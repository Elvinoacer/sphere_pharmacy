import { NextResponse } from "next/server"
import { audit } from "@/lib/notify"
import { getSession, requireStaff } from "@/lib/session"
import { getSettings, saveSettingsSection } from "@/lib/settings"
import { rejectOversizedRequest } from "@/lib/security/request"

export async function GET() {
  const { pharmacy, delivery, compliance } = await getSettings()
  const session = await getSession()
  const canViewRecord = session?.staffRole === "ADMIN" || session?.staffRole === "PHARMACIST"
  // Recording compliance details is not PPB verification or authorization to publish.
  // Do not expose unverified licence or superintendent records to public clients.
  const publicCompliance = { premiseLicenceNumber: "", premiseLicenceExpiry: "", superintendentName: "", superintendentReg: "", notes: "" }
  return NextResponse.json(
    { pharmacy, delivery, compliance: canViewRecord ? compliance : publicCompliance },
    { headers: { "Cache-Control": "private, no-store" } }
  )
}

export async function PUT(request: Request) {
  const { session, error } = await requireStaff(["ADMIN"])
  if (error) return error
  const oversized = rejectOversizedRequest(request, 64_000)
  if (oversized) return oversized
  try {
    const body = await request.json()
    if (body.pharmacy) {
      if (!body.pharmacy || typeof body.pharmacy !== "object" || Array.isArray(body.pharmacy)) return NextResponse.json({ error: "Invalid pharmacy settings." }, { status: 400 })
      const pharmacy = Object.fromEntries(["name", "tagline", "phone", "whatsapp", "email", "address", "hoursLabel", "mapsUrl"].filter((key) => body.pharmacy[key] !== undefined).map((key) => [key, String(body.pharmacy[key]).trim().slice(0, key === "address" || key === "mapsUrl" ? 500 : 160)]))
      await saveSettingsSection("pharmacy", pharmacy)
      await audit(session.staffName ?? "Admin", "ADMIN", "SETTINGS_UPDATED", "Setting", "pharmacy", "Pharmacy profile updated")
    }
    if (body.delivery) {
      if (typeof body.delivery !== "object" || Array.isArray(body.delivery)) return NextResponse.json({ error: "Invalid delivery settings." }, { status: 400 })
      if (!Array.isArray(body.delivery.zones) || body.delivery.zones.length > 50 || body.delivery.zones.some((z: any) => !z || typeof z.name !== "string" || !z.name.trim() || z.name.length > 100 || !Number.isFinite(Number(z.fee)) || Number(z.fee) < 0)) return NextResponse.json({ error: "Every delivery zone needs a valid name and non-negative fee." }, { status: 400 })
      const zones = Array.isArray(body.delivery.zones)
        ? body.delivery.zones
            .map((z: { name?: unknown; fee?: unknown }) => ({ name: String(z.name ?? "").trim(), fee: Math.max(0, Number(z.fee) || 0) }))
            .filter((z: { name: string }) => z.name.length > 0)
        : undefined
      const distanceBands = Array.isArray(body.delivery.distanceBands)
        ? body.delivery.distanceBands
            .map((band: { id?: unknown; minKm?: unknown; maxKm?: unknown; fee?: unknown; label?: unknown }, index: number) => ({
              id: String(band.id ?? "band-" + index),
              minKm: Math.max(0, Number(band.minKm) || 0),
              maxKm: band.maxKm === null || band.maxKm === "" || band.maxKm === undefined ? null : Math.max(0, Number(band.maxKm) || 0),
              fee: Math.max(0, Number(band.fee) || 0),
              label: String(band.label ?? "Distance band " + (index + 1)).trim(),
            }))
            .filter((band: { label: string; maxKm: number | null; minKm: number }) => band.label.length > 0 && (band.maxKm === null || band.maxKm > band.minKm))
        : undefined
      if (body.delivery.distanceBands !== undefined && (!distanceBands || distanceBands.length !== body.delivery.distanceBands.length || distanceBands.length > 30 || distanceBands.some((band, index) => index > 0 && band.minKm < distanceBands[index - 1]!.maxKm!))) return NextResponse.json({ error: "Distance bands must be valid, ordered and non-overlapping." }, { status: 400 })
      const pharmacyLocation =
        body.delivery.pharmacyLocation &&
        Number.isFinite(Number(body.delivery.pharmacyLocation.latitude)) &&
        Number.isFinite(Number(body.delivery.pharmacyLocation.longitude))
          ? {
              latitude: Number(body.delivery.pharmacyLocation.latitude),
              longitude: Number(body.delivery.pharmacyLocation.longitude),
              label: String(body.delivery.pharmacyLocation.label ?? "Pharmacy"),
            }
          : undefined
      if (pharmacyLocation && (pharmacyLocation.latitude < -90 || pharmacyLocation.latitude > 90 || pharmacyLocation.longitude < -180 || pharmacyLocation.longitude > 180)) return NextResponse.json({ error: "Pharmacy coordinates are outside valid ranges." }, { status: 400 })
      const mode = body.delivery.mode === "flat" || body.delivery.mode === "zone" ? body.delivery.mode : null
      const pricingMode = body.delivery.pricingMode === "zone" || body.delivery.pricingMode === "distance" ? body.delivery.pricingMode : null
      const flatFee = Number(body.delivery.flatFee)
      const freeOver = body.delivery.freeOver == null || body.delivery.freeOver === "" ? null : Number(body.delivery.freeOver)
      if (!mode || !pricingMode || !Number.isFinite(flatFee) || flatFee < 0 || freeOver != null && (!Number.isFinite(freeOver) || freeOver < 0) || typeof body.delivery.nightDelivery !== "boolean") return NextResponse.json({ error: "Delivery modes, fees or flags are invalid." }, { status: 400 })
      if (body.delivery.pricingMode === "distance" && (!pharmacyLocation || !distanceBands?.length)) {
        return NextResponse.json({ error: "Distance pricing needs a pinned pharmacy location and at least one valid distance band." }, { status: 400 })
      }
      await saveSettingsSection("delivery", {
        mode, pricingMode, flatFee, freeOver, nightDelivery: body.delivery.nightDelivery,
        ...(zones ? { zones } : {}),
        ...(distanceBands ? { distanceBands } : {}),
        ...(pharmacyLocation ? { pharmacyLocation } : {}),
      })
      await audit(session.staffName ?? "Admin", "ADMIN", "SETTINGS_UPDATED", "Setting", "delivery", "Delivery settings updated")
    }
    if (body.compliance) {
      if (!body.compliance || typeof body.compliance !== "object" || Array.isArray(body.compliance)) return NextResponse.json({ error: "Invalid compliance settings." }, { status: 400 })
      const allowedKeys = ["premiseLicenceNumber", "premiseLicenceExpiry", "superintendentName", "superintendentReg", "notes"] as const
      if (allowedKeys.some((key) => body.compliance[key] !== undefined && typeof body.compliance[key] !== "string")) {
        return NextResponse.json({ error: "Compliance details must be text values." }, { status: 400 })
      }
      if (allowedKeys.some((key) => String(body.compliance[key] ?? "").length > (key === "notes" ? 1000 : 160))) {
        return NextResponse.json({ error: "Some compliance fields exceed their maximum length." }, { status: 400 })
      }
      const compliance = Object.fromEntries(allowedKeys.filter((key) => body.compliance[key] !== undefined).map((key) => [key, String(body.compliance[key]).trim()]))
      const expiry = compliance.premiseLicenceExpiry
      if (expiry && (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(Date.parse(`${expiry}T00:00:00Z`)) || new Date(`${expiry}T00:00:00Z`).toISOString().slice(0, 10) !== expiry)) {
        return NextResponse.json({ error: "Enter a valid licence expiry date." }, { status: 400 })
      }
      // These are internal draft records; updating them never constitutes verification or publication.
      await saveSettingsSection("compliance", compliance)
      await audit(session.staffName ?? "Admin", "ADMIN", "COMPLIANCE_UPDATED", "Setting", "compliance", "Internal compliance record updated (not PPB-verified)")
    }
    const settings = await getSettings()
    return NextResponse.json({ ok: true, ...settings })
  } catch {
    return NextResponse.json({ error: "Could not save the settings." }, { status: 500 })
  }
}
