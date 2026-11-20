import type { Prisma } from "@prisma/client"
import { cancelOrderPosDeduction } from "@/lib/pos-reconciliation"

/**
 * Idempotently returns any claimed refill slots attached to a cancelled, rejected,
 * or expired refill order back to their parent prescription.
 *
 * Structural idempotency: `refillReleasedAt` is stamped inside a conditional
 * `updateMany({ where: { id, refillReleasedAt: null } })` so concurrent cancel,
 * reject, or expiry-cron paths can never decrement `refillsUsed` twice.
 */
export async function releaseRefillSlotsForOrder(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<number> {
  const childPrescriptions = await tx.prescription.findMany({
    where: {
      orderId,
      parentPrescriptionId: { not: null },
      refillReleasedAt: null,
    },
    select: {
      id: true,
      parentPrescriptionId: true,
    },
  })

  if (childPrescriptions.length === 0) return 0

  let released = 0
  for (const child of childPrescriptions) {
    if (!child.parentPrescriptionId) continue
    const claimed = await tx.prescription.updateMany({
      where: {
        id: child.id,
        parentPrescriptionId: child.parentPrescriptionId,
        refillReleasedAt: null,
      },
      data: {
        refillReleasedAt: new Date(),
      },
    })
    if (claimed.count !== 1) continue

    await tx.$executeRaw`
      UPDATE "Prescription"
      SET "refillsUsed" = GREATEST(0, "refillsUsed" - 1)
      WHERE "id" = ${child.parentPrescriptionId}
    `
    released++
  }

  return released
}

/**
 * Safely releases reserved stock, redeemed loyalty points, dangling payment attempts,
 * outbound POS deductions, and claimed refill slots when an unpaid order is rejected
 * (either via pharmacist prescription review or direct staff order rejection).
 */
export async function releaseOrderResourcesOnReject(
  tx: Prisma.TransactionClient,
  orderId: string,
  actor: string,
  paymentFailureReason = "Order rejected before payment"
): Promise<{ inventoryRestored: boolean; refillsReleased: number }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      pointsRedeemed: true,
      inventoryReservedAt: true,
      inventoryReleasedAt: true,
      items: {
        select: {
          productId: true,
          qty: true,
        },
      },
    },
  })

  if (!order) return { inventoryRestored: false, refillsReleased: 0 }

  let inventoryRestored = false
  if (order.inventoryReservedAt && !order.inventoryReleasedAt) {
    const claimed = await tx.order.updateMany({
      where: {
        id: order.id,
        inventoryReservedAt: { not: null },
        inventoryReleasedAt: null,
      },
      data: {
        inventoryReleasedAt: new Date(),
      },
    })
    if (claimed.count === 1) {
      const sortedItems = [...order.items]
        .filter((item) => item.productId)
        .sort((a, b) => a.productId!.localeCompare(b.productId!))
      for (const item of sortedItems) {
        const updated = await tx.product.update({
          where: { id: item.productId! },
          data: {
            stockQty: { increment: item.qty },
            stock: { increment: item.qty },
            inStock: true,
          },
          select: { stockQty: true, lowStockThreshold: true },
        })
        const stockStatus =
          updated.stockQty <= 0
            ? "OUT_OF_STOCK"
            : updated.stockQty <= updated.lowStockThreshold
              ? "LOW_STOCK"
              : "IN_STOCK"
        await tx.product.update({
          where: { id: item.productId! },
          data: { stockStatus },
        })
      }
      inventoryRestored = true
    }
  }

  if (order.userId && order.pointsRedeemed > 0) {
    const existingRefund = await tx.loyaltyLedger.findFirst({
      where: {
        eventKey: { in: [`reject:${order.id}`, `cancel:${order.id}`, `expire:${order.id}`] },
      },
      select: { id: true },
    })
    if (!existingRefund) {
      await tx.loyaltyLedger.create({
        data: {
          eventKey: `reject:${order.id}`,
          userId: order.userId,
          orderId: order.id,
          delta: order.pointsRedeemed,
          reason: "ORDER_REJECTED",
        },
      })
      await tx.user.update({
        where: { id: order.userId },
        data: { loyaltyPoints: { increment: order.pointsRedeemed } },
      })
    }
  }

  await tx.payment.updateMany({
    where: {
      orderId: order.id,
      status: { in: ["PENDING", "PROCESSING"] },
    },
    data: {
      status: "FAILED",
      failureReason: paymentFailureReason,
    },
  })

  const refillsReleased = await releaseRefillSlotsForOrder(tx, order.id)
  await cancelOrderPosDeduction(tx, order.id, actor)

  return { inventoryRestored, refillsReleased }
}
