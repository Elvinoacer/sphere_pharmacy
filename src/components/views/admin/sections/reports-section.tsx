"use client"

// Reports (ADMIN only) — revenue-by-day chart with 7/14/30-day range selector,
// status funnel in lifecycle order, top-10 products table, Rx vs OTC donut,
// prescription volume card, customer count, and client-side CSV exports
// (orders summary + top products). Payment-method split is skipped: AdminStats
// doesn't expose it yet.

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip as ChartTooltip, XAxis, YAxis, Legend,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/shared/empty-state"
import { adminApi, ordersApi } from "@/lib/api-client"
import type { AdminStats, OrderDTO } from "@/lib/types"
import { ORDER_STATUSES, ORDER_STATUS_LABELS, ORDER_TYPE_LABELS } from "@/lib/constants"
import { formatDate, formatKES } from "@/lib/format"
import { toast } from "sonner"
import { AdminSectionHeader, apiErrorMessage, downloadCsv, KpiCard, KpiSkeletonGrid, SectionError, type SectionProps } from "../admin-shared"
import { Download, Loader2, BarChart3, TrendingUp, Users, ClipboardList, Banknote, Package } from "lucide-react"
import { cn } from "@/lib/utils"

type ReportRange = "7" | "14" | "30"

const dayLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short" })

export function ReportsSection({ refreshKey }: SectionProps) {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<ReportRange>("14")
  const [exporting, setExporting] = useState<"orders" | "products" | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setStats(await adminApi.stats())
    } catch (err) {
      setError(apiErrorMessage(err))
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const revenueData = useMemo(() => {
    if (!stats) return []
    return stats.ordersByDay.slice(-Number(range)).map((d) => ({ ...d, label: dayLabel(d.date) }))
  }, [stats, range])

  const funnel = useMemo(() => {
    if (!stats) return []
    const byStatus = new Map(stats.statusBreakdown.map((s) => [s.status, s.count]))
    return ORDER_STATUSES.map((status) => ({
      status,
      label: ORDER_STATUS_LABELS[status],
      count: byStatus.get(status) ?? 0,
    }))
  }, [stats])

  const maxFunnel = funnel.reduce((m, row) => Math.max(m, row.count), 1)

  const typeDonut = useMemo(() => {
    if (!stats) return []
    return [
      { name: "Prescription (Rx)", value: stats.rxVsOtc.rx },
      { name: "Over-the-counter", value: stats.rxVsOtc.otc },
    ].filter((d) => d.value > 0)
  }, [stats])

  async function exportOrdersCsv() {
    setExporting("orders")
    try {
      const orders: OrderDTO[] = await ordersApi.allOrders()
      const rows: (string | number | null)[][] = [
        ["Reference", "Date", "Customer", "Phone", "Type", "Fulfilment", "Status", "Items", "Subtotal (KSh)", "Delivery (KSh)", "Total (KSh)"],
        ...orders.map((o) => [
          o.reference,
          new Date(o.createdAt).toISOString(),
          o.customerName ?? "Guest",
          o.customerPhone ?? "",
          ORDER_TYPE_LABELS[o.type] ?? o.type,
          o.fulfillment,
          ORDER_STATUS_LABELS[o.status] ?? o.status,
          o.items.length,
          o.subtotal,
          o.deliveryFee,
          o.total,
        ]),
      ]
      downloadCsv(`sphere-orders-${new Date().toISOString().slice(0, 10)}.csv`, rows)
      toast.success(`Exported ${orders.length} orders to CSV.`)
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      setExporting(null)
    }
  }

  function exportProductsCsv() {
    if (!stats) return
    const rows: (string | number)[][] = [
      ["Product", "Qty sold", "Revenue (KSh)"],
      ...stats.topProducts.map((p) => [p.name, p.qty, p.revenue]),
    ]
    downloadCsv(`sphere-top-products-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    toast.success("Exported top products to CSV.")
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <KpiSkeletonGrid count={4} />
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (error || !stats) {
    return <SectionError message={error ?? "No stats available."} onRetry={() => void load()} />
  }

  const rxTotal = stats.rxVsOtc.rx + stats.rxVsOtc.otc
  const rxShare = rxTotal > 0 ? Math.round((stats.rxVsOtc.rx / rxTotal) * 100) : 0

  return (
    <div className="space-y-5">
      <AdminSectionHeader
        title="Reports"
        subtitle="Sales, products and the order funnel. Exports download straight from your browser."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-1.5" onClick={() => void exportOrdersCsv()} disabled={exporting === "orders"}>
              {exporting === "orders" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" />}
              Orders CSV
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={exportProductsCsv} disabled={exporting === "products" || stats.topProducts.length === 0}>
              <Download className="h-4 w-4" aria-hidden /> Top products CSV
            </Button>
          </div>
        }
      />

      {/* headline KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <KpiCard label="Revenue today" value={formatKES(stats.revenueToday)} icon={Banknote} tone="emerald" />
        <KpiCard label="Revenue this week" value={formatKES(stats.revenueThisWeek)} icon={TrendingUp} tone="teal" />
        <KpiCard label="Revenue (all time)" value={formatKES(stats.revenueTotal)} icon={Banknote} />
        <KpiCard label="Customers" value={stats.totalCustomers} icon={Users} hint={`${stats.totalProducts} products live`} />
      </div>

      {/* revenue chart */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm font-semibold">Revenue by day</CardTitle>
          <Tabs value={range} onValueChange={(v) => setRange(v as ReportRange)}>
            <TabsList>
              <TabsTrigger value="7">7d</TabsTrigger>
              <TabsTrigger value="14">14d</TabsTrigger>
              <TabsTrigger value="30">30d</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {revenueData.length === 0 ? (
            <EmptyState icon={BarChart3} title="No revenue data yet" description="Daily revenue appears once paid orders come through." className="py-8" />
          ) : (
            <div className="h-64" role="img" aria-label={`Area chart of daily revenue over the last ${range} days`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="reportRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number | string) => `${Math.round(Number(v) / 1000)}k`} />
                  <ChartTooltip formatter={(value: number | string) => formatKES(Number(value))} />
                  <Area isAnimationActive={false} type="monotone" dataKey="revenue" name="Revenue" stroke="var(--chart-2)" strokeWidth={2} fill="url(#reportRev)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-5">
        {/* top products table */}
        <Card className="min-w-0 overflow-hidden lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Package className="h-4 w-4 text-muted-foreground" aria-hidden /> Top 10 products
            </CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 p-0">
            {stats.topProducts.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No product sales yet.</p>
            ) : (
              <div className="scroll-slim max-h-[22rem] min-w-0 overflow-y-auto overscroll-contain" role="region" aria-label="Top products ranking" tabIndex={0}>
                <Table className="min-w-[26rem] table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="w-14 text-right">Qty</TableHead>
                      <TableHead className="w-28 text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.topProducts.slice(0, 10).map((p, i) => (
                      <TableRow key={p.name}>
                        <TableCell className="w-8 text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                        <TableCell className="min-w-0 text-sm font-medium"><span className="block truncate" title={p.name}>{p.name}</span></TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{p.qty}</TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">{formatKES(p.revenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* rx vs otc + prescription volume */}
        <Card className="min-w-0 overflow-hidden lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Order mix &amp; prescription volume</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {typeDonut.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <div className="h-52" role="img" aria-label={`Donut chart: ${rxShare}% of orders include prescription items`}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie isAnimationActive={false} data={typeDonut} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={3} strokeWidth={0}>
                      {typeDonut.map((entry, index) => <Cell key={entry.name} fill={index === 0 ? "var(--chart-1)" : "var(--chart-4)"} aria-label={`${entry.name}: ${entry.value} orders`} />)}
                    </Pie>
                    <ChartTooltip formatter={(value: number | string) => `${value} orders`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ClipboardList className="h-3.5 w-3.5" aria-hidden /> Rx orders
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">{stats.rxVsOtc.rx}</p>
                <p className="text-xs text-muted-foreground">{rxShare}% of orders</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ClipboardList className="h-3.5 w-3.5" aria-hidden /> OTC orders
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">{stats.rxVsOtc.otc}</p>
                <p className="text-xs text-muted-foreground">{100 - rxShare}% of orders</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* status funnel */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Order funnel — counts by status (lifecycle order)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {funnel.map((row) => (
              <div key={row.status}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{row.label}</span>
                  <span className="font-bold tabular-nums">{row.count}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      row.status === "COMPLETED_PICKUP" || row.status === "COMPLETED_DELIVERY"
                        ? "bg-emerald-500"
                        : row.status === "REJECTED" || row.status === "CANCELLED" || row.status === "REFUNDED"
                          ? "bg-rose-400"
                          : "bg-primary/70"
                    )}
                    style={{ width: `${Math.max((row.count / maxFunnel) * 100, row.count > 0 ? 4 : 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Reports refresh with live order data · generated {formatDate(new Date())} · payment-provider split lands once
        the stats API exposes it.
      </p>
    </div>
  )
}
