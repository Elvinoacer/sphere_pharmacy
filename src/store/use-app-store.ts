"use client"

// App view router store (single-page app at "/").
// MERGED CONTRACT (task 2-a): this file was missing from the foundation delivery
// (dev.log showed "Module not found: Can't resolve '@/store/use-app-store'").
// Task 2-c restored a view/params-based router; task 2-a's storefront views
// additionally need authMode/authNext/authMessage, resetCatalogFilters and
// selectedProductId/selectedOrderId mirrors. This file merges BOTH contracts so
// page.tsx, header, footer, product-card, assistant-widget, storefront views
// (2-a) and admin views (2-c) all compile against one store.

import { create } from "zustand"

export type ViewName =
  | "home"
  | "catalog"
  | "offers"
  | "product"
  | "services"
  | "cart"
  | "checkout"
  | "auth"
  | "orders"
  | "order"
  | "prescriptions"
  | "account"
  | "admin"

/** Alias kept for storefront views that use the AppView name. */
export type AppView = ViewName

export type AuthMode = "login" | "register" | "otp" | "staff"

export interface ViewParams {
  productId?: string
  orderId?: string
  /** auth view: which sign-in tab to preselect ("login" | "register" | "otp" | "staff") */
  mode?: string
  /** auth view: view name to return to after successful sign-in */
  next?: string
  [key: string]: string | undefined
}

/** Alias kept for storefront views that use NavigateOptions. */
export type NavigateOptions = ViewParams

export interface CatalogFilters {
  search: string
  /** CategoryDTO.id; "" means all categories */
  category: string
  rx: "any" | "yes" | "no"
  availability: "any" | "in" | "low" | "out"
  sort: "popular" | "price-asc" | "price-desc" | "name" | "newest"
}

export type CatalogSort = CatalogFilters["sort"]

export const DEFAULT_CATALOG_FILTERS: CatalogFilters = {
  search: "",
  category: "",
  rx: "any",
  availability: "any",
  sort: "popular",
}

const AUTH_MODES: AuthMode[] = ["login", "register", "otp", "staff"]

function isAuthMode(v: unknown): v is AuthMode {
  return typeof v === "string" && (AUTH_MODES as string[]).includes(v)
}

interface HistoryEntry {
  view: ViewName
  params: ViewParams
}

interface AppState {
  view: ViewName
  params: ViewParams
  /** mirrors of params.productId / params.orderId for convenience */
  selectedProductId: string | null
  selectedOrderId: string | null
  assistantOpen: boolean
  catalogFilters: CatalogFilters
  history: HistoryEntry[]
  hydrateFromLocation: () => void

  /** auth view state (set via openAuth or when navigating to "auth" with params.mode) */
  authMode: AuthMode
  authNext: ViewName | null
  authNextParams: ViewParams | null
  authMessage: string | null

  /** Navigate to a view (pushes onto the internal back-stack). */
  navigate: (view: ViewName, params?: ViewParams) => void
  /** Replace current view without pushing history. */
  replace: (view: ViewName, params?: ViewParams) => void
  /** Go back one entry in the internal back-stack (falls back to home). */
  goBack: () => void
  /** Convenience: open the auth view in a given mode, optionally returning to `next` (with params) after login. */
  openAuth: (mode?: AuthMode, next?: ViewName, message?: string, nextParams?: ViewParams) => void
  setAuthMode: (mode: AuthMode) => void
  clearAuthIntent: () => void
  setAssistantOpen: (open: boolean) => void
  setCatalogFilters: (filters: Partial<CatalogFilters>) => void
  resetCatalogFilters: () => void
}

function mirrorParams(params: ViewParams): Pick<AppState, "selectedProductId" | "selectedOrderId"> {
  return {
    selectedProductId: params.productId ?? null,
    selectedOrderId: params.orderId ?? null,
  }
}

const SIMPLE_PATHS: Partial<Record<ViewName, string>> = {
  home: "/", catalog: "/catalog", offers: "/offers", services: "/services", cart: "/cart",
  checkout: "/checkout", auth: "/auth", orders: "/orders",
  prescriptions: "/prescriptions", account: "/account", admin: "/admin",
}

function urlFor(view: ViewName, params: ViewParams): string {
  let path = view === "product" && params.productId ? `/products/${encodeURIComponent(params.productId)}`
    : view === "order" && params.orderId ? `/orders/${encodeURIComponent(params.orderId)}`
    : SIMPLE_PATHS[view] || "/"
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (!value || key === "productId" || key === "orderId") continue
    query.set(key, value)
  }
  if (query.size) path += `?${query.toString()}`
  return path
}

function stateFromLocation(): HistoryEntry {
  if (typeof window === "undefined") return { view: "home", params: {} }
  const path = window.location.pathname.replace(/\/+$/, "") || "/"
  const params: ViewParams = Object.fromEntries(new URLSearchParams(window.location.search))
  const product = /^\/products\/([^/]+)$/.exec(path)
  if (product) return { view: "product", params: { ...params, productId: decodeURIComponent(product[1]) } }
  const order = /^\/orders\/([^/]+)$/.exec(path)
  if (order) return { view: "order", params: { ...params, orderId: decodeURIComponent(order[1]) } }
  const adminSection = /^\/admin\/([a-z0-9-]+)$/.exec(path)
  if (adminSection) return { view: "admin", params: { ...params, section: decodeURIComponent(adminSection[1]) } }
  const routes: Record<string, ViewName> = {
    "/": "home", "/catalog": "catalog", "/offers": "offers", "/services": "services", "/cart": "cart",
    "/checkout": "checkout", "/auth": "auth", "/orders": "orders",
    "/prescriptions": "prescriptions", "/account": "account", "/admin": "admin",
  }
  const hash = window.location.hash.replace(/^#/, "")
  if (path === "/" && hash === "prescriptions") return { view: "prescriptions", params }
  if (path === "/" && hash.startsWith("admin-")) return { view: "admin", params: { ...params, section: hash.slice(6) } }
  return { view: routes[path] || "home", params }
}

export const useAppStore = create<AppState>((set, get) => ({
  view: "home",
  params: {},
  selectedProductId: null,
  selectedOrderId: null,
  assistantOpen: false,
  catalogFilters: DEFAULT_CATALOG_FILTERS,
  history: [],
  hydrateFromLocation: () => {
    const entry = stateFromLocation()
    const patch: Partial<AppState> = { view: entry.view, params: entry.params, ...mirrorParams(entry.params) }
    if (entry.view === "auth" && isAuthMode(entry.params.mode)) patch.authMode = entry.params.mode
    set(patch)
  },

  authMode: "login",
  authNext: null,
  authNextParams: null,
  authMessage: null,

  navigate: (view, params = {}) => {
    const { view: currentView, params: currentParams, history } = get()
    if (currentView === view && JSON.stringify(currentParams) === JSON.stringify(params)) return
    const patch: Partial<AppState> = {
      view,
      params,
      history: [...history, { view: currentView, params: currentParams }].slice(-30),
      ...mirrorParams(params),
    }
    if (view === "auth") {
      if (isAuthMode(params.mode)) patch.authMode = params.mode
      if (params.next) patch.authNext = params.next as ViewName
    }
    set(patch)
    if (typeof window !== "undefined") window.history.pushState({}, "", urlFor(view, params))
    if (typeof window !== "undefined") window.scrollTo({ top: 0 })
  },

  replace: (view, params = {}) => {
    set({ view, params, ...mirrorParams(params) })
    if (typeof window !== "undefined") window.history.replaceState({}, "", urlFor(view, params))
  },

  goBack: () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back()
      return
    }
    const { history } = get()
    const last = history[history.length - 1]
    if (last) {
      set({ view: last.view, params: last.params, ...mirrorParams(last.params), history: history.slice(0, -1) })
    } else {
      set({ view: "home", params: {}, selectedProductId: null, selectedOrderId: null })
    }
    if (typeof window !== "undefined") window.scrollTo({ top: 0 })
  },

  openAuth: (mode = "login", next, message, nextParams) => {
    set({ authMode: mode, authNext: next ?? null, authNextParams: nextParams ?? null, authMessage: message ?? null })
    get().navigate("auth", { mode, next, ...nextParams })
  },

  setAuthMode: (mode) => set({ authMode: mode }),
  clearAuthIntent: () => set({ authNext: null, authNextParams: null, authMessage: null }),

  setAssistantOpen: (open) => set({ assistantOpen: open }),

  setCatalogFilters: (filters) => set({ catalogFilters: { ...get().catalogFilters, ...filters } }),

  resetCatalogFilters: () => set({ catalogFilters: { ...DEFAULT_CATALOG_FILTERS } }),
}))
