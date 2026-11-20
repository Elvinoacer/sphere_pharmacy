import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { orderReference, pickupCode } from "@/lib/hash"
import { audit, notifyCustomer, notifyStaff } from "@/lib/notify"
import { requireCustomer } from "@/lib/session"
import { money } from "@/lib/security/payment"
import { enforceRateLimit, publicError, rejectOversizedRequest } from "@/lib/security/request"
import { InventoryGuard } from "@/lib/inventory-guard"
import { computeDeliveryFee, getSettings } from "@/lib/settings"
import {
  computeRefillOrderTotals,
  isOrderActiveForRefill,
  isOrderCancelledOrRejected,
  normalizeRefillPaymentMethod,
} from "@/lib/prescriptions/refill-core"

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  const { session, error } = await requireCustomer()
  if (error) return error
  const tooLarge = rejectOversizedRequest(request, 16_384)
  if (tooLarge) return tooLarge
  const limited = await enforceRateLimit(request, "prescription-refill", 5, 24 * 60 * 60_000, session.userId!)
  if (limited) return limited

  try {
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const requestedRx = await db.prescription.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        deletedAt: true,
        parentPrescriptionId: true,
      },
    })
    if (!requestedRx || requestedRx.userId !== session.userId || requestedRx.deletedAt) {
      return NextResponse.json({ error: "Prescription not found." }, { status: 404 })
    }

    // If the customer triggers a refill from a completed refill order's child prescription,
    // transparently resolve to the authoritative parent prescription holding the refill allowance.
    const rootPrescriptionId = requestedRx.parentPrescriptionId ?? requestedRx.id
    const rx = await db.prescription.findUnique({
      where: { id: rootPrescriptionId },
      include: {
        order: { include: { items: true } },
        childRefills: {
          where: { deletedAt: null },
          include: { order: { select: { id: true, reference: true, status: true } } },
        },
      },
    })
    if (!rx || rx.userId !== session.userId || rx.deletedAt) {
      return NextResponse.json({ error: "Prescription not found." }, { status: 404 })
    }
    if (!["APPROVED", "PARTIALLY_APPROVED"].includes(rx.status)) {
      return NextResponse.json({ error: "Only approved prescriptions can be refilled." }, { status: 409 })
    }
    if (rx.refillsUsed >= rx.refillsAllowed) {
      return NextResponse.json({ error: "No refills remain on this prescription." }, { status: 409 })
    }
    if (!rx.validUntil || rx.validUntil < new Date()) {
      return NextResponse.json({ error: "This prescription has expired. Upload a current prescription." }, { status: 409 })
    }

    const sourceOrder = rx.order
    if (!sourceOrder) {
      return NextResponse.json({ error: "No prescription medicines are linked to this document." }, { status: 409 })
    }
    if (isOrderCancelledOrRejected(sourceOrder.status)) {
      return NextResponse.json(
        { error: "Refills are not available for a cancelled, rejected, or refunded order." },
        { status: 409 }
      )
    }

    const activeRefill = rx.childRefills.find((child) => child.order && isOrderActiveForRefill(child.order.status))
    if (activeRefill?.order) {
      return NextResponse.json(
        {
          error: `A refill order (${activeRefill.order.reference}) is already in progress for this prescription.`,
          activeOrderId: activeRefill.order.id,
          activeOrderReference: activeRefill.order.reference,
        },
        { status: 409 }
      )
    }

    const sourceItems = sourceOrder.items.filter((item) => item.requiresPrescription && item.productId)
    if (sourceItems.length === 0) {
      return NextResponse.json({ error: "No prescription medicines are linked to this document." }, { status: 409 })
    }

    const products = await db.product.findMany({ where: { id: { in: sourceItems.map((item) => item.productId!) } } })
    const lines = sourceItems.map((item) => ({ item, product: products.find((product) => product.id === item.productId) }))
    if (
      lines.some(
        ({ item, product }) =>
          !product ||
          !product.active ||
          product.stockStatus === "DISCONTINUED" ||
          InventoryGuard.getAvailableStock(product) < item.qty
      )
    ) {
      return NextResponse.json(
        { error: "One or more prescribed medicines are unavailable in the required quantity." },
        { status: 409 }
      )
    }

    // Optional fulfillment, delivery address, and payment preference overrides; defaults
    // inherit safely from the original prescription order.
    const requestedFulfillment =
      body.fulfillment === "PICKUP" || body.fulfillment === "DELIVERY"
        ? body.fulfillment
        : sourceOrder.fulfillment === "DELIVERY"
          ? "DELIVERY"
          : "PICKUP"

    let deliveryAddress: string | null = requestedFulfillment === "DELIVERY" ? sourceOrder.deliveryAddress : null
    let deliveryArea: string | null = requestedFulfillment === "DELIVERY" ? sourceOrder.deliveryArea : null
    let deliveryNotes: string | null = requestedFulfillment === "DELIVERY" ? sourceOrder.deliveryNotes : null
    let deliveryLatitude: number | null = requestedFulfillment === "DELIVERY" ? sourceOrder.deliveryLatitude : null
    let deliveryLongitude: number | null = requestedFulfillment === "DELIVERY" ? sourceOrder.deliveryLongitude : null

    if (requestedFulfillment === "DELIVERY") {
      if (body.addressId) {
        const saved = await db.address.findFirst({
          where: { id: String(body.addressId), userId: session.userId! },
        })
        if (!saved) {
          return NextResponse.json({ error: "Selected delivery address was not found." }, { status: 400 })
        }
        deliveryAddress = saved.text
        deliveryArea = saved.area || (body.deliveryArea ? String(body.deliveryArea).trim().slice(0, 100) : null)
        deliveryNotes = body.deliveryNotes ? String(body.deliveryNotes).trim().slice(0, 500) : saved.notes
        deliveryLatitude = saved.latitude
        deliveryLongitude = saved.longitude
      } else if (body.deliveryAddress) {
        deliveryAddress = String(body.deliveryAddress).trim().slice(0, 300) || null
        deliveryArea = body.deliveryArea ? String(body.deliveryArea).trim().slice(0, 100) : deliveryArea
        deliveryNotes = body.deliveryNotes ? String(body.deliveryNotes).trim().slice(0, 500) : deliveryNotes
        deliveryLatitude = body.deliveryLatitude == null ? null : Number(body.deliveryLatitude)
        deliveryLongitude = body.deliveryLongitude == null ? null : Number(body.deliveryLongitude)
      }
      if (!deliveryAddress) {
        return NextResponse.json({ error: "Enter or select a delivery address for this refill." }, { status: 400 })
      }
      if (deliveryLatitude != null && (!Number.isFinite(deliveryLatitude) || deliveryLatitude < -90 || deliveryLatitude > 90)) {
        return NextResponse.json({ error: "Invalid delivery latitude." }, { status: 400 })
      }
      if (deliveryLongitude != null && (!Number.isFinite(deliveryLongitude) || deliveryLongitude < -180 || deliveryLongitude > 180)) {
        return NextResponse.json({ error: "Invalid delivery longitude." }, { status: 400 })
      }
    }

    const paymentMethod = normalizeRefillPaymentMethod(
      typeof body.paymentMethod === "string" ? body.paymentMethod : sourceOrder.paymentMethod,
      requestedFulfillment
    )

    const rawSubtotal = money(lines.reduce((sum, line) => sum + Number(line.product!.price) * line.item.qty, 0))
    const settings = await getSettings()
    const computedDeliveryFee =
      requestedFulfillment === "DELIVERY"
        ? money(computeDeliveryFee(deliveryArea, settings.delivery, rawSubtotal, deliveryLatitude, deliveryLongitude))
        : 0
    const { subtotal, deliveryFee, total } = computeRefillOrderTotals({
      lines: lines.map(({ item, product }) => ({ price: Number(product!.price), qty: item.qty })),
      fulfillment: requestedFulfillment,
      deliveryFee: computedDeliveryFee,
    })

    const customerNotes = typeof body.notes === "string" ? body.notes.trim().slice(0, 600) : ""
    const reference = orderReference()
    const refillNumber = rx.refillsUsed + 1

    const order = await db.$transaction(async (tx) => {
      // Re-check inside Serializable tx so two simultaneous requests cannot both spawn active refills.
      const concurrentActive = await tx.prescription.findFirst({
        where: {
          parentPrescriptionId: rx.id,
          deletedAt: null,
          order: {
            status: {
              in: [
                "RECEIVED",
                "UNDER_REVIEW",
                "PRESCRIPTION_VERIFIED",
                "AVAILABILITY_CONFIRMED",
                "AWAITING_PAYMENT",
                "PAID",
                "PREPARING",
                "READY_FOR_PICKUP",
                "OUT_FOR_DELIVERY",
              ],
            },
          },
        },
        select: { id: true },
      })
      if (concurrentActive) throw new Error("ACTIVE_REFILL_CONFLICT")

      const claimed = await tx.prescription.updateMany({
        where: {
          id: rx.id,
          userId: session.userId!,
          deletedAt: null,
          status: { in: ["APPROVED", "PARTIALLY_APPROVED"] },
          refillsUsed: rx.refillsUsed,
          refillsAllowed: { gt: rx.refillsUsed },
          validUntil: { gte: new Date() },
        },
        data: { refillsUsed: { increment: 1 } },
      })
      if (claimed.count !== 1) throw new Error("REFILL_CONFLICT")

      const sortedLines = [...lines].sort((a, b) => a.product!.id.localeCompare(b.product!.id))
      for (const line of sortedLines) {
        const fresh = await tx.product.findUnique({
          where: { id: line.product!.id },
          select: {
            id: true,
            active: true,
            stockStatus: true,
            stockQty: true,
            stock: true,
            safetyStockBuffer: true,
            virtualReservedStock: true,
          },
        })
        if (!fresh || !fresh.active || fresh.stockStatus === "DISCONTINUED" || InventoryGuard.getAvailableStock(fresh) < line.item.qty) {
          throw new Error("STOCK_CONFLICT")
        }

        const minPhysicalRequired = line.item.qty + (fresh.safetyStockBuffer ?? 2) + Math.max(0, fresh.virtualReservedStock ?? 0)
        const reserved = await tx.product.updateMany({
          where: {
            id: line.product!.id,
            active: true,
            stockQty: { gte: minPhysicalRequired },
            ...(fresh.stock != null ? { stock: { gte: minPhysicalRequired } } : {}),
          },
          data:
            fresh.stock != null
              ? {
                  stockQty: { decrement: line.item.qty },
                  stock: { decrement: line.item.qty },
                }
              : {
                  stockQty: { decrement: line.item.qty },
                  stock: Math.max(0, fresh.stockQty - line.item.qty),
                },
        })
        if (reserved.count !== 1) throw new Error("STOCK_CONFLICT")

        const updatedProduct = await tx.product.findUnique({
          where: { id: line.product!.id },
          select: { stockQty: true, lowStockThreshold: true },
        })
        if (updatedProduct) {
          const inStock = updatedProduct.stockQty > 0
          const stockStatus =
            updatedProduct.stockQty <= 0
              ? 'OUT_OF_STOCK'
              : updatedProduct.stockQty <= updatedProduct.lowStockThreshold
              ? 'LOW_STOCK'
              : 'IN_STOCK'
          await tx.product.update({
            where: { id: line.product!.id },
            data: { inStock, stockStatus },
          })
        }
      }

      const orderNoteBase = `Refill #${refillNumber} of order ${sourceOrder.reference}`
      const created = await tx.order.create({
        data: {
          reference,
          userId: rx.userId,
          type: "PRESCRIPTION",
          status: "UNDER_REVIEW",
          fulfillment: requestedFulfillment,
          paymentMethod,
          deliveryFee,
          subtotal,
          total,
          pickupCode: requestedFulfillment === "PICKUP" ? pickupCode() : null,
          deliveryAddress,
          deliveryArea,
          deliveryNotes,
          deliveryLatitude,
          deliveryLongitude,
          refillOfOrderId: sourceOrder.id,
          notes: customerNotes ? `${orderNoteBase} — ${customerNotes}`.slice(0, 1000) : orderNoteBase,
          inventoryReservedAt: new Date(),
          items: {
            create: lines.map(({ item, product }) => ({
              productId: product!.id,
              name: product!.name,
              price: product!.price,
              qty: item.qty,
              requiresPrescription: true,
              lineTotal: money(Number(product!.price) * item.qty),
            })),
          },
          statusHistory: {
            create: {
              status: "UNDER_REVIEW",
              actor: "System",
              note: `Refill #${refillNumber} of ${rx.refillsAllowed} queued for pharmacist re-verification`,
            },
          },
        },
      })

      await tx.prescription.create({
        data: {
          userId: rx.userId,
          orderId: created.id,
          parentPrescriptionId: rx.id,
          refillNumber,
          fileName: rx.fileName,
          fileType: rx.fileType,
          fileData: null,
          fileUrl: null,
          storageKey: rx.storageKey,
          refillsAllowed: 0,
          refillsUsed: 0,
          validUntil: rx.validUntil,
          notes: `Refill #${refillNumber} of ${rx.refillsAllowed} (order ${sourceOrder.reference})`,
          status: "PENDING",
        },
      })

      return created
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000, maxWait: 5000 })

    const refillsRemaining = Math.max(0, rx.refillsAllowed - refillNumber)
    await audit(
      "System",
      null,
      "RX_REFILL_REQUESTED",
      "Prescription",
      rx.id,
      `Refill #${refillNumber}/${rx.refillsAllowed} -> order ${reference} (source ${sourceOrder.reference})`
    )
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://spherepharmacy.co.ke"
    const customer = await db.user.findUnique({ where: { id: rx.userId! }, select: { name: true, email: true } })
    await notifyCustomer(
      rx.userId,
      "PRESCRIPTION",
      `Refill #${refillNumber} requested — order ${reference}`,
      `Your refill order ${reference} (KSh ${total.toLocaleString()}) is queued for pharmacist re-verification.`,
      "IN_APP",
      {
        link: `${appUrl}/orders/${order.id}`,
        metadata: { orderId: order.id, prescriptionId: rx.id, reference, refillNumber },
        email: customer?.email
          ? {
              to: customer.email,
              subject: `Refill requested: ${reference}`,
              html: `<p>Your refill request (#${refillNumber} of ${rx.refillsAllowed}, order <strong>${reference}</strong>, total KSh ${total.toLocaleString()}) is awaiting pharmacist review.</p>`,
              text: `Refill #${refillNumber} (${reference}, KSh ${total.toLocaleString()}) is awaiting pharmacist review.`,
            }
          : undefined,
      }
    )
    await notifyStaff({
      roles: ["PHARMACIST", "ADMIN"],
      event: "RX_REFILL_REQUESTED",
      title: `Prescription refill #${refillNumber}: ${reference}`,
      message: `${customer?.name || "A customer"} requested refill #${refillNumber} of ${rx.refillsAllowed} (source ${sourceOrder.reference}).`,
      link: `${appUrl}/admin?section=prescriptions`,
      details: {
        Order: reference,
        "Source Order": sourceOrder.reference,
        Refill: `${refillNumber} of ${rx.refillsAllowed}`,
        Customer: customer?.name || "Customer",
      },
    })

    return NextResponse.json(
      {
        orderId: order.id,
        reference,
        refillNumber,
        refillsRemaining,
        subtotal,
        deliveryFee,
        total,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error && error.message === "ACTIVE_REFILL_CONFLICT") {
      return NextResponse.json(
        { error: "A refill order is already in progress for this prescription. Check your orders." },
        { status: 409 }
      )
    }
    if (error instanceof Error && ["REFILL_CONFLICT", "STOCK_CONFLICT"].includes(error.message)) {
      return NextResponse.json(
        { error: "The refill or stock changed while processing. Refresh and try again." },
        { status: 409 }
      )
    }
    return publicError("Could not request the refill.")
  }
}
