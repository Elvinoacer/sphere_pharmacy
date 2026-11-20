"use client"

import { MemberIntro } from "@/components/member/member-intro"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/shared/empty-state"
import { OrderStatusBadge } from "@/components/shared/status-badges"
import { useAppStore } from "@/store/use-app-store"
import { useAuthStore } from "@/store/use-auth-store"
import { ordersApi } from "@/lib/api-client"
import {
  ACTIVE_STATUSES,
  FULFILLMENT_LABELS,
  ORDER_TYPE_LABELS,
  ROLE_LABELS,
  TERMINAL_STATUSES,
} from "@/lib/constants"
import { formatKES, shortRef, timeAgo } from "@/lib/format"
import type { OrderDTO } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  ChevronRight,
  FileText,
  Lock,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  RefreshCw,
  Repeat2,
  Search,
  ShieldCheck,
  Store,
  Truck,
  Wallet,
} from "lucide-react"

// ---------- local helpers ----------

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

type OrdersTab = "all" | "active" | "completed" | "rx"

const TAB_DEFS: { id: OrdersTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
  { id: "rx", label: "Prescriptions" },
]

const TAB_EMPTY_ICONS = {
  all: PackageOpen,
  active: PackageSearch,
  completed: PackageCheck,
  rx: FileText,
} as const

// ============================== VIEW ==============================

export function OrdersView() {
  const navigate = useAppStore((s) => s.navigate)
  const openAuth = useAppStore((s) => s.openAuth)
  const session = useAuthStore((s) => s.session)
  const authLoading = useAuthStore((s) => s.loading)

  const [orders, setOrders] = useState<OrderDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<OrdersTab>("all")
  const [search, setSearch] = useState("")

  const isCustomer = session?.role === "CUSTOMER"
  const isStaff = session != null && session.role !== "CUSTOMER"

  // ---------- data ----------

  async function load(): Promise<void> {
    setRefreshing(true)
    try {
      const res = await ordersApi.myOrders()
      setOrders(res)
      setError(null)
    } catch (err) {
      const msg = errMessage(err, "We couldn't load your orders. Please try again.")
      setError(msg)
      if (orders !== null) toast.error(msg) // inline card handles the first failure
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (authLoading || !isCustomer) return
    let cancelled = false
    ordersApi
      .myOrders()
      .then((res) => {
        if (cancelled) return
        setOrders(res)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(errMessage(err, "We couldn't load your orders. Please try again."))
      })
    return () => {
      cancelled = true
    }
  }, [authLoading, isCustomer])

  // ---------- derived ----------

  const counts = useMemo(() => {
    const list = orders ?? []
    return {
      all: list.length,
      active: list.filter((o) => ACTIVE_STATUSES.includes(o.status)).length,
      completed: list.filter((o) => TERMINAL_STATUSES.includes(o.status)).length,
      rx: list.filter((o) => o.type === "PRESCRIPTION" || o.type === "MIXED").length,
    }
  }, [orders])

  const visible = useMemo(() => {
    if (!orders) return []
    let list = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (tab === "active") list = list.filter((o) => ACTIVE_STATUSES.includes(o.status))
    else if (tab === "completed") list = list.filter((o) => TERMINAL_STATUSES.includes(o.status))
    else if (tab === "rx") list = list.filter((o) => o.type === "PRESCRIPTION" || o.type === "MIXED")
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (o) =>
          o.reference.toLowerCase().includes(q) || shortRef(o.reference).toLowerCase().includes(q)
      )
    }
    return list
  }, [orders, tab, search])

  const loading = authLoading || (isCustomer && orders === null && error === null)

  function openOrder(orderId: string) {
    navigate("order", { orderId })
  }

  // ============================== GUARDS ==============================

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Skeleton className="mb-2 h-8 w-40" />
        <Skeleton className="mb-6 h-4 w-64" />
        <Skeleton className="mb-6 h-10 w-full" />
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
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
                Customer order history lives in your account. Staff can track every order from the
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
      <div className="mx-auto max-w-3xl px-4 py-10">
        <EmptyState
          icon={Lock}
          title="Sign in to see your orders"
          description="Track orders, prescriptions and deliveries in one place. Sign in with your email, phone or OTP."
          action={{ label: "Sign in", onClick: () => openAuth("login", "orders") }}
        />
      </div>
    )
  }

  // ============================== MAIN ==============================

  const EmptyIcon = TAB_EMPTY_ICONS[tab]

  return (
    <div className="app-page app-page-orders mx-auto max-w-3xl px-4 py-8 pb-12">
      <MemberIntro kind="orders" />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">

        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={refreshing}
          aria-label="Refresh your orders"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden />
          Refresh
        </Button>
      </div>

      {error && orders === null ? (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Tabs value={tab} onValueChange={(v) => setTab(v as OrdersTab)} className="mb-4">
            <TabsList className="grid h-auto w-full grid-cols-4 p-1">
              {TAB_DEFS.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="flex min-w-0 flex-col gap-0.5 px-1 py-1.5 text-xs sm:flex-row sm:items-center sm:justify-center sm:gap-1.5 sm:text-sm"
                >
                  <span className="truncate">{t.label}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground sm:text-xs">
                    {counts[t.id]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="relative mb-4">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by order reference…"
              aria-label="Search your orders by reference"
              className="pl-9"
            />
          </div>

          {visible.length === 0 ? (
            orders !== null && search.trim() ? (
              <EmptyState
                icon={Search}
                title="No matching orders"
                description={`No order reference matches “${search.trim()}”.`}
                action={{ label: "Clear search", onClick: () => setSearch("") }}
              />
            ) : (
              <EmptyState
                icon={EmptyIcon}
                title={
                  tab === "all"
                    ? "No orders yet"
                    : tab === "active"
                      ? "No active orders"
                      : tab === "completed"
                        ? "No completed orders"
                        : "No prescription orders"
                }
                description={
                  tab === "rx"
                    ? "Orders with prescription items appear here once you upload a prescription."
                    : "Browse our catalogue to place your first order — we deliver across Nairobi."
                }
                action={{ label: "Browse catalogue", onClick: () => navigate("catalog") }}
              />
            )
          ) : (
            <ul className="space-y-3">
              {visible.map((order) => (
                <OrderCard key={order.id} order={order} onOpen={openOrder} />
              ))}
            </ul>
          )}
        </>
      )}

    </div>
  )
}

// ============================== ORDER CARD ==============================

function OrderCard({ order, onOpen }: { order: OrderDTO; onOpen: (orderId: string) => void }) {
  const awaitingPayment = order.status === "AWAITING_PAYMENT"
  const fulfillmentIcon = order.fulfillment === "PICKUP" ? Store : Truck
  const FulfillmentIcon = fulfillmentIcon
  const itemsLabel =
    order.items.length === 1
      ? `1 item — ${order.items[0]?.name ?? "Item"}`
      : `${order.items.length} items — ${order.items[0]?.name ?? "Item"} +${order.items.length - 1} more`

  return (
    <li>
      <Card
        role="button"
        tabIndex={0}
        aria-label={`Open order ${order.reference}, ${itemsLabel}, total ${formatKES(order.total)}`}
        onClick={() => onOpen(order.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onOpen(order.id)
          }
        }}
        className={cn(
          "card-lift cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
          awaitingPayment &&
            "border-amber-300 bg-amber-50/60 dark:border-amber-800/60 dark:bg-amber-950/20"
        )}
      >
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold tracking-tight">
              #{shortRef(order.reference)}
            </span>
            <OrderStatusBadge status={order.status} />
            <Badge variant="secondary" className="text-[10px] sm:text-xs">
              {ORDER_TYPE_LABELS[order.type]}
            </Badge>
            {order.isRefill ? (
              <Badge variant="outline" className="gap-1 border-teal-300 bg-teal-50 text-[10px] text-teal-800 sm:text-xs dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
                <Repeat2 className="h-3 w-3" aria-hidden />
                Refill
              </Badge>
            ) : null}
          </div>

          <div className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
            <FulfillmentIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="truncate">{itemsLabel}</p>
              <p className="mt-0.5 text-xs">{FULFILLMENT_LABELS[order.fulfillment]}</p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-base font-semibold">{formatKES(order.total)}</p>
            <p className="text-xs text-muted-foreground">{timeAgo(order.createdAt)}</p>
          </div>

          {awaitingPayment ? (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-amber-200 pt-3 dark:border-amber-800/60">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                Payment needed to move this order forward
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 border-amber-300 bg-amber-100/80 text-amber-900 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-950"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen(order.id)
                }}
              >
                <Wallet className="h-3.5 w-3.5" aria-hidden />
                Complete payment
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex justify-end">
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  )
}
