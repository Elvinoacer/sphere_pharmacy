import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireStaff } from "@/lib/session"
import { ACTIVE_STATUSES, type OrderStatus } from "@/lib/constants"

const PAID = ["PAID", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "COMPLETED_PICKUP", "COMPLETED_DELIVERY"]

export async function GET() {
  const { error } = await requireStaff(["ADMIN"])
  if (error) return error
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
  const startOfWeek = new Date(startOfDay.getTime() - 6 * 86_400_000)
  const start14 = new Date(startOfDay.getTime() - 13 * 86_400_000)

  const [ordersToday, ordersThisWeek, paymentToday, paymentWeek, paymentTotal, activeOrders, awaitingPayment,
    pendingRx, productCounts, totalCustomers, recentOrders, top, types, statuses] = await Promise.all([
    db.order.count({ where: { createdAt: { gte: startOfDay } } }),
    db.order.count({ where: { createdAt: { gte: startOfWeek } } }),
    db.payment.aggregate({ where: { status: "SUCCESS", createdAt: { gte: startOfDay } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { status: "SUCCESS", createdAt: { gte: startOfWeek } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { status: "SUCCESS" }, _sum: { amount: true } }),
    db.order.count({ where: { status: { in: ACTIVE_STATUSES } } }),
    db.order.count({ where: { status: "AWAITING_PAYMENT" } }),
    db.prescription.count({
      where: {
        status: "PENDING",
        deletedAt: null,
        OR: [
          { orderId: null },
          { order: { status: { notIn: ["CANCELLED", "REJECTED", "REFUNDED"] } } },
        ],
      },
    }),
    db.product.groupBy({ by: ["stockStatus", "active"], _count: { _all: true } }),
    db.user.count(),
    db.order.findMany({ where: { createdAt: { gte: start14 } }, select: { createdAt: true, total: true, status: true }, orderBy: { createdAt: "asc" } }),
    db.orderItem.groupBy({ by: ["name"], where: { order: { status: { in: PAID } } }, _sum: { qty: true, lineTotal: true }, orderBy: { _sum: { qty: "desc" } }, take: 10 }),
    db.order.groupBy({ by: ["type"], _count: { _all: true } }),
    db.order.groupBy({ by: ["status"], _count: { _all: true } }),
  ])

  const byDay = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(start14.getTime() + index * 86_400_000)
    const next = new Date(day.getTime() + 86_400_000)
    const rows = recentOrders.filter((order) => order.createdAt >= day && order.createdAt < next)
    return { date: day.toISOString().slice(5, 10), orders: rows.length, revenue: rows.filter((order) => PAID.includes(order.status)).reduce((sum, order) => sum + Number(order.total), 0) }
  })
  const countProducts = (status?: string) => productCounts.filter((row) => row.active && (!status || row.stockStatus === status)).reduce((sum, row) => sum + row._count._all, 0)
  const countTypes = (wanted: string[]) => types.filter((row) => wanted.includes(row.type)).reduce((sum, row) => sum + row._count._all, 0)
  const statusMap = new Map(statuses.map((row) => [row.status, row._count._all]))
  const statusOrder: OrderStatus[] = ["RECEIVED", "UNDER_REVIEW", "PRESCRIPTION_VERIFIED", "AVAILABILITY_CONFIRMED", "AWAITING_PAYMENT", "PAID", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "COMPLETED_PICKUP", "COMPLETED_DELIVERY", "REJECTED", "CANCELLED", "REFUNDED"]
  return NextResponse.json({
    ordersToday, ordersThisWeek, revenueToday: Number(paymentToday._sum.amount || 0), revenueThisWeek: Number(paymentWeek._sum.amount || 0), revenueTotal: Number(paymentTotal._sum.amount || 0),
    pendingPrescriptions: pendingRx, awaitingPayment, activeOrders,
    lowStockCount: countProducts("LOW_STOCK"), outOfStockCount: countProducts("OUT_OF_STOCK"), totalProducts: countProducts(), totalCustomers,
    ordersByDay: byDay,
    topProducts: top.map((row) => ({ name: row.name, qty: row._sum.qty || 0, revenue: Number(row._sum.lineTotal || 0) })),
    rxVsOtc: { otc: countTypes(["OTC", "RESERVATION"]), rx: countTypes(["PRESCRIPTION", "MIXED"]) },
    statusBreakdown: statusOrder.map((status) => ({ status, count: statusMap.get(status) || 0 })),
  })
}
