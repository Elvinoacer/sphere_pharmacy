import type { OrderStatus, Role } from "@/lib/constants"

const STAFF_TRANSITIONS: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  RECEIVED: ["UNDER_REVIEW", "AVAILABILITY_CONFIRMED", "CANCELLED"],
  UNDER_REVIEW: ["PRESCRIPTION_VERIFIED", "REJECTED", "CANCELLED"],
  PRESCRIPTION_VERIFIED: ["AVAILABILITY_CONFIRMED", "AWAITING_PAYMENT", "CANCELLED"],
  AVAILABILITY_CONFIRMED: ["AWAITING_PAYMENT", "PAID", "CANCELLED"],
  AWAITING_PAYMENT: ["PAID", "CANCELLED"],
  PAID: ["PREPARING"],
  PREPARING: ["READY_FOR_PICKUP"],
  READY_FOR_PICKUP: ["COMPLETED_PICKUP", "OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["COMPLETED_DELIVERY"],
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus, role: Role): boolean {
  if (role === "RIDER") return (from === "READY_FOR_PICKUP" && to === "OUT_FOR_DELIVERY") || (from === "OUT_FOR_DELIVERY" && to === "COMPLETED_DELIVERY")
  if (role === "STAFF" && ["REFUNDED", "REJECTED"].includes(to)) return false
  if (to === "REFUNDED") return role === "ADMIN" && ["PAID", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "COMPLETED_PICKUP", "COMPLETED_DELIVERY"].includes(from)
  return STAFF_TRANSITIONS[from]?.includes(to) ?? false
}
