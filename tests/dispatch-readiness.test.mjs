import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("delivery must be physically prepared before it can be dispatched", () => {
  const workflow = source("src/lib/security/order-workflow.ts")
  assert.match(workflow, /PREPARING:\s*\["READY_FOR_PICKUP"\]/)
  assert.match(workflow, /READY_FOR_PICKUP:\s*\["COMPLETED_PICKUP",\s*"OUT_FOR_DELIVERY"\]/)
  assert.match(workflow, /from === "READY_FOR_PICKUP" && to === "OUT_FOR_DELIVERY"/)
})

test("dispatching requires a rider and completed deliveries require confirmed payment", () => {
  const route = source("src/app/api/orders/[id]/route.ts")
  assert.match(route, /status === "OUT_FOR_DELIVERY" && \(order\.fulfillment !== "DELIVERY" \|\| !order\.riderId\)/)
  assert.match(route, /status === "COMPLETED_DELIVERY" && !order\.payments\.some/)
  assert.match(route, /status === "PAID" && !order\.payments\.some/)
  assert.match(route, /status === "READY_FOR_PICKUP" && order\.prescriptions\.some/)
  assert.match(route, /status === "READY_FOR_PICKUP" && order\.fulfillment === "DELIVERY"/)
})

test("orders UI exposes pack, ready, rider assignment and dispatch as distinct actions", () => {
  const orders = source("src/components/views/admin/sections/orders-section.tsx")
  assert.match(orders, /Mark ready for dispatch/)
  assert.match(orders, /Dispatch readiness/)
  assert.match(orders, /ordersApi\.dispatchRiders\(\)/)
  assert.match(orders, /Assign rider/)
  assert.match(orders, /order\.riderId \? \["OUT_FOR_DELIVERY"\] : \[\]/)
  assert.doesNotMatch(orders, /adminApi\s*\.staff\(\)/)
})

test("dispatch controller exposes prepared order handoff without skipping readiness", () => {
  const dispatch = source("src/components/views/admin/sections/dispatch-control-room.tsx")
  assert.match(dispatch, /Mark ready for dispatch/)
  assert.match(dispatch, /order\.status === "READY_FOR_PICKUP" && !!order\.riderId/)
})
