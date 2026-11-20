"use client"

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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/shared/empty-state"
import { RefillRequestDialog } from "@/components/shared/refill-request-dialog"
import { OrderStatusBadge, PaymentStatusBadge, RxFlagBadge, RxStatusBadge } from "@/components/shared/status-badges"
import { useAppStore } from "@/store/use-app-store"
import { useAuthStore } from "@/store/use-auth-store"
import { useCartStore } from "@/store/use-cart-store"
import {
  ApiError,
  ordersApi,
  paymentsApi,
  prescriptionsApi,
} from "@/lib/api-client"
import { evaluateRefillEligibility } from "@/lib/prescriptions/refill-core"
import { ORDER_TYPE_LABELS, LOYALTY, PAYMENT_METHOD_LABELS, waLink, type OrderStatus } from "@/lib/constants"
import { formatDate, formatDateTime, formatKES, shortRef, statusLabel } from "@/lib/format"
import type { OrderDTO, PrescriptionDTO } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  ArrowLeft,
  Banknote,
  Bike,
  CheckCircle2,
  CreditCard,
  Download,
  FileSearch,
  FileText,
  Inbox,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  PackageCheck,
  PackageSearch,
  Pill,
  RefreshCw,
  Repeat2,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  Trash2,
  Truck,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react"

// ---------- local helpers ----------

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "")
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`
  if (/^254[17]\d{8}$/.test(digits)) return digits
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`
  return null
}

// ---------- status timeline icons ----------

const TIMELINE_ICONS: Record<OrderStatus, LucideIcon> = {
  RECEIVED: Inbox,
  UNDER_REVIEW: FileSearch,
  PRESCRIPTION_VERIFIED: ShieldCheck,
  AVAILABILITY_CONFIRMED: PackageCheck,
  AWAITING_PAYMENT: Wallet,
  PAID: CreditCard,
  PREPARING: Pill,
  READY_FOR_PICKUP: Store,
  OUT_FOR_DELIVERY: Truck,
  COMPLETED_PICKUP: CheckCircle2,
  COMPLETED_DELIVERY: CheckCircle2,
  REJECTED: XCircle,
  CANCELLED: XCircle,
  REFUNDED: RotateCcw,
}

const PAYMENT_PROVIDER_ICONS: Record<string, LucideIcon> = {
  MPESA: Smartphone,
  INTASEND: CreditCard,
  CASH: Banknote,
}

const CANCELLABLE_STATUSES: OrderStatus[] = [
  "RECEIVED",
  "UNDER_REVIEW",
  "PRESCRIPTION_VERIFIED",
  "AVAILABILITY_CONFIRMED",
  "AWAITING_PAYMENT",
]

const TERMINAL_SET = new Set<OrderStatus>([
  "COMPLETED_PICKUP",
  "COMPLETED_DELIVERY",
  "REJECTED",
  "CANCELLED",
  "REFUNDED",
])

const REJECTED_SET = new Set<OrderStatus>(["REJECTED", "CANCELLED", "REFUNDED"])

type LoadResult =
  | { id: string; order: OrderDTO }
  | { id: string; notFound: true }
  | { id: string; error: string; authError?: "signin" | "wrong-account" }

// ============================== VIEW ==============================

export function OrderDetailView() {
  const orderId = useAppStore((s) => s.params.orderId ?? s.selectedOrderId)
  const goBack = useAppStore((s) => s.goBack)
  const navigate = useAppStore((s) => s.navigate)
  const openAuth = useAppStore((s) => s.openAuth)
  const session = useAuthStore((s) => s.session)
  const user = session?.user ?? null
  const addToCart = useCartStore((s) => s.add)

  // ---------- order load ----------
  const [result, setResult] = useState<LoadResult | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    const accessToken = sessionStorage.getItem(`sphere_order_access_${orderId}`) ?? undefined
    ordersApi
      .get(orderId, accessToken)
      .then((res) => {
        if (!cancelled) setResult({ id: orderId, order: res })
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) setResult({ id: orderId, notFound: true })
        else if (err instanceof ApiError && err.status === 403)
          setResult({ id: orderId, error: "__WRONG_ACCOUNT__", authError: "wrong-account" })
        else if (err instanceof ApiError && err.status === 401)
          setResult({ id: orderId, error: "__AUTH__", authError: "signin" })
        else setResult({ id: orderId, error: errMessage(err, "We couldn't load this order.") })
      })
    return () => {
      cancelled = true
    }
  }, [orderId, refreshKey])

  const current = result && result.id === orderId ? result : null
  const order = current && "order" in current ? current.order : null
  const loading = orderId != null && current === null
  const needsAuth = current != null && "error" in current && current.error === "__AUTH__"
  const wrongAccount = current != null && "error" in current && current.error === "__WRONG_ACCOUNT__"
  const loadError =
    current != null && "error" in current && current.error !== "__AUTH__" && current.error !== "__WRONG_ACCOUNT__"
      ? current.error
      : null
  const notFound = current != null && "notFound" in current

  async function refetchOrder() {
    if (!orderId) return
    try {
      const res = await ordersApi.get(orderId, sessionStorage.getItem(`sphere_order_access_${orderId}`) ?? undefined)
      setResult({ id: orderId, order: res })
    } catch {
      /* keep the current view; the refresh button re-triggers the effect */
    }
  }

  // ---------- payment panel ----------

  const [payMethod, setPayMethod] = useState<"mpesa" | "card">("mpesa")
  const [mpesaPhoneInput, setMpesaPhoneInput] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [cardError, setCardError] = useState<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [])

  const mpesaPhone = mpesaPhoneInput ?? (user?.phone ?? "")

  // ---------- dialogs / actions ----------

  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelling, setCancelling] = useState(false)
  const [reorderOpen, setReorderOpen] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [rxViewId, setRxViewId] = useState<string | null>(null)
  const [refillTarget, setRefillTarget] = useState<PrescriptionDTO | null>(null)

  // ---------- derived ----------

  const history = useMemo(() => {
    if (!order) return []
    return [...order.statusHistory].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [order])

  const isTerminal = order ? TERMINAL_SET.has(order.status) : false
  const awaitingPayment = order?.status === "AWAITING_PAYMENT"
  const canCancel = order ? CANCELLABLE_STATUSES.includes(order.status) : false
  const canReorder =
    order?.status === "COMPLETED_PICKUP" || order?.status === "COMPLETED_DELIVERY"
  const isCashOrder = order
    ? order.paymentMethod === "CASH_ON_DELIVERY" ||
      order.paymentMethod === "CASH_ON_PICKUP" ||
      order.payments.some((p) => p.provider === "CASH")
    : false

  // ---------- payment handlers ----------

  async function startMpesa() {
    if (!order) return
    setPayError(null)
    const phone = normalizePhone(mpesaPhone)
    if (!phone) {
      setPayError("Enter a valid Safaricom number, e.g. 0712 345 678.")
      return
    }
    setPaying(true)
    try {
      const accessToken = sessionStorage.getItem(`sphere_order_access_${order.id}`) ?? undefined
      const init = await paymentsApi.mpesaInitiate(order.id, phone, crypto.randomUUID(), accessToken)
      toast.info("STK push sent. Enter your PIN only on your phone.")
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
      const deadline = Date.now() + 2 * 60_000
      let delay = 2_500
      const poll = async () => {
        if (Date.now() >= deadline) {
          setPayError("Confirmation is taking longer than expected. Check your M-Pesa messages before retrying.")
          return
        }
        if (document.hidden) {
          pollTimerRef.current = setTimeout(poll, delay)
          return
        }
        try {
          const res = await paymentsApi.mpesaQuery(init.checkoutRequestId, accessToken)
          if (res.status === "SUCCESS") {
            toast.success("M-Pesa payment confirmed — thank you!")
            await refetchOrder()
            return
          } else if (res.status === "FAILED") {
            setPayError(res.payment?.failureReason || "M-Pesa payment was declined or timed out.")
            return
          }
        } catch {
          // ignore transient poll error
        }
        delay = Math.min(10_000, Math.round(delay * 1.5))
        pollTimerRef.current = setTimeout(poll, delay)
      }
      pollTimerRef.current = setTimeout(poll, delay)
    } catch (err) {
      const msg = errMessage(err, "Couldn't start the M-Pesa payment. Please try again.")
      setPayError(msg)
    } finally {
      setPaying(false)
    }
  }

  async function startCard() {
    if (!order) return
    setPaying(true)
    setCardError(null)
    try {
      const accessToken = sessionStorage.getItem(`sphere_order_access_${order.id}`) ?? undefined
      const res = await paymentsApi.cardCheckoutSession(order.id, crypto.randomUUID(), accessToken)
      window.location.assign(res.checkoutUrl)
    } catch (err) {
      setCardError(errMessage(err, "Card payment failed. Please try again."))
    } finally {
      setPaying(false)
    }
  }

  // ---------- cancel / reorder ----------

  async function confirmCancel() {
    if (!order) return
    setCancelling(true)
    try {
      await ordersApi.cancel(order.id, cancelReason.trim() || undefined, sessionStorage.getItem(`sphere_order_access_${order.id}`) ?? undefined)
      setCancelOpen(false)
      setCancelReason("")
      toast.success("Order cancelled. A refund is issued automatically if you had already paid.")
      await refetchOrder()
    } catch (err) {
      toast.error(errMessage(err, "Couldn't cancel this order. Please try again."))
    } finally {
      setCancelling(false)
    }
  }

  function confirmReorder() {
    if (!order) return
    setReordering(true)
    try {
      let unavailable = 0
      for (const item of order.items) {
        if (item.productId) {
          addToCart(
            {
              productId: item.productId,
              name: item.name,
              price: item.price,
              image: null,
              requiresPrescription: item.requiresPrescription,
              packSize: null,
              stockStatus: "IN_STOCK",
            },
            item.qty
          )
        } else {
          unavailable += 1
        }
      }
      if (unavailable > 0) {
        toast.info(
          `${unavailable} item${unavailable === 1 ? "" : "s"} no longer available and couldn't be added.`
        )
      }
      toast.success(`${order.items.length - unavailable} item(s) added to your cart`)
      setReorderOpen(false)
      navigate("cart")
    } finally {
      setReordering(false)
    }
  }

  // ---------- prescriptions ----------

  const rxToView = order?.prescriptions.find((rx) => rx.id === rxViewId) ?? null

  // ============================== GUARDS ==============================

  if (orderId == null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <EmptyState
          icon={PackageSearch}
          title="No order selected"
          description="Pick an order from your history to track it here."
          action={{ label: "My orders", onClick: goBack }}
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <div className="flex justify-center">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your order…
          </p>
        </div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <EmptyState
          icon={PackageSearch}
          title="Order not found"
          description="This order may have been removed, or the reference doesn't match an order on your account."
          action={{ label: "Back", onClick: goBack }}
        />
      </div>
    )
  }

  if (needsAuth || wrongAccount) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        {wrongAccount ? (
          <EmptyState
            icon={Lock}
            title="This order belongs to a different account"
            description="You're signed in, but this order was placed as a guest or from another account. Check your orders list, or contact us with the reference and we'll help right away."
            action={{ label: "My orders", onClick: () => navigate("orders") }}
          />
        ) : (
          <EmptyState
            icon={Lock}
            title="Sign in to view this order"
            description="Order details are private. Sign in with the account you used to place the order."
            action={{
              label: "Sign in",
              onClick: () => openAuth("login", "order", "Sign in to view your order details.", { orderId }),
            }}
          />
        )}
      </div>
    )
  }

  if (loadError || !order) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {loadError ?? "We couldn't load this order."}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRefreshKey((k) => k + 1)}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Try again
              </Button>
              <Button variant="ghost" onClick={goBack}>
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ============================== MAIN ==============================

  return (
    <div className="app-page app-page-order mx-auto max-w-3xl space-y-4 px-4 py-6 pb-16">

      {/* ---------- header ---------- */}
      <div>
        <Button variant="ghost" size="sm" onClick={goBack} className="mb-3 -ml-2 h-8">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-2xl font-bold tracking-tight">{order.reference}</h1>
          <OrderStatusBadge status={order.status} />
          <Badge variant="secondary">{ORDER_TYPE_LABELS[order.type]}</Badge>
          {order.isRefill ? (
            <Badge variant="outline" className="gap-1 border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
              <Repeat2 className="h-3 w-3" aria-hidden />
              Refill
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Placed {formatDateTime(order.createdAt)}
          {order.refillOfOrderReference ? (
            <>
              {" · Refill of "}
              {order.refillOfOrderId ? (
                <button
                  type="button"
                  className="font-mono font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => navigate("order", { orderId: order.refillOfOrderId! })}
                >
                  #{shortRef(order.refillOfOrderReference)}
                </button>
              ) : (
                <span className="font-mono">#{shortRef(order.refillOfOrderReference)}</span>
              )}
            </>
          ) : null}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() =>
            window.open(waLink(`Hello, I'd like to ask about order ${order.reference}.`), "_blank")
          }
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          Ask about this order
        </Button>
      </div>

      {/* ---------- pickup code / delivery address ---------- */}
      {order.fulfillment === "PICKUP" && order.pickupCode ? (
        <Card className="border-teal-200 bg-teal-50/50 dark:border-teal-800/60 dark:bg-teal-950/20">
          <CardContent className="flex items-center gap-4 p-4 sm:p-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Store className="h-6 w-6 text-primary" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-muted-foreground">Pickup code</p>
              <p className="font-mono text-3xl font-bold tracking-widest">{order.pickupCode}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Show this code at the counter when collecting your order.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {order.fulfillment === "DELIVERY" ? (
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Truck className="h-5 w-5 text-primary" aria-hidden />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold">Delivery address</p>
                <p className="text-sm">{order.deliveryAddress ?? "Address on file"}</p>
                {order.deliveryArea ? (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {order.deliveryArea}
                  </p>
                ) : null}
                {order.deliveryNotes ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Rider notes:</span> {order.deliveryNotes}
                  </p>
                ) : null}
                {order.riderName ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Bike className="h-3.5 w-3.5 text-primary" aria-hidden />
                    Delivery rider: <span className="font-medium text-foreground">{order.riderName}</span>
                  </p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------- status timeline ---------- */}
      {history.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <PackageCheck className="h-4 w-4 text-primary" aria-hidden />
              Order progress
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <ol className="space-y-0">
              {history.map((ev, idx) => {
                const Icon = TIMELINE_ICONS[ev.status] ?? Inbox
                const isLast = idx === history.length - 1
                const isCurrent = isLast && !isTerminal
                const failed = REJECTED_SET.has(ev.status)
                const done = TERMINAL_SET.has(ev.status) || idx < history.length - 1
                return (
                  <li key={ev.id} className="relative flex gap-4 pb-6 last:pb-0">
                    {isLast ? null : (
                      <span
                        className="absolute left-[15px] top-8 bottom-0 w-px bg-border"
                        aria-hidden
                      />
                    )}
                    <span
                      className={cn(
                        "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                        isCurrent
                          ? "border-primary bg-primary text-primary-foreground"
                          : failed
                            ? "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                            : done
                              ? "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : "border-border bg-muted text-muted-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                      {isCurrent ? (
                        <span className="pulse-dot absolute inset-0 rounded-full text-primary" aria-hidden />
                      ) : null}
                    </span>
                    <div className="min-w-0 pt-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {statusLabel(ev.status)}
                        {isCurrent ? (
                          <span className="text-xs font-normal text-primary">current</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(ev.createdAt)}</p>
                      {ev.note ? (
                        <p className="mt-1 text-sm text-muted-foreground">{ev.note}</p>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------- actions / payment ---------- */}
      {!isTerminal ? (
        <section aria-label="Order actions">
          {awaitingPayment ? (
            <Card className="border-amber-300 dark:border-amber-800/60">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wallet className="h-4 w-4 text-primary" aria-hidden />
                  Complete payment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <p className="text-sm text-muted-foreground">
                  Your order is confirmed and waiting on payment of{" "}
                  <span className="font-semibold text-foreground">{formatKES(order.total)}</span>.
                </p>

                {isCashOrder ? (
                  <Alert>
                    <Banknote className="h-4 w-4" aria-hidden />
                    <AlertTitle>Paying in cash</AlertTitle>
                    <AlertDescription>
                      Pay {formatKES(order.total)} on{" "}
                      {order.fulfillment === "PICKUP" ? "pickup at the counter" : "delivery to the rider"}
                      . You can still pay now to speed things up.
                    </AlertDescription>
                  </Alert>
                ) : null}

                <Tabs value={payMethod} onValueChange={(v) => setPayMethod(v as "mpesa" | "card")}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="mpesa">
                      <Smartphone className="h-4 w-4" aria-hidden /> M-Pesa
                    </TabsTrigger>
                    <TabsTrigger value="card">
                      <CreditCard className="h-4 w-4" aria-hidden /> Card
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {payMethod === "mpesa" ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="mpesa-phone">M-Pesa phone number</Label>
                      <Input
                        id="mpesa-phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="0712 345 678"
                        value={mpesaPhone}
                        onChange={(e) => setMpesaPhoneInput(e.target.value)}
                        aria-describedby="mpesa-phone-hint"
                      />
                      <p id="mpesa-phone-hint" className="text-xs text-muted-foreground">
                        We'll send an STK push to this number — approve it with your M-Pesa PIN.
                      </p>
                    </div>
                    {payError ? (
                      <p className="text-sm text-destructive" role="alert">
                        {payError}
                      </p>
                    ) : null}
                    <Button onClick={() => void startMpesa()} disabled={paying} className="w-full">
                      {paying ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Smartphone className="h-4 w-4" aria-hidden />
                      )}
                      Send M-Pesa request
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      Card details are entered only on IntaSend&apos;s secure hosted checkout. Sphere Pharmacy never receives your card number or CVV.
                    </p>
                    {cardError ? (
                      <p className="text-sm text-destructive" role="alert">
                        {cardError}
                      </p>
                    ) : null}
                    <Button onClick={() => void startCard()} disabled={paying} className="w-full">
                      {paying ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Lock className="h-4 w-4" aria-hidden />
                      )}
                      Continue to IntaSend · {formatKES(order.total)}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {canCancel ? (
            <Button
              variant="outline"
              className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setCancelOpen(true)}
            >
              <XCircle className="h-4 w-4" aria-hidden />
              Cancel order
            </Button>
          ) : null}
        </section>
      ) : canReorder ? (
        <Button onClick={() => setReorderOpen(true)} className="w-full">
          <Repeat2 className="h-4 w-4" aria-hidden />
          Reorder these items
        </Button>
      ) : null}

      {/* ---------- items ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Items
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({order.items.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y pt-0">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Pill className="h-4 w-4 text-muted-foreground" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">{item.name}</p>
                {item.requiresPrescription ? <RxFlagBadge className="mt-1" compact /> : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.qty} × {formatKES(item.price)}
                </p>
              </div>
              <p className="text-sm font-semibold tabular-nums">{formatKES(item.lineTotal)}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ---------- prescriptions attached ---------- */}
      {order.prescriptions.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prescriptions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {order.prescriptions.map((rx) => {
              const eligibility = evaluateRefillEligibility(rx)
              const hasActiveOtherRefill =
                eligibility.blockedReason === "active_refill" &&
                eligibility.activeRefillOrderId &&
                eligibility.activeRefillOrderId !== order.id
              return (
                <div
                  key={rx.id}
                  className="rounded-lg border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{rx.fileName}</p>
                    {eligibility.isRefill ? (
                      <Badge variant="outline" className="gap-1 border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
                        <Repeat2 className="h-3 w-3" aria-hidden />
                        {rx.refillNumber
                          ? eligibility.refillsAllowed > 0
                            ? `Refill #${rx.refillNumber} of ${eligibility.refillsAllowed}`
                            : `Refill #${rx.refillNumber}`
                          : "Refill"}
                      </Badge>
                    ) : null}
                    <RxStatusBadge status={rx.status} />
                  </div>

                  {rx.reviewNotes ? (
                    <blockquote className="mt-2 border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
                      “{rx.reviewNotes}”
                      {rx.reviewedByName ? (
                        <footer className="mt-1 text-xs">
                          — {rx.reviewedByName}
                          {rx.reviewedAt ? `, ${formatDate(rx.reviewedAt)}` : ""}
                        </footer>
                      ) : null}
                    </blockquote>
                  ) : null}

                  {eligibility.refillsAllowed > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Refills: {eligibility.refillsUsed} of {eligibility.refillsAllowed} used
                      {eligibility.validUntil ? (
                        <span className={cn(eligibility.expired && "font-medium text-rose-600 dark:text-rose-400")}>
                          {" · "}
                          {eligibility.expired ? "Expired" : "Valid until"} {formatDate(eligibility.validUntil)}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {rx.refillReleasedAt ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      This refill slot was returned to your original prescription.
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRxViewId(rx.id)}
                      aria-label={`View ${rx.fileName}`}
                    >
                      <FileSearch className="h-3.5 w-3.5" aria-hidden />
                      View
                    </Button>
                    {eligibility.canRequest ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRefillTarget(rx)}
                      >
                        <Repeat2 className="h-3.5 w-3.5" aria-hidden />
                        {eligibility.isRefill ? `Request next refill (${eligibility.remaining} left)` : "Request refill"}
                      </Button>
                    ) : hasActiveOtherRefill ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => navigate("order", { orderId: eligibility.activeRefillOrderId! })}
                      >
                        <Repeat2 className="h-3.5 w-3.5" aria-hidden />
                        View active refill
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* ---------- payments ---------- */}
      {order.payments.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Payments</CardTitle>
          </CardHeader>
          <CardContent className="divide-y pt-0">
            {order.payments.map((p) => {
              const ProviderIcon = PAYMENT_PROVIDER_ICONS[p.provider] ?? CreditCard
              const methodLabel =
                p.method && PAYMENT_METHOD_LABELS[p.method] ? PAYMENT_METHOD_LABELS[p.method] : p.method ?? "Payment"
              return (
                <div key={p.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <ProviderIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{methodLabel}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(p.createdAt)}</p>
                    {p.providerReference ? (
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {p.providerReference}
                      </p>
                    ) : null}
                    {p.failureReason ? (
                      <p className="mt-1 text-xs text-destructive">{p.failureReason}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <p className="text-sm font-semibold tabular-nums">{formatKES(p.amount)}</p>
                    <PaymentStatusBadge status={p.status} />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* ---------- summary ---------- */}
      <Card>
        <CardContent className="space-y-2 p-4 sm:p-6">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium tabular-nums">{formatKES(order.subtotal)}</span>
          </div>
          {order.discountAmount > 0 ? (
            <div className="flex items-center justify-between text-sm text-emerald-700 dark:text-emerald-400">
              <span>Promo {order.promotionCode}</span>
              <span className="font-medium tabular-nums">−{formatKES(order.discountAmount)}</span>
            </div>
          ) : null}
          {order.pointsRedeemed > 0 ? (
            <div className="flex items-center justify-between text-sm text-teal-700 dark:text-teal-400">
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Sphere Points redeemed
              </span>
              <span className="font-medium tabular-nums">
                −{order.pointsRedeemed} pts (−{formatKES(order.pointsRedeemed * LOYALTY.pointValue)})
              </span>
            </div>
          ) : null}
          {order.pointsEarned > 0 ? (
            <div className="flex items-center justify-between text-sm text-emerald-700 dark:text-emerald-400">
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Sphere Points earned
              </span>
              <span className="font-medium tabular-nums">+{order.pointsEarned} pts</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {order.fulfillment === "PICKUP" ? "Pickup" : "Delivery fee"}
            </span>
            <span className="font-medium tabular-nums">
              {order.deliveryFee === 0 ? "Free" : formatKES(order.deliveryFee)}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatKES(order.total)}</span>
          </div>
        </CardContent>
      </Card>

      {/* ---------- cancel dialog ---------- */}
      <Dialog
        open={cancelOpen}
        onOpenChange={(open) => {
          if (!open && !cancelling) {
            setCancelOpen(false)
            setCancelReason("")
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel this order?</DialogTitle>
            <DialogDescription>
              This can&apos;t be undone. Reserved items return to stock. Orders with a captured payment must use the separate provider-refund process.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Textarea
              id="cancel-reason"
              placeholder="e.g. Found the medicine at home"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={cancelling}>
              Keep order
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmCancel()}
              disabled={cancelling}
            >
              {cancelling ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden />
              )}
              Cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- reorder dialog ---------- */}
      <Dialog open={reorderOpen} onOpenChange={(open) => !open && setReorderOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reorder these items?</DialogTitle>
            <DialogDescription>
              We'll add {order.items.length} item(s) worth {formatKES(order.subtotal)} to your cart —
              you can adjust quantities before checking out.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setReorderOpen(false)} disabled={reordering}>
              Not now
            </Button>
            <Button onClick={confirmReorder} disabled={reordering}>
              {reordering ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Repeat2 className="h-4 w-4" aria-hidden />
              )}
              Add to cart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- refill request dialog ---------- */}
      {refillTarget ? (
        <RefillRequestDialog
          rx={refillTarget}
          initialOrder={order}
          onClose={() => setRefillTarget(null)}
          onCreated={(res) => {
            setRefillTarget(null)
            navigate("order", { orderId: res.orderId })
          }}
        />
      ) : null}

      {/* ---------- prescription file dialog ---------- */}
      {rxToView ? (
        <PrescriptionFileDialog
          rx={rxToView}
          onClose={() => setRxViewId(null)}
        />
      ) : null}
    </div>
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
      const link = document.createElement("a")
      link.href = `/api/prescriptions/${encodeURIComponent(rx.id)}?download=1`
      link.download = detail.fileName || "prescription"
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
          <DialogDescription className="flex items-center gap-2">
            <RxStatusBadge status={rx.status} />
            <span>Uploaded {formatDateTime(rx.createdAt)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-slim flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading file" />
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
