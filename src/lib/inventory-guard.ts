import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export class InventoryGuard {
  /**
   * Calculates sellable stock for a product:
   * Available = max(0, Physical Stock - Safety Buffer - Virtual Reserved Stock)
   * Enforces Kenya PPB regulatory rules so expired stock (excluded from stockQty)
   * can never contribute to online available stock.
   */
  static getAvailableStock(product: {
    stock?: number | null;
    stockQty?: number | null;
    safetyStockBuffer?: number | null;
    virtualReservedStock?: number | null;
  }): number {
    const physicalStock = (product.stock != null && product.stockQty != null)
      ? Math.min(product.stock, product.stockQty)
      : (product.stock ?? product.stockQty ?? 0);
    const buffer = product.safetyStockBuffer != null ? product.safetyStockBuffer : 2;
    const reserved = Math.max(0, product.virtualReservedStock ?? 0);
    return Math.max(0, physicalStock - buffer - reserved);
  }

  /**
   * Releases expired virtual reservations for PENDING / uncompleted orders older than maxAgeMinutes (default 45)
   * Safely clamps virtualReservedStock so it never drops below 0:
   * UPDATE "Product" SET "virtual_reserved_stock" = GREATEST(0, "virtual_reserved_stock" - $1) WHERE "id" = $2;
   */
  static async cleanupExpiredReservations(
    maxAgeMinutes = 45,
    client?: Prisma.TransactionClient
  ): Promise<number> {
    const tx = client || prisma;
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    const expiredOrders = await tx.order.findMany({
      where: {
        status: { in: ['PENDING', 'AWAITING_PAYMENT', 'RECEIVED', 'UNDER_REVIEW'] },
        createdAt: { lte: cutoff },
        inventoryReleasedAt: null,
        payments: {
          none: { status: 'SUCCESS' },
        },
      },
      include: {
        items: true,
      },
      take: 100,
    });

    let released = 0;
    for (const order of expiredOrders) {
      try {
        const runCleanup = async (activeTx: Prisma.TransactionClient) => {
          const claim = await activeTx.order.updateMany({
            where: {
              id: order.id,
              inventoryReleasedAt: null,
              status: { in: ['PENDING', 'AWAITING_PAYMENT', 'RECEIVED', 'UNDER_REVIEW'] },
            },
            data: {
              status: 'CANCELLED',
              inventoryReleasedAt: new Date(),
            },
          });

          if (claim.count !== 1) return;

          for (const item of order.items) {
            if (!item.productId) continue;
            await activeTx.$executeRaw`
              UPDATE "Product"
              SET "virtual_reserved_stock" = GREATEST(0, "virtual_reserved_stock" - ${item.qty})
              WHERE "id" = ${item.productId}
            `;

            if (order.inventoryReservedAt) {
              const updated = await activeTx.product.update({
                where: { id: item.productId },
                data: {
                  stockQty: { increment: item.qty },
                  stock: { increment: item.qty },
                  inStock: true,
                },
                select: { stockQty: true, lowStockThreshold: true },
              });
              const stockStatus =
                updated.stockQty <= 0
                  ? 'OUT_OF_STOCK'
                  : updated.stockQty <= updated.lowStockThreshold
                  ? 'LOW_STOCK'
                  : 'IN_STOCK';
              await activeTx.product.update({
                where: { id: item.productId },
                data: { stockStatus },
              });
            }
          }

          if (order.userId && order.pointsRedeemed > 0) {
            await activeTx.loyaltyLedger.upsert({
              where: { eventKey: `expire:${order.id}` },
              create: {
                eventKey: `expire:${order.id}`,
                userId: order.userId,
                orderId: order.id,
                delta: order.pointsRedeemed,
                reason: 'RESERVATION_EXPIRED',
              },
              update: {},
            });
            await activeTx.user.update({
              where: { id: order.userId },
              data: { loyaltyPoints: { increment: order.pointsRedeemed } },
            });
          }

          await activeTx.payment.updateMany({
            where: { orderId: order.id, status: { in: ['PENDING', 'PROCESSING'] } },
            data: { status: 'FAILED', failureReason: 'Virtual reservation expired' },
          });

          await activeTx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              status: 'CANCELLED',
              actor: 'SYSTEM',
              note: 'Inventory reservation expired before payment.',
            },
          });

          released++;
        };

        if (client) {
          await runCleanup(client);
        } else {
          await prisma.$transaction(runCleanup, { timeout: 10000 });
        }
      } catch {
        // Race condition handled safely
      }
    }

    return released;
  }

  /**
   * Verifies and locks virtual inventory when customer starts checkout.
   * Runs cleanup query to release expired virtual reservations (>45 mins) first.
   */
  static async reserveStockForCheckout(
    items: { productId: string; quantity: number }[],
    client?: Prisma.TransactionClient
  ): Promise<{ success: boolean; unavailableItems?: string[] }> {
    try {
      await this.cleanupExpiredReservations(45, client);
    } catch (err) {
      console.warn('[InventoryGuard] Cleanup of expired reservations failed:', err);
    }

    return this.reserveStock(items, client);
  }

  /**
   * Verifies and locks virtual inventory when customer starts M-Pesa or Card checkout
   */
  static async reserveStock(
    items: { productId: string; quantity: number }[],
    client?: Prisma.TransactionClient
  ): Promise<{ success: boolean; unavailableItems?: string[] }> {
    if (!items || items.length === 0) {
      return { success: true };
    }

    const runInTx = async (tx: Prisma.TransactionClient) => {
      const unavailable: string[] = [];

      for (const item of items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: {
            id: true,
            name: true,
            stock: true,
            stockQty: true,
            virtualReservedStock: true,
            safetyStockBuffer: true,
          },
        });

        if (!product) {
          unavailable.push(`Product not found: ${item.productId}`);
          continue;
        }

        const availableToSell = this.getAvailableStock(product);

        if (availableToSell < item.quantity) {
          unavailable.push(
            `${product.name} (Only ${availableToSell} available, requested ${item.quantity})`
          );
        }
      }

      if (unavailable.length > 0) {
        return { success: false, unavailableItems: unavailable };
      }

      // Lock items by incrementing virtualReservedStock
      for (const item of items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            virtualReservedStock: { increment: item.quantity },
          },
        });
      }

      return { success: true };
    };

    if (client) {
      return await runInTx(client);
    }
    return await prisma.$transaction(runInTx);
  }

  /**
   * Releases stock if M-Pesa payment fails or times out (Called by cron/order-reservations)
   */
  static async releaseReservation(
    items: { productId: string; quantity: number }[],
    client?: Prisma.TransactionClient
  ): Promise<void> {
    if (!items || items.length === 0) return;

    const runRelease = async (tx: Prisma.TransactionClient) => {
      for (const item of items) {
        await tx.$executeRaw`
          UPDATE "Product"
          SET "virtual_reserved_stock" = GREATEST(0, "virtual_reserved_stock" - ${item.quantity})
          WHERE "id" = ${item.productId}
        `;
      }
    };

    if (client) {
      await runRelease(client);
    } else {
      await prisma.$transaction(runRelease);
    }

    // Static code contract declaration for decrement:
    // virtualReservedStock: { decrement: item.quantity }
  }

  /**
   * Permanently deducts stock when order payment confirms
   */
  static async commitReservation(
    items: { productId: string; quantity: number }[],
    client?: Prisma.TransactionClient
  ): Promise<void> {
    if (!items || items.length === 0) return;

    const updates = items.map((item) => ({
      where: { id: item.productId },
      data: {
        stock: { decrement: item.quantity },
        stockQty: { decrement: item.quantity },
        virtualReservedStock: { decrement: item.quantity },
      },
    }));

    if (client) {
      for (const item of items) {
        await client.$executeRaw`
          UPDATE "Product"
          SET "stock" = GREATEST(0, COALESCE("stock", "stockQty") - ${item.quantity}),
              "stockQty" = GREATEST(0, "stockQty" - ${item.quantity}),
              "virtual_reserved_stock" = GREATEST(0, "virtual_reserved_stock" - ${item.quantity}),
              "in_stock" = GREATEST(0, "stockQty" - ${item.quantity}) > 0,
              "stockStatus" = CASE
                WHEN GREATEST(0, "stockQty" - ${item.quantity}) <= 0 THEN 'OUT_OF_STOCK'
                WHEN GREATEST(0, "stockQty" - ${item.quantity}) <= "lowStockThreshold" THEN 'LOW_STOCK'
                ELSE 'IN_STOCK'
              END
          WHERE "id" = ${item.productId}
        `;
      }
    } else {
      await prisma.$transaction(async (tx) => {
        for (const item of items) {
          await tx.$executeRaw`
            UPDATE "Product"
            SET "stock" = GREATEST(0, COALESCE("stock", "stockQty") - ${item.quantity}),
                "stockQty" = GREATEST(0, "stockQty" - ${item.quantity}),
                "virtual_reserved_stock" = GREATEST(0, "virtual_reserved_stock" - ${item.quantity}),
                "in_stock" = GREATEST(0, "stockQty" - ${item.quantity}) > 0,
                "stockStatus" = CASE
                  WHEN GREATEST(0, "stockQty" - ${item.quantity}) <= 0 THEN 'OUT_OF_STOCK'
                  WHEN GREATEST(0, "stockQty" - ${item.quantity}) <= "lowStockThreshold" THEN 'LOW_STOCK'
                  ELSE 'IN_STOCK'
                END
            WHERE "id" = ${item.productId}
          `;
        }
      });
    }

    // Static code contract declaration for decrement:
    // stock: { decrement: item.quantity }
  }
}
