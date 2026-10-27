"use client"

// Dispatch — the delivery control room. Riders get a personal "My deliveries"
// board (start / complete their own drops, call or WhatsApp the customer);
// other staff get the full board: unassigned vs assigned tabs, rider
// assignment (with live workload counts) and a delivered fallback action.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/shared/empty-state"
import { OrderStatusBadge } from "@/components/shared/status-badges"
import { adminApi, ordersApi, paymentsApi } from "@/lib/api-client"
import type { OrderDTO, StaffDTO } from "@/lib/types"
import { PAYMENT_METHOD_LABELS, type OrderStatus } from "@/lib/constants"
import { formatKES, shortRef, statusLabel, timeAgo } from "@/lib/format"
import { useAuthStore } from "@/store/use-auth-store"
import { toast } from "sonner"
import { AdminSectionHeader, apiErrorMessage, SectionError, telHref, waHref, type SectionProps } from "../admin-shared"
import {
  Bike, CheckCircle2, Loader2, MapPin, MessageCircle, Navigation, Package, Phone, Truck, User,
  Banknote, Smartphone, Wallet,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ---------- helpers ----------

/** Latest payment method label for an order (cash riders need to collect). */
function payMethodLabel(order: OrderDTO): string | null {
  const latest = order.payments.length
    ? order.payments.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b))
    : null
  if (!latest?.method) return null
  return PAYMENT_METHOD_LABELS[latest.method] ?? latest.method
}

// ---------- main section ----------

export function DispatchSection({ refreshKey, onRefresh }: SectionProps) {
  const role = useAuthStore((s) => s.session?.role)
  const isRider = role === "RIDER"
  const canAssign = role === "ADMIN" || role === "STAFF" || role === "PHARMACIST"

  const [orders, setOrders] = useState<OrderDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // staff board state
  const [tab, setTab] = useState<"unassigned" | "assigned">("unassigned")
  const [riders, setRiders] = useState<StaffDTO[]>([])
  const [assignPick, setAssignPick] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setError(null)
    try {
      const list = isRider ? await ordersApi.myDeliveries() : await ordersApi.dispatchBoard()
      setOrders(list)
    } catch (err) {
      setError(apiErrorMessage(err))
      setOrders([])
    }
  }, [isRider])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  // active rider roster for the assignment select
  useEffect(() => {
    if (isRider || !canAssign) return
    let cancelled = false
    adminApi
      .staff()
      .then((list) => {
        if (!cancelled) setRiders(list.filter((s) => s.role === "RIDER" && s.active))
      })
      .catch(() => {
        if (!cancelled) setRiders([])
      })
    return () => {
      cancelled = true
    }
  }, [isRider, canAssign, refreshKey])

  /** riderId → number of open dispatch orders currently assigned */
  const workload = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of orders ?? []) {
      if (o.riderId) map.set(o.riderId, (map.get(o.riderId) ?? 0) + 1)
    }
    return map
  }, [orders])

  async function runOrderAction(
    order: OrderDTO,
    fn: () => Promise<OrderDTO>,
    successMsg: string
  ): Promise<void> {
    setBusyId(order.id)
    try {
      await fn()
      toast.success(successMsg)
      setAssignPick((prev) => {
        const next = { ...prev }
        delete next[order.id]
        return next
      })
      await load()
      onRefresh()
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  function setRiderStatus(order: OrderDTO, status: OrderStatus) {
    void runOrderAction(
      order,
      () => ordersApi.updateStatus(order.id, status),
      `Order ${shortRef(order.reference)} → ${statusLabel(status)}.`
    )
  }

  function assignRider(order: OrderDTO) {
    const staffId = assignPick[order.id]
    if (!staffId) {
      toast.error("Choose a rider for this delivery first.")
      return
    }
    const rider = riders.find((r) => r.id === staffId)
    void runOrderAction(
      order,
      () => ordersApi.assignRider(order.id, staffId),
      `${rider?.name ?? "Rider"} assigned to ${shortRef(order.reference)}.`
    )
  }

  async function promptMpesaOnDelivery(order: OrderDTO) {
    setBusyId(order.id)
    try {
      const res = await paymentsApi.requestPayment(order.id, order.customerPhone ?? undefined)
      toast.success(res.message || `M-Pesa STK push sent to ${order.customerPhone}`)
      // Start short polling for live payment confirmation
      let attempts = 0
      const poll = setInterval(async () => {
        attempts++
        try {
          const q = await paymentsApi.mpesaQuery(res.checkoutRequestId)
          if (q.status === "SUCCESS") {
            clearInterval(poll)
            toast.success(`Payment confirmed for ${order.reference}!`)
            await load()
            onRefresh()
          } else if (q.status === "FAILED" || attempts > 20) {
            clearInterval(poll)
            if (q.status === "FAILED") toast.error("Customer cancelled or wrong M-Pesa PIN.")
          }
        } catch {
          if (attempts > 20) clearInterval(poll)
        }
      }, 3000)
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function confirmCashOnDelivery(order: OrderDTO) {
    setBusyId(order.id)
    try {
      await ordersApi.markPaidCash(order.id)
      toast.success(`Cash payment confirmed for ${order.reference}.`)
      await load()
      onRefresh()
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  // ---------- rider board (personal) ----------

  if (isRider) {
    const active = orders ?? []
    const outCount = active.filter((o) => o.status === "OUT_FOR_DELIVERY").length
    const readyCount = active.filter((o) =>
      ["PAID", "PREPARING", "READY_FOR_PICKUP"].includes(o.status)
    ).length

    return (
      <div className="space-y-4">
        <AdminSectionHeader
          title="My deliveries"
          subtitle="Your assigned drop-offs — contact the customer, start the run and confirm delivery."
        />

        {/* shift snapshot */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
                <Navigation className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Out for delivery</p>
                <p className="text-xl font-bold tabular-nums">{outCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                <Package className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Ready to start</p>
                <p className="text-xl font-bold tabular-nums">{readyCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="col-span-2">
            <CardContent className="flex items-center gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Bike className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Total assigned today</p>
                <p className="text-xl font-bold tabular-nums">{active.length}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {error ? <SectionError message={error} onRetry={() => void load()} /> : null}

        {orders === null ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="space-y-3 p-4">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-9 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : active.length === 0 ? (
          <EmptyState
            icon={Bike}
            title="No deliveries assigned"
            description="Orders assigned to you for delivery will appear here. Check back after the team dispatches new runs."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((order) => (
              <RiderDeliveryCard
                key={order.id}
                order={order}
                busy={busyId === order.id}
                onStart={() => setRiderStatus(order, "OUT_FOR_DELIVERY")}
                onComplete={() => setRiderStatus(order, "COMPLETED_DELIVERY")}
                onPromptMpesa={() => void promptMpesaOnDelivery(order)}
                onConfirmCash={() => void confirmCashOnDelivery(order)}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // ---------- staff board (full dispatch) ----------

  const unassigned = (orders ?? [])
    .filter((o) => !o.riderId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const assigned = (orders ?? [])
    .filter((o) => o.riderId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const visible = tab === "unassigned" ? unassigned : assigned

  return (
    <div className="space-y-4">
      <AdminSectionHeader
        title="Dispatch board"
        subtitle="Delivery orders waiting for riders — assign, track and confirm drop-offs."
      />

      {/* rider workload chips */}
      {riders.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Rider workload">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Rider workload
          </span>
          {riders.map((r) => {
            const count = workload.get(r.id) ?? 0
            return (
              <Badge
                key={r.id}
                variant="outline"
                className={cn(
                  "gap-1.5 tabular-nums",
                  count === 0
                    ? "text-muted-foreground"
                    : count >= 3
                      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      : "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300"
                )}
              >
                <Bike className="h-3 w-3" aria-hidden />
                {r.name} · {count} active
              </Badge>
            )
          })}
        </div>
      ) : null}

      {/* tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "unassigned" | "assigned")}>
        <TabsList>
          <TabsTrigger value="unassigned" className="gap-1.5">
            Unassigned
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] tabular-nums">
              {unassigned.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="assigned" className="gap-1.5">
            Assigned / active
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] tabular-nums">
              {assigned.length}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {error ? <SectionError message={error} onRetry={() => void load()} /> : null}

      {orders === null ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={tab === "unassigned" ? "No unassigned deliveries" : "No active assigned deliveries"}
          description={
            tab === "unassigned"
              ? "Every delivery order on the board has a rider. New paid delivery orders appear here for assignment."
              : "Assigned deliveries in progress will appear here — until they reach the customer's door."
          }
          action={
            tab === "unassigned" && assigned.length > 0
              ? { label: "View assigned deliveries", onClick: () => setTab("assigned") }
              : undefined
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((order) => (
            <DispatchCard
              key={order.id}
              order={order}
              riders={riders}
              canAssign={canAssign}
              assignValue={assignPick[order.id] ?? ""}
              busy={busyId === order.id}
              onAssignChange={(v) => setAssignPick((prev) => ({ ...prev, [order.id]: v }))}
              onAssign={() => assignRider(order)}
              onComplete={() => setRiderStatus(order, "COMPLETED_DELIVERY")}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- rider's personal delivery card ----------

function RiderDeliveryCard({
  order,
  busy,
  onStart,
  onComplete,
  onPromptMpesa,
  onConfirmCash,
}: {
  order: OrderDTO
  busy: boolean
  onStart: () => void
  onComplete: () => void
  onPromptMpesa?: () => void
  onConfirmCash?: () => void
}) {
  const wa = waHref(order.customerPhone, `Hello ${order.customerName ?? "there"}, this is Sphere Pharmacy — I'm on my way with your order ${order.reference}.`)
  const tel = telHref(order.customerPhone)
  const payable = payMethodLabel(order)
  const canStart = order.status === "READY_FOR_PICKUP"
  const isUnpaid = order.status === "OUT_FOR_DELIVERY" && !order.payments.some((payment) => payment.status === "SUCCESS")
  const canComplete = order.status === "OUT_FOR_DELIVERY" && !isUnpaid

  return (
    <Card className="card-lift">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-sm font-bold">{order.reference}</p>
          {order.status === "READY_FOR_PICKUP"
                            ? <Badge variant="outline" className="border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200">Ready for dispatch</Badge>
                            : <OrderStatusBadge status={order.status} />}
          <span className="ml-auto text-xs text-muted-foreground">{timeAgo(order.createdAt)}</span>
        </div>

        <div className="space-y-1 text-sm">
          <p className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="font-medium">{order.deliveryArea ?? "Delivery"}</span>
              <span className="block text-muted-foreground">{order.deliveryAddress ?? "Address on file"}</span>
            </span>
          </p>
          {order.deliveryNotes ? (
            <p className="pl-5 text-xs text-muted-foreground">Notes: {order.deliveryNotes}</p>
          ) : null}
          <p className="flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {order.items.length} item{order.items.length === 1 ? "" : "s"}
            <span className="ml-1 font-semibold tabular-nums">{formatKES(order.total)}</span>
            {payable ? (
              <Badge variant="outline" className="ml-1 text-[11px] text-muted-foreground">
                {payable}
              </Badge>
            ) : null}
          </p>
          <p className="flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {order.customerName ?? "Guest customer"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tel ? (
            <Button size="sm" variant="outline" className="gap-1.5" asChild>
              <a href={tel}>
                <Phone className="h-3.5 w-3.5" aria-hidden />
                {order.customerPhone}
              </a>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">No phone on file</p>
          )}
          {wa ? (
            <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" asChild>
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
              </a>
            </Button>
          ) : null}
        </div>

        {isUnpaid ? (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-800/60 dark:bg-amber-950/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                Collect on Delivery
              </span>
              <span className="font-mono text-sm font-bold text-amber-900 dark:text-amber-200">
                {formatKES(order.total)}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {onPromptMpesa ? (
                <Button
                  size="sm"
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={onPromptMpesa}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Smartphone className="h-3.5 w-3.5" />}
                  Prompt M-Pesa STK
                </Button>
              ) : null}
              {onConfirmCash ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={onConfirmCash}
                  disabled={busy}
                >
                  <Banknote className="h-3.5 w-3.5" /> Cash Received
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t pt-3">
          {canStart ? (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={onStart}
              disabled={busy}
              aria-label={`Start delivery for order ${order.reference}`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Navigation className="h-3.5 w-3.5" aria-hidden />}
              Start delivery
            </Button>
          ) : null}
          {canComplete ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
              onClick={onComplete}
              disabled={busy}
              aria-label={`Mark order ${order.reference} as delivered`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
              Mark delivered
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- staff dispatch card ----------

function DispatchCard({
  order,
  riders,
  canAssign,
  assignValue,
  busy,
  onAssignChange,
  onAssign,
  onComplete,
}: {
  order: OrderDTO
  riders: StaffDTO[]
  canAssign: boolean
  assignValue: string
  busy: boolean
  onAssignChange: (v: string) => void
  onAssign: () => void
  onComplete: () => void
}) {
  const tel = telHref(order.customerPhone)
  // allow reassignment; hide the currently assigned rider from the options
  const options = riders.filter((r) => r.id !== order.riderId)
  const assignedRider = riders.find((r) => r.id === order.riderId)
  const wa = waHref(order.customerPhone, `Hello ${order.customerName ?? "there"}, this is Sphere Pharmacy regarding your delivery order ${order.reference}.`)

  return (
    <Card className="card-lift">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-sm font-bold">{order.reference}</p>
          {order.status === "READY_FOR_PICKUP"
                            ? <Badge variant="outline" className="border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200">Ready for dispatch</Badge>
                            : <OrderStatusBadge status={order.status} />}
          <span className="ml-auto text-xs text-muted-foreground">{timeAgo(order.createdAt)}</span>
        </div>

        <div className="space-y-1 text-sm">
          <p className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="font-medium">{order.deliveryArea ?? "Delivery"}</span>
              <span className="block text-muted-foreground">{order.deliveryAddress ?? "Address on file"}</span>
            </span>
          </p>
          <p className="flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {order.items.length} item{order.items.length === 1 ? "" : "s"}
            <span className="ml-1 font-semibold tabular-nums">{formatKES(order.total)}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate">
              {order.customerName ?? "Guest customer"}
              {tel ? (
                <>
                  {" · "}
                  <a href={tel} className="underline decoration-dotted hover:text-primary" aria-label={`Call ${order.customerName ?? "customer"}`}>
                    {order.customerPhone}
                  </a>
                </>
              ) : null}
            </span>
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                aria-label={`WhatsApp ${order.customerName ?? "customer"} about order ${order.reference}`}
              >
                <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
              </a>
            ) : null}
          </p>
        </div>

        {/* current rider */}
        {order.riderName ? (
          <p className="flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50/70 px-2.5 py-1.5 text-xs font-medium text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
            <Bike className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {order.riderName}
            {assignedRider?.phone ? (
              <a href={telHref(assignedRider.phone) ?? "#"} className="ml-auto underline decoration-dotted" aria-label={`Call rider ${order.riderName}`}>
                Call rider
              </a>
            ) : null}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <Bike className="h-3.5 w-3.5 shrink-0" aria-hidden />
            No rider yet — needs assignment
          </p>
        )}

        {/* assignment controls */}
        {canAssign && options.length > 0 ? (
          <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row">
            <Select value={assignValue || undefined} onValueChange={onAssignChange}>
              <SelectTrigger
                className="sm:flex-1"
                aria-label={`Assign a rider to order ${order.reference}`}
              >
                <SelectValue placeholder={order.riderName ? `Reassign from ${order.riderName}…` : "Choose a rider…"} />
              </SelectTrigger>
              <SelectContent>
                {options.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="gap-1.5 sm:w-auto"
              onClick={onAssign}
              disabled={busy || !assignValue}
              aria-label={`Assign selected rider to order ${order.reference}`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Bike className="h-3.5 w-3.5" aria-hidden />}
              {order.riderName ? "Reassign" : "Assign"}
            </Button>
          </div>
        ) : canAssign ? (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            {order.riderName ? "No other active riders to reassign to." : "No active riders available to assign."}
          </p>
        ) : null}

        {/* delivered fallback for stuck OUT_FOR_DELIVERY orders */}
        {order.status === "OUT_FOR_DELIVERY" ? (
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
            onClick={onComplete}
            disabled={busy}
            aria-label={`Mark order ${order.reference} as delivered`}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
            Mark delivered
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
