"use client"

// Sphere Pharmacy — staff/admin dashboard shell.
// Role guard + sidebar navigation (desktop) / Sheet navigation (mobile) + section router.
// Section data refreshes via a refreshKey counter so actions in one section can
// trigger refetches in others (e.g. prescription review → orders + overview).

import { useEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { EmptyState } from "@/components/shared/empty-state"
import { AdminAccessFrame } from "./admin-access"
import { ROLE_LABELS, type Role } from "@/lib/constants"
import { initials, isOpenNow } from "@/lib/format"
import { useAppStore } from "@/store/use-app-store"
import { useAuthStore } from "@/store/use-auth-store"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  LayoutDashboard, Package, ClipboardList, Pill, Megaphone, Users, BarChart3,
  ShieldCheck, Settings, LogOut, Lock, Store, Menu, Loader2, RefreshCw, Bike, MessageSquareText,
  Bell, BellRing, BriefcaseMedical, CalendarDays, ArrowUpRight, ChevronRight, Search,
  Plus, Moon, Sun, PanelLeftClose, PanelLeftOpen,
} from "lucide-react"
import { enablePushNotifications, getPushPermissionState } from "@/lib/firebase/client"
import type { LucideIcon } from "lucide-react"
import {
  type AdminSectionKey, type SectionProps,
} from "./admin-shared"
import { OverviewSection } from "./sections/overview-section"
import { OrdersSection } from "./sections/orders-section"
import { DispatchSection } from "./sections/dispatch-section"
import { DispatchControlRoom } from "./sections/dispatch-control-room"
import { PrescriptionsSection } from "./sections/prescriptions-section"
import { MedicineRequestsSection } from "./sections/medicine-requests-section"
import { CatalogueSection } from "./sections/catalogue-section"
import { ReviewsSection } from "./sections/reviews-section"
import { PromotionsSection } from "./sections/promotions-section"
import { StaffSection } from "./sections/staff-section"
import { ReportsSection } from "./sections/reports-section"
import { ComplianceSection } from "./sections/compliance-section"
import { SettingsSection } from "./sections/settings-section"
import { ServicesSection } from "./sections/services-section"
import { ServiceBookingsSection } from "./sections/service-bookings-section"
import { ServiceAnalyticsSection } from "./sections/service-analytics-section"
import { PosSyncSection } from "./sections/pos-sync-section"

const STAFF_ROLES: Role[] = ["ADMIN", "PHARMACIST", "STAFF", "RIDER"]
const ALL_STAFF: Role[] = ["ADMIN", "PHARMACIST", "STAFF", "RIDER"]

/** Narrow a session role down to a staff role (excludes CUSTOMER). */
function isStaffRole(role: Role | "CUSTOMER" | undefined): role is Role {
  return STAFF_ROLES.includes(role as Role)
}

interface NavItem {
  key: AdminSectionKey
  label: string
  title: string
  subtitle: string
  icon: LucideIcon
  roles: Role[]
}

const NAV: NavItem[] = [
  {
    key: "overview", label: "Overview", title: "Overview", subtitle: "Today at the pharmacy — orders, revenue and queue health",
    icon: LayoutDashboard, roles: ["ADMIN"],
  },
  {
    key: "orders", label: "Orders", title: "Orders", subtitle: "Process the order queue — confirm, review, take payment, dispatch",
    icon: Package, roles: ["ADMIN", "PHARMACIST", "STAFF"],
  },
  {
    key: "dispatch", label: "Dispatch", title: "Dispatch board", subtitle: "Delivery orders — assign riders and track drop-offs to the door",
    icon: Bike, roles: ALL_STAFF,
  },
  {
    key: "prescriptions", label: "Prescriptions", title: "Prescription review", subtitle: "Verify uploaded prescriptions before dispensing",
    icon: ClipboardList, roles: ["ADMIN", "PHARMACIST"],
  },
  {
    key: "medicine-requests", label: "Medicine requests", title: "Medicine requests", subtitle: "Check requested medicines, view photos and follow up with customers",
    icon: MessageSquareText, roles: ["ADMIN", "PHARMACIST", "STAFF"],
  },
  {
    key: "service-analytics", label: "Service analytics", title: "Service performance", subtitle: "Bookings, completion and care-service revenue", icon: BarChart3, roles: ["ADMIN"],
  },
  {
    key: "service-bookings", label: "Bookings", title: "Service bookings", subtitle: "Manage appointments, confirmations and the daily care calendar",
    icon: CalendarDays, roles: ["ADMIN", "PHARMACIST", "STAFF"],
  },
  {
    key: "services", label: "Services", title: "Care services", subtitle: "Create, edit and publish pharmacy care services and their imagery",
    icon: BriefcaseMedical, roles: ["ADMIN", "PHARMACIST", "STAFF"],
  },
  {
    key: "catalogue", label: "Catalogue", title: "Catalogue", subtitle: "Manage products, pricing, stock levels and CSV imports",
    icon: Pill, roles: ["ADMIN", "PHARMACIST", "STAFF"],
  },
  {
    key: "reviews", label: "Reviews", title: "Reviews", subtitle: "Moderate customer product reviews — publish or hide them",
    icon: MessageSquareText, roles: ["ADMIN", "PHARMACIST"],
  },
  {
    key: "promotions", label: "Promotions", title: "Promotions", subtitle: "Banners, promo codes and storefront campaigns",
    icon: Megaphone, roles: ["ADMIN", "STAFF"],
  },
  {
    key: "staff", label: "Staff", title: "Staff", subtitle: "Team members, roles and access",
    icon: Users, roles: ["ADMIN"],
  },
  {
    key: "reports", label: "Reports", title: "Reports", subtitle: "Sales, products and order funnel analytics with CSV export",
    icon: BarChart3, roles: ["ADMIN"],
  },
  {
    key: "compliance", label: "Compliance", title: "Compliance", subtitle: "PPB licence details and superintendent pharmacist record",
    icon: ShieldCheck, roles: ["ADMIN", "PHARMACIST"],
  },
  {
    key: "settings", label: "Settings", title: "Settings", subtitle: "Pharmacy profile, delivery fees and demo data",
    icon: Settings, roles: ["ADMIN"],
  },
  {
    key: "pos-sync", label: "POS Sync", title: "BandaGo POS Integration Hub", subtitle: "Real-time telemetry, stock sync ledger, and lot/expiry compliance",
    icon: RefreshCw, roles: ["ADMIN", "PHARMACIST"],
  },
]

function navItem(key: AdminSectionKey): NavItem | undefined {
  return NAV.find((n) => n.key === key)
}

const NAV_GROUPS = [
  { label: "Workspace", keys: ["overview", "orders", "dispatch"] },
  { label: "Patient care", keys: ["prescriptions", "medicine-requests", "service-bookings", "services"] },
  { label: "Business", keys: ["catalogue", "promotions", "reviews", "reports", "service-analytics"] },
  { label: "Management", keys: ["staff", "compliance", "settings", "pos-sync"] },
]

type AdminLiveCursor = { change: string | null; arrival: string | null; arrivedAt: string | null }
type AdminLiveSnapshot = { orders: AdminLiveCursor; bookings: AdminLiveCursor }
const ADMIN_SYNC_INTERVAL_MS = 15_000

export function AdminView() {
  const session = useAuthStore((s) => s.session)
  const authLoading = useAuthStore((s) => s.loading)
  const refreshSession = useAuthStore((s) => s.refresh)
  const logout = useAuthStore((s) => s.logout)
  const openAuth = useAppStore((s) => s.openAuth)
  const navigate = useAppStore((s) => s.navigate)
  const routeSection = useAppStore((s) => s.params.section)

  const role = session?.role
  const visibleNav = NAV.filter((item) => isStaffRole(role) && item.roles.includes(role))
  const section = navItem(routeSection as AdminSectionKey)?.key ?? visibleNav[0]?.key ?? "overview"
  const { resolvedTheme, setTheme } = useTheme()
  const contentRef = useRef<HTMLDivElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [dateLabel, setDateLabel] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)
  const [navOpen, setNavOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    try { setSidebarCollapsed(window.localStorage.getItem("sphere-admin-sidebar-collapsed") === "true") }
    catch { /* Keep the full sidebar when browser storage is unavailable. */ }
  }, [])

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current
      try { window.localStorage.setItem("sphere-admin-sidebar-collapsed", String(next)) }
      catch { /* The toggle still works for this session. */ }
      return next
    })
  }

  const [pushStatus, setPushStatus] = useState<NotificationPermission>("default")
  const [pushLoading, setPushLoading] = useState(false)

  useEffect(() => {
    setPushStatus(getPushPermissionState())
    setDateLabel(new Intl.DateTimeFormat("en-KE", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Nairobi" }).format(new Date()))
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && isStaffRole(role)) {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [role])

  // Customer orders and care bookings are created in other sessions. A small
  // authenticated cursor poll detects them without fetching full lists or
  // flashing a loading state on every tick. PUSH_NOTIFICATION/visibility
  // events trigger an immediate check instead of waiting for the next tick.
  useEffect(() => {
    if (!role || !["ADMIN", "PHARMACIST", "STAFF"].includes(role)) return

    let active = true
    let inFlight = false
    let previous: AdminLiveSnapshot | null = null
    const check = async () => {
      if (!active || inFlight || document.visibilityState === "hidden" || !navigator.onLine) return
      inFlight = true
      try {
        const response = await fetch("/api/admin/live-changes", {
          cache: "no-store", credentials: "same-origin",
          headers: { Accept: "application/json" },
        })
        if (!response.ok) return
        const snapshot = await response.json() as AdminLiveSnapshot
        if (!active) return
        if (previous) {
          const ordersChanged = snapshot.orders.change !== previous.orders.change ||
            snapshot.orders.arrival !== previous.orders.arrival
          const bookingsChanged = snapshot.bookings.change !== previous.bookings.change ||
            snapshot.bookings.arrival !== previous.bookings.arrival
          if (ordersChanged || bookingsChanged) {
            setRefreshKey((key) => key + 1)
          }
          if (snapshot.orders.arrival && snapshot.orders.arrival !== previous.orders.arrival &&
              snapshot.orders.arrivedAt && (!previous.orders.arrivedAt ||
                Date.parse(snapshot.orders.arrivedAt) > Date.parse(previous.orders.arrivedAt))) {
            toast.info("New order received", {
              description: "An incoming customer order is ready for your review.",
              action: { label: "Open orders", onClick: () => navigate("admin", { section: "orders" }) },
            })
          }
          if (snapshot.bookings.arrival && snapshot.bookings.arrival !== previous.bookings.arrival &&
              snapshot.bookings.arrivedAt && (!previous.bookings.arrivedAt ||
                Date.parse(snapshot.bookings.arrivedAt) > Date.parse(previous.bookings.arrivedAt))) {
            toast.info("New care appointment", {
              description: "A customer has booked a service.",
              action: { label: "View bookings", onClick: () => navigate("admin", { section: "service-bookings" }) },
            })
          }
        }
        previous = snapshot
      } catch {
        // A failed poll must not interrupt staff work or discard the last cursor.
      } finally {
        inFlight = false
      }
    }

    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_NOTIFICATION") void check()
    }
    void check()
    const timer = window.setInterval(() => { void check() }, ADMIN_SYNC_INTERVAL_MS)
    document.addEventListener("visibilitychange", check)
    window.addEventListener("focus", check)
    window.addEventListener("online", check)
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", check)
      window.removeEventListener("focus", check)
      window.removeEventListener("online", check)
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage)
    }
  }, [role, navigate])

  async function handleTogglePush() {
    setPushLoading(true)
    try {
      const res = await enablePushNotifications()
      if (res.success) {
        setPushStatus("granted")
        toast.success("Staff push alerts active! You will receive live alerts for new orders and prescriptions.")
      } else {
        toast.error(res.error || "Could not enable push alerts.")
      }
    } finally {
      setPushLoading(false)
    }
  }

  // ---------- role guard ----------
  if (authLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="mb-6 flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          <p className="text-sm font-medium">Loading staff dashboard…</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (!session || !isStaffRole(role)) {
    return (
      <>
        <StaffGate
          isCustomer={role === "CUSTOMER"}
          onSignIn={() => openAuth("staff", "admin")}
          onBackToStore={() => navigate("home")}
          onSessionChange={refreshSession}
        />
      </>
    )
  }

  const staff = session.staff
  const active = navItem(section)
  const allowed = active ? active.roles.includes(role) : false
  const openNow = isOpenNow()

  const bumpRefresh = () => setRefreshKey((k) => k + 1)

  function goTo(next: AdminSectionKey, filters: Record<string, string> = {}) {
    const item = navItem(next)
    if (item && item.roles.includes(role as Role)) {
      navigate("admin", { ...filters, section: next })
      setNavOpen(false)
      setSearchOpen(false)
      requestAnimationFrame(() => contentRef.current?.focus({ preventScroll: true }))
    } else {
      toast.error("Your role doesn't have access to that section.")
    }
  }

  async function handleSignOut() {
    try {
      await logout()
      navigate("admin")
      toast.success("Signed out of the staff dashboard.")
    } catch {
      toast.error("Sign out failed — please try again.")
    }
  }

  const sectionProps: SectionProps = {
    refreshKey,
    onRefresh: bumpRefresh,
    onNavigateSection: goTo,
  }

  function renderSection() {
    if (!allowed || !active) {
      return (
        <EmptyState
          icon={Lock}
          title="Restricted section"
          description={`The ${active?.label ?? "requested"} section isn't available to ${ROLE_LABELS[role as Role]} accounts. Ask an admin if you need access.`}
          action={{ label: `Go to ${visibleNav[0]?.label ?? "workspace"}`, onClick: () => goTo(visibleNav[0]?.key ?? "dispatch") }}
        />
      )
    }
    switch (section) {
      case "overview":
        return <OverviewSection {...sectionProps} />
      case "orders":
        return <OrdersSection {...sectionProps} />
      case "dispatch":
        return role === "RIDER" ? <DispatchSection {...sectionProps} /> : <DispatchControlRoom {...sectionProps} />
      case "prescriptions":
        return <PrescriptionsSection {...sectionProps} />
      case "medicine-requests":
        return <MedicineRequestsSection {...sectionProps} />
      case "service-analytics":
        return <ServiceAnalyticsSection {...sectionProps} />
      case "service-bookings":
        return <ServiceBookingsSection {...sectionProps} />
      case "services":
        return <ServicesSection {...sectionProps} />
      case "catalogue":
        return <CatalogueSection {...sectionProps} />
      case "reviews":
        return <ReviewsSection {...sectionProps} />
      case "promotions":
        return <PromotionsSection {...sectionProps} />
      case "staff":
        return <StaffSection {...sectionProps} />
      case "reports":
        return <ReportsSection {...sectionProps} />
      case "compliance":
        return <ComplianceSection {...sectionProps} />
      case "settings":
        return <SettingsSection {...sectionProps} />
      case "pos-sync":
        return <PosSyncSection {...sectionProps} />
    }
  }

  return (
    <div className={cn("app-page app-page-admin admin-workspace", sidebarCollapsed && "admin-sidebar-collapsed")}>
      <aside id="admin-desktop-navigation" className={cn("admin-sidebar sticky top-0", sidebarCollapsed && "is-collapsed")}>
        <SidebarNav items={visibleNav} section={section} onSelect={goTo} staffName={staff?.name ?? "Staff"} staffRole={role} onSignOut={handleSignOut} openNow={openNow} onStore={() => navigate("home")} collapsed={sidebarCollapsed} />
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="admin-menu-toggle" aria-label="Open admin menu"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="admin-mobile-sidebar w-72 gap-0 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Workspace navigation</SheetTitle>
                <SheetDescription>Navigate your pharmacy workspace.</SheetDescription>
              </SheetHeader>
              <SidebarNav items={visibleNav} section={section} onSelect={goTo} staffName={staff?.name ?? "Staff"} staffRole={role} onSignOut={handleSignOut} openNow={openNow} onStore={() => navigate("home")} />
            </SheetContent>
          </Sheet>
          <Button type="button" variant="ghost" size="icon"
            className="admin-sidebar-collapse-toggle"
            aria-label={sidebarCollapsed ? "Expand admin sidebar" : "Collapse admin sidebar"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="admin-desktop-navigation"
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleSidebar}>
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
          <div className="admin-breadcrumb"><span>Workspace</span><ChevronRight aria-hidden className="h-3.5 w-3.5" /><span>{active?.label ?? "Dashboard"}</span></div>
          <div className="admin-topbar-actions">
            <span className="admin-today"><CalendarDays className="h-3.5 w-3.5" aria-hidden />{dateLabel}</span>
            <Button variant="outline" className="admin-search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search admin pages">
              <Search className="h-4 w-4" /><span>Jump to a page…</span><kbd>⌘ / Ctrl K</kbd>
            </Button>
            <Button variant="ghost" size="icon" onClick={bumpRefresh} aria-label="Refresh section data" title="Refresh data"><RefreshCw className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Toggle color theme" title="Toggle color theme"><Sun className="admin-sun h-4 w-4" /><Moon className="admin-moon h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={handleTogglePush} disabled={pushLoading} aria-label={pushStatus === "granted" ? "Push alerts active" : "Enable push alerts"} title={pushStatus === "granted" ? "Push alerts active" : "Enable order and prescription alerts"} className={cn("admin-notification", pushStatus === "granted" && "is-enabled")}>
              {pushLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : pushStatus === "granted" ? <Bell className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
              {pushStatus === "granted" ? <span className="admin-notification-dot" /> : null}
            </Button>
            <Avatar className="admin-topbar-avatar h-9 w-9"><AvatarFallback>{initials(staff?.name ?? "Staff")}</AvatarFallback></Avatar>
          </div>
        </header>

        <div ref={contentRef} tabIndex={-1} className="admin-content" aria-label={active?.title ?? "Dashboard"}>
          <p className="sr-only" role="status">{active?.title ?? "Dashboard"} page</p>
          <div key={section} className="admin-section" data-admin-section={section}>{renderSection()}</div>
          <footer className="admin-footer"><span>Sphere Pharmacy <span aria-hidden>·</span> Staff workspace</span><span><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {ROLE_LABELS[role]} access</span></footer>
        </div>
      </div>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="admin-command-dialog gap-0 overflow-hidden p-0" showCloseButton={false}>
          <DialogHeader className="sr-only"><DialogTitle>Find a page</DialogTitle><DialogDescription>Search the pages available to your role. Use arrow keys and Enter to navigate.</DialogDescription></DialogHeader>
          <Command>
            <CommandInput placeholder="Where would you like to go?" />
            <CommandList><CommandEmpty>No pages match your search.</CommandEmpty>
              {NAV_GROUPS.map((group) => <CommandGroup key={group.label} heading={group.label}>{visibleNav.filter((item) => group.keys.includes(item.key)).map((item) => <CommandItem key={item.key} value={`${item.label} ${item.subtitle}`} onSelect={() => goTo(item.key)}><item.icon className="h-4 w-4" /><span className="flex-1">{item.label}</span><ChevronRight className="h-3.5 w-3.5" /></CommandItem>)}</CommandGroup>)}
            </CommandList>
            <div className="admin-command-hint"><span>↑ ↓ to browse</span><span>↵ to open</span><span>esc to close</span></div>
          </Command>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SidebarNav({ items, section, onSelect, staffName, staffRole, onSignOut, openNow, onStore, collapsed = false }: {
  items: NavItem[]
  section: AdminSectionKey
  onSelect: (key: AdminSectionKey) => void
  staffName: string
  staffRole: Role
  onSignOut: () => void
  openNow: boolean
  onStore: () => void
  collapsed?: boolean
}) {
  return (
    <div className="admin-sidebar-inner">
      <button onClick={onStore} className="admin-brand" aria-label="Sphere Pharmacy storefront" title="Sphere Pharmacy storefront"><span className="admin-brand-mark"><Plus strokeWidth={2.5} /></span><span>sphere<span className="admin-brand-caption">PHARMACY WORKSPACE</span></span><ArrowUpRight className="admin-brand-arrow h-4 w-4" aria-hidden /></button>
      <div className="admin-location"><span className="admin-location-icon"><Store className="h-4 w-4" /></span><span><strong>Roysambu, Nairobi</strong><span className="admin-location-status"><i className={openNow ? "is-open" : ""} />{openNow ? "Pharmacy is open" : "Pharmacy is closed"}</span></span></div>
      <nav aria-label="Admin sections" className="admin-nav">
        {NAV_GROUPS.map((group) => {
          const groupItems = group.keys.flatMap((key) => items.filter((item) => item.key === key))
          return groupItems.length ? <div className="admin-nav-group" key={group.label}><p className="admin-nav-label">{group.label}</p>{groupItems.map((item) => <button key={item.key} onClick={() => onSelect(item.key)} aria-current={section === item.key ? "page" : undefined} aria-label={collapsed ? item.label : undefined} title={collapsed ? item.label : undefined} className={cn("admin-nav-item", section === item.key && "is-active")}><item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden /><span>{item.label}</span>{section === item.key ? <span className="admin-nav-active-dot" aria-hidden /> : null}</button>)}</div> : null
        })}
      </nav>
      <div className="admin-sidebar-bottom"><button className="admin-store-link" onClick={onStore} title="View storefront" aria-label={collapsed ? "View storefront" : undefined}><Store className="h-4 w-4" /><span>View storefront</span><ArrowUpRight className="h-3.5 w-3.5" /></button><div className="admin-sidebar-profile"><Avatar className="h-9 w-9"><AvatarFallback>{initials(staffName)}</AvatarFallback></Avatar><span className="min-w-0 flex-1"><strong>{staffName}</strong><span>{ROLE_LABELS[staffRole]}</span></span><button onClick={onSignOut} aria-label="Sign out of staff dashboard" title="Sign out"><LogOut className="h-4 w-4" /></button></div></div>
    </div>
  )
}

// ---------- gate for non-staff visitors ----------

function StaffGate({
  isCustomer,
  onSignIn,
  onBackToStore,
  onSessionChange,
}: {
  isCustomer: boolean
  onSignIn: () => void
  onBackToStore: () => void
  onSessionChange: () => Promise<void>
}) {
  // Light insurance poll: if the auth view signs a staff member in but doesn't sync the
  // auth store, pick the session up here so the dashboard appears.
  useEffect(() => {
    const t = setInterval(() => {
      void onSessionChange()
    }, 4000)
    return () => clearInterval(t)
  }, [onSessionChange])

  return (
    <AdminAccessFrame>
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="h-7 w-7" aria-hidden />
          </span>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Welcome to your workspace</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {isCustomer
                ? "You're signed in with a customer account. The dashboard is for Sphere Pharmacy staff — admins, pharmacists, staff and riders."
                : "Sign in with your Sphere Pharmacy staff account to manage orders, prescriptions and the catalogue."}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2">
            <Button className="h-11 w-full" onClick={onSignIn}>
              Sign in as staff
            </Button>
            <Button variant="outline" className="h-11 w-full" onClick={onBackToStore}>
              <Store className="h-4 w-4" /> Back to storefront
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Need access? Contact your pharmacy administrator.</p>
        </CardContent>
      </Card>
    </AdminAccessFrame>
  )
}
