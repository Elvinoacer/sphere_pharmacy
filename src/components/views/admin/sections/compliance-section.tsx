"use client"

// Staff compliance register: an internal record is not a PPB verification or public licence claim.
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { adminApi, settingsApi } from "@/lib/api-client"
import type { AuditLogDTO, ComplianceInfo } from "@/lib/types"
import { formatDate, formatDateTime, timeAgo } from "@/lib/format"
import { useAuthStore } from "@/store/use-auth-store"
import { toast } from "sonner"
import { AdminSectionHeader, apiErrorMessage, SectionError, type SectionProps } from "../admin-shared"
import { AlertTriangle, ArrowRight, CalendarClock, Check, CheckCircle2, ClipboardCheck, FileText, Info, Loader2, LockKeyhole, RefreshCw, RotateCcw, Save, ShieldAlert, ShieldCheck, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"

const EMPTY_COMPLIANCE: ComplianceInfo = {
  premiseLicenceNumber: "",
  premiseLicenceExpiry: "",
  superintendentName: "",
  superintendentReg: "",
  notes: "",
}

type RequiredField = Exclude<keyof ComplianceInfo, "notes">
const REQUIRED_FIELDS: { key: RequiredField; label: string; id: string }[] = [
  { key: "premiseLicenceNumber", label: "Current premises licence number", id: "compliance-licence" },
  { key: "premiseLicenceExpiry", label: "Licence expiry date", id: "compliance-expiry" },
  { key: "superintendentName", label: "Superintendent pharmacist name", id: "compliance-name" },
  { key: "superintendentReg", label: "Superintendent PPB registration", id: "compliance-registration" },
]

function dateInputValue(raw: string): string {
  if (!raw) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10)
}

function daysUntil(raw: string): number | null {
  const date = dateInputValue(raw)
  if (!date) return null
  const parsed = new Date(date + "T00:00:00Z")
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null
  const today = new Date().toISOString().slice(0, 10)
  return Math.round((parsed.getTime() - new Date(today + "T00:00:00Z").getTime()) / 86_400_000)
}

function normalize(info: ComplianceInfo): ComplianceInfo {
  return {
    premiseLicenceNumber: info.premiseLicenceNumber?.trim() ?? "",
    premiseLicenceExpiry: dateInputValue(info.premiseLicenceExpiry ?? ""),
    superintendentName: info.superintendentName?.trim() ?? "",
    superintendentReg: info.superintendentReg?.trim() ?? "",
    notes: info.notes?.trim() ?? "",
  }
}

function focusField(id: string) {
  const field = document.getElementById(id)
  field?.scrollIntoView({ behavior: "smooth", block: "center" })
  field?.focus({ preventScroll: true })
}

export function ComplianceSection({ refreshKey, onRefresh }: SectionProps) {
  const role = useAuthStore((s) => s.session?.role)
  const isAdmin = role === "ADMIN"
  const [saved, setSaved] = useState<ComplianceInfo | null>(null)
  const [form, setForm] = useState<ComplianceInfo>(EMPTY_COMPLIANCE)
  const [audit, setAudit] = useState<AuditLogDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auditError, setAuditError] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [savedRecently, setSavedRecently] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const settings = await settingsApi.get()
      const record = normalize(settings.compliance ?? EMPTY_COMPLIANCE)
      setSaved(record)
      setForm(record)
      if (isAdmin) {
        try {
          setAudit(await adminApi.audit())
          setAuditError(false)
        } catch {
          setAudit([])
          setAuditError(true)
        }
      }
    } catch (err) {
      setSaved(null)
      setError(apiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  useEffect(() => { void load() }, [load, refreshKey])

  const record = saved ?? EMPTY_COMPLIANCE
  const expiryDays = daysUntil(record.premiseLicenceExpiry)
  const formExpiryDays = daysUntil(form.premiseLicenceExpiry)
  const completed = REQUIRED_FIELDS.filter((f) => f.key === "premiseLicenceExpiry"
    ? formExpiryDays !== null && formExpiryDays >= 0
    : Boolean(form[f.key].trim()))
  const completedCount = completed.length
  const recordComplete = REQUIRED_FIELDS.every((f) => f.key === "premiseLicenceExpiry"
    ? expiryDays !== null && expiryDays >= 0
    : Boolean(record[f.key].trim()))
  const hasAnyRecord = REQUIRED_FIELDS.some((f) => Boolean(record[f.key]))
  const dirty = JSON.stringify(normalize(form)) !== JSON.stringify(record)
  const expired = expiryDays !== null && expiryDays < 0
  const renewalSoon = expiryDays !== null && expiryDays >= 0 && expiryDays <= 30

  const title = !record.premiseLicenceNumber ? "Premises licence not yet recorded"
    : expired ? "Recorded licence has expired"
    : !recordComplete ? "Compliance record needs attention"
    : "Record complete — independent verification pending"
  const description = !record.premiseLicenceNumber
    ? "Enter the details from the current PPB documentation. Do not use the older 2024 record as a current licence."
    : expired ? "Request the renewed licence before treating this record as current."
    : !recordComplete ? "Some required fields are missing or invalid. Follow the checklist to complete the record."
    : "The fields are recorded internally. The current licence and superintendent registration still require independent confirmation."

  const complianceAudit = useMemo(() => audit.filter((entry) =>
    entry.action === "COMPLIANCE_UPDATED" ||
    (entry.entity?.toLowerCase() === "setting" && entry.entityId?.toLowerCase() === "compliance") ||
    entry.entity?.toLowerCase().includes("licence")
  ).slice(0, 6), [audit])

  function updateField(key: keyof ComplianceInfo, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
    setSavedRecently(false)
  }

  async function save() {
    if (!isAdmin || !dirty || saving) return
    const value = normalize(form)
    if (value.premiseLicenceExpiry && daysUntil(value.premiseLicenceExpiry) === null) {
      toast.error("Enter a valid calendar date for the licence expiry.")
      focusField("compliance-expiry")
      return
    }
    setSaving(true)
    try {
      await settingsApi.update({ compliance: value })
      toast.success("Internal compliance record saved; no public licence claim was published.")
      setSavedRecently(true)
      await load()
      onRefresh()
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="space-y-4" aria-label="Loading compliance record">
      <Skeleton className="h-20 rounded-xl" />
      <Skeleton className="h-28 rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-[32rem] rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>
    </div>
  }
  if (error || !saved) return <SectionError message={error ?? "Compliance settings unavailable."} onRetry={() => void load()} />

  return (
    <div className="space-y-4">
      <AdminSectionHeader
        title="Compliance workspace"
        subtitle="Maintain the PPB premises licence, superintendent record, renewal details and internal history."
        action={<div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={saving || dirty} title={dirty ? "Save or discard edits before refreshing" : undefined} onClick={() => void load()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          {isAdmin ? <Button type="button" size="sm" className="gap-2" onClick={() => focusField("compliance-licence")}><FileText className="h-4 w-4" /> Edit record</Button> : null}
        </div>}
      />

      <section className={cn("flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start sm:gap-4", expired
        ? "border-rose-300 bg-rose-50/70 dark:border-rose-800 dark:bg-rose-950/20"
        : "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20")} role="status">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", expired
          ? "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300")}>
          {expired ? <AlertTriangle className="h-5 w-5" /> : recordComplete ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground sm:text-base">{title}</h2>
            <Badge variant="outline" className="border-amber-300 bg-background text-amber-800 dark:border-amber-800 dark:text-amber-200">Not independently verified</Badge>
          </div>
          <p className="text-sm leading-relaxed text-foreground/80">{description}</p>
          <p className="text-xs font-medium text-muted-foreground">Public licence claim: withheld. Saving information is not PPB verification or approval to publish.</p>
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,1fr)]">
        <Card className="min-w-0 gap-0 overflow-hidden py-0">
          <CardHeader className="space-y-1 border-b px-4 py-4 sm:px-5">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Compliance record</span>
              {isAdmin ? <Badge variant="secondary">Admin edit</Badge> : <Badge variant="outline"><LockKeyhole className="mr-1 h-3 w-3" /> Read only</Badge>}
            </CardTitle>
            <p className="text-xs leading-relaxed text-muted-foreground">Enter only accurate information. Incomplete details can be saved as an internal draft.</p>
          </CardHeader>
          <CardContent className="space-y-5 p-4 sm:p-5">
            <section aria-labelledby="compliance-premises-heading" className="space-y-3">
              <div>
                <h3 id="compliance-premises-heading" className="flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-primary" /> 1. Premises licence</h3>
                <p className="mt-1 text-xs text-muted-foreground">Record the licence number and expiry printed on the current PPB document.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="compliance-licence">Licence number</Label>
                  <Input id="compliance-licence" autoComplete="off" maxLength={160} disabled={!isAdmin || saving} value={form.premiseLicenceNumber} onChange={(e) => updateField("premiseLicenceNumber", e.target.value)} placeholder="Current licence number" className="min-w-0 font-mono text-sm" />
                  <p className="text-[11px] text-muted-foreground">Do not enter the outdated 2024 licence as current.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="compliance-expiry">Valid until</Label>
                  <Input id="compliance-expiry" type="date" disabled={!isAdmin || saving} value={form.premiseLicenceExpiry} onChange={(e) => updateField("premiseLicenceExpiry", e.target.value)} className="min-w-0" />
                  <p className={cn("text-[11px]", formExpiryDays !== null && formExpiryDays < 0 ? "font-medium text-rose-700 dark:text-rose-300" : formExpiryDays !== null && formExpiryDays <= 30 ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                    {formExpiryDays === null ? "Use the expiry date shown on the licence." : formExpiryDays < 0 ? "Expired " + Math.abs(formExpiryDays) + " days ago" : formExpiryDays === 0 ? "Expires today" : formExpiryDays + " days until expiry"}
                  </p>
                </div>
              </div>
            </section>
            <Separator />
            <section aria-labelledby="compliance-super-heading" className="space-y-3">
              <div>
                <h3 id="compliance-super-heading" className="flex items-center gap-2 text-sm font-semibold"><UserRound className="h-4 w-4 text-primary" /> 2. Superintendent pharmacist</h3>
                <p className="mt-1 text-xs text-muted-foreground">Check the responsible pharmacist's registration against current PPB records.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="compliance-name">Registered full name</Label>
                  <Input id="compliance-name" maxLength={160} disabled={!isAdmin || saving} value={form.superintendentName} onChange={(e) => updateField("superintendentName", e.target.value)} placeholder="Name as registered with PPB" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="compliance-registration">PPB registration number</Label>
                  <Input id="compliance-registration" maxLength={160} disabled={!isAdmin || saving} value={form.superintendentReg} onChange={(e) => updateField("superintendentReg", e.target.value)} placeholder="Professional registration number" className="min-w-0 font-mono text-sm" />
                </div>
              </div>
            </section>
            <Separator />
            <section aria-labelledby="compliance-notes-heading" className="space-y-2">
              <div>
                <h3 id="compliance-notes-heading" className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="h-4 w-4 text-primary" /> 3. Internal follow-up notes</h3>
                <p className="mt-1 text-xs text-muted-foreground">Record where the document came from, verification questions and renewal follow-up. Do not include passwords or patient information.</p>
              </div>
              <Textarea id="compliance-notes" rows={3} maxLength={1000} disabled={!isAdmin || saving} value={form.notes} onChange={(e) => updateField("notes", e.target.value)} placeholder="e.g. Awaiting the renewed PPB licence copy from the proprietor; confirm pharmacist registration before verification." />
              <p className="text-right text-[11px] tabular-nums text-muted-foreground">{form.notes.length}/1000</p>
            </section>
          </CardContent>
          {isAdmin ? (
            <div className="flex flex-col gap-3 border-t bg-muted/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="space-y-0.5">
                <p className={cn("text-xs font-semibold", dirty ? "text-amber-800 dark:text-amber-300" : "text-foreground")}>{dirty ? "Unsaved changes" : savedRecently ? "Saved successfully" : "All changes saved"}</p>
                <p className="text-[11px] text-muted-foreground">Changes are audit-logged and remain internal.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" type="button" variant="outline" disabled={!dirty || saving} className="gap-1.5" onClick={() => setDiscardOpen(true)}><RotateCcw className="h-3.5 w-3.5" /> Discard</Button>
                <Button size="sm" type="button" disabled={!dirty || saving} className="gap-1.5" onClick={() => void save()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save internal record</Button>
              </div>
            </div>
          ) : <p className="border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground sm:px-5">View only — an administrator must maintain or correct these details.</p>}
        </Card>

        <div className="min-w-0 space-y-4">
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="space-y-1 border-b px-4 py-4 sm:px-5">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                <span className="inline-flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-primary" /> Record checklist</span>
                <Badge variant={completedCount === 4 ? "secondary" : "outline"}>{completedCount} of 4</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">Checks the visible editor values{dirty ? " (including unsaved edits)" : ""}.</p>
            </CardHeader>
            <CardContent className="space-y-3 p-4 sm:p-5">
              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label={completedCount + " of 4 required fields complete"}>
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: completedCount * 25 + "%" }} />
              </div>
              <ul className="space-y-1">
                {REQUIRED_FIELDS.map((field) => {
                  const done = completed.some((item) => item.key === field.key)
                  return <li key={field.key}>
                    {isAdmin ? (
                      <button type="button" onClick={() => focusField(field.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", done ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "border-border text-muted-foreground")}>
                          {done ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                        </span>
                        <span className="min-w-0 flex-1">{field.label}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    ) : <div className="flex items-center gap-2 px-2 py-2 text-xs">{done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <span className="h-5 w-5 shrink-0 rounded-full border" />}{field.label}</div>}
                  </li>
                })}
              </ul>
              <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground"><Info className="mr-1 inline h-3.5 w-3.5 align-[-2px]" /> Complete fields do <strong>not</strong> establish PPB verification or authorise publication.</p>
            </CardContent>
          </Card>

          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b px-4 py-4 sm:px-5">
              <CardTitle className="flex items-center gap-2 text-sm"><CalendarClock className="h-4 w-4 text-primary" /> Saved record snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 text-xs sm:p-5">
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Premises licence</span><span className="min-w-0 max-w-[65%] break-all text-right font-semibold">{record.premiseLicenceNumber || "Not recorded"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Expiry</span><span className="text-right font-semibold">{record.premiseLicenceExpiry ? formatDate(record.premiseLicenceExpiry) : "Not recorded"}</span></div>
              {renewalSoon && !expired ? <p className="rounded-md bg-amber-50 px-2.5 py-2 font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{expiryDays === 0 ? "Renewal due today" : "Renewal due in " + expiryDays + " days"}</p> : null}
              {expired ? <p className="rounded-md bg-rose-50 px-2.5 py-2 font-medium text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">Expired — request a renewed licence</p> : null}
              <Separator />
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Superintendent</span><span className="min-w-0 max-w-[65%] break-words text-right font-semibold">{record.superintendentName || "Not recorded"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">PPB registration</span><span className="min-w-0 max-w-[65%] break-all text-right font-mono font-semibold">{record.superintendentReg || "Not recorded"}</span></div>
              {!hasAnyRecord ? <p className="text-muted-foreground">No current record has been saved.</p> : null}
            </CardContent>
          </Card>

          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b px-4 py-4 sm:px-5">
              <CardTitle className="flex items-center gap-2 text-sm"><FileText className="h-4 w-4 text-primary" /> Recent compliance changes</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              {!isAdmin ? <p className="text-xs text-muted-foreground">Audit history is restricted to administrators.</p> : auditError ? (
                <p className="text-xs text-amber-800 dark:text-amber-300">Could not load audit history. Refresh to retry.</p>
              ) : complianceAudit.length === 0 ? <p className="text-xs leading-relaxed text-muted-foreground">No compliance edits yet. Saved changes appear here with the actor and timestamp.</p> : (
                <ul className="divide-y">
                  {complianceAudit.map((entry) => <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-xs font-semibold">{entry.actor}<span className="font-normal text-muted-foreground"> · {entry.action.replaceAll("_", " ").toLowerCase()}</span></p>
                    {entry.details ? <p className="mt-1 break-words text-xs text-muted-foreground">{entry.details}</p> : null}
                    <p className="mt-1 text-[11px] text-muted-foreground" title={formatDateTime(entry.createdAt)}>{timeAgo(entry.createdAt)}</p>
                  </li>)}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved compliance changes?</AlertDialogTitle>
            <AlertDialogDescription>Your edits will be lost and the form will return to its last saved state. No changes will be published.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => setForm(record)}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
