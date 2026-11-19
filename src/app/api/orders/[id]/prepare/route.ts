import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { ORDER_INCLUDE, toOrderDTO } from "@/lib/dto"
import { audit, notifyCustomer } from "@/lib/notify"
import { requireStaff } from "@/lib/session"
import { rejectOversizedRequest, publicError } from "@/lib/security/request"
import { enqueueOrderPosDeduction } from "@/lib/pos-reconciliation"

type Params = { params: Promise<{ id: string }> }

/**
 * One deliberate staff action accepts the order and begins packing.
 * Unlike general status PATCH, it safely advances cash-on-delivery orders
 * without claiming money was received. All Rx reviews must be complete.
 */
export async function POST(request: Request, { params }: Params) {
  const { session, error } = await requireStaff(["ADMIN", "PHARMACIST", "STAFF"])
  if (error) return error
  const oversized = rejectOversizedRequest(request, 4096)
  if (oversized) return oversized

  try {
    const { id } = await params
    const order = await db.order.findUnique({ where: { id }, include: ORDER_INCLUDE })
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 })

    const paid = order.payments.some((p) => p.status === "SUCCESS")
    const cashOnDelivery = order.fulfillment === "DELIVERY" && order.paymentMethod === "CASH_ON_DELIVERY"
    const cashOnPickup = order.fulfillment === "PICKUP" && order.paymentMethod === "CASH_ON_PICKUP"
    const cashCanPrepare = (cashOnDelivery || cashOnPickup) && ["RECEIVED", "PRESCRIPTION_VERIFIED", "AVAILABILITY_CONFIRMED", "AWAITING_PAYMENT"].includes(order.status)
    if (!(order.status === "PAID" && paid) && !cashCanPrepare) {
      return NextResponse.json({ error: "Payment must be confirmed, or the order must explicitly be payable in cash at pickup or delivery." }, { status: 409 })
    }
    if (!order.inventoryReservedAt || order.inventoryReleasedAt) {
      return NextResponse.json({ error: "Stock has not been reserved or has been released. Resolve stock before packing." }, { status: 409 })
    }
    if (order.items.some((item) => item.requiresPrescription) && order.prescriptions.length === 0) {
      return NextResponse.json({ error: "Prescription-only medicines require an uploaded, approved prescription." }, { status: 409 })
    }
    if (order.prescriptions.some((rx) => !["APPROVED", "PARTIALLY_APPROVED"].includes(rx.status))) {
      return NextResponse.json({ error: "Pharmacist review is required before packing prescription medicines." }, { status: 409 })
    }
    if (!paid && order.payments.some((p) => ["PENDING", "PROCESSING", "REFUND_PENDING"].includes(p.status))) {
      return NextResponse.json({ error: "Payment is still being processed. Resolve it before switching to cash collection." }, { status: 409 })
    }
    const actor = session.staffName ?? "Pharmacy staff"
    const note = !paid && (cashOnDelivery || cashOnPickup)
      ? `Accepted for packing — collect cash on ${cashOnDelivery ? "delivery" : "pickup"}; payment not yet received`
      : "Accepted for packing — payment confirmed"
    await db.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: order.id, status: order.status, version: order.version },
        data: { status: "PREPARING", version: { increment: 1 } },
      })
      if (updated.count !== 1) throw new Error("ORDER_CONFLICT")
      await tx.orderStatusHistory.create({ data: { orderId: id, status: "PREPARING", actor, note } })
      await enqueueOrderPosDeduction(tx, order.id, order.paymentMethod ?? "CASH")
    })
    await audit(actor, session.staffRole, "ORDER_PREPARATION_STARTED", "Order", order.reference, note)
    await notifyCustomer(order.userId, "ORDER_STATUS", "Order being prepared",
      `Your order ${order.reference} is being packed by the pharmacy.`, "IN_APP",
      { link: `/orders/${order.id}`, metadata: { orderId: id, status: "PREPARING" } })

    const updated = await db.order.findUnique({ where: { id }, include: ORDER_INCLUDE })
    return NextResponse.json(toOrderDTO(updated!), { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    if (err instanceof Error && err.message === "ORDER_CONFLICT") {
      return NextResponse.json({ error: "Order changed since you opened it. Refresh the queue." }, { status: 409 })
    }
    return publicError("Could not start preparation. Please refresh and try again.")
  }
}
