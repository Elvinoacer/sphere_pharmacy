"use client"

// Prescriptions — compliance-critical review queue (PENDING first, then clarification
// requested, then others), full review dialog (image/PDF, customer notes, linked order
// items with Rx flags) and reviewed history with reviewer details.
// Review actions: Approve (refills + validity), Reject (reason required),
// Request clarification (message required), Partially approve (unavailable items noted).

import { useCallback, useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/shared/empty-state"
import { RxStatusBadge } from "@/components/shared/status-badges"
import { ordersApi, prescriptionsApi } from "@/lib/api-client"
import type { OrderDTO, PrescriptionDTO } from "@/lib/types"
import { RX_STATUS_LABELS, RX_STATUSES, type RxStatus } from "@/lib/constants"
import { formatDate, formatDateTime, formatKES, shortRef, statusLabel, timeAgo } from "@/lib/format"
import { isOrderCancelledOrRejected, isRefillPrescriptionRecord } from "@/lib/prescriptions/refill-core"
import { useAuthStore } from "@/store/use-auth-store"
import { toast } from "sonner"
import { AdminSectionHeader, apiErrorMessage, telHref, waHref, type SectionProps } from "../admin-shared"
import {
  ShieldAlert, Loader2, FileText, Download, Phone, MessageCircle, Eye,
  CheckCircle2, XCircle, HelpCircle, ListChecks, History, Clock, Repeat2,
  ZoomIn, ZoomOut, RotateCw, RefreshCw, Maximize2, ExternalLink, ArrowRight, ArrowLeft, X,
} from "lucide-react"
import { cn } from "@/lib/utils"

type ReviewAction = "APPROVED" | "REJECTED" | "CLARIFICATION_REQUESTED" | "PARTIALLY_APPROVED"

const VALID_DAYS_OPTIONS = [30, 60, 90, 180] as const

const queueOrder: Record<RxStatus, number> = {
  PENDING: 0,
  CLARIFICATION_REQUESTED: 1,
  PARTIALLY_APPROVED: 2,
  APPROVED: 3,
  REJECTED: 4,
}

export function PrescriptionsSection({ refreshKey, onRefresh }: SectionProps) {
  const role = useAuthStore((s) => s.session?.role)
  const canReview = role === "ADMIN" || role === "PHARMACIST"

  const [all, setAll] = useState<PrescriptionDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [historyFilter, setHistoryFilter] = useState<string>("ALL")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await prescriptionsApi.queue()
      setAll(list)
    } catch (err) {
      setError(apiErrorMessage(err))
      setAll([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const queue = useMemo(
    () =>
      all
        .filter((rx) => (rx.status === "PENDING" || rx.status === "CLARIFICATION_REQUESTED") && !isOrderCancelledOrRejected(rx.orderStatus))
        .sort((a, b) => queueOrder[a.status] - queueOrder[b.status] || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [all]
  )
  const history = useMemo(
    () =>
      all
        .filter((rx) => rx.status !== "PENDING" || isOrderCancelledOrRejected(rx.orderStatus))
        .filter((rx) => (historyFilter === "ALL" ? true : rx.status === historyFilter))
        .sort((a, b) => new Date(b.reviewedAt ?? b.createdAt).getTime() - new Date(a.reviewedAt ?? a.createdAt).getTime()),
    [all, historyFilter]
  )
  const pendingCount = queue.filter((rx) => rx.status === "PENDING").length
  const clarificationCount = queue.length - pendingCount

  return (
    <div className="space-y-4">
      <AdminSectionHeader
        title="Prescription review"
        subtitle="Verify uploaded prescriptions before dispensing — approvals, rejections and refill counts are audit-logged."
      />

      {/* PHI reminder */}
      <div
        className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        role="note"
      >
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          <span className="font-semibold">Confidential patient information.</span> Prescription images are
          confidential — only review on trusted devices, and never share them outside the dispensing workflow.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
          <p className="font-semibold">Couldn&apos;t load the prescription queue</p>
          <p className="mt-0.5">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void load()}>Retry</Button>
        </div>
      ) : null}

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue" className="gap-1.5">
            Review queue
            {pendingCount > 0 ? (
              <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-bold tabular-nums text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                {pendingCount}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-3.5 w-3.5" aria-hidden /> Reviewed
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4 space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="flex items-center gap-4 p-4">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="h-7 w-24" />
                </CardContent>
              </Card>
            ))
          ) : queue.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Queue is clear"
              description="No prescriptions waiting for review. New uploads appear here the moment customers submit them."
            />
          ) : (
            queue.map((rx) => <QueueCard key={rx.id} rx={rx} onReview={() => setReviewId(rx.id)} canReview={canReview} />)
          )}
          {!loading && clarificationCount > 0 && pendingCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {clarificationCount} awaiting customer clarification — follow up by phone or WhatsApp if needed.
            </p>
          ) : null}
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{history.length} reviewed prescription{history.length === 1 ? "" : "s"}</p>
            <Select value={historyFilter} onValueChange={setHistoryFilter}>
              <SelectTrigger className="w-48" aria-label="Filter reviewed prescriptions by status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All outcomes</SelectItem>
                {RX_STATUSES.filter((s) => s !== "PENDING").map((s) => (
                  <SelectItem key={s} value={s}>{RX_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
          ) : history.length === 0 ? (
            <EmptyState
              icon={History}
              title="No reviewed prescriptions yet"
              description="Completed reviews will show here with reviewer notes, refills and validity."
            />
          ) : (
            history.map((rx) => <HistoryCard key={rx.id} rx={rx} onInspect={() => setReviewId(rx.id)} />)
          )}
        </TabsContent>
      </Tabs>

      {reviewId ? (
        <ReviewDialog
          rxId={reviewId}
          canReview={canReview}
          onClose={() => setReviewId(null)}
          onSubmitted={() => {
            setReviewId(null)
            void load()
            onRefresh() // linked order status + overview KPIs may have changed
          }}
        />
      ) : null}
    </div>
  )
}

// ---------- queue card ----------

function QueueCard({ rx, onReview, canReview }: { rx: PrescriptionDTO; onReview: () => void; canReview: boolean }) {
  const wa = waHref(rx.customerPhone, `Hello ${rx.customerName ?? "there"}, this is Sphere Pharmacy regarding your prescription upload (${rx.fileName}).`)
  const tel = telHref(rx.customerPhone)
  const isRefill = isRefillPrescriptionRecord(rx)
  return (
    <Card className="card-lift">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
          {isRefill ? <Repeat2 className="h-5 w-5" aria-hidden /> : rx.status === "PENDING" ? <Clock className="h-5 w-5" aria-hidden /> : <HelpCircle className="h-5 w-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{rx.customerName ?? "Standalone upload"}</p>
            {isRefill ? (
              <Badge variant="outline" className="gap-1 border-teal-300 bg-teal-50 px-1.5 py-0 text-[10px] text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
                <Repeat2 className="h-2.5 w-2.5" aria-hidden />
                {rx.refillNumber
                  ? rx.parentRefillsAllowed
                    ? `Refill #${rx.refillNumber} of ${rx.parentRefillsAllowed}`
                    : `Refill #${rx.refillNumber}`
                  : "Refill"}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {rx.fileName} · uploaded {timeAgo(rx.createdAt)}
          </p>
          {rx.orderReference ? (
            <p className="truncate text-xs text-muted-foreground">
              Linked order: <span className="font-medium text-foreground">{rx.orderReference}</span>
              {isRefill && rx.sourceOrderReference ? (
                <span> · original order #{shortRef(rx.sourceOrderReference)}</span>
              ) : null}
            </p>
          ) : null}
          {rx.notes ? <p className="mt-1 truncate text-xs italic text-muted-foreground">“{rx.notes}”</p> : null}
        </div>
        <RxStatusBadge status={rx.status} />
        <div className="flex items-center gap-1.5">
          {tel ? (
            <Button size="icon" variant="outline" className="h-9 w-9" asChild aria-label={`Call ${rx.customerName ?? "customer"}`}>
              <a href={tel}><Phone className="h-4 w-4" /></a>
            </Button>
          ) : null}
          {wa ? (
            <Button size="icon" variant="outline" className="h-9 w-9" asChild aria-label={`WhatsApp ${rx.customerName ?? "customer"}`}>
              <a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" /></a>
            </Button>
          ) : null}
          <Button size="sm" onClick={onReview} disabled={!canReview} title={canReview ? undefined : "Only pharmacists and admins can review"}>
            <Eye className="mr-1.5 h-4 w-4" aria-hidden /> {canReview ? "Review" : "View"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- history card ----------

function HistoryCard({ rx, onInspect }: { rx: PrescriptionDTO; onInspect: () => void }) {
  const isRefill = isRefillPrescriptionRecord(rx)
  const orderClosed = isOrderCancelledOrRejected(rx.orderStatus)
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{rx.customerName ?? "Standalone upload"}</p>
          {isRefill ? (
            <Badge variant="outline" className="gap-1 border-teal-300 bg-teal-50 px-1.5 py-0 text-[10px] text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
              <Repeat2 className="h-2.5 w-2.5" aria-hidden />
              {rx.refillNumber
                ? rx.parentRefillsAllowed
                  ? `Refill #${rx.refillNumber} of ${rx.parentRefillsAllowed}`
                  : `Refill #${rx.refillNumber}`
                : "Refill"}
            </Badge>
          ) : null}
          {orderClosed && rx.orderStatus ? (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Order {statusLabel(rx.orderStatus).toLowerCase()}
            </Badge>
          ) : null}
          <RxStatusBadge status={rx.status} />
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {rx.fileName}
          {rx.orderReference ? ` · order ${rx.orderReference}` : ""} · uploaded {timeAgo(rx.createdAt)}
        </p>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          {rx.reviewedByName ? (
            <p><span className="font-medium text-foreground">Reviewed by:</span> {rx.reviewedByName}{rx.reviewedAt ? ` · ${formatDateTime(rx.reviewedAt)}` : ""}</p>
          ) : null}
          {isRefill ? (
            <p>
              <span className="font-medium text-foreground">Refill dispense:</span>{" "}
              {rx.refillReleasedAt
                ? "Slot returned to original prescription"
                : rx.parentRefillsAllowed
                  ? `Parent usage ${rx.parentRefillsUsed ?? 0} of ${rx.parentRefillsAllowed}`
                  : "Linked to original prescription"}
            </p>
          ) : rx.refillsAllowed > 0 ? (
            <p><span className="font-medium text-foreground">Refills:</span> {rx.refillsUsed} used of {rx.refillsAllowed} allowed</p>
          ) : (
            <p><span className="font-medium text-foreground">Refills:</span> none allowed</p>
          )}
          {rx.validUntil ? (
            <p><span className="font-medium text-foreground">Valid until:</span> {formatDate(rx.validUntil)}</p>
          ) : null}
        </div>
        {rx.reviewNotes ? (
          <p className="mt-2 rounded-lg bg-muted/50 p-2.5 text-xs">“{rx.reviewNotes}”</p>
        ) : null}
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onInspect}>
            <Eye className="h-3.5 w-3.5" aria-hidden />
            {rx.status === "APPROVED" || orderClosed ? "View details" : "Inspect / re-review"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- review dialog ----------

export function ReviewDialog({
  rxId,
  canReview,
  onClose,
  onSubmitted,
}: {
  rxId: string
  canReview: boolean
  onClose: () => void
  onSubmitted: () => void
}) {
  const [detail, setDetail] = useState<(PrescriptionDTO & { fileData?: string }) | null>(null)
  const [linkedOrder, setLinkedOrder] = useState<OrderDTO | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // review form state
  const [action, setAction] = useState<ReviewAction>("APPROVED")
  const [notes, setNotes] = useState("")
  const [unavailable, setUnavailable] = useState("")
  const [refills, setRefills] = useState("0")
  const [validDays, setValidDays] = useState<string>("30")
  const [busy, setBusy] = useState(false)

  // Document viewer controls
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [mobileTab, setMobileTab] = useState<"doc" | "review">("doc")
  const [lightboxOpen, setLightboxOpen] = useState(false)

  function handleZoomIn() {
    setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))
  }
  function handleZoomOut() {
    setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))
  }
  function handleRotate() {
    setRotation((r) => (r + 90) % 360)
  }
  function handleResetView() {
    setZoom(1)
    setRotation(0)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setDetailError(null)
    prescriptionsApi
      .get(rxId)
      .then(async (rx) => {
        if (cancelled) return
        setDetail(rx)
        setRefills(String(Math.max(rx.refillsUsed, rx.refillsAllowed)))
        setLoading(false)
        if (rx.orderId) {
          try {
            const order = await ordersApi.get(rx.orderId)
            if (!cancelled) setLinkedOrder(order)
          } catch {
            if (!cancelled) setLinkedOrder(null)
          }
        }
      })
      .catch((err) => {
        if (cancelled) return
        setDetailError(apiErrorMessage(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [rxId])

  const isImage = detail ? detail.fileType.startsWith("image") : false
  const imageSrc =
    detail?.fileUrl ||
    (detail?.fileData
      ? detail.fileData.startsWith("data:")
        ? detail.fileData
        : `data:${detail.fileType};base64,${detail.fileData}`
      : null)

  function download() {
    if (detail?.fileUrl) {
      window.open(detail.fileUrl, "_blank")
      return
    }
    if (!detail?.fileData) return
    const href = detail.fileData.startsWith("data:") ? detail.fileData : `data:${detail.fileType};base64,${detail.fileData}`
    const a = document.createElement("a")
    a.href = href
    a.download = detail.fileName || "prescription"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const isRefillCopy = detail ? isRefillPrescriptionRecord(detail) : false
  const orderClosed = Boolean(detail?.orderStatus && ["CANCELLED", "REFUNDED"].includes(detail.orderStatus))
  const parentExpired = Boolean(
    isRefillCopy &&
      detail?.parentPrescriptionId &&
      (!detail.parentValidUntil || Date.parse(detail.parentValidUntil) < Date.now() || !["APPROVED", "PARTIALLY_APPROVED"].includes(detail.parentStatus ?? ""))
  )
  const notesRequired = action === "REJECTED" || action === "CLARIFICATION_REQUESTED" || action === "PARTIALLY_APPROVED"
  const notesValid = notes.trim().length >= 3
  const partialValid = action !== "PARTIALLY_APPROVED" || unavailable.trim().length >= 3
  const minRefillsAllowed = detail && !isRefillCopy ? detail.refillsUsed : 0
  const refillsNum = Math.max(minRefillsAllowed, Math.min(6, Number(refills) || 0))
  const approvalBlockedByParent = parentExpired && (action === "APPROVED" || action === "PARTIALLY_APPROVED")

  async function submit() {
    if (!detail) return
    setBusy(true)
    try {
      let reviewNotes = notes.trim()
      if (action === "PARTIALLY_APPROVED" && unavailable.trim()) {
        reviewNotes = reviewNotes
          ? `${reviewNotes} — unavailable items: ${unavailable.trim()}`
          : `Unavailable items: ${unavailable.trim()}`
      }
      await prescriptionsApi.review(detail.id, {
        status: action,
        reviewNotes: reviewNotes || undefined,
        ...(!isRefillCopy && (action === "APPROVED" || action === "PARTIALLY_APPROVED")
          ? { refillsAllowed: refillsNum, validDays: Number(validDays) }
          : {}),
      })
      toast.success(
        action === "APPROVED"
          ? isRefillCopy
            ? "Refill dispense verified and approved."
            : "Prescription approved — refills and validity recorded."
          : action === "REJECTED"
            ? isRefillCopy
              ? "Refill rejected — customer notified and refill slot returned."
              : "Prescription rejected — customer will be notified."
            : action === "CLARIFICATION_REQUESTED"
              ? "Clarification request sent to the customer."
              : "Partially approved — unavailable items noted."
      )
      onSubmitted()
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const wa = detail ? waHref(detail.customerPhone, `Hello ${detail.customerName ?? "there"}, this is Sphere Pharmacy regarding your prescription upload (${detail.fileName}).`) : null
  const tel = detail ? telHref(detail.customerPhone) : null

  const submitButtonClass = {
    APPROVED: "bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700",
    PARTIALLY_APPROVED: "bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-600 dark:hover:bg-amber-700",
    CLARIFICATION_REQUESTED: "bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700",
    REJECTED: "bg-rose-600 hover:bg-rose-700 text-white dark:bg-rose-600 dark:hover:bg-rose-700",
  }[action]

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
        <DialogContent className="flex h-[94dvh] max-h-[94dvh] w-[96vw] max-w-[96vw] sm:max-w-4xl md:max-w-5xl lg:max-w-6xl xl:max-w-7xl flex-col overflow-hidden p-0 gap-0">
          {/* Header */}
          <DialogHeader className="border-b px-4 py-3 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
              <DialogTitle className="flex flex-wrap items-center gap-2 text-sm sm:text-base font-bold">
                <FileText className="h-4 w-4 text-primary shrink-0" aria-hidden />
                <span className="truncate max-w-[220px] sm:max-w-md">{detail?.fileName ?? "Prescription Review"}</span>
                {detail ? <RxStatusBadge status={detail.status} /> : null}
              </DialogTitle>
              {detail?.orderReference ? (
                <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">
                  Order #{detail.orderReference}
                </span>
              ) : null}
            </div>
            <DialogDescription className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              {detail ? (
                <>
                  <span className="font-medium text-foreground">{detail.customerName ?? "Standalone upload"}</span>
                  {detail.customerPhone ? <span>· {detail.customerPhone}</span> : null}
                  <span>· uploaded {timeAgo(detail.createdAt)}</span>
                </>
              ) : (
                "Loading prescription details…"
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Mobile Tab Switcher (Visible on small screens only) */}
          <div className="flex border-b bg-muted/40 md:hidden shrink-0">
            <button
              type="button"
              onClick={() => setMobileTab("doc")}
              className={cn(
                "flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors",
                mobileTab === "doc"
                  ? "border-primary text-primary bg-background shadow-xs"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              Prescription Document
            </button>
            <button
              type="button"
              onClick={() => setMobileTab("review")}
              className={cn(
                "flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors",
                mobileTab === "review"
                  ? "border-primary text-primary bg-background shadow-xs"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <ListChecks className="h-3.5 w-3.5" />
              Review & Order Details
              {canReview && detail?.status !== "APPROVED" ? (
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              ) : null}
            </button>
          </div>

          {/* Main Body: Responsive 2-column split on desktop, tabbed on mobile */}
          <div className="flex-1 min-h-0 grid md:grid-cols-12 divide-y md:divide-y-0 md:divide-x overflow-hidden">
            {/* Left Column: Document Viewer */}
            <div
              className={cn(
                "md:col-span-6 lg:col-span-7 flex flex-col min-h-0 bg-muted/15 overflow-hidden",
                mobileTab === "doc" ? "flex" : "hidden md:flex"
              )}
            >
              {/* Document Toolbar */}
              <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5 text-xs shrink-0">
                <span className="text-muted-foreground font-mono truncate max-w-[120px] sm:max-w-[200px]">
                  {detail?.fileName ?? "Document preview"}
                </span>
                <div className="flex items-center gap-0.5 sm:gap-1">
                  {isImage && imageSrc ? (
                    <>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleZoomOut} title="Zoom out">
                        <ZoomOut className="h-3.5 w-3.5" />
                      </Button>
                      <span className="text-[11px] font-mono text-muted-foreground w-9 text-center select-none">
                        {Math.round(zoom * 100)}%
                      </span>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleZoomIn} title="Zoom in">
                        <ZoomIn className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleRotate} title="Rotate 90°">
                        <RotateCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 hidden sm:inline-flex" onClick={handleResetView} title="Reset zoom & rotation">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setLightboxOpen(true)} title="Fullscreen zoom">
                        <Maximize2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : null}
                  <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs ml-1" onClick={download} title="Download file">
                    <Download className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Download</span>
                  </Button>
                </div>
              </div>

              {/* Document Viewport Canvas */}
              <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-3 sm:p-6 bg-slate-900/[0.03] dark:bg-slate-950/40 select-none">
                {loading ? (
                  <div className="flex flex-col items-center gap-3 p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Loading prescription file…</p>
                  </div>
                ) : detailError ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
                    {detailError}
                  </div>
                ) : isImage && imageSrc ? (
                  <div
                    className="relative transition-transform duration-150 ease-out cursor-zoom-in max-w-full"
                    style={{
                      transform: `scale(${zoom}) rotate(${rotation}deg)`,
                      transformOrigin: "center center",
                    }}
                    onClick={() => setLightboxOpen(true)}
                    title="Click to view full screen"
                  >
                    <img
                      src={imageSrc}
                      alt={`Prescription ${detail?.fileName}`}
                      className="max-h-[56dvh] md:max-h-[68dvh] w-auto max-w-full rounded-md shadow-sm object-contain border bg-background"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-background p-8 text-center max-w-sm shadow-xs">
                    <FileText className="h-12 w-12 text-primary" />
                    <div>
                      <p className="text-sm font-semibold">{detail?.fileName}</p>
                      <p className="text-xs text-muted-foreground mt-1">{detail?.fileType || "application/pdf"}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {detail?.fileUrl ? (
                        <Button size="sm" className="gap-1.5 text-xs" onClick={() => { if (detail?.fileUrl) window.open(detail.fileUrl, "_blank") }}>
                          <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={download}>
                        <Download className="h-3.5 w-3.5" /> Download
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile helper bar to switch to review */}
              <div className="p-2.5 border-t bg-background flex items-center justify-between md:hidden shrink-0">
                <span className="text-xs text-muted-foreground">Done checking document?</span>
                <Button size="sm" className="gap-1 text-xs" onClick={() => setMobileTab("review")}>
                  Proceed to review <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Right Column: Review Form & Prescription Details */}
            <div
              className={cn(
                "md:col-span-6 lg:col-span-5 flex flex-col min-h-0 bg-background overflow-hidden",
                mobileTab === "review" ? "flex" : "hidden md:flex"
              )}
            >
              {/* Mobile quick banner to switch back to document */}
              <div className="md:hidden flex items-center justify-between px-3 py-2 border-b bg-muted/25 shrink-0 text-xs">
                <span className="text-muted-foreground truncate max-w-[200px]">
                  {detail?.fileName ?? "Document"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1 text-primary hover:text-primary font-medium"
                  onClick={() => setMobileTab("doc")}
                >
                  <Eye className="h-3.5 w-3.5" /> View document
                </Button>
              </div>

              <ScrollArea className="scroll-slim flex-1 min-h-0">
                <div className="space-y-4 p-4">
                  {/* Customer / Patient Card */}
                  {detail ? (
                    <div className="rounded-lg border p-3 bg-muted/20 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Customer / Patient</p>
                          <p className="text-sm font-bold text-foreground mt-0.5 truncate">{detail.customerName ?? "Standalone upload"}</p>
                          <p className="text-xs font-mono text-muted-foreground truncate">{detail.customerPhone ?? "No phone on file"}</p>
                        </div>
                        <RxStatusBadge status={detail.status} />
                      </div>

                      {tel || wa ? (
                        <div className="flex flex-wrap items-center gap-2 pt-1 border-t">
                          {tel ? (
                            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs flex-1" asChild>
                              <a href={tel}><Phone className="h-3.5 w-3.5 text-primary" /> Call</a>
                            </Button>
                          ) : null}
                          {wa ? (
                            <Button size="sm" className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white flex-1" asChild>
                              <a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Refill verification context banner */}
                  {detail && isRefillCopy ? (
                    <div
                      className={cn(
                        "space-y-1.5 rounded-lg border p-3 text-xs",
                        parentExpired
                          ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                          : "border-teal-300 bg-teal-50/70 text-teal-950 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-200"
                      )}
                    >
                      <p className="flex items-center gap-1.5 font-bold uppercase tracking-wider">
                        <Repeat2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        Refill re-verification
                        {detail.refillNumber
                          ? detail.parentRefillsAllowed
                            ? ` · #${detail.refillNumber} of ${detail.parentRefillsAllowed}`
                            : ` · #${detail.refillNumber}`
                          : ""}
                      </p>
                      <p>
                        {detail.sourceOrderReference ? (
                          <>
                            Source order <span className="font-mono font-semibold">#{shortRef(detail.sourceOrderReference)}</span>
                          </>
                        ) : (
                          "Refill of a previously approved prescription"
                        )}
                        {detail.parentReviewedByName ? ` · originally approved by ${detail.parentReviewedByName}` : ""}
                      </p>
                      {detail.parentRefillsAllowed != null ? (
                        <p>
                          Original allowance: <span className="font-semibold">{detail.parentRefillsUsed ?? 0} of {detail.parentRefillsAllowed} used</span>
                          {detail.parentValidUntil ? ` · valid until ${formatDate(detail.parentValidUntil)}` : ""}
                        </p>
                      ) : null}
                      {detail.parentReviewNotes ? (
                        <p className="italic opacity-90">Original notes: “{detail.parentReviewNotes}”</p>
                      ) : null}
                      {parentExpired ? (
                        <p className="font-semibold">
                          The original prescription has expired or is no longer valid — reject this refill and ask the customer to upload a current prescription.
                        </p>
                      ) : (
                        <p className="opacity-85">
                          Approving verifies this dispense only; it does not grant extra refills or extend the original expiry date.
                        </p>
                      )}
                    </div>
                  ) : null}

                  {/* Customer notes */}
                  {detail?.notes ? (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer notes</p>
                      <p className="rounded-lg border bg-muted/10 p-2.5 text-xs italic text-foreground">“{detail.notes}”</p>
                    </div>
                  ) : null}

                  {/* Linked order items */}
                  {detail?.orderId ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Linked order {detail.orderReference ? `· #${detail.orderReference}` : ""}
                        </p>
                        {linkedOrder ? (
                          <span className="text-xs font-semibold text-primary">{formatKES(linkedOrder.total)}</span>
                        ) : null}
                      </div>
                      {linkedOrder ? (
                        <ul className="divide-y rounded-lg border text-xs max-h-36 overflow-y-auto">
                          {linkedOrder.items.map((item) => (
                            <li key={item.id} className="flex items-center justify-between gap-2 p-2">
                              <span className="min-w-0 truncate font-medium">
                                {item.name} <span className="text-muted-foreground font-normal">× {item.qty}</span>
                                {item.requiresPrescription ? (
                                  <span className="ml-1.5 rounded bg-rose-100 px-1 py-0.2 text-[10px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                                    ℞
                                  </span>
                                ) : null}
                              </span>
                              <span className="tabular-nums text-muted-foreground">{formatKES(item.lineTotal)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
                          Linked order details unavailable.
                        </p>
                      )}
                    </div>
                  ) : null}

                  {/* Pharmacist Review Form */}
                  {orderClosed && detail ? (
                    <div className="rounded-lg border border-muted bg-muted/40 p-3 text-xs text-muted-foreground">
                      <p className="font-semibold text-foreground">
                        Linked order is {statusLabel(detail.orderStatus!).toLowerCase()}
                      </p>
                      <p className="mt-1">
                        This prescription belongs to a cancelled or refunded order and no longer requires pharmacist review.
                        {detail.refillReleasedAt ? " Its refill slot was automatically returned to the original prescription." : ""}
                      </p>
                    </div>
                  ) : canReview && detail && detail.status !== "APPROVED" ? (
                    <div className="space-y-3 rounded-lg border p-3.5 bg-card shadow-xs">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold uppercase tracking-wider text-foreground">Pharmacist Decision</p>
                        <span className="text-[10px] text-muted-foreground">Select decision</span>
                      </div>

                      <RadioGroup
                        value={action}
                        onValueChange={(v) => setAction(v as ReviewAction)}
                        className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                      >
                        <ReviewChoice
                          value="APPROVED"
                          icon={CheckCircle2}
                          title="Approve"
                          desc={isRefillCopy ? "Verify this refill dispense" : "Valid prescription — authorize"}
                          selected={action === "APPROVED"}
                          colorScheme="emerald"
                        />
                        <ReviewChoice
                          value="PARTIALLY_APPROVED"
                          icon={ListChecks}
                          title="Partial approval"
                          desc="Some items in stock only"
                          selected={action === "PARTIALLY_APPROVED"}
                          colorScheme="amber"
                        />
                        <ReviewChoice
                          value="CLARIFICATION_REQUESTED"
                          icon={HelpCircle}
                          title="Clarify"
                          desc="Request clearer photo / info"
                          selected={action === "CLARIFICATION_REQUESTED"}
                          colorScheme="blue"
                        />
                        <ReviewChoice
                          value="REJECTED"
                          icon={XCircle}
                          title="Reject"
                          desc={isRefillCopy ? "Deny refill (returns refill slot)" : "Invalid, expired or unreadable"}
                          selected={action === "REJECTED"}
                          colorScheme="rose"
                        />
                      </RadioGroup>

                      {/* Conditional inputs based on decision */}
                      {(action === "APPROVED" || action === "PARTIALLY_APPROVED") && !isRefillCopy ? (
                        <div className="space-y-2 pt-1">
                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="space-y-1">
                              <Label htmlFor="rx-refills" className="text-xs font-medium">
                                Refills allowed ({minRefillsAllowed}–6)
                              </Label>
                              <Input
                                id="rx-refills"
                                type="number"
                                min={minRefillsAllowed}
                                max={6}
                                value={refills}
                                onChange={(e) => setRefills(e.target.value)}
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="rx-valid" className="text-xs font-medium">Validity period</Label>
                              <Select value={validDays} onValueChange={setValidDays}>
                                <SelectTrigger id="rx-valid" className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {VALID_DAYS_OPTIONS.map((d) => (
                                    <SelectItem key={d} value={String(d)} className="text-xs">
                                      {d} days
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          {!detail.orderId ? (
                            <p className="text-[11px] text-muted-foreground">
                              Standalone upload — refills only become actionable once linked to a prescription order.
                            </p>
                          ) : null}
                        </div>
                      ) : (action === "APPROVED" || action === "PARTIALLY_APPROVED") && isRefillCopy ? (
                        <div className="rounded-md border bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
                          Refill allowance and validity are inherited from the original prescription — no additional refills will be created by approving this dispense.
                        </div>
                      ) : null}

                      {action === "PARTIALLY_APPROVED" ? (
                        <div className="space-y-1 pt-1">
                          <Label htmlFor="rx-unavailable" className="text-xs font-medium text-amber-800 dark:text-amber-300">
                            Unavailable items (required)
                          </Label>
                          <Input
                            id="rx-unavailable"
                            value={unavailable}
                            onChange={(e) => setUnavailable(e.target.value)}
                            placeholder="e.g. Augmentin 625mg out of stock"
                            className="h-8 text-xs"
                          />
                        </div>
                      ) : null}

                      <div className="space-y-1 pt-1">
                        <Label htmlFor="rx-notes" className="text-xs font-medium">
                          {action === "CLARIFICATION_REQUESTED"
                            ? "Message to customer (required)"
                            : action === "REJECTED"
                              ? "Reason for rejection (required)"
                              : "Pharmacist review notes (optional)"}
                        </Label>
                        <Textarea
                          id="rx-notes"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={2}
                          placeholder={
                            action === "CLARIFICATION_REQUESTED"
                              ? "e.g. Please upload a clearer photo showing the doctor signature and dosage."
                              : action === "REJECTED"
                                ? "e.g. Prescription expired or illegible doctor handwriting."
                                : "e.g. Verified against patient records; authorized."
                          }
                          className="text-xs resize-none"
                          aria-invalid={notesRequired && !notesValid && notes.length > 0}
                        />
                        {notesRequired && !notesValid && notes.length > 0 ? (
                          <p className="text-[11px] text-rose-600 font-medium">At least 3 characters required.</p>
                        ) : null}
                      </div>
                    </div>
                  ) : detail?.status === "APPROVED" ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                      <p className="font-semibold">✓ Prescription already verified and approved.</p>
                      {detail.reviewNotes ? <p className="mt-1 italic">“{detail.reviewNotes}”</p> : null}
                    </div>
                  ) : null}
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* Solid Opaque Footer */}
          <div className="border-t bg-background shrink-0 px-4 py-3 flex items-center justify-between gap-3 shadow-sm z-10">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={busy} className="h-8 text-xs">
                Close
              </Button>
              {mobileTab === "review" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMobileTab("doc")}
                  className="h-8 text-xs gap-1 md:hidden"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Document
                </Button>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {mobileTab === "doc" ? (
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setMobileTab("review")}
                  className="h-8 text-xs gap-1 font-semibold md:hidden"
                >
                  Review prescription <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : null}

              {canReview && detail && !orderClosed && detail.status !== "APPROVED" ? (
                <Button
                  size="sm"
                  onClick={() => void submit()}
                  disabled={busy || approvalBlockedByParent || (notesRequired && !notesValid) || !partialValid}
                  className={cn(
                    "h-8 text-xs font-semibold transition-colors",
                    submitButtonClass,
                    mobileTab === "doc" ? "hidden md:inline-flex" : "inline-flex"
                  )}
                >
                  {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  {action === "APPROVED" ? "Approve prescription"
                    : action === "REJECTED" ? "Reject prescription"
                      : action === "CLARIFICATION_REQUESTED" ? "Send clarification request"
                        : "Save partial approval"}
                </Button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fullscreen Lightbox Modal */}
      {lightboxOpen && isImage && imageSrc ? (
        <div
          className="fixed inset-0 z-[120] bg-black/95 flex flex-col p-4 animate-in fade-in-0 duration-150"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="flex items-center justify-between text-white pb-3 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-sm font-medium truncate max-w-sm">{detail?.fileName}</span>
            <div className="flex items-center gap-2">
              <Button size="icon" variant="ghost" className="text-white hover:bg-white/20 h-8 w-8" onClick={handleZoomOut} title="Zoom out">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-xs font-mono">{Math.round(zoom * 100)}%</span>
              <Button size="icon" variant="ghost" className="text-white hover:bg-white/20 h-8 w-8" onClick={handleZoomIn} title="Zoom in">
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="text-white hover:bg-white/20 h-8 w-8" onClick={handleRotate} title="Rotate">
                <RotateCw className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="text-white hover:bg-white/20 h-8 w-8" onClick={download} title="Download">
                <Download className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="text-white hover:bg-white/20 h-8 w-8" onClick={() => setLightboxOpen(false)} title="Close">
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
          <div
            className="flex-1 overflow-auto flex items-center justify-center p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={imageSrc}
              alt={detail?.fileName ?? "Prescription"}
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                transformOrigin: "center center",
              }}
              className="max-h-[85vh] max-w-[90vw] object-contain transition-transform duration-150 select-none"
            />
          </div>
        </div>
      ) : null}
    </>
  )
}

function ReviewChoice({
  value,
  icon: Icon,
  title,
  desc,
  selected,
  colorScheme,
}: {
  value: ReviewAction
  icon: typeof CheckCircle2
  title: string
  desc: string
  selected: boolean
  colorScheme: "emerald" | "amber" | "blue" | "rose"
}) {
  const colorClasses = {
    emerald: selected
      ? "border-emerald-500 bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-600 shadow-xs ring-1 ring-emerald-500/20"
      : "hover:border-emerald-200 hover:bg-muted/40",
    amber: selected
      ? "border-amber-500 bg-amber-50/70 text-amber-950 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-600 shadow-xs ring-1 ring-amber-500/20"
      : "hover:border-amber-200 hover:bg-muted/40",
    blue: selected
      ? "border-blue-500 bg-blue-50/70 text-blue-950 dark:bg-blue-950/30 dark:text-blue-200 dark:border-blue-600 shadow-xs ring-1 ring-blue-500/20"
      : "hover:border-blue-200 hover:bg-muted/40",
    rose: selected
      ? "border-rose-500 bg-rose-50/70 text-rose-950 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-600 shadow-xs ring-1 ring-rose-500/20"
      : "hover:border-rose-200 hover:bg-muted/40",
  }[colorScheme]

  const iconColor = {
    emerald: selected ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
    amber: selected ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
    blue: selected ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground",
    rose: selected ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
  }[colorScheme]

  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-all text-left min-w-0 select-none",
        colorClasses
      )}
    >
      <RadioGroupItem value={value} className="mt-0.5 shrink-0" aria-label={title} />
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconColor)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold leading-tight text-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground leading-snug mt-0.5 break-normal">{desc}</div>
      </div>
    </label>
  )
}
