// Sphere Pharmacy — shared domain constants & type definitions
// (Database-agnostic domain constants; PostgreSQL is the production datasource.)

// ---------- Staff roles ----------
export const ROLES = ["ADMIN", "PHARMACIST", "STAFF", "RIDER"] as const
export type Role = (typeof ROLES)[number]
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  PHARMACIST: "Pharmacist",
  STAFF: "Pharmacy Staff",
  RIDER: "Delivery Rider",
}

// ---------- Stock status ----------
export const STOCK_STATUSES = ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "DISCONTINUED"] as const
export type StockStatus = (typeof STOCK_STATUSES)[number]
export const STOCK_LABELS: Record<StockStatus, string> = {
  IN_STOCK: "In stock",
  LOW_STOCK: "Low stock",
  OUT_OF_STOCK: "Out of stock",
  DISCONTINUED: "Discontinued",
}

// ---------- Order type ----------
export const ORDER_TYPES = ["OTC", "PRESCRIPTION", "MIXED", "RESERVATION"] as const
export type OrderType = (typeof ORDER_TYPES)[number]
export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  OTC: "OTC purchase",
  PRESCRIPTION: "Prescription order",
  MIXED: "Mixed order",
  RESERVATION: "Reservation (pay in store)",
}

// ---------- Order status ----------
export const ORDER_STATUSES = [
  "RECEIVED",
  "UNDER_REVIEW",
  "PRESCRIPTION_VERIFIED",
  "AVAILABILITY_CONFIRMED",
  "AWAITING_PAYMENT",
  "PAID",
  "PREPARING",
  "READY_FOR_PICKUP",
  "OUT_FOR_DELIVERY",
  "COMPLETED_PICKUP",
  "COMPLETED_DELIVERY",
  "REJECTED",
  "CANCELLED",
  "REFUNDED",
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  RECEIVED: "Received",
  UNDER_REVIEW: "Under review",
  PRESCRIPTION_VERIFIED: "Prescription verified",
  AVAILABILITY_CONFIRMED: "Availability confirmed",
  AWAITING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  PREPARING: "Preparing your order",
  READY_FOR_PICKUP: "Ready for pickup",
  OUT_FOR_DELIVERY: "Out for delivery",
  COMPLETED_PICKUP: "Completed (picked up)",
  COMPLETED_DELIVERY: "Completed (delivered)",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
}

// Customer-facing status groups
export const ACTIVE_STATUSES: OrderStatus[] = [
  "RECEIVED", "UNDER_REVIEW", "PRESCRIPTION_VERIFIED", "AVAILABILITY_CONFIRMED",
  "AWAITING_PAYMENT", "PAID", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY",
]
export const TERMINAL_STATUSES: OrderStatus[] = [
  "COMPLETED_PICKUP", "COMPLETED_DELIVERY", "REJECTED", "CANCELLED", "REFUNDED",
]

// Suggested next status for staff workflow
export const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  RECEIVED: ["UNDER_REVIEW", "AVAILABILITY_CONFIRMED"],
  UNDER_REVIEW: ["PRESCRIPTION_VERIFIED", "REJECTED"],
  PRESCRIPTION_VERIFIED: ["AVAILABILITY_CONFIRMED"],
  AVAILABILITY_CONFIRMED: ["AWAITING_PAYMENT"],
  AWAITING_PAYMENT: ["PAID"],
  PAID: ["PREPARING"],
  PREPARING: ["READY_FOR_PICKUP"],
  READY_FOR_PICKUP: ["COMPLETED_PICKUP", "OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["COMPLETED_DELIVERY"],
}

// ---------- Prescription status ----------
export const RX_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CLARIFICATION_REQUESTED", "PARTIALLY_APPROVED"] as const
export type RxStatus = (typeof RX_STATUSES)[number]
export const RX_STATUS_LABELS: Record<RxStatus, string> = {
  PENDING: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CLARIFICATION_REQUESTED: "Clarification requested",
  PARTIALLY_APPROVED: "Partially approved",
}

// ---------- Fulfillment ----------
export const FULFILLMENTS = ["PICKUP", "DELIVERY"] as const
export type Fulfillment = (typeof FULFILLMENTS)[number]
export const FULFILLMENT_LABELS: Record<Fulfillment, string> = {
  PICKUP: "Store pickup",
  DELIVERY: "Delivery",
}

// ---------- Payment ----------
export const PAYMENT_PROVIDERS = ["MPESA", "INTASEND", "CASH"] as const
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number]
export const PAYMENT_STATUSES = ["PENDING", "PROCESSING", "SUCCESS", "FAILED", "REFUND_PENDING", "REFUNDED"] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  STK_PUSH: "M-Pesa (STK Push)",
  CARD: "Card (IntaSend)",
  PAYBILL: "M-Pesa Paybill",
  CASH_ON_PICKUP: "Pay on pickup",
  CASH_ON_DELIVERY: "Pay on delivery",
}

// ---------- Notification channels ----------
export const NOTIFICATION_CHANNELS = ["IN_APP", "SMS", "WHATSAPP", "EMAIL"] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

// ---------- Sphere Points loyalty ----------
// Earn: 1 point per KSh 100 spent on successful payments. Redeem: 1 point = KSh 1
// at checkout (minimum 100 pts, max 25% of the order subtotal). Balances also
// cover legacy in-store activity for demo purposes.
export const LOYALTY = {
  earnPerKES: 100, // spend KSh 100 → 1 point
  pointValue: 1, // KSh per point when redeeming
  minRedeem: 100, // minimum points to redeem
  maxRedeemPct: 25, // redemption capped at 25% of subtotal (after promo discount)
} as const

/** Points earned for a given paid amount (floor). */
export const pointsForAmount = (amountKES: number): number => Math.max(0, Math.floor(amountKES / LOYALTY.earnPerKES))

/** Maximum redeemable points for a subtotal (cap + balance aware). */
export const maxRedeemablePoints = (subtotalKES: number, balance: number): number => {
  const cap = Math.floor((subtotalKES * LOYALTY.maxRedeemPct) / 100 / LOYALTY.pointValue)
  return Math.max(0, Math.min(balance, cap))
}

// ---------- Delivery / dispatch ----------
// Statuses relevant for the dispatch & rider boards (delivery fulfillment only)
export const DISPATCH_STATUSES: OrderStatus[] = [
  "PAID", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY",
]
// Statuses a rider may set themselves (only for orders assigned to them)
export const RIDER_ALLOWED_STATUSES: OrderStatus[] = ["OUT_FOR_DELIVERY", "COMPLETED_DELIVERY"]

// ---------- Review moderation ----------
export const REVIEW_STATUSES = ["PUBLISHED", "HIDDEN"] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  PUBLISHED: "Published",
  HIDDEN: "Hidden",
}

// ---------- Pharmacy profile (defaults; editable in Admin → Settings) ----------
export const PHARMACY = {
  name: "Sphere Pharmacy",
  legalName: "The Sphere Pharmacy — Lumumba Drive",
  tagline: "Your community pharmacy on Lumumba Drive, Roysambu",
  phone: "+254707475208",
  phoneDisplay: "+254 707 475 208",
  whatsapp: "254707475208",
  address: "Lumumba Drive, Roysambu, Nairobi, Kenya",
  hoursLabel: "Open daily · 8:00 AM – 10:30 PM",
  hoursOpen: 8,
  hoursClose: 22.5,
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Sphere+Pharmacy+Lumumba+Drive+Roysambu+Nairobi",
  email: "orders@spherepharmacy.co.ke", // placeholder pending client confirmation
  disclaimer:
    "Opening hours & contact details are from the current public listing and pending final client confirmation. Licence details will be published once the current PPB licence is provided.",
}

export const waLink = (text?: string) =>
  `https://wa.me/${PHARMACY.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ""}`

// ---------- Delivery fee defaults (editable in Admin → Settings) ----------
export const DELIVERY_DEFAULTS = {
  mode: "zone" as "flat" | "zone",
  flatFee: 200,
  freeOver: 3000,
  nightDelivery: false,
  zones: [
    { name: "Roysambu / TRM area", fee: 150 },
    { name: "Kasarani", fee: 200 },
    { name: "Githurai 44", fee: 250 },
    { name: "Ruaraka / Baba Dogo", fee: 250 },
    { name: " Nairobi CBD", fee: 400 },
    { name: "Other Nairobi areas", fee: 500 },
  ],
}
