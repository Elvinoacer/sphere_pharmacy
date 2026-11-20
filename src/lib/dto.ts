import { db } from "@/lib/db"
import {
  extractLegacySourceOrderReference,
  isOrderActiveForRefill,
  isRefillPrescriptionRecord,
} from "@/lib/prescriptions/refill-core"
import type {
  AddressDTO,
  AuditLogDTO,
  CategoryDTO,
  NotificationDTO,
  OrderDTO,
  OrderItemDTO,
  PaymentDTO,
  PrescriptionDTO,
  ProductDTO,
  PromotionDTO,
  ReviewDTO,
} from "@/lib/types"
import type { OrderStatus, PaymentStatus, PaymentProvider, RxStatus, StockStatus, OrderType, Fulfillment, Role } from "@/lib/constants"

type DbMoney = number | string | { toString(): string }
const moneyNumber = (value: DbMoney | null | undefined): number => value == null ? 0 : Number(value)

type DbProduct = {
  id: string; name: string; sku: string; brand: string | null; packSize: string | null;
  price: DbMoney; compareAtPrice: DbMoney | null; stockStatus: string; stockQty: number;
  requiresPrescription: boolean; description: string; usageInfo: string | null;
  warnings: string | null; image: string | null; images?: string[]; categoryId: string | null;
  categoryName?: string | null; categorySlug?: string | null;
  category?: { name: string; slug: string } | null;
  avgRating?: number | null; reviewCount?: number;
  createdAt: Date; updatedAt: Date;
}

export function toProductDTO(p: DbProduct): ProductDTO {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    brand: p.brand,
    packSize: p.packSize,
    price: moneyNumber(p.price),
    compareAtPrice: p.compareAtPrice == null ? null : moneyNumber(p.compareAtPrice),
    stockStatus: p.stockStatus as StockStatus,
    stockQty: p.stockQty,
    requiresPrescription: p.requiresPrescription,
    description: p.description,
    usageInfo: p.usageInfo,
    warnings: p.warnings,
    image: p.image,
    images: p.images ?? [],
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? p.categoryName ?? null,
    categorySlug: p.category?.slug ?? p.categorySlug ?? null,
    avgRating: p.avgRating ?? null,
    reviewCount: p.reviewCount ?? 0,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }
}

export function toCategoryDTO(c: { id: string; name: string; slug: string; description: string | null; icon: string | null }, productCount: number): CategoryDTO {
  return { id: c.id, name: c.name, slug: c.slug, description: c.description, icon: c.icon, productCount }
}

type DbOrderItem = {
  id: string; productId: string | null; name: string; price: DbMoney; qty: number;
  requiresPrescription: boolean; lineTotal: DbMoney;
}

function toOrderItemDTO(i: DbOrderItem): OrderItemDTO {
  return {
    id: i.id, productId: i.productId, name: i.name, price: moneyNumber(i.price), qty: i.qty,
    requiresPrescription: i.requiresPrescription, lineTotal: moneyNumber(i.lineTotal),
  }
}

type DbPayment = {
  id: string; provider: string; method: string | null; status: string; amount: DbMoney;
  phone: string | null; cardLast4: string | null; providerReference: string | null;
  failureReason: string | null; createdAt: Date;
}

export function toPaymentDTO(p: DbPayment): PaymentDTO {
  return {
    id: p.id, provider: p.provider as PaymentProvider, method: p.method, status: p.status as PaymentStatus,
    amount: moneyNumber(p.amount), phone: p.phone, cardLast4: p.cardLast4, providerReference: p.providerReference,
    failureReason: p.failureReason, createdAt: p.createdAt.toISOString(),
  }
}

type DbRefillChildSummary = {
  id: string
  orderId: string | null
  order?: { id: string; reference: string; status: string } | null
}

type DbParentPrescriptionSummary = {
  id: string
  status: string
  refillsAllowed: number
  refillsUsed: number
  validUntil: Date | null
  reviewNotes: string | null
  orderId: string | null
  order?: { id: string; reference: string; status: string } | null
  reviewedBy?: { name: string } | null
  childRefills?: DbRefillChildSummary[]
}

type DbPrescription = {
  id: string; fileName: string; fileType: string; notes: string | null; status: string;
  reviewNotes: string | null; reviewedById: string | null; reviewedBy?: { name: string } | null;
  reviewedAt?: Date | null;
  refillsAllowed: number; refillsUsed: number; validUntil: Date | null; createdAt: Date;
  orderId: string | null; order?: { id?: string; reference: string; status?: string } | null;
  user?: { name: string | null; phone: string | null } | null; userId: string | null;
  fileUrl?: string | null; storageKey?: string | null;
  parentPrescriptionId?: string | null;
  refillNumber?: number | null;
  refillReleasedAt?: Date | null;
  parentPrescription?: DbParentPrescriptionSummary | null;
  childRefills?: DbRefillChildSummary[];
}

function findActiveRefillOrder(children?: DbRefillChildSummary[]): { id: string; reference: string; status: OrderStatus } | null {
  if (!children?.length) return null
  for (const child of children) {
    if (child.order && isOrderActiveForRefill(child.order.status)) {
      return {
        id: child.order.id,
        reference: child.order.reference,
        status: child.order.status as OrderStatus,
      }
    }
  }
  return null
}

export function toPrescriptionDTO(rx: DbPrescription, includeCustomer = false): PrescriptionDTO {
  const isRefill = isRefillPrescriptionRecord(rx)
  const parent = rx.parentPrescription ?? null
  const activeRefill = findActiveRefillOrder(parent ? parent.childRefills : rx.childRefills)
  return {
    id: rx.id,
    fileName: rx.fileName,
    fileType: rx.fileType,
    notes: rx.notes,
    status: rx.status as RxStatus,
    reviewNotes: rx.reviewNotes,
    reviewedByName: rx.reviewedBy?.name ?? null,
    reviewedAt: rx.reviewedAt ? rx.reviewedAt.toISOString() : null,
    refillsAllowed: rx.refillsAllowed,
    refillsUsed: rx.refillsUsed,
    validUntil: rx.validUntil ? rx.validUntil.toISOString() : null,
    createdAt: rx.createdAt.toISOString(),
    orderId: rx.orderId,
    orderReference: rx.order?.reference ?? null,
    orderStatus: (rx.order?.status as OrderStatus | undefined) ?? null,
    fileUrl: null,
    storageKey: null,
    isRefill,
    parentPrescriptionId: rx.parentPrescriptionId ?? null,
    refillNumber: rx.refillNumber ?? null,
    refillReleasedAt: rx.refillReleasedAt ? rx.refillReleasedAt.toISOString() : null,
    sourceOrderId: parent?.order?.id ?? parent?.orderId ?? null,
    sourceOrderReference: parent?.order?.reference ?? null,
    sourceOrderStatus: (parent?.order?.status as OrderStatus | undefined) ?? null,
    parentRefillsAllowed: parent ? parent.refillsAllowed : null,
    parentRefillsUsed: parent ? parent.refillsUsed : null,
    parentValidUntil: parent?.validUntil ? parent.validUntil.toISOString() : null,
    parentStatus: parent ? (parent.status as RxStatus) : null,
    parentReviewedByName: parent?.reviewedBy?.name ?? null,
    parentReviewNotes: parent?.reviewNotes ?? null,
    activeRefillOrderId: activeRefill?.id ?? null,
    activeRefillOrderReference: activeRefill?.reference ?? null,
    activeRefillOrderStatus: activeRefill?.status ?? null,
    ...(includeCustomer
      ? { customerName: rx.user?.name ?? null, customerPhone: rx.user?.phone ?? null }
      : {}),
  }
}

/** Full order with relations → DTO. */
export function toOrderDTO(order: {
  id: string; reference: string; type: string; status: string; fulfillment: string;
  paymentMethod?: string | null; deliveryLatitude?: number | null; deliveryLongitude?: number | null;
  deliveryAddress: string | null; deliveryArea: string | null; deliveryNotes: string | null;
  deliveryFee: DbMoney; subtotal: DbMoney; total: DbMoney; notes: string | null; pickupCode: string | null;
  riderId?: string | null; riderName: string | null; createdAt: Date; updatedAt: Date;
  pointsEarned?: number | null; pointsRedeemed?: number | null;
  discountAmount?: DbMoney | null; promotionCode?: string | null;
  guestName?: string | null; guestPhone?: string | null;
  refillOfOrderId?: string | null;
  refillOfOrder?: { id: string; reference: string } | null;
  user?: { name: string | null; phone: string | null } | null;
  items: DbOrderItem[];
  statusHistory: { id: string; status: string; note: string | null; actor: string; createdAt: Date }[];
  payments: DbPayment[];
  prescriptions: DbPrescription[];
}): OrderDTO {
  const refillOfOrderId = order.refillOfOrderId ?? order.refillOfOrder?.id ?? null
  const refillOfOrderReference =
    order.refillOfOrder?.reference ??
    order.prescriptions.find((rx) => rx.parentPrescription?.order?.reference)?.parentPrescription?.order?.reference ??
    extractLegacySourceOrderReference(order.notes)
  const isRefill = Boolean(
    refillOfOrderId ||
      refillOfOrderReference ||
      order.prescriptions.some((rx) => isRefillPrescriptionRecord(rx))
  )

  return {
    id: order.id,
    reference: order.reference,
    type: order.type as OrderType,
    status: order.status as OrderStatus,
    fulfillment: order.fulfillment as Fulfillment,
    paymentMethod: order.paymentMethod ?? null,
    deliveryLatitude: order.deliveryLatitude ?? null,
    deliveryLongitude: order.deliveryLongitude ?? null,
    deliveryAddress: order.deliveryAddress,
    deliveryArea: order.deliveryArea,
    deliveryNotes: order.deliveryNotes,
    deliveryFee: moneyNumber(order.deliveryFee),
    subtotal: moneyNumber(order.subtotal),
    discountAmount: moneyNumber(order.discountAmount),
    promotionCode: order.promotionCode ?? null,
    total: moneyNumber(order.total),
    notes: order.notes,
    pickupCode: order.pickupCode,
    pointsEarned: order.pointsEarned ?? 0,
    pointsRedeemed: order.pointsRedeemed ?? 0,
    riderId: order.riderId ?? null,
    riderName: order.riderName,
    customerName: order.user?.name ?? order.guestName ?? null,
    customerPhone: order.user?.phone ?? order.guestPhone ?? null,
    isRefill,
    refillOfOrderId,
    refillOfOrderReference,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items.map(toOrderItemDTO),
    statusHistory: order.statusHistory
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((h) => ({
        id: h.id, status: h.status as OrderStatus, note: h.note, actor: h.actor, createdAt: h.createdAt.toISOString(),
      })),
    payments: order.payments.map(toPaymentDTO),
    prescriptions: order.prescriptions.map((rx) => toPrescriptionDTOFull({ ...rx, reviewedAt: rx.reviewedAt ?? null })),
  }
}

export function toAddressDTO(a: { id: string; label: string; text: string; area: string | null; notes: string | null; isDefault: boolean; latitude?: number | null; longitude?: number | null }): AddressDTO {
  return { id: a.id, label: a.label, text: a.text, area: a.area, notes: a.notes, isDefault: a.isDefault, latitude: a.latitude ?? null, longitude: a.longitude ?? null }
}

export function toPromotionDTO(p: {
  id: string; title: string; description: string; badge: string | null; code: string | null;
  discountPct: number | null; color: string | null; active: boolean; isPublic: boolean;
  startsAt: Date | null; endsAt: Date | null;
  maxUses?: number | null; perUserLimit?: number | null; perIpLimit?: number | null; perBrowserLimit?: number | null; minimumSpend?: DbMoney | null;
}): PromotionDTO {
  return {
    id: p.id, title: p.title, description: p.description, badge: p.badge, code: p.code,
    discountPct: p.discountPct, color: p.color, active: p.active, isPublic: p.isPublic,
    startsAt: p.startsAt ? p.startsAt.toISOString() : null,
    endsAt: p.endsAt ? p.endsAt.toISOString() : null,
    maxUses: p.maxUses ?? null,
    perUserLimit: p.perUserLimit ?? null,
    perIpLimit: p.perIpLimit ?? null,
    perBrowserLimit: p.perBrowserLimit ?? null,
    minimumSpend: p.minimumSpend == null ? null : moneyNumber(p.minimumSpend),
  }
}

export function toNotificationDTO(n: {
  id: string; channel: string; event: string | null; title: string; message: string;
  read: boolean; createdAt: Date; metadata?: string | null; staffId?: string | null;
}): NotificationDTO {
  return {
    id: n.id, channel: n.channel, event: n.event, title: n.title, message: n.message,
    read: n.read, createdAt: n.createdAt.toISOString(),
    metadata: n.metadata ?? null,
    staffId: n.staffId ?? null,
  }
}

export function toAuditLogDTO(l: {
  id: string; actor: string; actorRole: string | null; action: string; entity: string;
  entityId: string | null; details: string | null; createdAt: Date;
}): AuditLogDTO {
  return {
    id: l.id, actor: l.actor, actorRole: l.actorRole, action: l.action, entity: l.entity,
    entityId: l.entityId, details: l.details, createdAt: l.createdAt.toISOString(),
  }
}

// helper to include reviewedAt from raw prescription rows
export function toPrescriptionDTOFull(rx: DbPrescription & { reviewedAt: Date | null }, includeCustomer = false): PrescriptionDTO {
  const dto = toPrescriptionDTO(rx, includeCustomer)
  return { ...dto, reviewedAt: rx.reviewedAt ? rx.reviewedAt.toISOString() : null }
}

/** Prescription include object for Prisma queries (reused across routes & orders). */
export const PRESCRIPTION_INCLUDE = {
  user: { select: { name: true, phone: true } },
  order: { select: { id: true, reference: true, status: true } },
  reviewedBy: { select: { name: true } },
  parentPrescription: {
    select: {
      id: true,
      status: true,
      refillsAllowed: true,
      refillsUsed: true,
      validUntil: true,
      reviewNotes: true,
      orderId: true,
      order: { select: { id: true, reference: true, status: true } },
      reviewedBy: { select: { name: true } },
      childRefills: {
        where: { deletedAt: null },
        select: {
          id: true,
          orderId: true,
          order: { select: { id: true, reference: true, status: true } },
        },
      },
    },
  },
  childRefills: {
    where: { deletedAt: null },
    select: {
      id: true,
      orderId: true,
      order: { select: { id: true, reference: true, status: true } },
    },
  },
} as const

/** Order include object for Prisma queries (reused everywhere). */
export const ORDER_INCLUDE = {
  items: true,
  statusHistory: true,
  payments: true,
  refillOfOrder: { select: { id: true, reference: true } },
  prescriptions: {
    where: { deletedAt: null },
    include: PRESCRIPTION_INCLUDE,
  },
  user: { select: { name: true, phone: true } },
} as const

/** Attach avgRating + reviewCount aggregates to product rows (single groupBy query). */
export async function attachRatings<T extends { id: string }>(
  products: T[]
): Promise<(T & { avgRating: number | null; reviewCount: number })[]> {
  if (products.length === 0) return []
  const grouped = await db.review.groupBy({
    by: ["productId"],
    where: { productId: { in: products.map((p) => p.id) }, status: "PUBLISHED" },
    _avg: { rating: true },
    _count: { rating: true },
  })
  const map = new Map(
    grouped.map((g) => [g.productId, { avgRating: g._avg.rating ?? null, reviewCount: g._count.rating }])
  )
  return products.map((p) => ({
    ...p,
    ...(map.get(p.id) ?? { avgRating: null, reviewCount: 0 }),
  }))
}

/** Review row → DTO (author name protected: shows first name + initial). */
export function toReviewDTO(r: {
  id: string; productId: string; rating: number; comment: string | null; createdAt: Date;
  user?: { name: string | null } | null;
}): ReviewDTO {
  const name = r.user?.name?.trim() ?? "Customer"
  const parts = name.split(/\s+/)
  const authorName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : name
  return {
    id: r.id,
    productId: r.productId,
    rating: r.rating,
    comment: r.comment,
    authorName,
    createdAt: r.createdAt.toISOString(),
  }
}
