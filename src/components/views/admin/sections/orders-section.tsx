"use client"

// Orders — the staff workhorse: filter bar (status/type/search/date-range), Queue vs All
// tabs, KPI queue snapshot, desktop table + mobile cards, full-detail Sheet with the
// status workflow (NEXT_STATUS suggestions, cash confirm, rider assignment, cancel w/ reason),
// customer contact actions and prescription links.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/shared/empty-state"
import { OrderStatusBadge, PaymentStatusBadge, RxFlagBadge, RxStatusBadge } from "@/components/shared/status-badges"
import { ordersApi, paymentsApi } from "@/lib/api-client"
import { ReviewDialog } from "./prescriptions-section"
import type { OrderDTO, PaymentDTO, StaffDTO } from "@/lib/types"
import {
  ACTIVE_STATUSES, DISPATCH_STATUSES, FULFILLMENT_LABELS, NEXT_STATUS, ORDER_STATUS_LABELS, ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS, TERMINAL_STATUSES, type OrderStatus, type OrderType, type Role,
} from "@/lib/constants"
import { formatDate, formatDateTime, formatKES, shortRef, statusLabel, timeAgo } from "@/lib/format"
import { isRefillPrescriptionRecord } from "@/lib/prescriptions/refill-core"
import { useAppStore } from "@/store/use-app-store"
import { useAuthStore } from "@/store/use-auth-store"
import { toast } from "sonner"
import { AdminSectionHeader, KpiCard, apiErrorMessage, telHref, useDebounced, waHref, type SectionProps } from "../admin-shared"
import {
  Search, Package, Loader2, Truck, Store, Phone, MessageCircle, ChevronRight, Ban, Bike,
  Banknote, Smartphone, CreditCard, ClipboardList, Wallet, Clock, CheckCircle2, User, X, MapPin, Navigation, Info, Repeat2,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ---------- helpers ----------

// Never treat a payment choice as money received. The server verifies it again.
function isCashOnDelivery(order: OrderDTO): boolean {
  return order.fulfillment === "DELIVERY" && order.paymentMethod === "CASH_ON_DELIVERY"
}
function isPaid(order: OrderDTO): boolean {
  return order.payments.some((p) => p.status === "SUCCESS")
}
function readyToPack(order: OrderDTO): boolean {
  const rxReady = (order.items.every((item) => !item.requiresPrescription) || order.prescriptions.length > 0) &&
    order.prescriptions.every((rx) => ["APPROVED", "PARTIALLY_APPROVED"].includes(rx.status))
  const statusReady = (order.status === "PAID" && isPaid(order)) ||
    ((isCashOnDelivery(order) || (order.fulfillment === "PICKUP" && order.paymentMethod === "CASH_ON_PICKUP")) &&
      ["RECEIVED", "PRESCRIPTION_VERIFIED", "AVAILABILITY_CONFIRMED", "AWAITING_PAYMENT"].includes(order.status))
  const paymentInFlight = !isPaid(order) && order.payments.some((p) => ["PENDING", "PROCESSING", "REFUND_PENDING"].includes(p.status))
  return rxReady && statusReady && !paymentInFlight
}
function quickAction(order: OrderDTO): "prepare" | "ready" | "dispatch" | null {
  if (readyToPack(order)) return "prepare"
  if (order.status === "PREPARING") return "ready"
  if (order.fulfillment === "DELIVERY" && order.status === "READY_FOR_PICKUP" && !!order.riderId) return "dispatch"
  return null
}
type BulkChoice = "prepare" | "ready"

function batchBlocker(order: OrderDTO, choice: BulkChoice): string | null {
  if (quickAction(order) === choice) return null
  if (["COMPLETED_PICKUP", "COMPLETED_DELIVERY", "CANCELLED", "REJECTED", "REFUNDED"].includes(order.status)) {
    return "Order already closed. No more packing actions are available."
  }
  if (order.status === "OUT_FOR_DELIVERY") return "Already dispatched. Manage this order in Dispatch."
  if (order.status === "READY_FOR_PICKUP") return "Already packed. Use the pickup or rider-handoff workflow."
  if (order.status === "PREPARING") return 'Already being packed. Choose "Confirm packed & ready" for this batch.'
  if (order.items.some(item => item.requiresPrescription) && order.prescriptions.length === 0) {
    return "Prescription missing. Obtain and review it before packing."
  }
  if (order.prescriptions.some(rx => !["APPROVED", "PARTIALLY_APPROVED"].includes(rx.status))) {
    return "Prescription review is incomplete. A pharmacist must approve it before packing."
  }
  if (choice === "ready") {
    return readyToPack(order)
      ? 'Select "Accept & start packing" first. Confirm ready only after physical packing.'
      : "Not in preparation yet. Review this order and resolve payment before packing."
  }
  if (!isPaid(order) && order.payments.some(p => ["PENDING", "PROCESSING", "REFUND_PENDING"].includes(p.status))) {
    return "A payment attempt is still processing. Resolve it before starting packing."
  }
  if (!isPaid(order) && !isCashOnDelivery(order) &&
      !(order.fulfillment === "PICKUP" && order.paymentMethod === "CASH_ON_PICKUP")) {
    return "Payment is not confirmed. Only paid or explicitly cash-on-pickup/delivery orders can be packed."
  }
  return "The order is not yet in an eligible packing stage. Open its details for the next step."
}

function BatchSelection({
  order, choice, busy, checked, onChange,
}: {
  order: OrderDTO
  choice: BulkChoice
  busy: boolean
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const reason = batchBlocker(order, choice)
  if (reason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 w-8 cursor-help items-center justify-center rounded-lg border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
            aria-label={`Why ${order.reference} is not selectable: ${reason}`}
            onClick={(event) => { event.stopPropagation(); toast.info("Unavailable for this batch", { description: reason }) }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Info className="h-4 w-4" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={6} className="max-w-72 leading-relaxed">{reason}</TooltipContent>
      </Tooltip>
    )
  }
  return <Checkbox
    aria-label={`Select order ${order.reference} for ${choice === "prepare" ? "packing" : "ready confirmation"}`}
    checked={checked}
    disabled={busy}
    onCheckedChange={(value) => onChange(value === true)}
  />
}

function deliveryMapUrl(order: OrderDTO): string {
  const target = order.deliveryLatitude != null && order.deliveryLongitude != null
    ? `${order.deliveryLatitude},${order.deliveryLongitude}`
    : [order.deliveryAddress, order.deliveryArea, "Nairobi, Kenya"].filter(Boolean).join(", ")
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(target)
}
function paymentSummary(order: OrderDTO): string {
  if (isPaid(order)) return "Paid"
  if (isCashOnDelivery(order)) return `Collect ${formatKES(order.total)} on delivery`
  return order.paymentMethod === "CASH_ON_PICKUP" ? "Pay on collection"
    : order.paymentMethod === "MPESA" ? "M-Pesa pending" : order.paymentMethod === "CARD" ? "Card pending" : "Payment not confirmed"
}


const typeBadgeClass: Record<OrderType, string> = {
  OTC: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800",
  PRESCRIPTION: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
  MIXED: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  RESERVATION: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700",
}

const TRANSITION_LABELS: Partial<Record<OrderStatus, string>> = {
  UNDER_REVIEW: "Start review",
  PRESCRIPTION_VERIFIED: "Mark Rx verified",
  AVAILABILITY_CONFIRMED: "Confirm availability",
  AWAITING_PAYMENT: "Request payment",
  PAID: "Mark as paid",
  PREPARING: "Start preparing",
  READY_FOR_PICKUP: "Ready for pickup",
  OUT_FOR_DELIVERY: "Dispatch for delivery",
  COMPLETED_PICKUP: "Complete pickup",
  COMPLETED_DELIVERY: "Confirm delivered",
  REJECTED: "Reject order",
}

function paymentIcon(provider: PaymentDTO["provider"]) {
  if (provider === "MPESA") return Smartphone
  if (provider === "INTASEND") return CreditCard
  return Banknote
}

function latestPayment(order: OrderDTO): PaymentDTO | null {
  if (order.payments.length === 0) return null
  return order.payments.reduce((a, b) =>
    new Date(a.createdAt).getTime() >= new Date(b.createdAt).getTime() ? a : b
  )
}

function nextStatusesFor(order: OrderDTO, role: Role | "CUSTOMER" | undefined): OrderStatus[] {
  if (role === "RIDER") {
    return order.fulfillment === "DELIVERY" && order.riderId && order.status === "READY_FOR_PICKUP"
      ? ["OUT_FOR_DELIVERY"]
      : order.fulfillment === "DELIVERY" && order.status === "OUT_FOR_DELIVERY" && isPaid(order)
        ? ["COMPLETED_DELIVERY"]
        : []
  }
  if (order.status === "READY_FOR_PICKUP") {
    return order.fulfillment === "PICKUP" ? (isPaid(order) ? ["COMPLETED_PICKUP"] : [])
      : order.riderId ? ["OUT_FOR_DELIVERY"] : []
  }
  // Completion always requires a recorded payment (including cash at handoff).
  if (order.status === "OUT_FOR_DELIVERY" && !isPaid(order)) return []
  return (NEXT_STATUS[order.status] ?? []).filter((status) => {
    if (status === "PAID") return order.payments.some((payment) => payment.status === "SUCCESS")
    return status !== "COMPLETED_DELIVERY" || order.fulfillment === "DELIVERY"
  })
}

function workflowLabel(order: OrderDTO, status: OrderStatus): string {
  if (status === "READY_FOR_PICKUP" && order.fulfillment === "DELIVERY") return "Mark ready for dispatch"
  return TRANSITION_LABELS[status] ?? statusLabel(status)
}

function OrderFulfillmentStatus({ order }: { order: OrderDTO }) {
  if (order.fulfillment === "DELIVERY" && order.status === "READY_FOR_PICKUP") {
    return <Badge variant="outline" className="border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200">Ready for dispatch</Badge>
  }
  return <OrderStatusBadge status={order.status} />
}

function nextOrderActionLabel(order: OrderDTO): string {
  if (readyToPack(order)) return "Accept & start packing"
  if (order.fulfillment === "DELIVERY") {
    if (order.status === "PAID") return "Start preparing"
    if (order.status === "PREPARING") return "Mark ready for dispatch"
    if (order.status === "READY_FOR_PICKUP") return order.riderId ? "Dispatch rider" : "Assign rider"
    if (order.status === "OUT_FOR_DELIVERY") return isPaid(order) ? "Confirm delivered" : isCashOnDelivery(order) ? "Cash due at drop-off" : "Resolve payment"
  }
  if (order.status === "READY_FOR_PICKUP" && order.fulfillment === "PICKUP") return isPaid(order) ? "Complete pickup" : "Collect cash at counter"
  if (order.status === "AWAITING_PAYMENT") return isCashOnDelivery(order) ? "Accept & start packing" : "Confirm payment"
  if (order.status === "RECEIVED" || order.status === "UNDER_REVIEW") return "Review order"
  return "View details"
}

function deliveryGuidance(order: OrderDTO): string {
  switch (order.status) {
    case "PAID": return "Payment is recorded. Start preparing, verify and pack the order."
    case "PREPARING": return "After medicines are checked and securely packed, mark the order ready for dispatch. Rider assignment can happen now."
    case "READY_FOR_PICKUP": return order.riderId
      ? "Package ready and rider assigned. Hand over the package, then select Dispatch rider."
      : "Package is ready. Assign an active rider below to unlock Dispatch rider."
    case "OUT_FOR_DELIVERY": return "Order has left the pharmacy. Track the rider and confirm delivery when it reaches the customer."
    case "COMPLETED_DELIVERY": return "The delivery is complete."
    default: return isCashOnDelivery(order) ? "Cash is collected on delivery, not before dispatch. Accept the reviewed order to start packing." : "Complete prescription review and confirm payment before packing. Never mark an unpaid online order as paid."
  }
}

type RangeKey = "today" | "7d" | "30d" | "all"

function withinRange(iso: string, range: RangeKey): boolean {
  if (range === "all") return true
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return true
  if (range === "today") {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return t >= start.getTime()
  }
  const days = range === "7d" ? 7 : 30
  return t >= Date.now() - days * 86_400_000
}

// ---------- main section ----------

export function OrdersSection({ refreshKey, onRefresh, onNavigateSection }: SectionProps) {
  const role = useAuthStore((s) => s.session?.role)
  const isRider = role === "RIDER"
  const canManage = role === "ADMIN" || role === "PHARMACIST" || role === "STAFF"
  const canAssignRider = role === "ADMIN" || role === "STAFF" || role === "PHARMACIST"

  const [raw, setRaw] = useState<OrderDTO[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchInput, setSearchInput] = useState(() => useAppStore.getState().params.search ?? "")
  const search = useDebounced(searchInput.trim(), 300)

  const [statusFilter, setStatusFilter] = useState<string>(() => { const value = useAppStore.getState().params.status; return value && [...ACTIVE_STATUSES, ...TERMINAL_STATUSES].includes(value as OrderStatus) ? value : "ALL" })
  const [typeFilter, setTypeFilter] = useState<string>("ALL")
  const [range, setRange] = useState<RangeKey>("all")
  const [sort, setSort] = useState<"newest" | "oldest" | "attention">("newest")
  const [focus, setFocus] = useState<"all" | "review" | "pack" | "handoff" | "collect">("all")
  const [tab, setTab] = useState<"queue" | "all">(() => TERMINAL_STATUSES.includes(useAppStore.getState().params.status as OrderStatus) ? "all" : "queue")

  const [selected, setSelected] = useState<OrderDTO | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [reviewId, setReviewId] = useState<string | null>(null)

  const [transition, setTransition] = useState<{ order: OrderDTO; target: OrderStatus; viaCash?: boolean } | null>(null)
  const [cancelFor, setCancelFor] = useState<OrderDTO | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [batchIds, setBatchIds] = useState<string[]>([])
  const [batchType, setBatchType] = useState<"prepare" | "ready">("prepare")
  const [batchConfirm, setBatchConfirm] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)

  const ordersRequest = useRef(0)
  const lastRefreshKey = useRef(refreshKey)

  const load = useCallback(async (searchTerm: string, background = false) => {
    const request = ++ordersRequest.current
    if (!background) {
      setLoading(true)
      setError(null)
    }
    try {
      const list = await ordersApi.allOrders(searchTerm ? { search: searchTerm } : {})
      if (request !== ordersRequest.current) return
      setRaw((previous) => {
        if (!background || previous.length <= 100) return list
        // Preserve older pages that staff have deliberately loaded, while
        // inserting recent arrivals and replacing changed records in the
        // newest page. Never make them re-scroll/load old pages after a tick.
        const latestIds = new Set(list.map((order) => order.id))
        return [...list, ...previous.filter((order) => !latestIds.has(order.id))]
      })
      setSelected((current) => current ? (list.find((order) => order.id === current.id) ?? current) : current)
      setHasMore(list.length === 100)
      setError(null)
    } catch (err) {
      if (request !== ordersRequest.current) return
      if (!background) {
        setError(apiErrorMessage(err))
        setRaw([])
        setHasMore(false)
      }
      // Silent updates must never blank a working queue during a network error.
    } finally {
      if (request === ordersRequest.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(search)
  }, [load, search])

  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return
    lastRefreshKey.current = refreshKey
    void load(search, true)
  }, [load, search, refreshKey])

  async function loadOlder() {
    const cursor = raw[raw.length - 1]?.id
    if (!cursor || !hasMore || loadingMore || loading) return
    setLoadingMore(true)
    try {
      const page = await ordersApi.allOrders({ ...(search ? { search } : {}), cursor })
      setRaw((previous) => {
        const ids = new Set(previous.map((order) => order.id))
        return [...previous, ...page.filter((order) => !ids.has(order.id))]
      })
      setHasMore(page.length === 100)
    } catch (error) {
      toast.error("Could not load older orders: " + apiErrorMessage(error))
    } finally {
      setLoadingMore(false)
    }
  }

  // ---- client-side filters ----
  const visible = useMemo(() => {
    return raw
      .filter((o) => (tab === "queue" ? ACTIVE_STATUSES.includes(o.status) : true))
      .filter((o) => (statusFilter === "ALL" ? true : o.status === statusFilter))
      .filter((o) => (typeFilter === "ALL" ? true : o.type === typeFilter))
      .filter((o) => withinRange(o.createdAt, range))
      .filter((o) => focus === "all" ||
        (focus === "review" && (o.status === "UNDER_REVIEW" || (o.status === "RECEIVED" && !readyToPack(o)))) ||
        (focus === "pack" && (readyToPack(o) || o.status === "PREPARING")) ||
        (focus === "handoff" && o.fulfillment === "DELIVERY" && o.status === "READY_FOR_PICKUP") ||
        (focus === "collect" && o.fulfillment === "DELIVERY" && o.status === "OUT_FOR_DELIVERY" && !isPaid(o)))
      .sort((a, b) => {
        const difference = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        if (sort === "newest") return difference || b.id.localeCompare(a.id)
        if (sort === "oldest") return -difference || a.id.localeCompare(b.id)
        const priority = (o: OrderDTO) =>
          o.status === "UNDER_REVIEW" || (o.status === "RECEIVED" && !readyToPack(o)) ? 0
            : readyToPack(o) ? 1 : o.status === "PREPARING" ? 2
              : o.status === "READY_FOR_PICKUP" ? 3 : o.status === "OUT_FOR_DELIVERY" ? 4 : 5
        return priority(a) - priority(b) || -difference
      })
  }, [raw, tab, statusFilter, typeFilter, range, focus, sort])

  const activeOrders = useMemo(() => raw.filter((o) => ACTIVE_STATUSES.includes(o.status)), [raw])
  const queueCount = (fn: (o: OrderDTO) => boolean) => activeOrders.filter(fn).length

  const queueKpis = isRider
    ? [
        { label: "Out for delivery", value: queueCount((o) => o.status === "OUT_FOR_DELIVERY"), tone: "teal" as const, icon: Truck },
        { label: "Ready to dispatch", value: queueCount((o) => o.fulfillment === "DELIVERY" && (o.status === "PAID" || o.status === "PREPARING")), tone: "amber" as const, icon: Package },
        { label: "Awaiting payment", value: queueCount((o) => o.status === "AWAITING_PAYMENT"), tone: "default" as const, icon: Wallet },
        { label: "Awaiting review", value: queueCount((o) => o.status === "RECEIVED" || o.status === "UNDER_REVIEW"), tone: "default" as const, icon: Clock },
      ]
    : [
        { label: "Awaiting review", value: queueCount((o) => o.status === "RECEIVED" || o.status === "UNDER_REVIEW"), tone: "amber" as const, icon: ClipboardList },
        { label: "Awaiting payment", value: queueCount((o) => o.status === "AWAITING_PAYMENT"), tone: "amber" as const, icon: Wallet },
        { label: "Ready for dispatch", value: queueCount((o) => o.fulfillment === "DELIVERY" && o.status === "READY_FOR_PICKUP"), tone: "teal" as const, icon: Truck },
        { label: "Out for delivery", value: queueCount((o) => o.status === "OUT_FOR_DELIVERY"), tone: "teal" as const, icon: Truck },
        { label: "Ready for pickup", value: queueCount((o) => o.fulfillment === "PICKUP" && o.status === "READY_FOR_PICKUP"), tone: "default" as const, icon: Store },
      ]

  function openDetail(order: OrderDTO) {
    setSelected(order)
    setSheetOpen(true)
  }

  async function runAction(fn: () => Promise<OrderDTO>, successMsg: string) {
    setActionBusy(true)
    try {
      const updated = await fn()
      // Show the confirmed mutation immediately without waiting for the
      // background list re-fetch. It is later reconciled with the server.
      setRaw((previous) => previous.map((order) => order.id === updated.id ? updated : order))
      setSelected((current) => current?.id === updated.id ? updated : current)
      toast.success(successMsg)
      await load(search, true)
      onRefresh()
      return updated
    } catch (err) {
      toast.error(apiErrorMessage(err))
      return null
    } finally {
      setActionBusy(false)
    }
  }

  async function runQuickAction(order: OrderDTO, operation: "prepare" | "ready" | "dispatch") {
    const label = operation === "prepare" ? "Packing started" : operation === "ready" ? "Packed and ready" : "Rider dispatched"
    await runAction(
      () => operation === "prepare" ? ordersApi.startPreparing(order.id)
        : ordersApi.updateStatus(order.id, operation === "ready" ? "READY_FOR_PICKUP" : "OUT_FOR_DELIVERY"),
      `${shortRef(order.reference)}: ${label}.`,
    )
  }

  async function executeBatch() {
    setBatchConfirm(false)
    const candidates = raw.filter((o) => batchIds.includes(o.id) && quickAction(o) === batchType).slice(0, 25)
    if (!candidates.length) { toast.error("No selected orders qualify for this action. Refresh the queue."); return }
    setBatchBusy(true)
    const errors: string[] = []
    let done = 0
    try {
      // Sequential writes preserve per-order authorization, audit and notification.
      for (const order of candidates) {
        try {
          if (batchType === "prepare") await ordersApi.startPreparing(order.id)
          else await ordersApi.updateStatus(order.id, "READY_FOR_PICKUP", "Staff confirmed each selected parcel has been checked and packed.")
          done++
        } catch (err) {
          errors.push(`${shortRef(order.reference)}: ${apiErrorMessage(err)}`)
        }
      }
      if (done) toast.success(`${done} order${done === 1 ? "" : "s"} updated.`)
      if (errors.length) toast.error(`${errors.length} orders need attention. ${errors.slice(0, 2).join("; ")}`, { duration: 9000 })
      setBatchIds(errors.length ? candidates.filter((o) => errors.some((m) => m.startsWith(shortRef(o.reference) + ":"))).map((o) => o.id) : [])
      await load(search)
      onRefresh()
    } finally {
      setBatchBusy(false)
    }
  }

  async function handlePromptMpesa(order: OrderDTO) {
    setActionBusy(true)
    try {
      const res = await paymentsApi.requestPayment(order.id, order.customerPhone ?? undefined)
      toast.success(res.message || `M-Pesa STK push prompt sent to ${order.customerPhone}`)
      let attempts = 0
      const poll = setInterval(async () => {
        attempts++
        try {
          const q = await paymentsApi.mpesaQuery(res.checkoutRequestId)
          if (q.status === "SUCCESS") {
            clearInterval(poll)
            toast.success(`Payment confirmed for order ${order.reference}!`)
            await load(search)
            onRefresh()
          } else if (q.status === "FAILED" || attempts > 20) {
            clearInterval(poll)
            if (q.status === "FAILED") toast.error("Payment was declined or timed out.")
          }
        } catch {
          if (attempts > 20) clearInterval(poll)
        }
      }, 3000)
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <AdminSectionHeader
        title="Orders"
        subtitle={isRider ? "Your delivery queue — dispatch and confirm drop-offs." : "Process the queue — review, confirm, take payment and dispatch."}
      />

      {/* KPI queue snapshot */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {queueKpis.map((kpi) => <KpiCard key={kpi.label} label={kpi.label} value={loading ? "—" : kpi.value} icon={kpi.icon} tone={kpi.tone} hint="In the active order queue" />)}
      </div>

      {!isRider ? (
        <div className="flex flex-wrap gap-2" aria-label="Work queues by required action">
          {([
            ["all", "All work"],
            ["review", "Needs review"],
            ["pack", "Pack"],
            ["handoff", "Rider handoff"],
            ["collect", "Payment at delivery"],
          ] as const).map(([key, label]) => (
            <Button key={key} size="sm" variant={focus === key ? "default" : "outline"}
              aria-pressed={focus === key} onClick={() => { setFocus(key); setBatchIds([]); setTab("queue"); setStatusFilter("ALL") }}>
              {label}
              {key === "pack" ? ` · ${raw.filter((o) => readyToPack(o) || o.status === "PREPARING").length}` : ""}
            </Button>
          ))}
        </div>
      ) : null}

      {/* Action-first queue: selected rows can be worked without opening each drawer. */}
      {!isRider && canManage ? (
        <Card className="border-primary/20 bg-primary/[0.03]">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold">One-click order processing</p>
                <p className="text-xs text-muted-foreground">Select compatible orders and act together. Each order is checked individually; prescription review and payment controls remain mandatory.</p>
              </div>
              <Badge variant="secondary">{batchIds.length} selected</Badge>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden /> Checkboxes are available for eligible orders. Select the info icon on another order to see why it cannot join this batch.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={batchType} onValueChange={(v) => { setBatchType(v as "prepare" | "ready"); setBatchIds([]) }}>
                <SelectTrigger className="w-full sm:w-52" aria-label="Bulk order action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prepare">Accept & start packing</SelectItem>
                  <SelectItem value="ready">Confirm packed & ready</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => {
                const eligible = visible.filter((order) => quickAction(order) === batchType).slice(0, 25).map((order) => order.id)
                setBatchIds(eligible)
              }} disabled={batchBusy || loading}>Select eligible ({visible.filter((order) => quickAction(order) === batchType).length})</Button>
              <Button size="sm" disabled={batchBusy || batchIds.length === 0} onClick={() => setBatchConfirm(true)}>
                {batchBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {batchType === "prepare" ? "Start packing" : "Mark ready"} · {batchIds.length}
              </Button>
              {batchIds.length ? <Button size="sm" variant="ghost" disabled={batchBusy} onClick={() => setBatchIds([])}>Clear selection</Button> : null}
            </div>
            {batchType === "ready" ? <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Only mark parcels ready after staff have checked all medicines and physically packed each selected order.</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {/* filter bar */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-3 sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search reference, customer name or phone…"
                className="pl-9"
                aria-label="Search orders"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setFocus("all"); if (TERMINAL_STATUSES.includes(value as OrderStatus)) setTab("all"); setBatchIds([]) }}>
              <SelectTrigger className="sm:w-52" aria-label="Filter by status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Active</SelectLabel>
                  {ACTIVE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{ORDER_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Terminal</SelectLabel>
                  {TERMINAL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{ORDER_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="sm:w-44" aria-label="Filter by order type">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                {(Object.keys(ORDER_TYPE_LABELS) as OrderType[]).map((t) => (
                  <SelectItem key={t} value={t}>{ORDER_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={tab} onValueChange={(v) => { setTab(v as "queue" | "all"); setFocus("all"); setBatchIds([]) }}>
              <TabsList>
                <TabsTrigger value="queue" className="gap-1.5">
                  Queue
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] tabular-nums">{activeOrders.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="all">All ({raw.length})</TabsTrigger>
              </TabsList>
            </Tabs>
            <Select value={sort} onValueChange={(value) => setSort(value as typeof sort)}>
              <SelectTrigger className="w-full sm:w-48" aria-label="Sort orders"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest arrivals first</SelectItem>
                <SelectItem value="oldest">Longest waiting first</SelectItem>
                <SelectItem value="attention">Needs attention first</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-1 rounded-lg border p-0.5" role="group" aria-label="Date range filter">
              {([["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All time"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setRange(key)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    range === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                  aria-pressed={range === key}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* error */}
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
          <p className="font-semibold">Couldn&apos;t load orders</p>
          <p className="mt-0.5">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void load(search)}>Retry</Button>
        </div>
      ) : null}

      {/* list */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="flex items-center gap-4 p-4">
                <Skeleton className="h-10 w-24" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-5 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Package}
          title={raw.length === 0 ? "No orders yet" : "No orders match these filters"}
          description={raw.length === 0 ? "New orders appear here as customers check out." : "Try clearing the search or switching to the All tab."}
          action={raw.length > 0 ? { label: "Clear filters", onClick: () => { setSearchInput(""); setStatusFilter("ALL"); setTypeFilter("ALL"); setRange("all"); setTab("all"); setFocus("all"); setBatchIds([]) } } : undefined}
        />
      ) : (
        <>
          {/* Full-width desktop worklist. Related information shares one cell so the
              price and next action remain visible without horizontal scrolling. */}
          <Card className="admin-orders-table hidden overflow-hidden xl:block">
            <Table className="table-fixed w-full">
              <colgroup>
                {canManage ? <col style={{ width: "5%" }} /> : null}
                <col style={{ width: canManage ? "27%" : "29%" }} />
                <col style={{ width: canManage ? "19%" : "21%" }} />
                <col style={{ width: canManage ? "20%" : "22%" }} />
                <col style={{ width: canManage ? "13%" : "13%" }} />
                <col style={{ width: canManage ? "16%" : "15%" }} />
              </colgroup>
              <TableHeader>
                <TableRow>
                  {canManage ? <TableHead><span className="sr-only">Select order</span></TableHead> : null}
                  <TableHead>Order, customer & items</TableHead>
                  <TableHead>Fulfilment</TableHead>
                  <TableHead>Progress & payment</TableHead>
                  <TableHead className="text-right">Total & age</TableHead>
                  <TableHead className="text-center">Next action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((order) => {
                  const pay = latestPayment(order)
                  const PayIcon = pay ? paymentIcon(pay.provider) : Banknote
                  const firstItem = order.items[0]?.name ?? "—"
                  return (
                    <TableRow key={order.id} className="cursor-pointer" onClick={() => openDetail(order)}>
                      {canManage ? (
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <BatchSelection order={order} choice={batchType} busy={batchBusy}
                            checked={batchIds.includes(order.id)}
                            onChange={(checked) => setBatchIds((previous) => checked
                              ? [...previous.filter((id) => id !== order.id), order.id]
                              : previous.filter((id) => id !== order.id))} />
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <div className="min-w-0 space-y-1">
                          <p className="font-mono text-xs font-bold text-foreground">{shortRef(order.reference)}</p>
                          <p className="text-xs font-semibold leading-snug">{order.customerName || "Guest customer"}</p>
                          <p className="break-all text-[11px] text-muted-foreground">{order.customerPhone || "No contact number"}</p>
                          <p className="text-[11px] leading-snug text-muted-foreground">
                            <span className="font-semibold text-foreground">{order.items.reduce((sum, item) => sum + item.qty, 0)} units</span>
                            {" · "}{firstItem}
                            {order.items.length > 1 ? ` +${order.items.length - 1} more item${order.items.length === 2 ? "" : "s"}` : ""}
                            {order.items.some((item) => item.requiresPrescription) ? <span className="ml-1 font-bold text-rose-700" aria-label="Contains prescription items">℞</span> : null}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 flex-col items-start gap-1.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className={cn("text-[10px]", typeBadgeClass[order.type])}>
                              {ORDER_TYPE_LABELS[order.type]}
                            </Badge>
                            {order.isRefill ? (
                              <Badge variant="outline" className="gap-1 border-teal-300 bg-teal-50 text-[10px] text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
                                <Repeat2 className="h-2.5 w-2.5" aria-hidden />
                                Refill
                              </Badge>
                            ) : null}
                          </div>
                          <p className="flex items-start gap-1.5 text-xs font-medium leading-snug">
                            {order.fulfillment === "DELIVERY" ? <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <Store className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
                            <span>{order.fulfillment === "DELIVERY" ? (order.deliveryArea || "Delivery zone missing") : "Store pickup"}</span>
                          </p>
                          {order.fulfillment === "DELIVERY" ? (
                            <p className="text-[11px] text-muted-foreground">Delivery fee: {formatKES(order.deliveryFee)}</p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 flex-col items-start gap-1.5">
                          <OrderFulfillmentStatus order={order} />
                          <p className="text-[11px] font-medium leading-snug text-muted-foreground">{paymentSummary(order)}</p>
                          {pay ? (
                            <span className="flex flex-wrap items-center gap-1">
                              <PayIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                              <PaymentStatusBadge status={pay.status} />
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="whitespace-nowrap text-sm font-bold tabular-nums text-foreground">{formatKES(order.total)}</p>
                        <p className="mt-1 text-[11px] font-medium tabular-nums text-muted-foreground">{timeAgo(order.createdAt)}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground" title={formatDateTime(order.createdAt)}>{formatDateTime(order.createdAt)}</p>
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        {canManage && quickAction(order) ? (
                          <Button
                            variant={quickAction(order) === "prepare" ? "default" : "outline"}
                            size="sm"
                            className="admin-order-next-action"
                            disabled={actionBusy || batchBusy}
                            onClick={() => {
                              const operation = quickAction(order)!
                              if (operation === "ready" || operation === "dispatch") {
                                setTransition({ order, target: operation === "ready" ? "READY_FOR_PICKUP" : "OUT_FOR_DELIVERY" })
                                return
                              }
                              void runQuickAction(order, operation)
                            }}
                          >
                            {nextOrderActionLabel(order)}
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" className="admin-order-next-action"
                            aria-label={`Open order ${shortRef(order.reference)}: ${nextOrderActionLabel(order)}`}
                            onClick={() => openDetail(order)}>
                            {nextOrderActionLabel(order)} <ChevronRight className="ml-1 inline h-3.5 w-3.5 shrink-0" aria-hidden />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>

          {/* Compact cards for phones and smaller laptops — no sideways table scroll. */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:hidden">
            {visible.map((order) => {
              const pay = latestPayment(order)
              return (
                <Card key={order.id} className="card-lift cursor-pointer" role="button" tabIndex={0} aria-label={`View order ${shortRef(order.reference)} for ${order.customerName ?? "Guest"}`} onClick={() => openDetail(order)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetail(order) } }}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      {canManage ? <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <BatchSelection order={order} choice={batchType} busy={batchBusy}
                          checked={batchIds.includes(order.id)}
                          onChange={(checked) => setBatchIds((previous) => checked ? [...previous.filter((id) => id !== order.id), order.id] : previous.filter((id) => id !== order.id))} />
                      </span> : null}
                      <p className="font-bold">{shortRef(order.reference)}</p>
                      <OrderFulfillmentStatus order={order} />
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      <span className="truncate font-medium">{order.customerName ?? "Guest"}</span>
                      <span className="truncate text-xs text-muted-foreground">{order.customerPhone ?? ""}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px]", typeBadgeClass[order.type])}>
                        {order.type === "RESERVATION" ? "Reservation" : order.type === "PRESCRIPTION" ? "Rx order" : order.type === "MIXED" ? "Mixed" : "OTC"}
                      </Badge>
                      {order.isRefill ? (
                        <Badge variant="outline" className="gap-1 border-teal-300 bg-teal-50 px-1.5 py-0 text-[10px] text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
                          <Repeat2 className="h-2.5 w-2.5" aria-hidden />
                          Refill
                        </Badge>
                      ) : null}
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        {order.fulfillment === "DELIVERY" ? <Truck className="h-3 w-3" aria-hidden /> : <Store className="h-3 w-3" aria-hidden />}
                        {FULFILLMENT_LABELS[order.fulfillment]}
                      </span>
                      {pay ? <PaymentStatusBadge status={pay.status} /> : null}
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs text-muted-foreground">
                          {order.items.length} item{order.items.length === 1 ? "" : "s"} · {order.items[0]?.name ?? "—"}
                        </p>
                        <p className="text-xs text-muted-foreground" title={formatDateTime(order.createdAt)}>In queue {timeAgo(order.createdAt)} · {formatDateTime(order.createdAt)}</p>
                        <p className="mt-1 text-xs font-semibold text-primary">Next: {nextOrderActionLabel(order)}</p>
                        <p className="mt-1 text-xs font-medium text-muted-foreground">{paymentSummary(order)}</p>
                        {order.fulfillment === "DELIVERY" ? <p className="mt-1 text-xs"><MapPin className="mr-1 inline h-3 w-3" />{order.deliveryArea || "Zone missing"} · Fee {formatKES(order.deliveryFee)}</p> : null}
                      </div>
                      <p className="shrink-0 whitespace-nowrap text-base font-bold tabular-nums">{formatKES(order.total)}</p>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {!loading && raw.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground">
          <span>{raw.length} most recent orders loaded{hasMore ? " · older orders are available" : ""}. Sorting, date filters and bulk actions apply to the loaded orders.</span>
          {hasMore ? <Button size="sm" variant="outline" disabled={loadingMore} onClick={() => void loadOlder()}>
            {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Load older orders
          </Button> : null}
        </div>
      ) : null}

      <Dialog open={batchConfirm} onOpenChange={setBatchConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{batchType === "prepare" ? "Start packing selected orders?" : "Confirm all selected parcels are physically packed?"}</DialogTitle>
            <DialogDescription>
              {batchType === "prepare"
                ? `Accept ${batchIds.length} eligible order(s) for packing. COD payments stay outstanding until money is actually collected; unreviewed prescriptions are excluded.`
                : `Mark ${batchIds.length} packed parcel(s) as ready for collection or dispatch. This is not a payment or rider-dispatch confirmation.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchConfirm(false)}>Cancel</Button>
            <Button onClick={() => void executeBatch()}>{batchType === "prepare" ? "Accept & start packing" : "Confirm parcels ready"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* detail sheet */}
      <OrderDetailSheet
        key={selected?.id ?? "no-order"}
        order={selected}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) setSelected(null)
        }}
        role={role}
        canManage={canManage}
        canAssignRider={canAssignRider}
        actionBusy={actionBusy}
        onStartTransition={(order, target, viaCash) => setTransition({ order, target, viaCash })}
        onCancel={(order) => setCancelFor(order)}
        onPromptMpesa={(order) => void handlePromptMpesa(order)}
        onStartPreparing={(order) => void runAction(() => ordersApi.startPreparing(order.id), `${shortRef(order.reference)} is now being packed.`)}
        onNavigateSection={onNavigateSection}
        onSearchReference={(ref) => {
          setSheetOpen(false)
          setSelected(null)
          setTab("all")
          setStatusFilter("ALL")
          setFocus("all")
          setSearchInput(ref)
        }}
        onReviewPrescription={setReviewId}
        onAssignRider={async (order, staffId, riderName) => {
          await runAction(
            () => ordersApi.assignRider(order.id, staffId),
            riderName ? `${riderName} assigned to ${shortRef(order.reference)}.` : `Rider assigned to ${shortRef(order.reference)}.`
          )
        }}
      />

      {reviewId ? <ReviewDialog
        rxId={reviewId}
        canReview={role === "ADMIN" || role === "PHARMACIST"}
        onClose={() => setReviewId(null)}
        onSubmitted={() => {
          const currentOrderId = selected?.id
          setReviewId(null)
          if (currentOrderId) void ordersApi.get(currentOrderId).then(setSelected).catch((error) => toast.error(apiErrorMessage(error)))
          void load(search)
          onRefresh()
        }}
      /> : null}

      {/* transition confirm dialog (mounted fresh per action so state resets) */}
      {transition ? (
        <TransitionDialog
          transition={transition}
          busy={actionBusy}
          onClose={() => setTransition(null)}
          onConfirm={async (note) => {
            if (!transition) return
            const { order, target, viaCash } = transition
            const updated = viaCash
              ? await runAction(() => ordersApi.markPaidCash(order.id), `Order ${shortRef(order.reference)} marked paid (cash received).`)
              : await runAction(() => ordersApi.updateStatus(order.id, target, note || undefined), `Order ${shortRef(order.reference)} → ${statusLabel(target)}.`)
            if (updated) setTransition(null)
          }}
        />
      ) : null}

      {/* cancel dialog */}
      {cancelFor ? (
        <CancelDialog
          order={cancelFor}
          busy={actionBusy}
          onClose={() => setCancelFor(null)}
          onConfirm={async (reason) => {
            if (!cancelFor) return
            const updated = await runAction(
              () => ordersApi.cancel(cancelFor.id, reason),
              `Order ${shortRef(cancelFor.reference)} cancelled.`
            )
            if (updated) setCancelFor(null)
          }}
        />
      ) : null}
    </div>
  )
}

// ---------- order detail sheet ----------

function OrderDetailSheet({
  order,
  open,
  onOpenChange,
  role,
  canManage,
  canAssignRider,
  actionBusy,
  onStartTransition,
  onCancel,
  onPromptMpesa,
  onStartPreparing,
  onNavigateSection,
  onSearchReference,
  onReviewPrescription,
  onAssignRider,
}: {
  order: OrderDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
  role: Role | "CUSTOMER" | undefined
  canManage: boolean
  canAssignRider: boolean
  actionBusy: boolean
  onStartTransition: (order: OrderDTO, target: OrderStatus, viaCash?: boolean) => void
  onCancel: (order: OrderDTO) => void
  onPromptMpesa: (order: OrderDTO) => void
  onStartPreparing: (order: OrderDTO) => void
  onNavigateSection: SectionProps["onNavigateSection"]
  onSearchReference: (ref: string) => void
  onReviewPrescription: (id: string) => void
  onAssignRider: (order: OrderDTO, staffId: string, riderName?: string) => Promise<void>
}) {
  const [riders, setRiders] = useState<StaffDTO[]>([])
  const [ridersLoading, setRidersLoading] = useState(true)
  const [ridersError, setRidersError] = useState<string | null>(null)
  const [riderPick, setRiderPick] = useState("")

  const needsRiders =
    Boolean(order) && canAssignRider && order?.fulfillment === "DELIVERY" &&
    ["PAID", "PREPARING", "READY_FOR_PICKUP"].includes(order.status)

  useEffect(() => {
    if (!open || !needsRiders || riders.length > 0) return
    let cancelled = false
    ordersApi.dispatchRiders()
      .then((list) => {
        if (!cancelled) {
          setRiders(list)
          setRidersError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRiders([])
          setRidersError(apiErrorMessage(err))
        }
      })
      .finally(() => {
        if (!cancelled) setRidersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, needsRiders, riders.length])

  if (!order) return null

  const nexts = nextStatusesFor(order, role)
  const wa = waHref(order.customerPhone, `Hello ${order.customerName ?? "there"}, this is Sphere Pharmacy regarding order ${order.reference}.`)
  const tel = telHref(order.customerPhone)
  const pay = latestPayment(order)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-dvh w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[min(42rem,calc(100vw-2rem))] sm:max-w-none">
        <SheetHeader className="shrink-0 space-y-1 border-b p-3 pr-12 text-left sm:p-4 sm:pr-12">
          <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="min-w-0 break-all font-bold">{order.reference}</span>
            <OrderFulfillmentStatus order={order} />
            {order.isRefill ? (
              <Badge variant="outline" className="gap-1 border-teal-300 bg-teal-50 text-xs text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
                <Repeat2 className="h-3 w-3" aria-hidden />
                Refill
              </Badge>
            ) : null}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>{formatDateTime(order.createdAt)}</span>
            <span className="flex items-center gap-1">
              {order.fulfillment === "DELIVERY" ? <Truck className="h-3 w-3" aria-hidden /> : <Store className="h-3 w-3" aria-hidden />}
              {FULFILLMENT_LABELS[order.fulfillment]}
            </span>
            <span>{ORDER_TYPE_LABELS[order.type]}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto overscroll-contain" tabIndex={0} aria-label={`Order ${order.reference} details`}>
          <div className="space-y-5 p-3 sm:p-4">
            {/* customer + contact */}
            <section aria-labelledby="od-customer">
              <h3 id="od-customer" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer</h3>
              <div className="rounded-lg border p-3">
                <p className="break-words text-sm font-semibold">{order.customerName ?? "Guest customer"}</p>
                <p className="break-all text-xs text-muted-foreground">{order.customerPhone ?? "No phone on file"}</p>
                <div className="mt-2.5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  {tel ? (
                    <Button size="sm" variant="outline" className="w-full gap-1.5 sm:w-auto" asChild>
                      <a href={tel}><Phone className="h-3.5 w-3.5" /> Call</a>
                    </Button>
                  ) : null}
                  {wa ? (
                    <Button size="sm" className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700 sm:w-auto" asChild>
                      <a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>
                    </Button>
                  ) : null}
                </div>
              </div>
            </section>

            {/* items */}
            <section aria-labelledby="od-items">
              <h3 id="od-items" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Items ({order.items.length})
              </h3>
              <ul className="divide-y rounded-lg border">
                {order.items.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">
                        {item.name}
                        <span className="ml-1 text-xs text-muted-foreground">× {item.qty}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{formatKES(item.price)} each</p>
                      {item.requiresPrescription ? <RxFlagBadge className="mt-1.5" compact /> : null}
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{formatKES(item.lineTotal)}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-2 space-y-1 rounded-lg bg-muted/40 p-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span><span className="tabular-nums">{formatKES(order.subtotal)}</span>
                </div>
                {order.discountAmount > 0 ? (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                    <span>Promo {order.promotionCode}</span>
                    <span className="tabular-nums">−{formatKES(order.discountAmount)}</span>
                  </div>
                ) : null}
                {order.fulfillment === "DELIVERY" ? (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Delivery{order.deliveryArea ? ` · ${order.deliveryArea}` : ""}</span>
                    <span className="tabular-nums">{order.deliveryFee > 0 ? formatKES(order.deliveryFee) : "Free"}</span>
                  </div>
                ) : null}
                <Separator />
                <div className="flex justify-between font-bold">
                  <span>Total</span><span className="tabular-nums">{formatKES(order.total)}</span>
                </div>
              </div>
            </section>

            {/* payment */}
            <section aria-labelledby="od-payment">
              <h3 id="od-payment" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment</h3>
              <div className={cn("mb-3 rounded-xl border p-3 text-sm", isCashOnDelivery(order) && !isPaid(order)
                ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
                : "bg-muted/30")}>
                <p className="font-bold">{paymentSummary(order)}</p>
                {isCashOnDelivery(order) && !isPaid(order) ? <p className="mt-1 text-xs leading-relaxed">Cash-on-delivery order. Packing and rider dispatch are allowed after pharmacist and stock checks. The rider confirms actual cash collection before completing delivery.</p> : null}
              </div>
              {order.payments.length === 0 ? (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  No payment attempts yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {order.payments
                    .slice()
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .map((p) => {
                      const PayIcon = paymentIcon(p.provider)
                      return (
                        <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                          <PayIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                          <span className="text-sm font-medium">
                            {p.method ? (PAYMENT_METHOD_LABELS[p.method] ?? p.method) : p.provider}
                          </span>
                          <PaymentStatusBadge status={p.status} />
                          <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">{formatKES(p.amount)}</span>
                          <p className="w-full break-words text-xs text-muted-foreground">
                            {formatDateTime(p.createdAt)}
                            {p.providerReference ? ` · Ref ${p.providerReference}` : ""}
                            {p.phone ? ` · ${p.phone}` : ""}
                            {p.cardLast4 ? ` · card ••••${p.cardLast4}` : ""}
                            {p.failureReason ? ` · ${p.failureReason}` : ""}
                          </p>
                        </li>
                      )
                    })}
                </ul>
              )}
              {canManage && (["AVAILABILITY_CONFIRMED", "AWAITING_PAYMENT"].includes(order.status) || (order.status === "READY_FOR_PICKUP" && order.paymentMethod === "CASH_ON_PICKUP")) && !isPaid(order) ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {order.paymentMethod !== "CASH_ON_PICKUP" ? <Button
                    size="sm"
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={actionBusy || !order.customerPhone}
                    title={!order.customerPhone ? "A customer phone number is required to send M-Pesa" : undefined}
                    onClick={() => onPromptMpesa(order)}
                  >
                    <Smartphone className="h-4 w-4" /> Send M-Pesa STK prompt
                  </Button> : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={actionBusy}
                    onClick={() => onStartTransition(order, "PAID", true)}
                  >
                    <Banknote className="h-4 w-4" /> {order.paymentMethod === "CASH_ON_PICKUP" ? "Confirm cash received at counter" : "Mark paid (cash received)"}
                  </Button>
                </div>
              ) : null}
            </section>

            {/* fulfilment details */}
            {order.fulfillment === "DELIVERY" ? (
              <section aria-labelledby="od-delivery">
                <h3 id="od-delivery" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Delivery details</h3>
                <div className="space-y-2 rounded-lg border p-3 text-sm">
                  <p className="flex min-w-0 items-start gap-2">
                    <Truck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 break-words">{order.deliveryAddress ?? "No address recorded"}</span>
                  </p>
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Priced delivery zone</p>
                    <p className="mt-1 flex items-center gap-1.5 font-bold"><MapPin className="h-4 w-4" />{order.deliveryArea || "Zone missing — confirm with customer"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Delivery charge: {formatKES(order.deliveryFee)}</p>
                  </div>
                  {order.deliveryLatitude != null && order.deliveryLongitude != null ? (
                    <p className="text-xs text-muted-foreground">Customer map pin: {order.deliveryLatitude.toFixed(5)}, {order.deliveryLongitude.toFixed(5)}</p>
                  ) : <p className="text-xs font-medium text-amber-800 dark:text-amber-300">No precise map pin saved — verify the location before sending a rider.</p>}
                  <Button asChild size="sm" variant="outline"><a target="_blank" rel="noopener noreferrer" href={deliveryMapUrl(order)}><Navigation className="mr-2 h-4 w-4"/> Open delivery map</a></Button>
                  {order.deliveryNotes ? (
                    <p className="text-xs text-muted-foreground">Notes: {order.deliveryNotes}</p>
                  ) : null}
                </div>
              </section>
            ) : (
              <section aria-labelledby="od-pickup">
                <h3 id="od-pickup" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pickup</h3>
                <div className="rounded-lg border p-3 text-sm">
                  <p>Collect in store — Lumumba Drive, Roysambu.</p>
                  {order.pickupCode ? (
                    <p className="mt-1.5 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Pickup code:</span>
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-sm font-bold tracking-widest text-primary">{order.pickupCode}</span>
                    </p>
                  ) : null}
                </div>
              </section>
            )}

            {/* Clear and actionable order-to-rider handoff */}
            {order.fulfillment === "DELIVERY" ? (
              <section aria-labelledby="od-dispatch-readiness">
                <h3 id="od-dispatch-readiness" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dispatch readiness</h3>
                <div className="space-y-3 rounded-xl border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-900 dark:bg-teal-950/20">
                  <div className="flex flex-wrap items-center gap-2">
                    <Truck className="h-4 w-4 text-teal-800 dark:text-teal-300" aria-hidden />
                    <OrderFulfillmentStatus order={order} />
                    {order.riderId ? (
                      <Badge variant="outline" className="border-teal-300 bg-background text-teal-800 dark:border-teal-800 dark:text-teal-200"><Bike className="mr-1 h-3 w-3" /> Rider assigned</Badge>
                    ) : null}
                  </div>
                  <p className="text-sm leading-relaxed text-foreground">{deliveryGuidance(order)}</p>
                  <p className="text-xs text-muted-foreground">Order checks are grouped into one acceptance action. Physical packing, rider handoff and cash receipt remain separate confirmations.</p>
                  {DISPATCH_STATUSES.includes(order.status) ? (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onNavigateSection("dispatch", { search: order.reference })}>
                      <Truck className="h-3.5 w-3.5" /> View in Dispatch <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <p className="text-xs font-medium text-muted-foreground">Not on Dispatch yet. Complete order review and accept the order for packing first; it will appear on Dispatch automatically when eligible.</p>
                  )}
                </div>
              </section>
            ) : null}

            {/* order notes */}
            {order.notes ? (
              <section aria-labelledby="od-notes">
                <h3 id="od-notes" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer notes</h3>
                <p className="rounded-lg border p-3 text-sm">{order.notes}</p>
              </section>
            ) : null}

            {/* refill lineage */}
            {order.isRefill ? (
              <section aria-labelledby="od-refill">
                <h3 id="od-refill" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prescription refill</h3>
                <div className="space-y-2 rounded-xl border border-teal-200 bg-teal-50/60 p-3 text-xs text-teal-950 dark:border-teal-900 dark:bg-teal-950/20 dark:text-teal-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <Repeat2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {order.refillOfOrderReference
                        ? `Refill of order #${shortRef(order.refillOfOrderReference)}`
                        : "Prescription refill order"}
                    </p>
                    {order.refillOfOrderReference ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => onSearchReference(order.refillOfOrderReference!)}
                      >
                        Find source order
                      </Button>
                    ) : null}
                  </div>
                  {order.prescriptions
                    .filter((rx) => isRefillPrescriptionRecord(rx))
                    .map((rx) => (
                      <p key={rx.id} className="text-muted-foreground">
                        {rx.refillNumber
                          ? rx.parentRefillsAllowed
                            ? `Refill #${rx.refillNumber} of ${rx.parentRefillsAllowed}`
                            : `Refill #${rx.refillNumber}`
                          : "Refill dispense"}
                        {rx.parentRefillsAllowed != null
                          ? ` · ${rx.parentRefillsUsed ?? 0}/${rx.parentRefillsAllowed} used`
                          : ""}
                        {rx.parentValidUntil ? ` · original valid until ${formatDate(rx.parentValidUntil)}` : ""}
                        {rx.refillReleasedAt ? " · slot returned" : ""}
                      </p>
                    ))}
                </div>
              </section>
            ) : null}

            {/* prescriptions */}
            {order.prescriptions.length > 0 ? (
              <section aria-labelledby="od-rx">
                <h3 id="od-rx" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attached prescriptions</h3>
                <ul className="space-y-2">
                  {order.prescriptions.map((rx) => {
                    const isRefillRx = isRefillPrescriptionRecord(rx)
                    return (
                      <li key={rx.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                        <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <span className="block break-all text-sm font-medium">{rx.fileName}</span>
                          {isRefillRx ? (
                            <span className="block text-xs text-muted-foreground">
                              {rx.refillNumber
                                ? rx.parentRefillsAllowed
                                  ? `Refill #${rx.refillNumber} of ${rx.parentRefillsAllowed}`
                                  : `Refill #${rx.refillNumber}`
                                : "Refill dispense"}
                              {rx.refillReleasedAt ? " · slot returned" : ""}
                            </span>
                          ) : rx.refillsAllowed > 0 ? (
                            <span className="block text-xs text-muted-foreground">
                              Refills: {rx.refillsUsed} of {rx.refillsAllowed} used
                              {rx.validUntil ? ` · valid until ${formatDate(rx.validUntil)}` : ""}
                            </span>
                          ) : null}
                        </div>
                        <RxStatusBadge status={rx.status} />
                        {role === "ADMIN" || role === "PHARMACIST" ? (
                          <Button size="sm" variant="outline" onClick={() => onReviewPrescription(rx.id)}>
                            Review here
                          </Button>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ) : null}

            {/* rider assignment */}
            {needsRiders ? (
              <section aria-labelledby="od-rider">
                <h3 id="od-rider" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rider assignment</h3>
                <p className="mb-2 text-xs text-muted-foreground">Assign a rider while the order is being prepared or once it is ready. Assignment does not dispatch the package.</p>
                {order.riderId ? <p className="mb-2 flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-900 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-200"><Bike className="h-4 w-4" /> Currently assigned: {order.riderName || "Rider"}</p> : null}
                {ridersLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading riders…</p>
                ) : ridersError ? (
                  <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">Could not load active riders: {ridersError}. Open Dispatch to try again.</div>
                ) : riders.filter((r) => r.id !== order.riderId).length === 0 ? (
                  <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{order.riderId ? "No other active riders are available for reassignment." : "No active rider accounts are available. An admin can add riders in Staff."}</p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Select value={riderPick || undefined} onValueChange={setRiderPick} disabled={actionBusy}>
                        <SelectTrigger className="w-full min-w-0 sm:flex-1" aria-label="Select an active delivery rider">
                          <SelectValue placeholder={order.riderId ? "Choose a replacement rider…" : "Choose an active rider…"} />
                        </SelectTrigger>
                        <SelectContent>
                          {riders.filter((r) => r.id !== order.riderId).map((rider) => (
                            <SelectItem key={rider.id} value={rider.id}>
                              {rider.name}{rider.phone ? ` · ${rider.phone}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={actionBusy || !riderPick || riderPick === order.riderId}
                        onClick={() => {
                          const rider = riders.find((r) => r.id === riderPick)
                          void onAssignRider(order, riderPick, rider?.name)
                        }}
                      >
                        {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bike className="h-4 w-4" />}
                        {order.riderId ? "Reassign rider" : "Assign rider"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Only active rider accounts are shown. Use Dispatch to manage assignments and see each rider’s workload.</p>
                  </div>
                )}
              </section>
            ) : null}

            {/* status history timeline */}
            <section aria-labelledby="od-history">
              <h3 id="od-history" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status history</h3>
              <ol className="relative space-y-3 border-l pl-4">
                {order.statusHistory
                  .slice()
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map((event) => (
                    <li key={event.id} className="relative">
                      <span
                        className={cn(
                          "absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background",
                          TERMINAL_STATUSES.includes(event.status) ? "bg-muted-foreground" : "bg-primary"
                        )}
                        aria-hidden
                      />
                      <p className="text-xs font-semibold">{ORDER_STATUS_LABELS[event.status] ?? event.status}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(event.createdAt)} · {event.actor}
                      </p>
                      {event.note ? <p className="mt-0.5 text-xs italic text-muted-foreground">“{event.note}”</p> : null}
                    </li>
                  ))}
              </ol>
            </section>
          </div>
        </div>

        {/* workflow actions footer */}
        <div className="scroll-slim max-h-[40dvh] shrink-0 space-y-2 overflow-y-auto border-t bg-background p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:bg-muted/30 sm:p-4">
          {canManage || role === "RIDER" ? (
            <>
              {order.fulfillment === "DELIVERY" ? (
                <p className="text-xs font-semibold text-foreground">{order.status === "READY_FOR_PICKUP" && !order.riderId ? "Next: assign a rider before dispatching" : "Next order action"}</p>
              ) : null}
              <div className="grid gap-2 sm:flex sm:flex-wrap">
                {canManage && order.fulfillment === "PICKUP" && order.status === "READY_FOR_PICKUP" && !isPaid(order) ? (
                  <Button disabled={actionBusy} onClick={() => onStartTransition(order, "PAID", true)}>
                    <Banknote className="mr-2 h-4 w-4"/> Confirm cash received at counter
                  </Button>
                ) : null}
                {canManage && readyToPack(order) ? (
                  <Button disabled={actionBusy} onClick={() => onStartPreparing(order)} className="gap-2">
                    {actionBusy ? <Loader2 className="h-4 w-4 animate-spin"/> : <Package className="h-4 w-4"/>}
                    Accept & start packing
                  </Button>
                ) : null}
                {nexts.filter((target) => !(readyToPack(order) && target === "PREPARING")).slice(0, 1).map((target, idx) => (
                  <Button
                    key={target}
                    size="sm"
                    variant={idx === 0 && target !== "REJECTED" ? "default" : "outline"}
                    disabled={actionBusy}
                    onClick={() => onStartTransition(order, target)}
                    className="w-full sm:w-auto"
                  >
                    {workflowLabel(order, target)}
                  </Button>
                ))}
              </div>
              {nexts.filter((target) => !(readyToPack(order) && target === "PREPARING")).length > 1 ? (
                <details className="rounded-lg border p-2 text-xs">
                  <summary className="cursor-pointer font-medium text-muted-foreground">Other status actions</summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {nexts.filter((target) => !(readyToPack(order) && target === "PREPARING")).slice(1).map((target) =>
                      <Button key={target} size="sm" variant="outline" disabled={actionBusy} onClick={() => onStartTransition(order, target)}>
                        {workflowLabel(order, target)}
                      </Button>
                    )}
                  </div>
                </details>
              ) : null}
              {order.fulfillment === "DELIVERY" && order.status === "READY_FOR_PICKUP" && !order.riderId ? (
                <Button size="sm" variant="outline" className="w-full gap-1.5 sm:w-auto" onClick={() => onNavigateSection("dispatch", { search: order.reference })}>
                  <Bike className="h-4 w-4" /> Assign a rider in Dispatch
                </Button>
              ) : null}
              {canManage && ACTIVE_STATUSES.includes(order.status) ? (
                <Button size="sm" variant="ghost" className="w-full gap-1.5 text-rose-600 hover:text-rose-700 sm:w-auto" disabled={actionBusy} onClick={() => onCancel(order)}>
                  <Ban className="h-4 w-4" /> Cancel order
                </Button>
              ) : null}
              {nexts.length === 0 && !ACTIVE_STATUSES.includes(order.status) ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> This order is in a terminal state — no further transitions.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Your role can view this order but not change its status.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ---------- transition confirmation ----------

function TransitionDialog({
  transition,
  busy,
  onClose,
  onConfirm,
}: {
  transition: { order: OrderDTO; target: OrderStatus; viaCash?: boolean }
  busy: boolean
  onClose: () => void
  onConfirm: (note: string) => Promise<void>
}) {
  const [note, setNote] = useState("")
  const { order, target, viaCash } = transition

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {viaCash ? "Confirm cash payment" : `Confirm: ${workflowLabel(order, target)}?`}
          </DialogTitle>
          <DialogDescription>
            {viaCash
              ? `Mark order ${order.reference} as paid — confirm you received ${formatKES(order.total)} in cash.`
              : target === "READY_FOR_PICKUP" && order.fulfillment === "DELIVERY"
                ? `Confirm all items in ${order.reference} have been checked, packed and are physically ready to hand over. This does not send the rider out yet.`
                : target === "OUT_FOR_DELIVERY" && order.fulfillment === "DELIVERY"
                  ? `Confirm the securely packed order ${order.reference} has been physically handed to ${order.riderName ?? "the assigned rider"}. This changes its status to Out for delivery.`
                  : `Order ${order.reference} will move from “${statusLabel(order.status)}” to “${statusLabel(target)}”. The customer is notified in-app.`}
          </DialogDescription>
        </DialogHeader>
        {!viaCash ? (
          <div className="space-y-2">
            <Label htmlFor="transition-note">Note (optional, shown in history)</Label>
            <Textarea
              id="transition-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Confirmed stock for all items, customer called to collect at 4pm"
              rows={3}
            />
          </div>
        ) : null}
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void onConfirm(note)} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            {viaCash ? "Mark as paid" : `Confirm: ${workflowLabel(order, target)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- cancel with reason ----------

function CancelDialog({
  order,
  busy,
  onClose,
  onConfirm,
}: {
  order: OrderDTO
  busy: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState("")
  const valid = reason.trim().length >= 3

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <X className="h-4 w-4 text-rose-600" aria-hidden /> Cancel order {order.reference}
          </DialogTitle>
          <DialogDescription>
            Cancelling stops the workflow and logs the reason to the audit trail. The customer is notified in-app.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">Reason (required)</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Prescription could not be verified; item out of stock; customer requested cancellation"
            rows={3}
            aria-invalid={!valid && reason.length > 0}
          />
          {!valid && reason.length > 0 ? (
            <p className="text-xs text-rose-600">Please give a short reason (min 3 characters).</p>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>Keep order</Button>
          <Button variant="destructive" onClick={() => void onConfirm(reason.trim())} disabled={busy || !valid}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Cancel order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
