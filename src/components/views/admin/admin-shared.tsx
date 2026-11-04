"use client"

// Shared primitives for the Sphere Pharmacy admin dashboard sections.
// Kept inside views/admin so sections stay self-contained and typed.

import { useEffect, useState, type ReactNode } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertTriangle, ArrowUpRight, RefreshCw } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { ApiError } from "@/lib/api-client"
import { cn } from "@/lib/utils"

// ---------- Section routing contract (used by AdminView shell) ----------

export type AdminSectionKey =
  | "overview"
  | "orders"
  | "dispatch"
  | "services"
  | "service-bookings"
  | "service-analytics"
  | "prescriptions"
  | "medicine-requests"
  | "catalogue"
  | "reviews"
  | "promotions"
  | "staff"
  | "reports"
  | "compliance"
  | "settings"
  | "pos-sync"

export interface SectionProps {
  /** Bump to force the section to refetch its data. */
  refreshKey: number
  /** Bump the shell-level refreshKey (e.g. after a mutation that affects other sections). */
  onRefresh: () => void
  /** Jump to another admin section (role-checked in the shell). */
  onNavigateSection: (section: AdminSectionKey, filters?: Record<string, string>) => void
}

// ---------- Hooks ----------

/** Debounce a fast-changing value (search inputs etc.). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ---------- Errors ----------

/** Human-friendly message from an API failure (backend may not exist yet → 404). */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Your staff session expired — sign in again."
    if (err.status === 403) return "Your role does not allow this action."
    if (err.status === 404) return "This API is not available yet (backend pending)."
    return err.message
  }
  if (err instanceof Error) return err.message
  return "Something went wrong. Please try again."
}

export function SectionError({
  message,
  onRetry,
  compact = false,
}: {
  message: string
  onRetry?: () => void
  compact?: boolean
}) {
  return (
    <Alert variant="destructive" className={compact ? "" : "mb-4"}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Couldn&apos;t load this section</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{message}</span>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

// ---------- KPI card ----------

export function AdminSectionHeader({ title, subtitle, action, className }: {
  title: string
  subtitle?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("admin-section-header", className)}>
      <div><p className="admin-eyebrow">SPHERE WORKSPACE</p><h1>{title}</h1>{subtitle ? <p className="admin-section-description">{subtitle}</p> : null}</div>
      {action ? <div className="admin-section-actions">{action}</div> : null}
    </div>
  )
}

type KpiTone = "default" | "teal" | "amber" | "rose" | "emerald" | "violet"

const kpiToneClasses: Record<KpiTone, string> = {
  default: "bg-muted text-muted-foreground",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = "default",
  onClick,
}: {
  label: string
  value: string | number
  icon?: LucideIcon
  hint?: string
  tone?: KpiTone
  onClick?: () => void
}) {
  const clickable = Boolean(onClick)
  const body = (
    <CardContent className="admin-kpi-content">
      <div className="admin-kpi-heading">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon ? <span className={cn("admin-kpi-icon", kpiToneClasses[tone])}><Icon className="h-[18px] w-[18px]" aria-hidden /></span> : null}
      </div>
      <div className="min-w-0">
        <p className={cn(
          "admin-kpi-value font-semibold tracking-tight tabular-nums leading-tight",
          typeof value === "number" || String(value).length <= 8 ? "text-3xl" : "text-xl sm:text-2xl"
        )}>{value}</p>
        <div className="admin-kpi-bottom">{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : <span className="text-xs text-muted-foreground">Current snapshot</span>}{clickable ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : null}</div>
      </div>
    </CardContent>
  )
  return (
    <Card
      className={cn(
        "admin-kpi border transition-shadow",
        clickable && "cursor-pointer hover:shadow-md focus-visible:shadow-md"
      )}
      data-tone={tone}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || (e.key === " " && !e.repeat)) {
          e.preventDefault()
          onClick?.()
        }
      } : undefined}
      aria-label={clickable ? `${label}: ${value}${hint ? ` — ${hint}` : ""}` : undefined}
    >
      {body}
    </Card>
  )
}

// ---------- Loading skeletons ----------

export function KpiSkeletonGrid({ count = 7 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-24" />
            <Skeleton className="mt-1.5 h-3 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- CSV download (client-side Blob) ----------

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell === null || cell === undefined ? "" : String(cell)
          return `"${s.replace(/"/g, '""')}"`
        })
        .join(",")
    )
    .join("\r\n")
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Build a wa.me deep link from a Kenyan phone number with a prefilled message. */
export function waHref(phone: string | null | undefined, text?: string): string | null {
  if (!phone) return null
  const digits = phone.replace(/[^\d]/g, "")
  const normalized = digits.startsWith("254")
    ? digits
    : digits.startsWith("0")
      ? `254${digits.slice(1)}`
      : digits.length > 0
        ? `254${digits}`
        : ""
  if (!normalized) return null
  return `https://wa.me/${normalized}${text ? `?text=${encodeURIComponent(text)}` : ""}`
}

export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null
  return `tel:${phone.replace(/\s+/g, "")}`
}

// ---------- Chart colours (theme CSS vars — work in recharts fill/stroke) ----------

export const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]
