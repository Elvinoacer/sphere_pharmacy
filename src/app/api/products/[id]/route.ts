import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { attachRatings, toProductDTO } from "@/lib/dto"
import { audit, notifyCustomer, notifyStaff } from "@/lib/notify"
import { requireStaff } from "@/lib/session"
import { STOCK_STATUSES } from "@/lib/constants"
import { managedImage } from "@/lib/security/service"
import { rejectOversizedRequest } from "@/lib/security/request"
import { enqueueAdminStockEdit } from "@/lib/pos-reconciliation"

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  const product = await db.product.findUnique({ where: { id }, include: { category: true } })
  if (!product || !product.active) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 })
  }
  const [withRating] = await attachRatings([product])
  return NextResponse.json(toProductDTO(withRating))
}

export async function PATCH(request: Request, { params }: Params) {
  const { session, error } = await requireStaff(["ADMIN", "PHARMACIST"])
  if (error) return error
  const oversized = rejectOversizedRequest(request, 32_768)
  if (oversized) return oversized
  const { id } = await params
  const existing = await db.product.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Product not found." }, { status: 404 })
  try {
    const body = await request.json()
    const data: Record<string, unknown> = {}

    if (body.name !== undefined) { const value=String(body.name).trim(); if(value.length<2||value.length>160)return NextResponse.json({error:"Product name must be 2–160 characters."},{status:400}); data.name=value }
    if (body.brand !== undefined) data.brand = body.brand ? String(body.brand).trim() : null
    if (body.packSize !== undefined) data.packSize = body.packSize ? String(body.packSize).trim() : null
    if (body.description !== undefined) data.description = String(body.description ?? "").trim().slice(0,5000)
    if (body.usageInfo !== undefined) data.usageInfo = body.usageInfo ? String(body.usageInfo).trim() : null
    if (body.warnings !== undefined) data.warnings = body.warnings ? String(body.warnings).trim() : null
    if (body.image !== undefined) { const image=body.image?managedImage(body.image):null;if(body.image&&!image)return NextResponse.json({error:"Product image must be an owned upload or site image."},{status:400});data.image=image }
    if (body.requiresPrescription !== undefined) { if(typeof body.requiresPrescription!=="boolean")return NextResponse.json({error:"Prescription flag must be true or false."},{status:400});data.requiresPrescription=body.requiresPrescription }
    if (body.categoryId !== undefined) {
      const cat = body.categoryId ? await db.category.findUnique({ where: { id: body.categoryId } }) : null
      data.categoryId = cat?.id ?? null
    }
    if (body.price !== undefined) {
      const price = Number(body.price)
      if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: "Enter a valid price." }, { status: 400 })
      data.price = price
    }
    if (body.compareAtPrice !== undefined) {
      const compare=body.compareAtPrice != null && body.compareAtPrice !== "" ? Number(body.compareAtPrice) : null
      const effectivePrice=Number(data.price??existing.price)
      if(compare!=null&&(!Number.isFinite(compare)||compare<=effectivePrice))return NextResponse.json({error:"Compare-at price must be greater than the sale price."},{status:400})
      data.compareAtPrice=compare
    }
    if (body.price !== undefined && body.compareAtPrice === undefined && existing.compareAtPrice != null && Number(existing.compareAtPrice) <= Number(data.price)) return NextResponse.json({ error: "Compare-at price must remain greater than the sale price." }, { status: 400 })
    if (body.stockQty !== undefined) {
      const qty = Number(body.stockQty)
      if (!Number.isSafeInteger(qty) || qty < 0) return NextResponse.json({ error: "Stock quantity must be a non-negative whole number." }, { status: 400 })
      data.stockQty = qty
      data.stock = qty
      data.inStock = qty > 0
      if (!body.stockStatus) {
        data.stockStatus = qty <= 0 ? "OUT_OF_STOCK" : qty <= existing.lowStockThreshold ? "LOW_STOCK" : "IN_STOCK"
      }
    }
    if (body.stockStatus !== undefined && STOCK_STATUSES.includes(body.stockStatus)) {
      data.stockStatus = body.stockStatus
      if (body.stockStatus === "OUT_OF_STOCK" && body.stockQty === undefined) data.stockQty = 0
      if (body.stockStatus === "DISCONTINUED") data.active = false
      if (body.stockStatus !== "DISCONTINUED" && body.active === undefined && !existing.active) data.active = true
    }
    if (body.active !== undefined) { if(typeof body.active!=="boolean")return NextResponse.json({error:"Active must be true or false."},{status:400});data.active=body.active }

    const updated = await db.product.update({ where: { id }, data, include: { category: true } })

    // Back-in-stock alerts: notify pending watchers when the product becomes available again
    const becameAvailable =
      (existing.stockStatus === "OUT_OF_STOCK" || !existing.active) &&
      (updated.stockStatus === "IN_STOCK" || updated.stockStatus === "LOW_STOCK")
    if (becameAvailable) {
      const watchers = await db.productAlert.findMany({
        where: { productId: id, notifiedAt: null },
        include: { user: { select: { id: true, email: true, name: true } } },
      })
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://spherepharmacy.co.ke"
      const productUrl = `${appUrl}/products/${updated.id}`
      const { backInStockTemplate } = await import("@/lib/email/templates")
      const emailTemplate = backInStockTemplate({
        productName: updated.name,
        price: Number(updated.price),
        productUrl,
      })

      for (const w of watchers) {
        await notifyCustomer(
          w.userId,
          "STOCK_ALERT",
          `${updated.name} is back in stock!`,
          `${updated.name} is back in stock at Sphere Pharmacy (KSh ${Number(updated.price).toLocaleString()}) — order it while it lasts.`,
          "IN_APP",
          {
            link: productUrl,
            metadata: { productId: updated.id, productName: updated.name, price: Number(updated.price) },
            email: w.user?.email
              ? {
                  to: w.user.email,
                  subject: emailTemplate.subject,
                  html: emailTemplate.html,
                  text: emailTemplate.text,
                }
              : undefined,
          }
        )
        await db.productAlert.update({ where: { id: w.id }, data: { notifiedAt: new Date() } })
      }
    }

    // Low stock / Out of stock staff alert
    const isLowOrOut =
      (updated.stockStatus === "LOW_STOCK" || updated.stockStatus === "OUT_OF_STOCK" || updated.stockQty <= updated.lowStockThreshold) &&
      (existing.stockStatus === "IN_STOCK" && existing.stockQty > existing.lowStockThreshold)
    if (isLowOrOut) {
      await notifyStaff({
        roles: ["ADMIN", "PHARMACIST", "STAFF"],
        event: "LOW_STOCK_ALERT",
        title: `Low Stock Alert: ${updated.name}`,
        message: `${updated.name} is running low on stock. Current quantity: ${updated.stockQty} units (threshold: ${updated.lowStockThreshold}).`,
        link: `${process.env.NEXT_PUBLIC_APP_URL || "https://spherepharmacy.co.ke"}/admin?section=catalogue`,
        details: {
          Product: updated.name,
          SKU: updated.sku,
          CurrentQty: updated.stockQty,
          Threshold: updated.lowStockThreshold,
          Status: updated.stockStatus,
        },
      })
    }

    if (data.price !== undefined && Number(data.price) !== Number(existing.price)) {
      await audit(
        session.staffName ?? "Staff", session.staffRole, "PRICE_UPDATE", "Product", existing.sku,
        `Price changed from KSh ${existing.price} to KSh ${data.price} (${existing.name})`
      )
    }
    if (data.stockQty !== undefined && Number(data.stockQty) !== existing.stockQty) {
      await enqueueAdminStockEdit(db, {
        productId: existing.id,
        previousQty: existing.stockQty,
        newQty: Number(data.stockQty),
        actor: session.staffName ?? "Admin",
      })
      await audit(
        session.staffName ?? "Staff", session.staffRole, "STOCK_UPDATE", "Product", existing.sku,
        `Stock qty ${existing.stockQty} → ${data.stockQty} (${existing.name})`
      )
    }
    await audit(session.staffName ?? "Staff", session.staffRole, "PRODUCT_UPDATED", "Product", existing.sku, existing.name)
    const [withRating] = await attachRatings([updated])
    return NextResponse.json(toProductDTO(withRating))
  } catch {
    return NextResponse.json({ error: "Could not update the product." }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { session, error } = await requireStaff(["ADMIN"])
  if (error) return error
  const { id } = await params
  const existing = await db.product.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Product not found." }, { status: 404 })
  try {
    // keep history: mark discontinued rather than hard delete when referenced by orders
    const referenced = await db.orderItem.count({ where: { productId: id } })
    if (referenced > 0) {
      await db.product.update({ where: { id }, data: { active: false, stockStatus: "DISCONTINUED" } })
      await audit(session.staffName ?? "Staff", session.staffRole, "PRODUCT_DISCONTINUED", "Product", existing.sku, `${existing.name} (kept for order history)`)
    } else {
      await db.product.delete({ where: { id } })
      await audit(session.staffName ?? "Staff", session.staffRole, "PRODUCT_DELETED", "Product", existing.sku, existing.name)
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Could not remove the product." }, { status: 500 })
  }
}
