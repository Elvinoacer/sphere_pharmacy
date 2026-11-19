import { notifyPaymentOutcome } from "@/lib/notifications/payment"
import { enqueueOrderPosDeduction } from "@/lib/pos-reconciliation"
import { createHash, timingSafeEqual } from "crypto"
import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { pointsForAmount } from "@/lib/constants"
import { db } from "@/lib/db"
import { queryStkPush } from "@/lib/mpesa/daraja"
import { paymentMatchesExpected } from "@/lib/security/payment"

interface CallbackItem { Name: string; Value?: string | number }

function validCallbackToken(request: Request): boolean {
  const expected = process.env.MPESA_CALLBACK_TOKEN || ""
  const provided = new URL(request.url).searchParams.get("token") || ""
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  return expected.length >= 24 && a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  if (!validCallbackToken(request)) return NextResponse.json({ error: "Invalid callback authentication." }, { status: 401 })
  const raw = await request.text()
  let body: { Body?: { stkCallback?: Record<string, unknown> } }
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }) }
  const callback = body.Body?.stkCallback
  if (!callback) return NextResponse.json({ error: "Invalid Daraja callback payload." }, { status: 400 })
  const checkoutRequestId = String(callback.CheckoutRequestID || "")
  const resultCode = Number(callback.ResultCode)
  if (!checkoutRequestId || !Number.isInteger(resultCode)) return NextResponse.json({ error: "Incomplete callback payload." }, { status: 400 })
  const items = ((callback.CallbackMetadata as { Item?: CallbackItem[] } | undefined)?.Item || [])
  const value = (name: string) => items.find((item) => item.Name === name)?.Value
  const receipt = value("MpesaReceiptNumber") ? String(value("MpesaReceiptNumber")) : null
  const phone = value("PhoneNumber") ? String(value("PhoneNumber")) : null
  const amount = value("Amount")
  const payment = await db.payment.findUnique({ where: { provider_checkoutRequestId: { provider: "MPESA", checkoutRequestId } }, include: { order: true } })
  if (!payment) return NextResponse.json({ error: "Unknown payment attempt." }, { status: 404 })
  const eventId = `mpesa:${checkoutRequestId}:${resultCode}:${receipt || "none"}`
  const payloadHash = createHash("sha256").update(raw).digest("hex")
  const priorEvent = await db.paymentWebhookEvent.findUnique({ where: { eventId } })
  if (priorEvent && (priorEvent.paymentId !== payment.id)) return NextResponse.json({ error: "Conflicting callback replay." }, { status: 409 })
  if (priorEvent) return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" })

  try {
    let awarded = 0
    if (resultCode === 0) {
      const providerStatus = await queryStkPush(checkoutRequestId)
      if (providerStatus.status !== "SUCCESS" || !paymentMatchesExpected({ expectedAmount: payment.amount, actualAmount: amount, expectedCurrency: payment.currency, actualCurrency: "KES", expectedPhone: payment.phone, actualPhone: phone, receipt })) return NextResponse.json({ error: "Payment verification mismatch." }, { status: 409 })
      await db.$transaction(async (tx) => {
        if (await tx.paymentWebhookEvent.findUnique({ where: { eventId } })) return
        await tx.paymentWebhookEvent.create({ data: { provider: "MPESA", eventId, payloadHash, paymentId: payment.id } })
        const changed = await tx.payment.updateMany({ where: { id: payment.id, status: { in: ["PENDING", "PROCESSING", "FAILED"] } }, data: { status: "SUCCESS", providerReference: receipt, failureReason: null } })
        if (changed.count === 0) return
        await notifyPaymentOutcome(tx, { paymentId: payment.id, orderId: payment.orderId, success: true })
        const moved = await tx.order.updateMany({ where: { id: payment.orderId, status: { in: ["AWAITING_PAYMENT", "AVAILABILITY_CONFIRMED", "PRESCRIPTION_VERIFIED"] } }, data: { status: "PAID", version: { increment: 1 } } })
        if (moved.count) await tx.orderStatusHistory.create({ data: { orderId: payment.orderId, status: "PAID", actor: "System", note: `M-Pesa payment confirmed (${receipt})` } })
        await enqueueOrderPosDeduction(tx, payment.orderId, "MPESA")
        if (payment.order.userId) {
          awarded = pointsForAmount(Number(payment.amount))
          if (awarded > 0) {
            await tx.loyaltyLedger.create({ data: { eventKey: `earn:${payment.orderId}`, userId: payment.order.userId, orderId: payment.orderId, delta: awarded, reason: "PAYMENT_CAPTURED" } })
            await tx.user.update({ where: { id: payment.order.userId }, data: { loyaltyPoints: { increment: awarded } } })
            await tx.order.update({ where: { id: payment.orderId }, data: { pointsEarned: awarded } })
          }
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000, maxWait: 5000 })
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" })
    }

    await db.$transaction(async (tx) => {
      if (await tx.paymentWebhookEvent.findUnique({ where: { eventId } })) return
      await tx.paymentWebhookEvent.create({ data: { provider: "MPESA", eventId, payloadHash, paymentId: payment.id } })
      const failedPayment = await tx.payment.updateMany({ where: { id: payment.id, status: { in: ["PENDING", "PROCESSING", "FAILED"] } }, data: { status: "FAILED", failureReason: `M-Pesa request failed (${resultCode})` } })
      if (failedPayment.count) await notifyPaymentOutcome(tx, { paymentId: payment.id, orderId: payment.orderId, success: false })
    }, { timeout: 15000, maxWait: 5000 })
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" })
  } catch {
    return NextResponse.json({ error: "Callback processing failed." }, { status: 503 })
  }
}
