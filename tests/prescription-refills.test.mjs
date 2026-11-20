import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  computeRefillOrderTotals,
  evaluateRefillEligibility,
  extractLegacySourceOrderReference,
  isRefillPrescriptionRecord,
  normalizeRefillPaymentMethod,
} from "../src/lib/prescriptions/refill-core.ts"

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
const NOW = Date.parse("2026-11-20T12:00:00.000Z")
const FUTURE = "2027-01-15T12:00:00.000Z"
const PAST = "2026-10-01T12:00:00.000Z"

// ---------- Pure refill domain unit tests ----------

test("evaluateRefillEligibility: allows APPROVED and PARTIALLY_APPROVED linked prescriptions with remaining refills", () => {
  const approved = evaluateRefillEligibility(
    {
      id: "rx-1",
      status: "APPROVED",
      orderId: "ord-1",
      orderReference: "SPH-AAA111",
      orderStatus: "COMPLETED_DELIVERY",
      refillsAllowed: 3,
      refillsUsed: 1,
      validUntil: FUTURE,
    },
    NOW
  )
  assert.equal(approved.canRequest, true)
  assert.equal(approved.blockedReason, null)
  assert.equal(approved.remaining, 2)
  assert.equal(approved.rootPrescriptionId, "rx-1")
  assert.equal(approved.isRefill, false)

  const partial = evaluateRefillEligibility(
    {
      id: "rx-2",
      status: "PARTIALLY_APPROVED",
      orderId: "ord-2",
      orderReference: "SPH-BBB222",
      orderStatus: "PRESCRIPTION_VERIFIED",
      refillsAllowed: 2,
      refillsUsed: 0,
      validUntil: FUTURE,
    },
    NOW
  )
  assert.equal(partial.canRequest, true)
  assert.equal(partial.remaining, 2)
})

test("evaluateRefillEligibility: blocks standalone, expired, exhausted, cancelled-order, and active-refill prescriptions", () => {
  const standalone = evaluateRefillEligibility(
    {
      id: "rx-standalone",
      status: "APPROVED",
      orderId: null,
      refillsAllowed: 3,
      refillsUsed: 0,
      validUntil: FUTURE,
    },
    NOW
  )
  assert.equal(standalone.canRequest, false)
  assert.equal(standalone.blockedReason, "no_order")

  const expired = evaluateRefillEligibility(
    {
      id: "rx-expired",
      status: "APPROVED",
      orderId: "ord-1",
      orderStatus: "COMPLETED_PICKUP",
      refillsAllowed: 3,
      refillsUsed: 0,
      validUntil: PAST,
    },
    NOW
  )
  assert.equal(expired.canRequest, false)
  assert.equal(expired.expired, true)
  assert.equal(expired.blockedReason, "expired")

  const exhausted = evaluateRefillEligibility(
    {
      id: "rx-used",
      status: "APPROVED",
      orderId: "ord-1",
      orderStatus: "COMPLETED_PICKUP",
      refillsAllowed: 2,
      refillsUsed: 2,
      validUntil: FUTURE,
    },
    NOW
  )
  assert.equal(exhausted.canRequest, false)
  assert.equal(exhausted.blockedReason, "exhausted")

  const cancelledSource = evaluateRefillEligibility(
    {
      id: "rx-cancelled",
      status: "APPROVED",
      orderId: "ord-1",
      orderStatus: "CANCELLED",
      refillsAllowed: 3,
      refillsUsed: 0,
      validUntil: FUTURE,
    },
    NOW
  )
  assert.equal(cancelledSource.canRequest, false)
  assert.equal(cancelledSource.blockedReason, "source_order_cancelled")

  const activeInFlight = evaluateRefillEligibility(
    {
      id: "rx-inflight",
      status: "APPROVED",
      orderId: "ord-1",
      orderStatus: "COMPLETED_DELIVERY",
      refillsAllowed: 3,
      refillsUsed: 1,
      validUntil: FUTURE,
      activeRefillOrderId: "ord-refill-1",
      activeRefillOrderReference: "SPH-REF001",
    },
    NOW
  )
  assert.equal(activeInFlight.canRequest, false)
  assert.equal(activeInFlight.hasActiveRefill, true)
  assert.equal(activeInFlight.blockedReason, "active_refill")
  assert.equal(activeInFlight.activeRefillOrderId, "ord-refill-1")
})

test("evaluateRefillEligibility: child refill prescription resolves to parent allowance once its refill order completes", () => {
  const completedChild = evaluateRefillEligibility(
    {
      id: "rx-child-1",
      status: "APPROVED",
      orderId: "ord-refill-1",
      orderReference: "SPH-REF001",
      orderStatus: "COMPLETED_DELIVERY",
      refillsAllowed: 0,
      refillsUsed: 0,
      validUntil: FUTURE,
      parentPrescriptionId: "rx-parent",
      refillNumber: 1,
      sourceOrderId: "ord-1",
      sourceOrderReference: "SPH-ORIG01",
      sourceOrderStatus: "COMPLETED_DELIVERY",
      parentStatus: "APPROVED",
      parentRefillsAllowed: 3,
      parentRefillsUsed: 1,
      parentValidUntil: FUTURE,
    },
    NOW
  )
  assert.equal(completedChild.isRefill, true)
  assert.equal(completedChild.rootPrescriptionId, "rx-parent")
  assert.equal(completedChild.canRequest, true)
  assert.equal(completedChild.remaining, 2)
  assert.equal(completedChild.refillsAllowed, 3)
  assert.equal(completedChild.refillsUsed, 1)

  const inProgressChild = evaluateRefillEligibility(
    {
      id: "rx-child-2",
      status: "PENDING",
      orderId: "ord-refill-2",
      orderReference: "SPH-REF002",
      orderStatus: "UNDER_REVIEW",
      refillsAllowed: 0,
      refillsUsed: 0,
      validUntil: FUTURE,
      parentPrescriptionId: "rx-parent",
      refillNumber: 2,
      sourceOrderId: "ord-1",
      sourceOrderReference: "SPH-ORIG01",
      sourceOrderStatus: "COMPLETED_DELIVERY",
      parentStatus: "APPROVED",
      parentRefillsAllowed: 3,
      parentRefillsUsed: 2,
      parentValidUntil: FUTURE,
    },
    NOW
  )
  assert.equal(inProgressChild.canRequest, false)
  assert.equal(inProgressChild.blockedReason, "active_refill")
  assert.equal(inProgressChild.activeRefillOrderId, "ord-refill-2")

  const legacyChild = evaluateRefillEligibility(
    {
      id: "rx-legacy",
      status: "APPROVED",
      notes: "Refill use of prescription ABC123",
      orderId: "ord-legacy-refill",
      orderStatus: "COMPLETED_PICKUP",
      refillsAllowed: 0,
      refillsUsed: 0,
      validUntil: FUTURE,
    },
    NOW
  )
  assert.equal(legacyChild.isRefill, true)
  assert.equal(legacyChild.canRequest, false)
  assert.equal(legacyChild.blockedReason, "legacy_refill_without_parent")
  assert.equal(isRefillPrescriptionRecord({ notes: "Refill use of prescription ABC123" }), true)
  assert.equal(extractLegacySourceOrderReference("Refill #2 of order SPH-ABCDEF123456"), "SPH-ABCDEF123456")
})

test("normalizeRefillPaymentMethod & computeRefillOrderTotals keep fulfillment, cash intent, and delivery fees consistent", () => {
  assert.equal(normalizeRefillPaymentMethod("CASH", "DELIVERY"), "CASH_ON_DELIVERY")
  assert.equal(normalizeRefillPaymentMethod("CASH", "PICKUP"), "CASH_ON_PICKUP")
  assert.equal(normalizeRefillPaymentMethod("CASH_ON_DELIVERY", "PICKUP"), "CASH_ON_PICKUP")
  assert.equal(normalizeRefillPaymentMethod("CASH_ON_PICKUP", "DELIVERY"), "CASH_ON_DELIVERY")
  assert.equal(normalizeRefillPaymentMethod("MPESA", "DELIVERY"), "MPESA")
  assert.equal(normalizeRefillPaymentMethod("CARD", "PICKUP"), "CARD")
  assert.equal(normalizeRefillPaymentMethod(null, "PICKUP"), null)

  const pickupTotals = computeRefillOrderTotals({
    lines: [
      { price: 450.5, qty: 2 },
      { price: 199, qty: 1 },
    ],
    fulfillment: "PICKUP",
    deliveryFee: 250,
  })
  assert.deepEqual(pickupTotals, { subtotal: 1100, deliveryFee: 0, total: 1100 })

  const deliveryTotals = computeRefillOrderTotals({
    lines: [{ price: 450, qty: 2 }],
    fulfillment: "DELIVERY",
    deliveryFee: 200,
  })
  assert.deepEqual(deliveryTotals, { subtotal: 900, deliveryFee: 200, total: 1100 })
})

// ---------- Schema, API, and UI contract tests ----------

test("database schema and migration declare structural refill lineage columns and indexes", () => {
  const schema = read("prisma/schema.prisma")
  const migration = read("prisma/migrations/20261120120000_prescription_refill_lineage/migration.sql")

  assert.match(schema, /refillOfOrderId\s+String\?\s+@map\("refill_of_order_id"\)/)
  assert.match(schema, /parentPrescriptionId\s+String\?\s+@map\("parent_prescription_id"\)/)
  assert.match(schema, /refillNumber\s+Int\?\s+@map\("refill_number"\)/)
  assert.match(schema, /refillReleasedAt\s+DateTime\?\s+@map\("refill_released_at"\)/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "refill_of_order_id" TEXT/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "parent_prescription_id" TEXT/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "refill_number" INTEGER/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "refill_released_at" TIMESTAMP\(3\)/)
})

test("refill API resolves parent prescriptions, enforces active-refill guard, prices delivery fees, and preserves payment & location details", () => {
  const route = read("src/app/api/prescriptions/[id]/refill/route.ts")

  assert.match(route, /const rootPrescriptionId = requestedRx\.parentPrescriptionId \?\? requestedRx\.id/)
  assert.match(route, /isOrderCancelledOrRejected\(sourceOrder\.status\)/)
  assert.match(route, /ACTIVE_REFILL_CONFLICT/)
  assert.match(route, /computeDeliveryFee\(deliveryArea, settings\.delivery/)
  assert.match(route, /normalizeRefillPaymentMethod\(/)
  assert.match(route, /refillOfOrderId:\s*sourceOrder\.id/)
  assert.match(route, /parentPrescriptionId:\s*rx\.id/)
  assert.match(route, /refillNumber/)
  assert.match(route, /deliveryNotes/)
  assert.match(route, /deliveryLatitude/)
  assert.match(route, /deliveryLongitude/)
  assert.match(route, /\/admin\?section=prescriptions/)
  assert.doesNotMatch(route, /\/admin\/prescriptions/)
})

test("prescription review prevents infinite refills, filters deleted/cancelled rows, and releases stock & refill slots on rejection", () => {
  const listRoute = read("src/app/api/prescriptions/route.ts")
  const detailRoute = read("src/app/api/prescriptions/[id]/route.ts")
  const statsRoute = read("src/app/api/admin/stats/route.ts")

  assert.match(listRoute, /where:\s*\{\s*deletedAt:\s*null\s*\}/)
  assert.match(listRoute, /where:\s*\{\s*userId:\s*session\.userId,\s*deletedAt:\s*null\s*\}/)
  assert.match(detailRoute, /if\s*\(!rx \|\| rx\.deletedAt\)/)
  assert.match(detailRoute, /belongs to a cancelled or refunded order/)
  assert.match(detailRoute, /isRefillPrescriptionRecord\(rx\)/)
  assert.match(detailRoute, /effectiveRefillsAllowed = 0/)
  assert.match(detailRoute, /Refills allowed cannot be less than refills already used/)
  assert.match(detailRoute, /releaseOrderResourcesOnReject\(tx, order\.id, actor/)
  assert.match(statsRoute, /notIn:\s*\["CANCELLED", "REJECTED", "REFUNDED"\]/)
})

test("order cancel, reject, expiry cron, and InventoryGuard cleanup all idempotently return claimed refill slots", () => {
  const cancelRoute = read("src/app/api/orders/[id]/cancel/route.ts")
  const orderPatchRoute = read("src/app/api/orders/[id]/route.ts")
  const expiryCron = read("src/app/api/cron/order-reservations/route.ts")
  const guard = read("src/lib/inventory-guard.ts")
  const serverHelper = read("src/lib/prescriptions/refill-server.ts")

  assert.match(cancelRoute, /releaseRefillSlotsForOrder\(tx, order\.id\)/)
  assert.match(orderPatchRoute, /releaseOrderResourcesOnReject\(tx, order\.id, actor/)
  assert.match(expiryCron, /releaseRefillSlotsForOrder\(tx, order\.id\)/)
  assert.match(guard, /releaseRefillSlotsForOrder\(activeTx, order\.id\)/)
  assert.match(serverHelper, /refillReleasedAt:\s*null/)
  assert.match(serverHelper, /GREATEST\(0, "refillsUsed" - 1\)/)
})

test("customer and admin UIs surface refill lineage, lock refill-copy allowance edits, fix Order Detail R2 viewer, and support admin deep links", () => {
  const rxView = read("src/components/views/prescriptions-view.tsx")
  const orderDetailView = read("src/components/views/order-detail-view.tsx")
  const ordersView = read("src/components/views/orders-view.tsx")
  const adminRx = read("src/components/views/admin/sections/prescriptions-section.tsx")
  const adminOrders = read("src/components/views/admin/sections/orders-section.tsx")
  const appStore = read("src/store/use-app-store.ts")

  // Customer UI
  assert.match(rxView, /evaluateRefillEligibility\(rx\)/)
  assert.match(rxView, /<RefillRequestDialog/)
  assert.match(rxView, /Refill in progress/)
  assert.match(orderDetailView, /evaluateRefillEligibility\(rx\)/)
  assert.match(orderDetailView, /<RefillRequestDialog/)
  assert.match(orderDetailView, /detail\?\.fileUrl/)
  assert.match(orderDetailView, /\?download=1/)
  assert.match(ordersView, /order\.isRefill/)

  // Admin UI & routing
  assert.match(adminRx, /!isOrderCancelledOrRejected\(rx\.orderStatus\)/)
  assert.match(adminRx, /Refill re-verification/)
  assert.match(adminRx, /!isRefillCopy/)
  assert.match(adminRx, /Inspect \/ re-review/)
  assert.match(adminOrders, /order\.isRefill/)
  assert.match(adminOrders, /Find source order/)
  assert.match(appStore, /\/\\\/admin\\\/\(\[a-z0-9-\]\+\)\$\/\.exec\(path\)|\/\^\\\/admin\\\/\(\[a-z0-9-\]\+\)\$\/\.exec\(path\)/)
})
