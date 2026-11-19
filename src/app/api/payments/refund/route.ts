import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { audit, notifyCustomer } from "@/lib/notify"
import { requireStaff } from "@/lib/session"
import { createIntaSendRefund, getIntaSendRefund } from "@/lib/intasend/client"
import { enforceRateLimit, escapeHtml, rejectOversizedRequest, publicError } from "@/lib/security/request"
import { cancelOrderPosDeduction } from "@/lib/pos-reconciliation"

const COMPLETE = new Set(["COMPLETED"])

async function finalizeRefund(paymentId: string, refundReference: string, actor: string) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { order: true } })
    if (!payment || payment.status === "REFUNDED") return { payment, changed: false }
    if (!['REFUND_PENDING', 'SUCCESS'].includes(payment.status)) throw new Error("REFUND_STATE")
    const changed = await tx.payment.updateMany({ where: { id: payment.id, status: { in: ["REFUND_PENDING", "SUCCESS"] } }, data: { status: "REFUNDED", refundReference } })
    if (!changed.count) return { payment, changed: false }
    await tx.order.update({ where: { id: payment.orderId }, data: { status: "REFUNDED", version: { increment: 1 } } })
    await tx.orderStatusHistory.create({ data: { orderId: payment.orderId, status: "REFUNDED", actor, note: `Provider-confirmed refund ${refundReference}` } })
    await cancelOrderPosDeduction(tx, payment.orderId, actor)
    if (payment.order.userId) {
      const user = await tx.user.findUnique({ where: { id: payment.order.userId }, select: { loyaltyPoints: true } })
      const clawback = Math.min(payment.order.pointsEarned, user?.loyaltyPoints || 0)
      if (clawback > 0) {
        await tx.loyaltyLedger.create({ data: { eventKey: `refund-earn:${payment.orderId}`, userId: payment.order.userId, orderId: payment.orderId, delta: -clawback, reason: "PAYMENT_REFUNDED" } })
        await tx.user.update({ where: { id: payment.order.userId }, data: { loyaltyPoints: { decrement: clawback } } })
      }
      if (payment.order.pointsRedeemed > 0) {
        await tx.loyaltyLedger.create({ data: { eventKey: `refund-redeem:${payment.orderId}`, userId: payment.order.userId, orderId: payment.orderId, delta: payment.order.pointsRedeemed, reason: "PAYMENT_REFUNDED" } })
        await tx.user.update({ where: { id: payment.order.userId }, data: { loyaltyPoints: { increment: payment.order.pointsRedeemed } } })
      }
    }
    return { payment, changed: true }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000, maxWait: 5000 })
}

export async function POST(request: Request) {
  const { session, error } = await requireStaff(["ADMIN"])
  if (error) return error
  const tooLarge = rejectOversizedRequest(request, 16_384)
  if (tooLarge) return tooLarge
  const limited = await enforceRateLimit(request, "refund", 10, 60 * 60_000, session.staffId!)
  if (limited) return limited

  try {
    const body = await request.json()
    const paymentId = String(body.paymentId || "")
    const reason = String(body.reason || "Customer refund").trim().slice(0, 100)
    const details = String(body.details || reason).trim().slice(0, 500)
    const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { order: true } })
    if (!payment) return NextResponse.json({ error: "Payment not found." }, { status: 404 })
    const actor = session.staffName || "Admin"

    if (payment.status === "SUCCESS") {
      if (payment.provider === "MPESA") return NextResponse.json({ error: "M-Pesa Express refunds must be completed and verified in the M-PESA organisation portal before recording them here." }, { status: 409 })
      if (payment.provider === "CASH") {
        const reference = String(body.cashRefundReference || "").trim()
        if (body.cashConfirmed !== true || !/^[A-Za-z0-9_-]{6,100}$/.test(reference)) return NextResponse.json({ error: "Confirm the cash was returned and provide the till/refund reference." }, { status: 400 })
        const result = await finalizeRefund(payment.id, `CASH:${reference}`, actor)
        if (result.changed) await sendRefundNotice(result.payment!, refundReference(result.payment!, `CASH:${reference}`))
        await audit(actor, "ADMIN", "CASH_REFUND_CONFIRMED", "Payment", payment.id, reference)
        return NextResponse.json({ ok: true, status: "REFUNDED", refundReference: `CASH:${reference}` })
      }
      if (payment.provider !== "INTASEND" || !payment.providerReference) return NextResponse.json({ error: "This payment has no supported provider refund reference." }, { status: 409 })
      const refund = await createIntaSendRefund(payment.providerReference, Number(payment.amount), reason, details)
      if (refund.invoiceId && refund.invoiceId !== payment.providerReference || Math.abs(refund.amount - Number(payment.amount)) > 0.001) return NextResponse.json({ error: "The provider returned mismatched refund details. No local refund was recorded." }, { status: 409 })
      await db.payment.update({ where: { id: payment.id }, data: { status: "REFUND_PENDING", refundReference: refund.id } })
      await audit(actor, "ADMIN", "REFUND_REQUESTED", "Payment", payment.id, `IntaSend ${refund.id}`)
      return NextResponse.json({ ok: true, status: "REFUND_PENDING", refundReference: refund.id })
    }

    if (payment.status === "REFUND_PENDING" && payment.provider === "INTASEND" && payment.refundReference) {
      const refund = await getIntaSendRefund(payment.refundReference)
      if (!COMPLETE.has(refund.state)) return NextResponse.json({ ok: true, status: "REFUND_PENDING", refundReference: refund.id })
      if (refund.invoiceId && payment.providerReference && refund.invoiceId !== payment.providerReference || Math.abs(refund.amount - Number(payment.amount)) > 0.001) return NextResponse.json({ error: "Refund reconciliation does not match the original payment." }, { status: 409 })
      const result = await finalizeRefund(payment.id, refund.id, actor)
      if (result.changed) await sendRefundNotice(result.payment!, refund.id)
      await audit(actor, "ADMIN", "PAYMENT_REFUNDED", "Payment", payment.id, `Provider confirmation ${refund.id}`)
      return NextResponse.json({ ok: true, status: "REFUNDED", refundReference: refund.id })
    }
    return NextResponse.json({ error: "Only captured or pending-refund payments can be processed." }, { status: 409 })
  } catch {
    return publicError("The refund provider is temporarily unavailable. No refund completion was recorded.", 503)
  }
}

function refundReference(payment: { refundReference: string | null }, fallback: string) { return payment.refundReference || fallback }

async function sendRefundNotice(payment: NonNullable<Awaited<ReturnType<typeof db.payment.findUnique>>> & { order: { id: string; reference: string; userId: string | null; guestEmail: string | null } }, reference: string) {
  const customer = payment.order.userId ? await db.user.findUnique({ where: { id: payment.order.userId }, select: { email: true } }) : null
  const email = customer?.email || payment.order.guestEmail
  const amount = Number(payment.amount)
  await notifyCustomer(payment.order.userId, "PAYMENT", `Refund confirmed — order ${payment.order.reference}`, `Your refund of KSh ${amount.toLocaleString()} was confirmed by the payment provider.`, "IN_APP", {
    link: `/orders/${payment.order.id}`, metadata: { orderId: payment.order.id, amount, refundReference: reference },
    email: email ? { to: email, subject: `Refund confirmed: ${payment.order.reference}`, html: `<p>Your refund of <strong>KSh ${escapeHtml(amount.toFixed(2))}</strong> for order <strong>${escapeHtml(payment.order.reference)}</strong> was confirmed.</p>`, text: `Refund of KSh ${amount.toFixed(2)} confirmed for ${payment.order.reference}. Reference: ${reference}` } : undefined,
  })
}
