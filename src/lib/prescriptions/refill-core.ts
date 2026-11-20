// Pure prescription refill domain logic (shared between API routes, UI views, and Node tests).
// Deliberately has no path-alias or runtime-DB imports so unit tests can import it directly.

export const LEGACY_REFILL_NOTE_RE = /^Refill use of prescription [A-F0-9]{6}/i
export const LEGACY_REFILL_ORDER_NOTE_RE = /^Refill(?:\s+#\d+)? of order (SPH-[A-Z0-9]+)/i

export const REFILL_APPROVED_RX_STATUSES = ["APPROVED", "PARTIALLY_APPROVED"] as const
export const REFILL_BLOCKED_ORDER_STATUSES = ["CANCELLED", "REJECTED", "REFUNDED"] as const
export const REFILL_ACTIVE_ORDER_STATUSES = [
  "RECEIVED",
  "UNDER_REVIEW",
  "PRESCRIPTION_VERIFIED",
  "AVAILABILITY_CONFIRMED",
  "AWAITING_PAYMENT",
  "PAID",
  "PREPARING",
  "READY_FOR_PICKUP",
  "OUT_FOR_DELIVERY",
] as const

export type RefillBlockedReason =
  | "active_refill"
  | "expired"
  | "exhausted"
  | "no_order"
  | "source_order_cancelled"
  | "not_approved"
  | "none_allowed"
  | "legacy_refill_without_parent"

export interface PrescriptionRefillLike {
  id: string
  status: string
  notes?: string | null
  orderId?: string | null
  orderReference?: string | null
  orderStatus?: string | null
  refillsAllowed: number
  refillsUsed: number
  validUntil?: string | null
  isRefill?: boolean
  parentPrescriptionId?: string | null
  refillNumber?: number | null
  sourceOrderId?: string | null
  sourceOrderReference?: string | null
  sourceOrderStatus?: string | null
  parentRefillsAllowed?: number | null
  parentRefillsUsed?: number | null
  parentValidUntil?: string | null
  parentStatus?: string | null
  activeRefillOrderId?: string | null
  activeRefillOrderReference?: string | null
  activeRefillOrderStatus?: string | null
}

export interface RefillEligibility {
  isRefill: boolean
  rootPrescriptionId: string
  effectiveStatus: string
  effectiveOrderId: string | null
  effectiveOrderReference: string | null
  effectiveOrderStatus: string | null
  refillsAllowed: number
  refillsUsed: number
  remaining: number
  validUntil: string | null
  expired: boolean
  hasActiveRefill: boolean
  activeRefillOrderId: string | null
  activeRefillOrderReference: string | null
  canRequest: boolean
  blockedReason: RefillBlockedReason | null
}

export function isRefillPrescriptionRecord(rx: {
  parentPrescriptionId?: string | null
  isRefill?: boolean
  notes?: string | null
}): boolean {
  if (rx.isRefill === true) return true
  if (rx.parentPrescriptionId) return true
  return typeof rx.notes === "string" && LEGACY_REFILL_NOTE_RE.test(rx.notes.trim())
}

export function isOrderActiveForRefill(status?: string | null): boolean {
  if (!status) return false
  return (REFILL_ACTIVE_ORDER_STATUSES as readonly string[]).includes(status)
}

export function isOrderCancelledOrRejected(status?: string | null): boolean {
  if (!status) return false
  return (REFILL_BLOCKED_ORDER_STATUSES as readonly string[]).includes(status)
}

export function extractLegacySourceOrderReference(notes?: string | null): string | null {
  if (!notes) return null
  const match = LEGACY_REFILL_ORDER_NOTE_RE.exec(notes.trim())
  return match ? match[1] : null
}

export function roundMoney2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Normalizes a checkout/refill payment method so cash intents stay aligned with
 * the chosen fulfillment mode (PICKUP -> CASH_ON_PICKUP, DELIVERY -> CASH_ON_DELIVERY).
 */
export function normalizeRefillPaymentMethod(
  method: string | null | undefined,
  fulfillment: "PICKUP" | "DELIVERY"
): string | null {
  if (!method) return null
  const upper = String(method).trim().toUpperCase()
  if (upper === "CASH") {
    return fulfillment === "DELIVERY" ? "CASH_ON_DELIVERY" : "CASH_ON_PICKUP"
  }
  if (upper === "CASH_ON_DELIVERY" || upper === "CASH_ON_PICKUP") {
    return fulfillment === "DELIVERY" ? "CASH_ON_DELIVERY" : "CASH_ON_PICKUP"
  }
  if (upper === "MPESA" || upper === "CARD" || upper === "LATER") {
    return upper
  }
  return null
}

export function computeRefillOrderTotals(input: {
  lines: Array<{ price: number; qty: number }>
  fulfillment: "PICKUP" | "DELIVERY"
  deliveryFee: number
}): { subtotal: number; deliveryFee: number; total: number } {
  const subtotal = roundMoney2(
    input.lines.reduce((sum, line) => sum + Number(line.price) * line.qty, 0)
  )
  const deliveryFee = input.fulfillment === "DELIVERY" ? roundMoney2(Math.max(0, input.deliveryFee)) : 0
  const total = roundMoney2(Math.max(0, subtotal + deliveryFee))
  return { subtotal, deliveryFee, total }
}

/**
 * Evaluates whether a prescription (or its root parent when viewing a child refill
 * dispense) can currently initiate another refill request.
 */
export function evaluateRefillEligibility(
  rx: PrescriptionRefillLike,
  nowMs: number = Date.now()
): RefillEligibility {
  const isRefill = isRefillPrescriptionRecord(rx)

  if (isRefill && !rx.parentPrescriptionId) {
    return {
      isRefill: true,
      rootPrescriptionId: rx.id,
      effectiveStatus: rx.status,
      effectiveOrderId: rx.orderId ?? null,
      effectiveOrderReference: rx.orderReference ?? null,
      effectiveOrderStatus: rx.orderStatus ?? null,
      refillsAllowed: 0,
      refillsUsed: 0,
      remaining: 0,
      validUntil: rx.validUntil ?? null,
      expired: rx.validUntil ? Date.parse(rx.validUntil) < nowMs : false,
      hasActiveRefill: isOrderActiveForRefill(rx.orderStatus),
      activeRefillOrderId: isOrderActiveForRefill(rx.orderStatus) ? (rx.orderId ?? null) : null,
      activeRefillOrderReference: isOrderActiveForRefill(rx.orderStatus) ? (rx.orderReference ?? null) : null,
      canRequest: false,
      blockedReason: "legacy_refill_without_parent",
    }
  }

  const useParent = Boolean(rx.parentPrescriptionId)
  const rootPrescriptionId = rx.parentPrescriptionId ?? rx.id
  const effectiveStatus = useParent ? (rx.parentStatus ?? "PENDING") : rx.status
  const effectiveOrderId = useParent ? (rx.sourceOrderId ?? null) : (rx.orderId ?? null)
  const effectiveOrderReference = useParent ? (rx.sourceOrderReference ?? null) : (rx.orderReference ?? null)
  const effectiveOrderStatus = useParent ? (rx.sourceOrderStatus ?? null) : (rx.orderStatus ?? null)
  const refillsAllowed = Math.max(0, useParent ? (rx.parentRefillsAllowed ?? 0) : rx.refillsAllowed)
  const refillsUsed = Math.max(0, useParent ? (rx.parentRefillsUsed ?? 0) : rx.refillsUsed)
  const validUntil = useParent ? (rx.parentValidUntil ?? rx.validUntil ?? null) : (rx.validUntil ?? null)

  const remaining = Math.max(0, refillsAllowed - refillsUsed)
  const parsedExpiry = validUntil ? Date.parse(validUntil) : Number.NaN
  const expired = validUntil ? (!Number.isFinite(parsedExpiry) || parsedExpiry < nowMs) : true

  const activeRefillOrderId =
    rx.activeRefillOrderId ??
    (useParent && isOrderActiveForRefill(rx.orderStatus) ? (rx.orderId ?? null) : null)
  const activeRefillOrderReference =
    rx.activeRefillOrderReference ??
    (useParent && isOrderActiveForRefill(rx.orderStatus) ? (rx.orderReference ?? null) : null)
  const hasActiveRefill = Boolean(activeRefillOrderId)

  let blockedReason: RefillBlockedReason | null = null
  if (!(REFILL_APPROVED_RX_STATUSES as readonly string[]).includes(effectiveStatus)) {
    blockedReason = "not_approved"
  } else if (refillsAllowed <= 0) {
    blockedReason = "none_allowed"
  } else if (!effectiveOrderId) {
    blockedReason = "no_order"
  } else if (isOrderCancelledOrRejected(effectiveOrderStatus)) {
    blockedReason = "source_order_cancelled"
  } else if (hasActiveRefill) {
    blockedReason = "active_refill"
  } else if (expired) {
    blockedReason = "expired"
  } else if (remaining <= 0) {
    blockedReason = "exhausted"
  }

  return {
    isRefill,
    rootPrescriptionId,
    effectiveStatus,
    effectiveOrderId,
    effectiveOrderReference,
    effectiveOrderStatus,
    refillsAllowed,
    refillsUsed,
    remaining,
    validUntil,
    expired: validUntil ? expired : false,
    hasActiveRefill,
    activeRefillOrderId,
    activeRefillOrderReference,
    canRequest: blockedReason === null,
    blockedReason,
  }
}
