import { after, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { PRESCRIPTION_INCLUDE, toPrescriptionDTOFull } from "@/lib/dto"
import { addStatusEvent, notifyCustomer } from "@/lib/notify"
import { requireCustomer, requireStaff } from "@/lib/session"
import { objectMetadataInR2, uploadBase64ToR2 } from "@/lib/r2"
import { validateFile } from "@/lib/security/file"
import { enforceRateLimit, publicError, rejectOversizedRequest } from "@/lib/security/request"
import { randomUUID } from "crypto"

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "application/pdf"]

// GET /api/prescriptions             → customer's own prescriptions
// GET /api/prescriptions?scope=queue → staff: review queue
export async function GET(request: Request) {
  const url = new URL(request.url)
  const scope = url.searchParams.get("scope")

  if (scope === "queue") {
    const { error } = await requireStaff(["PHARMACIST", "ADMIN"])
    if (error) return error
    const rows = await db.prescription.findMany({
      where: { deletedAt: null },
      include: PRESCRIPTION_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50)),
    })
    const order = { PENDING: 0, CLARIFICATION_REQUESTED: 1, PARTIALLY_APPROVED: 2, APPROVED: 3, REJECTED: 4 }
    const sorted = rows.sort((a, b) => (order[a.status as keyof typeof order] ?? 9) - (order[b.status as keyof typeof order] ?? 9))
    return NextResponse.json(sorted.map((rx) => toPrescriptionDTOFull(rx, true)))
  }

  const { session, error } = await requireCustomer()
  if (error) return error
  const rows = await db.prescription.findMany({
    where: { userId: session.userId, deletedAt: null },
    include: PRESCRIPTION_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50)),
  })
  return NextResponse.json(rows.map((rx) => toPrescriptionDTOFull(rx, true)))
}

// POST — customer uploads a prescription
export async function POST(request: Request) {
  const { session, error } = await requireCustomer()
  if (error) return error
  try {
    const tooLarge = rejectOversizedRequest(request, Math.ceil(MAX_FILE_BYTES / 3) * 4 + 16_384)
    if (tooLarge) return tooLarge
    const limited = await enforceRateLimit(request, "prescription-create", 10, 60 * 60 * 1000, session.userId!)
    if (limited) return limited
    const body = await request.json()
    const fileName = String(body.fileName ?? "").trim()
    const fileType = String(body.fileType ?? "").trim().toLowerCase()
    let fileData = typeof body.fileData === "string" ? body.fileData : ""
    let fileUrl: string | null = null
    let storageKey: string | null = body.storageKey ? String(body.storageKey) : null

    if (!fileName || fileName.length > 120) return NextResponse.json({ error: "Choose a file with a valid name." }, { status: 400 })
    if (!ALLOWED_TYPES.includes(fileType)) {
      return NextResponse.json({ error: "Upload an image (PNG/JPEG/WebP/HEIC) or a PDF." }, { status: 400 })
    }

    // The frontend may upload the binary to R2 first and then send only
    // fileUrl/storageKey. In that case there is no base64 payload to validate.
    const hasRemoteUpload = Boolean(storageKey)
    if (hasRemoteUpload) {
      const expectedPrefix = `prescriptions/${session.userId}/`
      if (!storageKey!.startsWith(expectedPrefix)) {
        return NextResponse.json({ error: "Invalid prescription storage reference." }, { status: 400 })
      }
      const uploaded = await objectMetadataInR2(storageKey!)
      if (!uploaded || uploaded.metadata.ownerid !== session.userId || uploaded.metadata.category !== "prescriptions" || uploaded.contentType !== fileType) {
        return NextResponse.json({ error: "Prescription upload ownership or metadata is invalid." }, { status: 400 })
      }
      if (uploaded.size < 1 || uploaded.size > MAX_FILE_BYTES) return NextResponse.json({ error: "File is too large — 10MB maximum." }, { status: 400 })
      fileData = ""
    } else {
      // Accept both raw base64 and data URLs for the database/R2 fallback path.
      const dataUrlMatch = /^data:[^;]+;base64,([\s\S]*)$/.exec(fileData)
      if (dataUrlMatch) fileData = dataUrlMatch[1]
      fileData = fileData.replace(/\s/g, "")

      if (!fileData || !/^[A-Za-z0-9+/]*={0,2}$/.test(fileData) || fileData.length < 32 || fileData.length % 4 !== 0) {
        return NextResponse.json({ error: "The file appears to be corrupt. Try re-uploading." }, { status: 400 })
      }

      const decodedBytes = Math.floor((fileData.length * 3) / 4) - (fileData.endsWith("==") ? 2 : fileData.endsWith("=") ? 1 : 0)
      if (decodedBytes > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "File is too large — 10MB maximum." }, { status: 400 })
      }
      const buffer = Buffer.from(fileData, "base64")
      const invalid = validateFile(buffer, fileType, fileName, MAX_FILE_BYTES)
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })
    }

    const notes = body.notes ? String(body.notes).trim().slice(0, 1000) : null

    // optional: attach to one of the customer's own orders
    let orderId: string | null = null
    if (body.orderId) {
      const order = await db.order.findFirst({ where: { id: String(body.orderId), userId: session.userId } })
      if (order) orderId = order.id
    }

    if (fileData) {
      const ext = fileName.includes(".") ? `.${fileName.split(".").pop()}` : ""
      const key = `prescriptions/${session.userId}/${randomUUID()}${ext}`
      const r2Res = await uploadBase64ToR2(fileData, key, fileType, { ownerid: session.userId!, originalname: fileName, category: "prescriptions" }, "private")
      storageKey = r2Res.key
    }

    if (!storageKey) {
      return NextResponse.json({ error: "The prescription file could not be stored. Please try again." }, { status: 400 })
    }

    const rx = await db.prescription.create({
      data: {
        userId: session.userId,
        orderId,
        fileName,
        fileType,
        fileData: null,
        fileUrl,
        storageKey,
        notes,
      },
      include: PRESCRIPTION_INCLUDE,
    })

    if (orderId) {
      await addStatusEvent(orderId, "UNDER_REVIEW", "System", "Prescription uploaded — queued for pharmacist review")
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://spherepharmacy.co.ke"
    const customerUser = await db.user.findUnique({ where: { id: session.userId! }, select: { name: true, email: true } })
    const customerName = customerUser?.name || "Customer"

    // The prescription is safely stored at this point. Notifications are
    // follow-up work and should not keep the upload UI waiting.
    after(async () => {
      try {
        await notifyCustomer(
          session.userId,
          "PRESCRIPTION",
          "Prescription received",
          "We received your prescription. Our pharmacist is reviewing it — usually within 2 working hours.",
          "IN_APP",
          {
            link: `${appUrl}/prescriptions`,
            metadata: { prescriptionId: rx.id, orderId },
            email: customerUser?.email
              ? {
                  to: customerUser.email,
                  subject: "Prescription Received — Sphere Pharmacy",
                  html: `<p>Hello ${customerName},</p><p>We have safely received your uploaded prescription (<strong>${fileName}</strong>). Our licensed pharmacist will review it shortly (usually within 2 working hours).</p><p>You will receive another update once verification is complete.</p>`,
                  text: `Hello ${customerName},\nWe received your prescription (${fileName}). Our pharmacist will review it shortly.`,
                }
              : undefined,
          }
        )
        const { notifyStaff } = await import("@/lib/notify")
        await notifyStaff({
          roles: ["PHARMACIST", "ADMIN"],
          event: "NEW_PRESCRIPTION",
          title: "New Prescription Uploaded",
          message: `Prescription uploaded by ${customerName} awaiting pharmacist review.`,
          link: `${appUrl}/admin?section=prescriptions`,
          details: {
            Customer: customerName,
            File: fileName,
            LinkedOrder: rx.order?.reference || "None",
          },
        })
      } catch (notificationError) {
        console.error("[prescription notification failed]", notificationError)
      }
    })
    return NextResponse.json(toPrescriptionDTOFull(rx, true))
  } catch {
    return publicError("Could not securely store the prescription. Please try again.")
  }
}
