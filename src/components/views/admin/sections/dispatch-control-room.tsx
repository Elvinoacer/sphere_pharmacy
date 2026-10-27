"use client"

// Admin/staff delivery operations. The separate Rider board stays unchanged.
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/shared/empty-state"
import { OrderStatusBadge } from "@/components/shared/status-badges"
import { ordersApi, paymentsApi } from "@/lib/api-client"
import { useAppStore } from "@/store/use-app-store"
import type { OrderDTO, StaffDTO } from "@/lib/types"
import { formatKES, shortRef, timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { AdminSectionHeader, apiErrorMessage, SectionError, telHref, waHref, type SectionProps } from "../admin-shared"
import {
  AlertCircle, ArrowRight, Bike, CheckCircle2, ChevronDown, ChevronUp, Clock3,
  CreditCard, ExternalLink, ListFilter, Loader2, MapPin, MessageCircle, Navigation,
  PackageCheck, Phone, RefreshCw, Search, Truck, UserRound, Users, Wallet,
} from "lucide-react"

type View = "all" | "unassigned" | "handoff" | "on-road" | "completed"
type Sort = "oldest" | "newest"
type Confirmation = { order: OrderDTO; action: "delivered" | "cash" | "reassign"; riderId?: string }
const VIEW_LABELS: Record<View, string> = {
  all: "All active", unassigned: "Needs rider", handoff: "At pharmacy",
  "on-road": "Out for delivery", completed: "Completed",
}

function paid(order: OrderDTO) {
  return order.payments.some((p) => p.status === "SUCCESS")
}
function onRoad(order: OrderDTO) {
  return order.status === "OUT_FOR_DELIVERY"
}
function attention(order: OrderDTO, now: number) {
  // Triage indicator, not a promised delivery SLA.
  return now - new Date(onRoad(order) ? order.updatedAt : order.createdAt).getTime() > 2 * 60 * 60 * 1000
}
function mapsHref(order: OrderDTO) {
  const location = [order.deliveryAddress, order.deliveryArea, "Nairobi, Kenya"].filter(Boolean).join(", ")
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(location)
}
function dateTime(value: string) {
  return new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })
}

export function DispatchControlRoom({ refreshKey, onRefresh, onNavigateSection }: SectionProps) {
  const [active, setActive] = useState<OrderDTO[] | null>(null)
  const [history, setHistory] = useState<OrderDTO[]>([])
  const [riders, setRiders] = useState<StaffDTO[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rosterError, setRosterError] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<View>("all")
  const [search, setSearch] = useState(() => useAppStore.getState().params.search ?? "")
  const [riderFilter, setRiderFilter] = useState("all")
  const [sort, setSort] = useState<Sort>("oldest")
  const [selected, setSelected] = useState<string[]>([])
  const [bulkRider, setBulkRider] = useState("")
  const [bulkBusy, setBulkBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<string[]>([])
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  const reload = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true)
    const [ordersResult, historyResult, ridersResult] = await Promise.allSettled([
      ordersApi.dispatchBoard(), ordersApi.dispatchHistory(), ordersApi.dispatchRiders(),
    ])
    if (ordersResult.status === "fulfilled") {
      setActive(ordersResult.value)
      setLoadError(null)
      setSelected((previous) => previous.filter((id) => ordersResult.value.some((o) => o.id === id && !o.riderId)))
    } else {
      setLoadError(apiErrorMessage(ordersResult.reason))
    }
    if (historyResult.status === "fulfilled") setHistory(historyResult.value)
    if (ridersResult.status === "fulfilled") {
      setRiders(ridersResult.value)
      setRosterError(false)
    } else {
      setRosterError(true)
    }
    setUpdatedAt(new Date())
    setNow(Date.now())
    setRefreshing(false)
  }, [])

  useEffect(() => {
    void reload()
    const ticker = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload(true)
    }, 45_000)
    return () => window.clearInterval(ticker)
  }, [reload, refreshKey])

  const open = useMemo(() => active ?? [], [active])
  const unassigned = open.filter((o) => !o.riderId)
  const handoff = open.filter((o) => o.riderId && !onRoad(o))
  const road = open.filter(onRoad)
  const ready = open.filter((o) => o.riderId && o.status === "READY_FOR_PICKUP")
  const completedToday = history.filter((o) => new Date(o.updatedAt).toDateString() === new Date(now).toDateString())
  const pendingPayment = road.filter((o) => !paid(o))
  const exceptions = open.filter((order) => attention(order, now))
  const counts: Record<View, number> = {
    all: open.length, unassigned: unassigned.length, handoff: handoff.length,
    "on-road": road.length, completed: history.length,
  }
  const workload = useMemo(() => {
    const tally = new Map<string, number>()
    for (const order of active ?? []) if (order.riderId) tally.set(order.riderId, (tally.get(order.riderId) ?? 0) + 1)
    return tally
  }, [active])

  const visible = useMemo(() => {
    const base = view === "completed" ? history : open.filter((o) =>
      view === "all" || (view === "unassigned" && !o.riderId) ||
      (view === "handoff" && !!o.riderId && !onRoad(o)) || (view === "on-road" && onRoad(o))
    )
    const q = search.trim().toLowerCase()
    return base.filter((o) => {
      if (riderFilter !== "all" && o.riderId !== riderFilter) return false
      if (!q) return true
      return [o.reference, o.customerName, o.customerPhone, o.deliveryAddress, o.deliveryArea, o.riderName]
        .some((part) => part?.toLowerCase().includes(q))
    }).sort((a, b) => {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      return sort === "oldest" ? diff : -diff
    })
  }, [open, history, view, search, riderFilter, sort])

  async function apply(order: OrderDTO, action: () => Promise<OrderDTO>, success: string) {
    setBusyId(order.id)
    try {
      await action()
      toast.success(success)
      setPicks((prev) => { const next = { ...prev }; delete next[order.id]; return next })
      await reload(true)
      onRefresh()
    } catch (err) {
      toast.error(apiErrorMessage(err))
      // A conflict means someone else might have moved the order.
      await reload(true)
    } finally {
      setBusyId(null)
    }
  }

  function assign(order: OrderDTO) {
    const riderId = picks[order.id]
    if (!riderId) { toast.error("Select an active rider first."); return }
    if (riderId === order.riderId) return
    if (onRoad(order)) {
      setConfirmation({ order, riderId, action: "reassign" })
      return
    }
    void apply(order, () => ordersApi.assignRider(order.id, riderId),
      (order.riderId ? "Reassigned" : "Assigned") + " " + shortRef(order.reference) + " to " + (riders.find((r) => r.id === riderId)?.name ?? "rider"))
  }

  function changeStatus(order: OrderDTO, status: "PREPARING" | "READY_FOR_PICKUP" | "OUT_FOR_DELIVERY") {
    void apply(order, () => ordersApi.updateStatus(order.id, status),
      status === "PREPARING" ? "Preparation started." : status === "READY_FOR_PICKUP" ? "Order is packed and ready for rider handoff." : "Rider dispatched.")
  }

  async function confirmAction() {
    const c = confirmation
    setConfirmation(null)
    if (!c) return
    if (c.action === "delivered") {
      await apply(c.order, () => ordersApi.updateStatus(c.order.id, "COMPLETED_DELIVERY", "Delivery confirmed by dispatch staff"),
        shortRef(c.order.reference) + " marked as delivered.")
    } else if (c.action === "cash") {
      await apply(c.order, () => ordersApi.markPaidCash(c.order.id),
        "Cash receipt recorded for " + shortRef(c.order.reference) + ".")
    } else if (c.riderId) {
      const riderId = c.riderId
      await apply(c.order, () => ordersApi.assignRider(c.order.id, riderId),
        "Active delivery reassigned to " + (riders.find((r) => r.id === riderId)?.name ?? "rider") + ".")
    }
  }

  async function requestMpesa(order: OrderDTO) {
    if (!order.customerPhone) { toast.error("Add a customer phone before requesting payment."); return }
    setBusyId(order.id)
    try {
      const result = await paymentsApi.requestPayment(order.id, order.customerPhone)
      toast.success(result.message || "M-Pesa payment prompt sent. Refresh after the customer approves.", { duration: 6000 })
      await reload(true)
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelected((prev) => checked ? [...prev.filter((x) => x !== id), id] : prev.filter((x) => x !== id))
  }

  const eligible = visible.filter((o) => !o.riderId && o.status !== "OUT_FOR_DELIVERY").slice(0, 25)
  async function batchAssign() {
    if (!bulkRider || !selected.length) {
      toast.error("Select deliveries and a rider first.")
      return
    }
    const ids = selected.filter((id) => open.some((o) => o.id === id && !o.riderId)).slice(0, 25)
    if (!ids.length) { toast.error("The selected deliveries have already been assigned."); setSelected([]); return }
    setBulkBusy(true)
    const failures: string[] = []
    let success = 0
    try {
      // Sequential writes avoid flooding customer/rider notifications.
      for (const id of ids) {
        try { await ordersApi.assignRider(id, bulkRider); success++ }
        catch (err) { failures.push(shortRef(open.find((o) => o.id === id)?.reference ?? id) + ": " + apiErrorMessage(err)) }
      }
      if (success) toast.success(success + " " + (success === 1 ? "delivery" : "deliveries") + " assigned.")
      if (failures.length) toast.error(failures.length + " not assigned. " + failures.slice(0, 2).join("; "), { duration: 8500 })
      setSelected(failures.length ? ids.filter((id) => failures.some((f) => f.includes(shortRef(open.find((o) => o.id === id)?.reference ?? id)))) : [])
      await reload(true)
      onRefresh()
    } finally {
      setBulkBusy(false)
    }
  }

  const isFiltered = search.trim() !== "" || riderFilter !== "all"
  const emptyDescription = isFiltered
    ? "No deliveries match the current search or rider filter. Clear filters to see the full queue."
    : view === "unassigned" ? "All active deliveries have a rider. Open All active to manage their next steps."
    : view === "handoff" ? "No rider-assigned orders are awaiting handoff. Check orders still needing a rider."
    : view === "on-road" ? "No deliveries are on the road. Check orders awaiting handoff."
    : view === "completed" ? "No delivered orders in the last 7 days."
    : "No paid or preparing delivery orders yet. Check Orders for incoming and unpaid orders."

  return (
    <div className="space-y-5">
      <AdminSectionHeader
        title="Dispatch control room"
        subtitle="Assign riders, prepare handoffs and close deliveries — all from one live operations board."
        action={<div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onNavigateSection("orders")} className="gap-2">
            <PackageCheck className="h-4 w-4" /> All orders
          </Button>
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={refreshing} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} /> Refresh
          </Button>
        </div>}
      />

      {loadError ? <SectionError message={loadError} onRetry={() => void reload()} /> : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Delivery summary">
        {([
          { label: "Needs a rider", value: unassigned.length, icon: Users, color: "text-amber-700 dark:text-amber-300", selectedView: "unassigned" as View },
          { label: "Ready to hand off", value: ready.length, icon: PackageCheck, color: "text-teal-700 dark:text-teal-300", selectedView: "handoff" as View },
          { label: "Out for delivery", value: road.length, icon: Truck, color: "text-blue-700 dark:text-blue-300", selectedView: "on-road" as View },
          { label: "Delivered today", value: completedToday.length, icon: CheckCircle2, color: "text-emerald-700 dark:text-emerald-300", selectedView: "completed" as View },
        ]).map((metric) => (
          <button type="button" key={metric.label}
            onClick={() => setView(metric.selectedView)}
            aria-label={"Show " + metric.label.toLowerCase()}
            className={cn("rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              view === metric.selectedView && "border-primary/60 bg-primary/5")}>
            <div className="flex items-start justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">{metric.label}</span>
              <metric.icon className={cn("h-5 w-5 shrink-0", metric.color)} aria-hidden />
            </div>
            <div className="mt-2 text-3xl font-bold tabular-nums">{metric.value}</div>
            <p className="mt-1 text-[11px] text-muted-foreground">Click to open queue</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          {updatedAt ? "Synced " + timeAgo(updatedAt.toISOString()) + " · refreshes every 45 seconds" : "Loading delivery activity…"}
        </span>
        <span className="flex flex-wrap gap-3">
          {pendingPayment.length ? <button type="button" onClick={() => setView("on-road")} className="inline-flex items-center gap-1 font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"><Wallet className="h-3.5 w-3.5" /> {pendingPayment.length} awaiting payment</button> : null}
          {exceptions.length ? <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300"><Clock3 className="h-3.5 w-3.5" /> {exceptions.length} older than 2 hours</span> : null}
        </span>
      </div>

      <section className="space-y-3" aria-label="Rider availability and workload">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Rider workload <span className="font-normal text-muted-foreground">· {riders.length} active accounts</span></h2>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setRiderFilter("all")}>Show all riders</Button>
        </div>
        {rosterError ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Rider roster could not load. Try refreshing before assigning an order.
          </div>
        ) : riders.length ? (
          <div className="flex flex-wrap gap-2">
            {riders.map((r) => {
              const count = workload.get(r.id) ?? 0
              return (
                <button key={r.id} type="button" onClick={() => setRiderFilter(riderFilter === r.id ? "all" : r.id)}
                  aria-pressed={riderFilter === r.id}
                  className={cn("inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    riderFilter === r.id && "border-primary bg-primary/5")}>
                  <Bike className="h-4 w-4 text-primary" aria-hidden />
                  <span className="font-medium">{r.name}</span>
                  <span className={cn("rounded-md px-1.5 py-0.5 font-semibold tabular-nums", count > 2 ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-muted text-foreground")}>{count} active</span>
                </button>
              )
            })}
          </div>
        ) : <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">No active delivery rider accounts. An administrator can add or activate riders in Staff.</p>}
      </section>

      <section className="space-y-3" aria-label="Manage deliveries">
        <div className="flex flex-wrap gap-1.5 border-b pb-3" role="group" aria-label="Delivery queue">
          {(Object.keys(VIEW_LABELS) as View[]).map((key) => (
            <Button key={key} type="button" size="sm" variant={view === key ? "default" : "ghost"}
              aria-pressed={view === key}
              className={cn("h-9 gap-2", view === key ? "" : "text-muted-foreground hover:text-foreground")}
              onClick={() => { setView(key); setSelected([]) }}>
              {VIEW_LABELS[key]}
              <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] tabular-nums", view === key ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-foreground")}>{counts[key]}</span>
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order, customer, phone or area…" aria-label="Search deliveries"
              className="pl-9" />
          </div>
          <Select value={riderFilter} onValueChange={setRiderFilter}>
            <SelectTrigger className="w-full md:w-48" aria-label="Filter by rider"><ListFilter className="mr-2 h-4 w-4" /><SelectValue placeholder="All riders" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All riders</SelectItem>
              {riders.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="w-full md:w-44" aria-label="Sort deliveries"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="oldest">Oldest first</SelectItem><SelectItem value="newest">Newest first</SelectItem></SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{visible.length} shown · {view === "completed" ? "last 7 days" : "live deliveries"}</span>
          {isFiltered ? <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setRiderFilter("all") }}>Clear filters</Button> : null}
          {(view === "completed" ? history.length : open.length) >= 100 ? <span className="text-amber-700 dark:text-amber-300">Showing latest 100; narrow search in Orders for older entries.</span> : null}
        </div>

        {eligible.length > 0 && riders.length > 0 && view !== "completed" ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3">
            <Checkbox id="dispatch-select-all" checked={eligible.every((o) => selected.includes(o.id))}
              onCheckedChange={(v) => {
                const ids = eligible.map((o) => o.id)
                setSelected((prev) => v === true ? [...new Set([...prev, ...ids])] : prev.filter((id) => !ids.includes(id)))
              }} />
            <label htmlFor="dispatch-select-all" className="mr-auto cursor-pointer text-xs font-medium">
              Select unassigned (up to 25) · {selected.length} selected
            </label>
            {selected.length ? (
              <>
                <Select value={bulkRider || undefined} onValueChange={setBulkRider}>
                  <SelectTrigger className="w-full sm:w-48" aria-label="Assign selected deliveries to rider"><SelectValue placeholder="Choose rider" /></SelectTrigger>
                  <SelectContent>{riders.map((r) => <SelectItem key={r.id} value={r.id}>{r.name} · {workload.get(r.id) ?? 0} active</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" disabled={!bulkRider || bulkBusy} onClick={() => void batchAssign()} className="gap-1.5">
                  {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bike className="h-4 w-4" />}
                  Assign {selected.length} selected
                </Button>
              </>
            ) : null}
          </div>
        ) : null}

        {active === null && !loadError ? (
          <div className="grid gap-3 xl:grid-cols-2">{[0, 1, 2, 3].map((i) => <Card key={i}><CardContent className="space-y-3 p-5"><Skeleton className="h-6 w-52" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-10 w-full" /></CardContent></Card>)}</div>
        ) : !visible.length ? (
          <EmptyState icon={view === "completed" ? CheckCircle2 : Truck}
            title={isFiltered ? "No matches" : view === "all" ? "No active deliveries" : VIEW_LABELS[view] + " is clear"}
            description={emptyDescription}
            action={isFiltered ? { label: "Clear filters", onClick: () => { setSearch(""); setRiderFilter("all") } } :
              view !== "all" && open.length > 0 ? { label: "View all active deliveries", onClick: () => setView("all") } :
                { label: "Open orders", onClick: () => onNavigateSection("orders") }} />
        ) : (
          <div className="grid items-start gap-3 xl:grid-cols-2">
            {visible.map((order) => {
              const completed = order.status === "COMPLETED_DELIVERY"
              const busy = busyId === order.id || bulkBusy
              const rider = riders.find((r) => r.id === order.riderId)
              const telephone = telHref(order.customerPhone)
              const whatsapp = waHref(order.customerPhone,
                "Hello " + (order.customerName ?? "there") + ", Sphere Pharmacy is following up on delivery " + order.reference + ".")
              const expandedOrder = expanded.includes(order.id)
              const currentRiderPick = picks[order.id] || ""
              const canAssign = !completed && riders.some((r) => r.id !== order.riderId)
              const statusAction = order.status === "PAID" ? { label: "Start preparing", status: "PREPARING" as const }
                : order.status === "PREPARING" ? { label: "Mark ready for dispatch", status: "READY_FOR_PICKUP" as const }
                : order.status === "READY_FOR_PICKUP" && !!order.riderId ? { label: "Dispatch rider", status: "OUT_FOR_DELIVERY" as const }
                : null
              return (
                <Card key={order.id} className={cn("overflow-hidden border-border/80 shadow-sm", attention(order, now) && !completed && "border-amber-300 dark:border-amber-800")}>
                  <CardContent className="space-y-4 p-4 sm:p-5">
                    <div className="flex flex-wrap items-start gap-2">
                      {!order.riderId && !completed && riders.length ? (
                        <Checkbox checked={selected.includes(order.id)} onCheckedChange={(v) => toggleSelected(order.id, v === true)}
                          disabled={busy} aria-label={"Select " + order.reference} className="mt-1" />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-bold">{order.reference}</span>
                          {order.status === "READY_FOR_PICKUP"
                            ? <Badge variant="outline" className="border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200">Ready for dispatch</Badge>
                            : <OrderStatusBadge status={order.status} />}
                          {attention(order, now) && !completed ? <Badge variant="outline" className="gap-1 border-amber-300 text-amber-800 dark:text-amber-300"><Clock3 className="h-3 w-3" /> Check delay</Badge> : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Placed {dateTime(order.createdAt)} · {timeAgo(order.createdAt)}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => onNavigateSection("orders", { search: order.reference })}>
                        Order <ExternalLink className="h-3 w-3" />
                      </Button>
                    </div>

                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <div className="min-w-0 space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</p>
                        <p className="flex items-center gap-1.5 font-medium"><UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />{order.customerName ?? "Guest customer"}</p>
                        {telephone ? <a href={telephone} className="inline-flex items-center gap-1.5 text-xs text-primary underline-offset-2 hover:underline"><Phone className="h-3.5 w-3.5" />{order.customerPhone}</a> : <p className="text-xs text-muted-foreground">No phone recorded</p>}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Drop-off</p>
                        <p className="flex items-start gap-1.5 font-medium"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="break-words">{order.deliveryArea || "Area not specified"}</span></p>
                        <p className="break-words text-xs text-muted-foreground">{order.deliveryAddress || "Delivery address missing — contact customer"}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/25 px-3 py-2">
                      <span className="inline-flex items-center gap-2 text-xs"><Bike className="h-4 w-4 text-primary" />
                        <strong>{order.riderName || "Rider not assigned"}</strong></span>
                      <div className="flex items-center gap-2">
                        {rider?.phone && telHref(rider.phone) ? <a href={telHref(rider.phone)!} className="text-xs font-medium text-primary underline-offset-2 hover:underline">Call rider</a> : null}
                        <Badge variant="outline" className={cn("text-[10px]", order.riderId ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>{order.riderId ? "Assigned" : "Needs assignment"}</Badge>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 text-muted-foreground" /><strong>{formatKES(order.total)}</strong> · {paid(order) ? <span className="font-medium text-emerald-700 dark:text-emerald-300">Payment received</span> : <span className="font-medium text-amber-700 dark:text-amber-300">Payment not confirmed</span>}</span>
                      <span className="text-muted-foreground">{order.items.reduce((sum, item) => sum + item.qty, 0)} units</span>
                    </div>

                    {!completed && canAssign ? (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Select value={currentRiderPick || undefined} onValueChange={(id) => setPicks((prev) => ({ ...prev, [order.id]: id }))}>
                          <SelectTrigger className="min-w-0 flex-1" aria-label={"Choose rider for " + order.reference}>
                            <SelectValue placeholder={order.riderId ? "Choose replacement rider…" : "Assign an active rider…"} />
                          </SelectTrigger>
                          <SelectContent>{riders.filter((r) => r.id !== order.riderId).map((r) =>
                            <SelectItem key={r.id} value={r.id}>{r.name} · {workload.get(r.id) ?? 0} active</SelectItem>
                          )}</SelectContent>
                        </Select>
                        <Button size="sm" className="gap-2" disabled={!currentRiderPick || busy} onClick={() => assign(order)}>
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bike className="h-3.5 w-3.5" />}
                          {order.riderId ? "Reassign" : "Assign rider"}
                        </Button>
                      </div>
                    ) : !completed && !order.riderId && !rosterError ? (
                      <p className="text-xs text-amber-700 dark:text-amber-300">Activate a rider account in Staff to assign this delivery.</p>
                    ) : null}

                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      {statusAction ? (
                        <Button size="sm" className="gap-2" disabled={busy} onClick={() => changeStatus(order, statusAction.status)}>
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                          {statusAction.label}
                        </Button>
                      ) : null}
                      {onRoad(order) && !paid(order) && !!order.customerPhone ? (
                        <Button size="sm" variant="outline" className="gap-2" disabled={busy} onClick={() => void requestMpesa(order)}>
                          <CreditCard className="h-4 w-4" /> Request M-Pesa
                        </Button>
                      ) : null}
                      {onRoad(order) && !paid(order) ? (
                        <Button size="sm" variant="outline" className="gap-2" disabled={busy} onClick={() => setConfirmation({ order, action: "cash" })}>
                          <Wallet className="h-4 w-4" /> Confirm cash received
                        </Button>
                      ) : null}
                      {onRoad(order) ? (
                        <Button size="sm" variant={paid(order) ? "default" : "outline"}
                          className="gap-2" disabled={busy || !paid(order)}
                          title={!paid(order) ? "Confirm payment before completing" : "Confirm the rider completed delivery"}
                          onClick={() => setConfirmation({ order, action: "delivered" })}>
                          <CheckCircle2 className="h-4 w-4" /> Mark delivered
                        </Button>
                      ) : null}
                      {telephone ? <Button size="sm" variant="outline" className="gap-1.5" asChild><a href={telephone}><Phone className="h-3.5 w-3.5" /> Call</a></Button> : null}
                      {whatsapp ? <Button size="sm" variant="outline" className="gap-1.5" asChild><a href={whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a></Button> : null}
                      {order.deliveryAddress || order.deliveryArea ? <Button size="sm" variant="outline" className="gap-1.5" asChild><a href={mapsHref(order)} target="_blank" rel="noopener noreferrer"><Navigation className="h-3.5 w-3.5" /> Map</a></Button> : null}
                    </div>

                    <button type="button" className="flex w-full items-center justify-between border-t pt-3 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
                      onClick={() => setExpanded((prev) => expandedOrder ? prev.filter((id) => id !== order.id) : [...prev, order.id])}
                      aria-expanded={expandedOrder}>
                      <span>Items, notes & delivery history</span>
                      {expandedOrder ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {expandedOrder ? (
                      <div className="space-y-3 rounded-lg bg-muted/30 p-3 text-xs">
                        <ul className="space-y-1">{order.items.map((item) => <li key={item.id} className="flex justify-between gap-2"><span>{item.qty} × {item.name}</span><span className="shrink-0 tabular-nums">{formatKES(item.lineTotal)}</span></li>)}</ul>
                        {order.deliveryNotes ? <p><strong>Delivery instructions:</strong> {order.deliveryNotes}</p> : null}
                        {order.notes ? <p><strong>Order notes:</strong> {order.notes}</p> : null}
                        <div><strong>Latest activity</strong>
                          <ul className="mt-2 space-y-2">{order.statusHistory.slice(-4).reverse().map((event) =>
                            <li key={event.id} className="border-l-2 border-border pl-2">
                              <span className="font-medium">{event.actor}</span> · {dateTime(event.createdAt)}
                              <span className="block text-muted-foreground">{event.note || event.status.replaceAll("_", " ").toLowerCase()}</span>
                            </li>)}</ul>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      <AlertDialog open={!!confirmation} onOpenChange={(isOpen) => { if (!isOpen) setConfirmation(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.action === "cash" ? "Confirm cash was received?" : confirmation?.action === "delivered" ? "Confirm completed delivery?" : "Reassign an active delivery?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.action === "cash" ?
                "Only confirm after physically receiving the full amount of " + formatKES(confirmation.order.total) + ". This records a successful cash payment and cannot be undone here." :
                confirmation?.action === "delivered" ?
                  "Verify the rider reached the customer and handed over order " + confirmation.order.reference + ". The customer will be notified that delivery is complete." :
                  "This order is already out for delivery. Check with the current rider before assigning it to someone else; the replacement rider and customer will receive updates."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmAction()}>
              {confirmation?.action === "cash" ? "Record cash received" : confirmation?.action === "delivered" ? "Confirm delivered" : "Reassign rider"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
