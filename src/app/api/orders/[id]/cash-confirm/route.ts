import { notifyPaymentOutcome } from "@/lib/notifications/payment"
import { enqueueOrderPosDeduction } from "@/lib/pos-reconciliation"
import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { ORDER_INCLUDE, toOrderDTO } from "@/lib/dto"
import { audit } from "@/lib/notify"
import { requireStaff } from "@/lib/session"
import { pointsForAmount } from "@/lib/constants"
import { enforceRateLimit, publicError } from "@/lib/security/request"

type Params = { params: Promise<{ id: string }> }
const CASH_ALLOWED = ["AVAILABILITY_CONFIRMED", "AWAITING_PAYMENT", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY"]

/** Confirm cash only after a staff member physically receives it. */
export async function POST(request: Request, { params }: Params) {
  const { session, error } = await requireStaff()
  if (error) return error
  const limited = await enforceRateLimit(request, "cash-confirm", 20, 15 * 60_000)
  if (limited) return limited

  try {
    const { id } = await params
    const order = await db.order.findUnique({ where: { id }, include: ORDER_INCLUDE })
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 })
    if (session.staffRole === "RIDER" && (order.fulfillment !== "DELIVERY" || order.paymentMethod !== "CASH_ON_DELIVERY" || order.riderId !== session.staffId || order.status !== "OUT_FOR_DELIVERY")) {
      return NextResponse.json({ error: "Riders may only confirm cash for their assigned delivery while it is out for delivery." }, { status: 403 })
    }
    if (!CASH_ALLOWED.includes(order.status)) return NextResponse.json({ error: "Cash cannot be confirmed at this stage." }, { status: 409 })
    if (order.prescriptions.some((rx) => !["APPROVED", "PARTIALLY_APPROVED"].includes(rx.status))) {
      return NextResponse.json({ error: "Every prescription must be reviewed before payment is accepted." }, { status: 409 })
    }
    if (order.payments.some((payment) => payment.status === "SUCCESS")) return NextResponse.json({ error: "This order already has a successful payment." }, { status: 409 })

    const actor = session.staffName ?? "Staff"
    const earned = order.userId ? pointsForAmount(Number(order.total)) : 0
    await db.$transaction(async (tx) => {
      if (await tx.payment.findFirst({ where: { orderId: order.id, status: { in: ["PENDING", "PROCESSING", "SUCCESS", "REFUND_PENDING", "REFUNDED"] } } })) throw new Error("ORDER_CONFLICT")
      const cashPayment = await tx.payment.create({
        data: {
          orderId: order.id, provider: "CASH",
          method: order.fulfillment === "DELIVERY" ? "CASH_ON_DELIVERY" : "CASH_ON_PICKUP",
          status: "SUCCESS", amount: order.total, currency: "KES",
          idempotencyKey: `cash:${order.id}`, providerReference: `CASH-${order.reference}`,
        },
      })
      await notifyPaymentOutcome(tx, { paymentId: cashPayment.id, orderId: order.id, success: true })
      await enqueueOrderPosDeduction(tx, order.id, cashPayment.method)
      if (["AVAILABILITY_CONFIRMED", "AWAITING_PAYMENT"].includes(order.status)) {
        const changed = await tx.order.updateMany({ where: { id: order.id, version: order.version, status: order.status }, data: { status: "PAID", pointsEarned: earned, version: { increment: 1 } } })
        if (changed.count !== 1) throw new Error("ORDER_CONFLICT")
        await tx.orderStatusHistory.create({ data: { orderId: order.id, status: "PAID", actor, note: "Cash payment received" } })
      } else if (earned > 0) {
        await tx.order.update({ where: { id: order.id }, data: { pointsEarned: earned, version: { increment: 1 } } })
      }
      if (order.userId && earned > 0) {
        await tx.loyaltyLedger.create({ data: { eventKey: `earn:${order.id}`, userId: order.userId, orderId: order.id, delta: earned, reason: "PAYMENT_CAPTURED" } })
        await tx.user.update({ where: { id: order.userId }, data: { loyaltyPoints: { increment: earned } } })
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000, maxWait: 5000 })

    await audit(actor, session.staffRole, "CASH_CONFIRMED", "Order", order.reference, `KSh ${Number(order.total).toFixed(2)} received in cash`)
    const updated = await db.order.findUnique({ where: { id: order.id }, include: ORDER_INCLUDE })
    return NextResponse.json(toOrderDTO(updated!))
  } catch (error) {
    if (error instanceof Error && (error.message === "ORDER_CONFLICT" || error.message.includes("Unique constraint"))) {
      return NextResponse.json({ error: "Cash was already confirmed or the order changed. Refresh before retrying." }, { status: 409 })
    }
    return publicError("Could not confirm the cash payment.")
  }
}
