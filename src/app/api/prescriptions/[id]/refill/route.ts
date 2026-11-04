import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { orderReference, pickupCode } from "@/lib/hash"
import { audit, notifyCustomer, notifyStaff } from "@/lib/notify"
import { requireCustomer } from "@/lib/session"
import { money } from "@/lib/security/payment"
import { enforceRateLimit, publicError } from "@/lib/security/request"
import { InventoryGuard } from "@/lib/inventory-guard"

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  const { session, error } = await requireCustomer()
  if (error) return error
  const limited = await enforceRateLimit(request, "prescription-refill", 5, 24 * 60 * 60_000)
  if (limited) return limited

  try {
    const { id } = await params
    const rx = await db.prescription.findUnique({ where: { id }, include: { order: { include: { items: true } } } })
    if (!rx || rx.userId !== session.userId || rx.deletedAt) return NextResponse.json({ error: "Prescription not found." }, { status: 404 })
    if (!["APPROVED", "PARTIALLY_APPROVED"].includes(rx.status)) return NextResponse.json({ error: "Only approved prescriptions can be refilled." }, { status: 409 })
    if (rx.refillsUsed >= rx.refillsAllowed) return NextResponse.json({ error: "No refills remain on this prescription." }, { status: 409 })
    if (!rx.validUntil || rx.validUntil < new Date()) return NextResponse.json({ error: "This prescription has expired. Upload a current prescription." }, { status: 409 })

    const sourceOrder = rx.order
    const sourceItems = sourceOrder?.items.filter((item) => item.requiresPrescription && item.productId) ?? []
    if (!sourceOrder || sourceItems.length === 0) return NextResponse.json({ error: "No prescription medicines are linked to this document." }, { status: 409 })
    const products = await db.product.findMany({ where: { id: { in: sourceItems.map((item) => item.productId!) } } })
    const lines = sourceItems.map((item) => ({ item, product: products.find((product) => product.id === item.productId) }))
    if (lines.some(({ item, product }) => !product || !product.active || product.stockStatus === "DISCONTINUED" || InventoryGuard.getAvailableStock(product) < item.qty)) {
      return NextResponse.json({ error: "One or more prescribed medicines are unavailable in the required quantity." }, { status: 409 })
    }

    const subtotal = money(lines.reduce((sum, line) => sum + Number(line.product!.price) * line.item.qty, 0))
    const reference = orderReference()
    const order = await db.$transaction(async (tx) => {
      const claimed = await tx.prescription.updateMany({
        where: { id: rx.id, userId: session.userId!, refillsUsed: rx.refillsUsed, refillsAllowed: { gt: rx.refillsUsed }, validUntil: { gte: new Date() } },
        data: { refillsUsed: { increment: 1 } },
      })
      if (claimed.count !== 1) throw new Error("REFILL_CONFLICT")
      for (const line of lines) {
        const reserved = await tx.product.updateMany({
          where: { id: line.product!.id, active: true, stockQty: { gte: line.item.qty } },
          data: {
            stockQty: { decrement: line.item.qty },
            stock: { decrement: line.item.qty },
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
      const created = await tx.order.create({
        data: {
          reference, userId: rx.userId, type: "PRESCRIPTION", status: "UNDER_REVIEW", fulfillment: sourceOrder.fulfillment,
          subtotal, total: subtotal, pickupCode: sourceOrder.fulfillment === "PICKUP" ? pickupCode() : null,
          deliveryAddress: sourceOrder.deliveryAddress, deliveryArea: sourceOrder.deliveryArea,
          notes: `Refill of order ${sourceOrder.reference}`, inventoryReservedAt: new Date(),
          items: { create: lines.map(({ item, product }) => ({ productId: product!.id, name: product!.name, price: product!.price, qty: item.qty, requiresPrescription: true, lineTotal: money(Number(product!.price) * item.qty) })) },
          statusHistory: { create: { status: "UNDER_REVIEW", actor: "System", note: "Refill queued for pharmacist re-verification" } },
        },
      })
      await tx.prescription.create({ data: {
        userId: rx.userId, orderId: created.id, fileName: rx.fileName, fileType: rx.fileType,
        fileData: null, fileUrl: null, storageKey: rx.storageKey,
        notes: `Refill use of prescription ${rx.id.slice(-6).toUpperCase()}`, status: "PENDING",
      } })
      return created
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    await audit("System", null, "RX_REFILL_REQUESTED", "Prescription", rx.id, `New order ${reference}`)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://spherepharmacy.co.ke"
    const customer = await db.user.findUnique({ where: { id: rx.userId! }, select: { name: true, email: true } })
    await notifyCustomer(rx.userId, "PRESCRIPTION", `Refill requested — order ${reference}`, "Your refill is queued for pharmacist re-verification.", "IN_APP", {
      link: `${appUrl}/orders/${order.id}`, metadata: { orderId: order.id, prescriptionId: rx.id, reference },
      email: customer?.email ? { to: customer.email, subject: `Refill requested: ${reference}`, html: `<p>Your refill request <strong>${reference}</strong> is awaiting pharmacist review.</p>`, text: `Refill ${reference} is awaiting pharmacist review.` } : undefined,
    })
    await notifyStaff({ roles: ["PHARMACIST", "ADMIN"], event: "RX_REFILL_REQUESTED", title: `Prescription refill: ${reference}`, message: `${customer?.name || "A customer"} requested a prescription refill.`, link: `${appUrl}/admin/prescriptions` })
    return NextResponse.json({ orderId: order.id, reference }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && ["REFILL_CONFLICT", "STOCK_CONFLICT"].includes(error.message)) return NextResponse.json({ error: "The refill or stock changed while processing. Refresh and try again." }, { status: 409 })
    return publicError("Could not request the refill.")
  }
}
