import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { PRESCRIPTION_INCLUDE, toPrescriptionDTOFull } from "@/lib/dto"
import { audit, notifyCustomer, notifyStaff } from "@/lib/notify"
import { getSession, requireStaff } from "@/lib/session"
import { RX_STATUSES, type RxStatus, type OrderStatus } from "@/lib/constants"
import { getPresignedDownloadUrl } from "@/lib/r2"
import { isRefillPrescriptionRecord } from "@/lib/prescriptions/refill-core"
import { releaseOrderResourcesOnReject } from "@/lib/prescriptions/refill-server"
import { escapeHtml } from "@/lib/security/request"

type Params = { params: Promise<{ id: string }> }

// GET — owner customer or staff; includes presigned fileUrl (restricted access per FR-5.6)
export async function GET(request: Request, { params }: Params) {
  const { id } = await params
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Sign in to view this prescription." }, { status: 401 })

  const rx = await db.prescription.findUnique({ where: { id }, include: PRESCRIPTION_INCLUDE })
  if (!rx || rx.deletedAt) return NextResponse.json({ error: "Prescription not found." }, { status: 404 })

  const isOwner = session.userId && rx.userId === session.userId
  const isStaff = session.staffRole === "ADMIN" || session.staffRole === "PHARMACIST"
  if (!isOwner && !isStaff) {
    return NextResponse.json({ error: "You do not have access to this prescription." }, { status: 403 })
  }

  const download = new URL(request.url).searchParams.get("download") === "1"
  let presignedUrl: string | null = null
  if (rx.storageKey) {
    try {
      presignedUrl = await getPresignedDownloadUrl(rx.storageKey, 300, download ? rx.fileName : undefined)
    } catch {
      return NextResponse.json({ error: "The prescription file is temporarily unavailable." }, { status: 503 })
    }
  }

  await db.prescriptionAccessLog.create({
    data: {
      prescriptionId: rx.id,
      actorId: session.userId || session.staffId!,
      actorRole: session.staffRole || "CUSTOMER",
      action: download ? "DOWNLOAD" : "VIEW",
    },
  })
  if (download && presignedUrl) return NextResponse.redirect(presignedUrl)

  const dto = toPrescriptionDTOFull(rx, true)
  return NextResponse.json({
    ...dto,
    fileData: "",
    fileUrl: presignedUrl,
    storageKey: undefined,
  })
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Sign in to delete this prescription." }, { status: 401 })
  const rx = await db.prescription.findUnique({ where: { id } })
  if (!rx || rx.deletedAt) return NextResponse.json({ error: "Prescription not found." }, { status: 404 })
  const allowed = rx.userId === session.userId || session.staffRole === "ADMIN"
  if (!allowed) return NextResponse.json({ error: "You do not have permission to delete this prescription." }, { status: 403 })
  if (rx.orderId && session.staffRole !== "ADMIN") return NextResponse.json({ error: "Contact the pharmacy to delete a prescription linked to an order." }, { status: 409 })
  await db.prescription.update({ where: { id }, data: { deletedAt: new Date() } })
  return NextResponse.json({ ok: true })
}

// PATCH — pharmacist review (APPROVED / REJECTED / CLARIFICATION_REQUESTED / PARTIALLY_APPROVED)
export async function PATCH(request: Request, { params }: Params) {
  const { session, error } = await requireStaff(["PHARMACIST", "ADMIN"])
  if (error) return error
  const { id } = await params
  const rx = await db.prescription.findUnique({ where: { id }, include: PRESCRIPTION_INCLUDE })
  if (!rx || rx.deletedAt) return NextResponse.json({ error: "Prescription not found." }, { status: 404 })

  if (rx.order && ["CANCELLED", "REFUNDED"].includes(rx.order.status)) {
    return NextResponse.json(
      { error: "This prescription belongs to a cancelled or refunded order and can no longer be reviewed." },
      { status: 409 }
    )
  }

  try {
    const body = await request.json()
    const status = String(body.status ?? "") as RxStatus
    if (!RX_STATUSES.includes(status)) return NextResponse.json({ error: "Unknown prescription status." }, { status: 400 })
    if (status !== "APPROVED" && !String(body.reviewNotes ?? "").trim()) {
      return NextResponse.json({ error: "A note/reason is required for this decision." }, { status: 400 })
    }

    const reviewNotes = body.reviewNotes ? String(body.reviewNotes).trim().slice(0, 2000) : null
    const isApproval = status === "APPROVED" || status === "PARTIALLY_APPROVED"
    const isRefillCopy = isRefillPrescriptionRecord(rx)

    let effectiveRefillsAllowed = 0
    let effectiveValidUntil: Date | null = null

    if (isRefillCopy) {
      // Refill dispense copies never grant independent refill allowances or extend
      // the original prescription's validity window.
      if (isApproval && rx.parentPrescriptionId) {
        const parent = await db.prescription.findUnique({
          where: { id: rx.parentPrescriptionId },
          select: { id: true, status: true, validUntil: true, deletedAt: true },
        })
        if (
          !parent ||
          parent.deletedAt ||
          !["APPROVED", "PARTIALLY_APPROVED"].includes(parent.status) ||
          !parent.validUntil ||
          parent.validUntil < new Date()
        ) {
          return NextResponse.json(
            { error: "The original prescription has expired or is no longer valid. Ask the customer to upload a current prescription." },
            { status: 409 }
          )
        }
        effectiveValidUntil = parent.validUntil
      }
      effectiveRefillsAllowed = 0
    } else if (isApproval) {
      const requestedRefills = Math.max(0, Math.min(6, Math.trunc(Number(body.refillsAllowed ?? 0)) || 0))
      if (requestedRefills < rx.refillsUsed) {
        return NextResponse.json(
          { error: `Refills allowed cannot be less than refills already used (${rx.refillsUsed}).` },
          { status: 400 }
        )
      }
      const validDays = [30, 60, 90, 180].includes(Number(body.validDays)) ? Number(body.validDays) : 90
      effectiveRefillsAllowed = requestedRefills
      effectiveValidUntil = new Date(Date.now() + validDays * 24 * 3600 * 1000)
    }

    const actor = session.staffName ?? "Pharmacist"
    let linkedOrderUpdate: { id: string; reference: string; next: OrderStatus; note: string } | null = null

    await db.$transaction(async (tx) => {
      await tx.prescription.update({
        where: { id },
        data: {
          status,
          reviewNotes,
          reviewedById: session.staffId,
          reviewedAt: new Date(),
          refillsAllowed: effectiveRefillsAllowed,
          validUntil: effectiveValidUntil,
        },
      })

      if (rx.orderId) {
        const order = await tx.order.findUnique({
          where: { id: rx.orderId },
          select: { id: true, reference: true, status: true, version: true },
        })
        const all = await tx.prescription.findMany({
          where: { orderId: rx.orderId, deletedAt: null },
          select: { status: true },
        })
        const allApproved = all.length > 0 && all.every((item) => ["APPROVED", "PARTIALLY_APPROVED"].includes(item.status))
        const allDecided = all.length > 0 && all.every((item) => ["APPROVED", "PARTIALLY_APPROVED", "REJECTED"].includes(item.status))
        const anyRejected = all.some((item) => item.status === "REJECTED")
        const next: OrderStatus = allApproved ? "PRESCRIPTION_VERIFIED" : allDecided && anyRejected ? "REJECTED" : "UNDER_REVIEW"
        if (order && order.status === "UNDER_REVIEW" && next !== order.status) {
          const note =
            next === "PRESCRIPTION_VERIFIED"
              ? "All prescriptions verified by a pharmacist"
              : "Prescription set rejected after all documents were reviewed"
          const changed = await tx.order.updateMany({
            where: { id: order.id, status: "UNDER_REVIEW", version: order.version },
            data: { status: next, version: { increment: 1 } },
          })
          if (changed.count !== 1) throw new Error("ORDER_CONFLICT")
          await tx.orderStatusHistory.create({ data: { orderId: order.id, status: next, actor, note } })
          if (next === "REJECTED") {
            await releaseOrderResourcesOnReject(tx, order.id, actor, "Order rejected during prescription review")
          }
          linkedOrderUpdate = { id: order.id, reference: order.reference, next, note }
        }
      }
    }, { timeout: 15000, maxWait: 5000 })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://spherepharmacy.co.ke"

    if (linkedOrderUpdate) {
      const update = linkedOrderUpdate as { id: string; reference: string; next: OrderStatus; note: string }
      await notifyCustomer(rx.userId, "PRESCRIPTION", `Prescription update — order ${update.reference}`, update.note, "IN_APP", {
        link: `${appUrl}/orders/${update.id}`,
        metadata: { orderId: update.id, status: update.next, reference: update.reference },
      })
      if (update.next === "REJECTED") {
        await notifyStaff({
          roles: ["ADMIN", "PHARMACIST"],
          event: "ORDER_REJECTED",
          title: `Order ${update.reference} rejected`,
          message: `Order ${update.reference} was rejected after prescription review by ${actor}.`,
          link: `${appUrl}/admin?section=orders`,
          details: { "Order Ref": update.reference, Actor: actor, Note: escapeHtml(reviewNotes || "None") },
        })
      }
    }

    if (rx.userId) {
      const customerUser = await db.user.findUnique({ where: { id: rx.userId }, select: { name: true, email: true } })
      const { prescriptionStatusTemplate } = await import("@/lib/email/templates")

      const emailData = prescriptionStatusTemplate({
        customerName: customerUser?.name,
        orderReference: rx.order?.reference ?? null,
        status: status as "APPROVED" | "REJECTED" | "CLARIFICATION_REQUESTED" | "PARTIALLY_APPROVED",
        reviewNotes: reviewNotes ?? null,
        refillsAllowed: !isRefillCopy && effectiveRefillsAllowed > 0 ? effectiveRefillsAllowed : undefined,
        actionUrl: rx.orderId ? `${appUrl}/orders/${rx.orderId}` : `${appUrl}/prescriptions`,
      })

      const noteText =
        status === "APPROVED" ? "Your prescription has been verified and approved by our pharmacist."
        : status === "PARTIALLY_APPROVED" ? `Partially approved: ${reviewNotes ?? ""}`
        : status === "REJECTED" ? `Prescription could not be verified: ${reviewNotes ?? ""}`
        : `Clarification needed: ${reviewNotes ?? ""}`

      await notifyCustomer(
        rx.userId,
        "PRESCRIPTION",
        `Prescription ${status.replace(/_/g, " ").toLowerCase()}`,
        noteText,
        "IN_APP",
        {
          link: rx.orderId ? `${appUrl}/orders/${rx.orderId}` : `${appUrl}/prescriptions`,
          metadata: { prescriptionId: rx.id, status, reviewNotes },
          email: customerUser?.email
            ? {
                to: customerUser.email,
                subject: emailData.subject,
                html: emailData.html,
                text: emailData.text,
              }
            : undefined,
        }
      )
    }

    await audit(actor, session.staffRole, `RX_${status}`, "Prescription", rx.id, `${rx.fileName}${reviewNotes ? ` — ${reviewNotes}` : ""}`)

    const updated = await db.prescription.findUnique({ where: { id }, include: PRESCRIPTION_INCLUDE })
    return NextResponse.json(toPrescriptionDTOFull(updated!, true))
  } catch (err) {
    if (err instanceof Error && err.message === "ORDER_CONFLICT") {
      return NextResponse.json({ error: "The linked order changed while saving this review. Refresh and try again." }, { status: 409 })
    }
    return NextResponse.json({ error: "Could not save the review." }, { status: 500 })
  }
}
