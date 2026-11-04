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

    const updates = items.map((item) => ({
      where: { id: item.productId },
      data: {
        virtualReservedStock: { decrement: item.quantity },
      },
    }));

    if (client) {
      for (const u of updates) {
        await client.product.update(u);
      }
    } else {
      await prisma.$transaction(
        updates.map((u) => prisma.product.update(u))
      );
    }
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
      for (const u of updates) {
        await client.product.update(u);
      }
    } else {
      await prisma.$transaction(
        updates.map((u) => prisma.product.update(u))
      );
    }
  }
}
