"use client"

import { MemberIntro } from "@/components/member/member-intro"

import { useEffect, useMemo, useRef, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/shared/empty-state"
import { RefillRequestDialog } from "@/components/shared/refill-request-dialog"
import { RxStatusBadge } from "@/components/shared/status-badges"
import { useAppStore } from "@/store/use-app-store"
import { useAuthStore } from "@/store/use-auth-store"
import { prescriptionsApi, storageApi } from "@/lib/api-client"
import { evaluateRefillEligibility } from "@/lib/prescriptions/refill-core"
import { ROLE_LABELS } from "@/lib/constants"
import { formatDate, formatDateTime, shortRef, statusLabel, timeAgo } from "@/lib/format"
import type { PrescriptionDTO } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  CalendarClock,
  Download,
  FileSearch,
  FileText,
  Info,
  Loader2,
  Lock,
  Repeat2,
  ShieldCheck,
  ShieldQuestion,
  Upload,
  Wallet,
  X,
} from "lucide-react"

// ---------- local helpers ----------

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

const MAX_FILE_BYTES = 10 * 1024 * 1024
const ACCEPTED_FILE_TYPES = /^image\/(png|jpe?g|webp|gif|heic|heif)$|^application\/pdf$/

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      // strip the data-url prefix if present (API expects raw base64)
      resolve(result.includes(",") ? (result.split(",")[1] ?? "") : result)
    }
    reader.onerror = () => reject(new Error("Couldn't read the file — please try again."))
    reader.readAsDataURL(file)
  })
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

type PrescriptionsTab = "list" | "upload"

// ============================== VIEW ==============================

export function PrescriptionsView() {
  const navigate = useAppStore((s) => s.navigate)
  const openAuth = useAppStore((s) => s.openAuth)
  const session = useAuthStore((s) => s.session)
  const authLoading = useAuthStore((s) => s.loading)

  const isCustomer = session?.role === "CUSTOMER"
  const isStaff = session != null && session.role !== "CUSTOMER"

  const [tab, setTab] = useState<PrescriptionsTab>("list")

  // ---------- list ----------
  const [list, setList] = useState<PrescriptionDTO[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (authLoading || !isCustomer) return
    let cancelled = false
    prescriptionsApi
      .mine()
      .then((res) => {
        if (cancelled) return
        setList(res)
        setListError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setListError(errMessage(err, "We couldn't load your prescriptions. Please try again."))
      })
    return () => {
      cancelled = true
    }
  }, [authLoading, isCustomer, reloadKey])

  async function reload() {
    try {
      const res = await prescriptionsApi.mine()
      setList(res)
      setListError(null)
    } catch (err) {
      setListError(errMessage(err, "We couldn't load your prescriptions. Please try again."))
    }
  }

  // ---------- upload form ----------
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [notes, setNotes] = useState("")
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStage, setUploadStage] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // revoke the object URL when the view unmounts
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  function setPreview(f: File | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = null
    if (f && f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f)
      previewUrlRef.current = url
      setPreviewUrl(url)
    } else {
      setPreviewUrl(null)
    }
  }

  function pickFile(f: File | undefined | null) {
    setUploadError(null)
    if (!f) return
    if (!ACCEPTED_FILE_TYPES.test(f.type)) {
      const msg = "Only photos (JPG, PNG, WebP, HEIC) or PDF files are accepted."
      toast.error(msg)
      setUploadError(msg)
      return
    }
    if (f.size > MAX_FILE_BYTES) {
      const msg = "File is too large — prescriptions must be 10 MB or smaller."
      toast.error(msg)
      setUploadError(msg)
      return
    }
    setFile(f)
    setPreview(f)
  }

  function clearFile() {
    setFile(null)
    setPreview(null)
    setUploadError(null)
  }

  async function submitUpload() {
    if (!file || uploading) return
    setUploading(true)
    setUploadProgress(0)
    setUploadStage("Preparing your file…")
    setUploadError(null)
    try {
      let fileUrl: string | undefined
      let storageKey: string | undefined
      let base64: string | undefined

      try {
        const r2Res = await storageApi.uploadFile(file, "prescriptions", (percent) => {
          setUploadProgress(percent)
          setUploadStage(percent < 100 ? `Uploading file… ${percent}%` : "Securing your prescription…")
        })
        fileUrl = r2Res.url
        storageKey = r2Res.key
      } catch (uploadErr) {
        console.warn("[R2 direct upload fallback]:", uploadErr)
        setUploadStage("Preparing secure fallback upload…")
        base64 = await fileToBase64(file)
      }

      setUploadStage("Creating your prescription record…")
      await prescriptionsApi.upload({
        fileName: file.name,
        fileType: file.type,
        fileData: base64,
        fileUrl,
        storageKey,
        notes: notes.trim() || undefined,
      })
      toast.success("Prescription uploaded to cloud storage — our pharmacist will review it shortly.")
      clearFile()
      setNotes("")
      setReloadKey((k) => k + 1)
      setTab("list")
    } catch (err) {
      const msg = errMessage(err, "Upload failed. Please try again.")
      setUploadError(msg)
      toast.error(msg)
    } finally {
      setUploading(false)
      setUploadStage(null)
      setUploadProgress(0)
    }
  }

  // ---------- refill / viewer ----------
  const [refillTarget, setRefillTarget] = useState<PrescriptionDTO | null>(null)
  const [rxViewId, setRxViewId] = useState<string | null>(null)

  const rxToView = (list ?? []).find((rx) => rx.id === rxViewId) ?? null

  const sorted = useMemo(() => {
    if (!list) return []
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [list])

  const listLoading = authLoading || (isCustomer && list === null && listError === null)

  // ============================== GUARDS ==============================

  if (listLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Skeleton className="mb-2 h-8 w-52" />
        <Skeleton className="mb-6 h-4 w-72" />
        <Skeleton className="mb-6 h-10 w-64" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (isStaff) {
    const staff = session?.staff
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <ShieldCheck className="h-7 w-7 text-primary" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-bold">You're signed in as staff</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {staff ? `${staff.name} · ${ROLE_LABELS[staff.role]}` : "Staff account"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Customer prescriptions live in your account — review the pharmacy's queue from the
                admin dashboard.
              </p>
            </div>
            <Button onClick={() => navigate("admin")}>Open staff dashboard</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <EmptyState
          icon={Lock}
          title="Prescription uploads need an account"
          description="Our pharmacist reviews every upload privately and responds securely to your account — that's why prescriptions can't be handled as a guest."
          action={{ label: "Sign in to upload", onClick: () => openAuth("login", "prescriptions") }}
        />
        <Card className="border-dashed">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
            <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <p>
              With an account you get a private prescription history, pharmacist review responses,
              refill tracking and faster repeat orders. Guests can still order OTC products.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ============================== MAIN ==============================

  return (
    <div className="app-page app-page-prescriptions mx-auto max-w-3xl px-4 py-8 pb-12">

      <MemberIntro kind="prescriptions" />

      <Tabs value={tab} onValueChange={(v) => setTab(v as PrescriptionsTab)} className="mb-5">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="list">
            <FileText className="h-4 w-4" aria-hidden /> My prescriptions
          </TabsTrigger>
          <TabsTrigger value="upload">
            <Upload className="h-4 w-4" aria-hidden /> Upload new
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "upload" ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Upload a prescription</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <Alert>
              <Info className="h-4 w-4" aria-hidden />
              <AlertTitle>Standalone upload — how it works</AlertTitle>
              <AlertDescription>
                We review your prescription first (usually within a few hours during opening
                times). Once approved, order the medicines from your catalogue and we'll match them
                to this prescription. Nothing is charged until you place an order.
              </AlertDescription>
            </Alert>

            {/* drop zone */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload a prescription photo or PDF — tap to browse files"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                pickFile(e.dataTransfer.files?.[0])
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/30 hover:border-primary/40 hover:bg-muted/50"
              )}
            >
              <Upload className="h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">
                {dragOver ? "Drop the file to attach it" : "Drag & drop your prescription here"}
              </p>
              <p className="text-xs text-muted-foreground">
                Photos (JPG, PNG, WebP, HEIC) or PDF · up to 10 MB
              </p>
              <Button variant="outline" size="sm" className="mt-2" tabIndex={-1}>
                <FileSearch className="h-3.5 w-3.5" aria-hidden />
                Browse files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                aria-hidden
                tabIndex={-1}
                onChange={(e) => {
                  pickFile(e.target.files?.[0])
                  e.target.value = "" // allow re-picking the same file
                }}
              />
            </div>

            {/* preview */}
            {file ? (
              <div className="flex items-start gap-3 rounded-lg border p-3">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={`Preview of ${file.name}`}
                    className="h-24 w-24 rounded-md border object-cover"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-md border bg-muted">
                    <FileText className="h-8 w-8 text-muted-foreground" aria-hidden />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {file.type.startsWith("image/") ? "Photo" : "PDF document"} ·{" "}
                    {formatBytes(file.size)}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-7 px-2 text-destructive hover:text-destructive"
                    onClick={clearFile}
                    disabled={uploading}
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    Remove
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="rx-notes">Notes for the pharmacist (optional)</Label>
              <Textarea
                id="rx-notes"
                rows={3}
                placeholder="e.g. Dr. Otieno, Nairobi West Hospital, dated 12 May — repeat of last month's script"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={uploading}
              />
            </div>

            {uploadError ? (
              <p className="text-sm text-destructive" role="alert">
                {uploadError}
              </p>
            ) : null}

            {uploading && uploadStage ? (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3" role="status" aria-live="polite">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{uploadStage}</span>
                  {uploadProgress > 0 ? <span className="tabular-nums text-muted-foreground">{uploadProgress}%</span> : null}
                </div>
                <Progress value={uploadProgress} aria-label={`Prescription upload ${uploadProgress}% complete`} />
                <p className="text-xs text-muted-foreground">Keep this page open until the upload is confirmed.</p>
              </div>
            ) : null}

            <Button
              className="w-full"
              onClick={() => void submitUpload()}
              disabled={!file || uploading}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-4 w-4" aria-hidden />
              )}
              {uploading ? "Uploading…" : "Upload for review"}
            </Button>
          </CardContent>
        </Card>
      ) : listError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">{listError}</p>
            <Button variant="outline" onClick={() => void reload()}>
              <Loader2 className="h-4 w-4" aria-hidden />
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No prescriptions yet"
          description="Upload a photo or PDF of your prescription — our pharmacist reviews it before you order."
          action={{ label: "Upload a prescription", onClick: () => setTab("upload") }}
        />
      ) : (
        <ul className="space-y-3">
          {sorted.map((rx) => (
            <PrescriptionCard
              key={rx.id}
              rx={rx}
              onView={() => setRxViewId(rx.id)}
              onRequestRefill={() => setRefillTarget(rx)}
              onOpenOrder={(orderId) => navigate("order", { orderId })}
            />
          ))}
        </ul>
      )}

      {/* refill request confirmation dialog */}
      {refillTarget ? (
        <RefillRequestDialog
          rx={refillTarget}
          onClose={() => setRefillTarget(null)}
          onCreated={(res) => {
            setRefillTarget(null)
            setReloadKey((k) => k + 1)
            navigate("order", { orderId: res.orderId })
          }}
        />
      ) : null}

      {/* prescription file viewer */}
      {rxToView ? <PrescriptionFileDialog rx={rxToView} onClose={() => setRxViewId(null)} /> : null}
    </div>
  )
}

// ============================== PRESCRIPTION CARD ==============================

function PrescriptionCard({
  rx,
  onView,
  onRequestRefill,
  onOpenOrder,
}: {
  rx: PrescriptionDTO
  onView: () => void
  onRequestRefill: () => void
  onOpenOrder: (orderId: string) => void
}) {
  const eligibility = evaluateRefillEligibility(rx)
  const isChildRefill = eligibility.isRefill
  const orderAwaitingPayment = rx.orderStatus === "AWAITING_PAYMENT"

  return (
    <li>
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">{rx.fileName}</p>
            {isChildRefill ? (
              <Badge variant="outline" className="gap-1 border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
                <Repeat2 className="h-3 w-3" aria-hidden />
                {rx.refillNumber
                  ? rx.parentRefillsAllowed
                    ? `Refill #${rx.refillNumber} of ${rx.parentRefillsAllowed}`
                    : `Refill #${rx.refillNumber}`
                  : "Refill"}
              </Badge>
            ) : null}
            <RxStatusBadge status={rx.status} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Uploaded {formatDateTime(rx.createdAt)} · {timeAgo(rx.createdAt)}
            {rx.orderReference ? ` · Order #${shortRef(rx.orderReference)}` : ""}
            {rx.orderStatus ? ` (${statusLabel(rx.orderStatus)})` : ""}
          </p>
          {isChildRefill && rx.sourceOrderReference ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Refill of original order #{shortRef(rx.sourceOrderReference)}
              {rx.refillReleasedAt ? " · refill slot returned" : ""}
            </p>
          ) : null}

          {rx.notes ? (
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{rx.notes}</p>
          ) : null}

          {rx.reviewNotes ? (
            <blockquote className="mt-3 rounded-r-md border-l-2 border-primary/50 bg-muted/40 py-2 pl-3 pr-2 text-sm text-muted-foreground">
              “{rx.reviewNotes}”
              {rx.reviewedByName ? (
                <footer className="mt-1 text-xs not-italic">
                  Reviewed by {rx.reviewedByName}
                  {rx.reviewedAt ? ` · ${formatDate(rx.reviewedAt)}` : ""}
                </footer>
              ) : null}
            </blockquote>
          ) : null}

          {!isChildRefill ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {rx.refillsAllowed > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  <Repeat2 className="h-3 w-3" aria-hidden />
                  Refills: {rx.refillsUsed} of {rx.refillsAllowed} used
                </span>
              ) : null}
              {rx.validUntil ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                    eligibility.expired
                      ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <CalendarClock className="h-3 w-3" aria-hidden />
                  {eligibility.expired ? "Expired" : "Valid until"} {formatDate(rx.validUntil)}
                </span>
              ) : null}
            </div>
          ) : rx.validUntil ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                <CalendarClock className="h-3 w-3" aria-hidden />
                Original prescription valid until {formatDate(rx.validUntil)}
              </span>
            </div>
          ) : null}

          {!isChildRefill && eligibility.blockedReason === "no_order" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Refills apply once this prescription is linked to a pharmacy order.
            </p>
          ) : !isChildRefill && eligibility.blockedReason === "source_order_cancelled" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Refills aren&apos;t available because the linked order was cancelled or rejected.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onView} aria-label={`View ${rx.fileName}`}>
              <FileSearch className="h-3.5 w-3.5" aria-hidden />
              View
            </Button>
            {rx.orderId ? (
              <Button
                size="sm"
                variant={orderAwaitingPayment ? "default" : "outline"}
                className={cn(
                  "gap-1.5",
                  orderAwaitingPayment && "bg-emerald-600 text-white hover:bg-emerald-700"
                )}
                onClick={() => onOpenOrder(rx.orderId!)}
              >
                <Wallet className="h-3.5 w-3.5" aria-hidden />
                {orderAwaitingPayment ? "View / Pay Order" : "View Order"}
              </Button>
            ) : null}
            {!isChildRefill && eligibility.canRequest ? (
              <Button size="sm" variant="outline" onClick={onRequestRefill}>
                <Repeat2 className="h-3.5 w-3.5" aria-hidden />
                Request refill
              </Button>
            ) : !isChildRefill && eligibility.blockedReason === "active_refill" && eligibility.activeRefillOrderId ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onOpenOrder(eligibility.activeRefillOrderId!)}
              >
                <Repeat2 className="h-3.5 w-3.5" aria-hidden />
                Refill in progress
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </li>
  )
}

// ============================== PRESCRIPTION FILE DIALOG ==============================

function PrescriptionFileDialog({ rx, onClose }: { rx: PrescriptionDTO; onClose: () => void }) {
  const [detail, setDetail] = useState<(PrescriptionDTO & { fileData: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    prescriptionsApi
      .get(rx.id)
      .then((res) => {
        if (cancelled) return
        setDetail(res)
        setError(null)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(errMessage(err, "We couldn't load this file. Please try again."))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [rx.id])

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
      // Trigger the authenticated file download without navigating away from
      // the prescription workspace or losing the current page state.
      const link = document.createElement("a")
      link.href = `/api/prescriptions/${encodeURIComponent(rx.id)}?download=1`
      link.download = "prescription"
      document.body.appendChild(link)
      link.click()
      link.remove()
      return
    }
    if (!detail?.fileData) return
    let url: string | null = null
    try {
      const base64 = detail.fileData.startsWith("data:")
        ? detail.fileData.split(",")[1] ?? ""
        : detail.fileData
      const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))
      const blob = new Blob([bytes], { type: detail.fileType || "application/octet-stream" })
      url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = detail.fileName || "prescription"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => {
        if (url) URL.revokeObjectURL(url)
      }, 1000)
    } catch {
      toast.error("Couldn't prepare the download.")
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b p-4 pb-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="truncate">{rx.fileName}</span>
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <RxStatusBadge status={rx.status} />
            <span>Uploaded {formatDateTime(rx.createdAt)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-slim flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2
                className="h-6 w-6 animate-spin text-muted-foreground"
                aria-label="Loading file"
              />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : isImage && imageSrc ? (
            <img
              src={imageSrc}
              alt={`Prescription file: ${rx.fileName}`}
              className="mx-auto max-h-[60dvh] rounded-lg border object-contain"
            />
          ) : detail?.fileType === "application/pdf" && imageSrc ? (
            <iframe
              src={imageSrc}
              title={`Prescription PDF: ${rx.fileName}`}
              className="h-[60dvh] w-full rounded-lg border bg-white"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-sm font-medium">{detail?.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  Preview is unavailable for this file type. Download it to view on your device.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 border-t p-4 sm:justify-between">
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            Shared privately with our pharmacist.
          </p>
          <Button size="sm" variant="outline" onClick={download} disabled={loading || !detail}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
