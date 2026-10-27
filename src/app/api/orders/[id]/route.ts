import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { ORDER_INCLUDE, toOrderDTO } from "@/lib/dto"
import { audit, notifyCustomer, notifyStaff, statusNotification } from "@/lib/notify"
import { getSession, requireStaff } from "@/lib/session"
import { tokenHash } from "@/lib/hash"
import { canTransitionOrder } from "@/lib/security/order-workflow"
import { ORDER_STATUS_LABELS, ORDER_STATUSES, type OrderStatus, type Role } from "@/lib/constants"
import { orderStatusUpdateTemplate } from "@/lib/email/templates"
import { escapeHtml, publicError, rejectOversizedRequest } from "@/lib/security/request"

type Params = { params: Promise<{ id: string }> }

function guestToken(request: Request): string | null {
  const value = request.headers.get("x-order-access-token")?.trim()
  return value && value.length <= 256 ? value : null
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params
  const session = await getSession()
  const order = await db.order.findUnique({ where: { id }, include: ORDER_INCLUDE })
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 })

  const role = session?.staffRole as Role | undefined
  const staffCanView = Boolean(session?.staffId) && (
    role !== "RIDER" || (order.riderId === session?.staffId && order.fulfillment === "DELIVERY")
  )
  const ownerCanView = Boolean(session?.userId && order.userId === session.userId)
  const accessToken = guestToken(request)
  const guestCanView = Boolean(
    accessToken && order.guestAccessTokenHash && order.guestAccessExpiresAt &&
    order.guestAccessExpiresAt > new Date() && tokenHash(accessToken) === order.guestAccessTokenHash
  )

  if (!staffCanView && !ownerCanView && !guestCanView) {
    return NextResponse.json({ error: session ? "You do not have access to this order." : "An order access token or sign-in is required." }, { status: session ? 403 : 401 })
  }
  return NextResponse.json(toOrderDTO(order))
}

export async function PATCH(request: Request, { params }: Params) {
  const { session, error } = await requireStaff()
  if (error) return error
  const tooLarge = rejectOversizedRequest(request, 16_384)
  if (tooLarge) return tooLarge

  try {
    const { id } = await params
    const order = await db.order.findUnique({ where: { id }, include: ORDER_INCLUDE })
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 })

    const role = session.staffRole as Role
    if (role === "RIDER" && (order.riderId !== session.staffId || order.fulfillment !== "DELIVERY")) {
      return NextResponse.json({ error: "This delivery is not assigned to you." }, { status: 403 })
    }

    const body = await request.json()
    const status = String(body.status ?? "") as OrderStatus
    const note = body.note ? String(body.note).trim().slice(0, 500) : undefined
    if (!ORDER_STATUSES.includes(status)) return NextResponse.json({ error: "Unknown order status." }, { status: 400 })
    if (order.status === status) return NextResponse.json(toOrderDTO(order))
    if (status === "CANCELLED") return NextResponse.json({ error: "Use the cancellation action so reserved stock and loyalty are restored safely." }, { status: 409 })
    if (status === "REFUNDED") return NextResponse.json({ error: "Use the refund action so the payment provider confirms the refund." }, { status: 409 })
    if (status === "PAID" && !order.payments.some((payment) => payment.status === "SUCCESS")) {
      return NextResponse.json({ error: "Confirm the payment through M-Pesa, the provider webhook or the cash-received action before marking an order paid." }, { status: 409 })
    }
    if (status === "READY_FOR_PICKUP" && order.prescriptions.some((rx) => !["APPROVED", "PARTIALLY_APPROVED"].includes(rx.status))) {
      return NextResponse.json({ error: "Review all prescription items before marking this order ready for collection or dispatch." }, { status: 409 })
    }
    if (status === "COMPLETED_PICKUP" && order.fulfillment !== "PICKUP") {
      return NextResponse.json({ error: "Delivery orders must be dispatched to a rider, not completed as pickups." }, { status: 409 })
    }
    if (status === "COMPLETED_DELIVERY" && order.fulfillment !== "DELIVERY") {
      return NextResponse.json({ error: "Pickup orders cannot be marked as delivered." }, { status: 409 })
    }
    if (status === "OUT_FOR_DELIVERY" && (order.fulfillment !== "DELIVERY" || !order.riderId)) {
      return NextResponse.json({ error: "Assign an active rider to this delivery before dispatching it." }, { status: 409 })
    }
    if (status === "COMPLETED_DELIVERY" && !order.payments.some((payment) => payment.status === "SUCCESS")) {
      return NextResponse.json({ error: "Confirm the customer's M-Pesa or cash payment before marking the delivery complete." }, { status: 409 })
    }
    if (!canTransitionOrder(order.status as OrderStatus, status, role)) {
      return NextResponse.json({ error: `The order cannot move from ${order.status} to ${status}.` }, { status: 409 })
    }

    const actor = session.staffName ?? "Staff"
    await db.$transaction(async (tx) => {
      const changed = await tx.order.updateMany({
        where: { id: order.id, version: order.version, status: order.status },
        data: { status, version: { increment: 1 } },
      })
      if (changed.count !== 1) throw new Error("ORDER_CONFLICT")
      await tx.orderStatusHistory.create({ data: { orderId: order.id, status, actor, note } })
    }, { timeout: 15000, maxWait: 5000 })
    await audit(actor, role, `ORDER_STATUS_${status}`, "Order", order.reference, note)

    const { title, message } = status === "READY_FOR_PICKUP" && order.fulfillment === "DELIVERY"
      ? { title: `Order ${order.reference}: Ready for dispatch`, message: `Your order ${order.reference} is packed and ready for dispatch. We will notify you when a rider starts delivery.` }
      : statusNotification(status, order.reference)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://spherepharmacy.co.ke"
    const orderUrl = `${appUrl}/orders/${order.id}`
    const customer = order.userId
      ? await db.user.findUnique({ where: { id: order.userId }, select: { name: true, email: true } })
      : null
    const email = orderStatusUpdateTemplate({
      orderReference: order.reference,
      customerName: customer?.name || order.guestName || "Valued Customer",
      statusLabel: status === "READY_FOR_PICKUP" && order.fulfillment === "DELIVERY" ? "Ready for dispatch" : ORDER_STATUS_LABELS[status], message,
      pickupCode: status === "READY_FOR_PICKUP" ? order.pickupCode : null, orderUrl,
    })
    await notifyCustomer(order.userId, "ORDER_STATUS", title, message, "IN_APP", {
      link: orderUrl,
      metadata: { orderId: order.id, status, reference: order.reference },
      email: (customer?.email || order.guestEmail) ? { to: customer?.email || order.guestEmail || undefined, ...email } : undefined,
    })

    if (status === "REJECTED") {
      await notifyStaff({
        roles: ["ADMIN", "PHARMACIST"], event: "ORDER_REJECTED",
        title: `Order ${order.reference} rejected`, message: `Order ${order.reference} was rejected by ${actor}.`,
        link: `${appUrl}/admin/orders`,
        details: { "Order Ref": order.reference, Actor: actor, Note: escapeHtml(note || "None") },
      })
    }

    const updated = await db.order.findUnique({ where: { id: order.id }, include: ORDER_INCLUDE })
    return NextResponse.json(toOrderDTO(updated!))
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_CONFLICT") {
      return NextResponse.json({ error: "The order changed while you were updating it. Refresh and try again." }, { status: 409 })
    }
    return publicError("Could not update the order status.")
  }
}
