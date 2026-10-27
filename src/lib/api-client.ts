// Typed API client — the single contract used by all frontend views.
// All requests are same-origin relative paths (Next.js API routes).

import type {
  AddressDTO,
  AdminReviewDTO,
  AdminStats,
  AuditLogDTO,
  CategoryDTO,
  ComplianceInfo,
  DeliverySettings,
  LoyaltySummaryDTO,
  NotificationDTO,
  NotificationPrefsDTO,
  ServiceDTO,
  OrderDTO,
  PharmacySettings,
  ProductDTO,
  ProductsResponse,
  PromotionDTO,
  PrescriptionDTO,
  ReviewDTO,
  ReviewSummaryDTO,
  SessionPayload,
  StaffDTO,
  StockAlertDTO,
  UserDTO,
} from "./types"
import type { OrderStatus, RxStatus } from "./constants"
import type { MedicineRequestDTO, MedicineRequestInput, MedicineRequestStatus, MedicineRequestsResponse } from "./medicine-requests"

export const medicineRequestsApi = {
  create: (data: MedicineRequestInput) => req<{ id: string }>("/api/medicine-requests", { method: "POST", body: JSON.stringify(data) }),
  list: (query: { status?: MedicineRequestStatus; search?: string; page: number }) => {
    const params = new URLSearchParams({ page: String(query.page) })
    if (query.status) params.set("status", query.status)
    if (query.search) params.set("search", query.search)
    return req<MedicineRequestsResponse>(`/api/admin/medicine-requests?${params}`)
  },
  update: (id: string, data: { status: MedicineRequestStatus; staffNotes: string }) =>
    req<MedicineRequestDTO>("/api/admin/medicine-requests", { method: "PATCH", body: JSON.stringify({ id, ...data }) }),
}

export interface UploadResponse {
  url: string
  key: string
}

export interface AssistantMessage {
  role: "user" | "assistant"
  content: string
  escalated?: boolean
  actions?: import("./assistant/contracts").AssistantAction[]
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : null) ?? `Request failed (${res.status})`
    throw new ApiError(msg, res.status)
  }
  return body as T
}

// ---------- session / auth ----------

export const authApi = {
  me: () => req<SessionPayload & { ok: boolean }>("/api/auth/me"),
  login: (identifier: string, password: string) =>
    req<SessionPayload>("/api/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }),
  register: (data: { name: string; email?: string; phone?: string; password: string }) =>
    req<SessionPayload>("/api/auth/register", { method: "POST", body: JSON.stringify(data) }),
  otpRequest: (phone: string) =>
    req<{ sent: true }>("/api/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) }),
  otpVerify: (phone: string, code: string, name?: string) =>
    req<SessionPayload>("/api/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, code, name }) }),
  staffLogin: (email: string, password: string) =>
    req<SessionPayload>("/api/auth/staff-login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  updateProfile: (data: { name?: string; email?: string; phone?: string; avatar?: string | null; password?: string; currentPassword?: string }) =>
    req<SessionPayload>("/api/auth/profile", { method: "PATCH", body: JSON.stringify(data) }),
}

// ---------- saved addresses ----------

const ADDRESS_REQUEST_TIMEOUT_MS = 15_000

async function addressReq<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), ADDRESS_REQUEST_TIMEOUT_MS)
  try {
    return await req<T>(path, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("Saving the address took too long. Please check your connection and try again.", 408)
    }
    throw err
  } finally {
    window.clearTimeout(timeout)
  }
}

export const addressesApi = {
  list: () => req<AddressDTO[]>("/api/addresses"),
  create: (data: {
    label: string
    text: string
    area?: string
    notes?: string
    isDefault?: boolean
    latitude?: number
    longitude?: number
  }) => addressReq<AddressDTO>("/api/addresses", { method: "POST", body: JSON.stringify(data) }),
  update: (
    id: string,
    data: Partial<{
      label: string
      text: string
      area: string
      notes: string
      isDefault: boolean
      latitude: number | null
      longitude: number | null
    }>
  ) => addressReq<AddressDTO>(`/api/addresses/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => addressReq<{ ok: boolean }>(`/api/addresses/${id}`, { method: "DELETE" }),
}

// ---------- catalogue ----------

export interface ProductQuery {
  ids?: string
  search?: string
  category?: string
  rx?: "yes" | "no"
  availability?: "in" | "low" | "out" | "any"
  stockStatus?: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "DISCONTINUED"
  sort?: "popular" | "price-asc" | "price-desc" | "name" | "name-desc" | "newest" | "oldest" | "stock-asc" | "stock-desc"
  admin?: "yes"
  page?: number
  pageSize?: number
}

export const catalogApi = {
  categories: () => req<CategoryDTO[]>("/api/categories"),
  products: (q: ProductQuery = {}) => {
    const params = new URLSearchParams()
    Object.entries(q).forEach(([k, v]) => {
      if (v !== undefined && v !== "" && v !== null) params.set(k, String(v))
    })
    return req<ProductsResponse>(`/api/products?${params.toString()}`, { cache: "default" })
  },
  product: (id: string) => req<ProductDTO>(`/api/products/${id}`),
  reviews: (productId: string) => req<ReviewSummaryDTO>(`/api/products/${productId}/reviews`),
  createReview: (productId: string, data: { rating: number; comment?: string }) =>
    req<ReviewDTO>(`/api/products/${productId}/reviews`, { method: "POST", body: JSON.stringify(data) }),
  stockAlert: {
    create: (productId: string) =>
      req<StockAlertDTO>(`/api/products/${productId}/stock-alert`, { method: "POST" }),
    list: () => req<StockAlertDTO[]>("/api/products/stock-alerts"),
    remove: (id: string) => req<{ ok: boolean }>(`/api/products/stock-alerts?id=${id}`, { method: "DELETE" }),
  },
}

// ---------- orders ----------

export interface CreateOrderPayload {
  items: { productId: string; qty: number }[]
  fulfillment: "PICKUP" | "DELIVERY"
  reservation: boolean
  paymentMethod: "MPESA" | "CARD" | "CASH" | "LATER"
  customer?: { name: string; phone: string; email?: string }
  addressId?: string
  deliveryAddress?: string
  deliveryArea?: string
  deliveryNotes?: string
  notes?: string
  prescriptionIds?: string[]
  promotionCode?: string
  redeemPoints?: boolean // redeem available Sphere Points at checkout
  deliveryLatitude?: number
  deliveryLongitude?: number
}

export const ordersApi = {
  myOrders: () => req<OrderDTO[]>("/api/orders"),
  allOrders: (q: { status?: string; type?: string; search?: string } = {}) => {
    const params = new URLSearchParams()
    Object.entries(q).forEach(([k, v]) => v && params.set(k, v))
    return req<OrderDTO[]>(`/api/orders?scope=all&${params.toString()}`)
  },
  // Dispatch board — delivery orders for staff (assign + track riders)
  dispatchBoard: () => req<OrderDTO[]>("/api/orders?scope=dispatch&limit=100"),
  dispatchHistory: () => req<OrderDTO[]>("/api/orders?scope=dispatch-history&limit=100"),
  dispatchRiders: () => req<StaffDTO[]>("/api/orders/riders"),
  // Rider board — orders assigned to the signed-in rider
  myDeliveries: () => req<OrderDTO[]>("/api/orders?scope=rider"),
  loyalty: () => req<LoyaltySummaryDTO>("/api/orders/loyalty"),
  get: (id: string, accessToken?: string) => req<OrderDTO>(`/api/orders/${id}`, accessToken ? { headers: { "x-order-access-token": accessToken } } : undefined),
  create: (payload: CreateOrderPayload) =>
    req<OrderDTO & { guestAccessToken?: string }>("/api/orders", { method: "POST", body: JSON.stringify(payload) }),
  updateStatus: (id: string, status: OrderStatus, note?: string) =>
    req<OrderDTO>(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status, note }) }),
  cancel: (id: string, reason?: string, accessToken?: string) =>
    req<OrderDTO>(`/api/orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }), ...(accessToken ? { headers: { "x-order-access-token": accessToken } } : {}) }),
  markPaidCash: (id: string) =>
    req<OrderDTO>(`/api/orders/${id}/cash-confirm`, { method: "POST" }),
  assignRider: (id: string, staffId: string) =>
    req<OrderDTO>(`/api/orders/${id}/assign`, { method: "POST", body: JSON.stringify({ staffId }) }),
}

// ---------- prescriptions ----------

export const prescriptionsApi = {
  mine: () => req<PrescriptionDTO[]>("/api/prescriptions"),
  queue: () => req<PrescriptionDTO[]>("/api/prescriptions?scope=queue"),
  upload: (data: { fileName: string; fileType: string; fileData?: string; fileUrl?: string; storageKey?: string; notes?: string; orderId?: string }) =>
    req<PrescriptionDTO>("/api/prescriptions", { method: "POST", body: JSON.stringify(data) }),
  get: (id: string) => req<PrescriptionDTO & { fileData: string }>(`/api/prescriptions/${id}`),
  review: (id: string, data: { status: RxStatus; reviewNotes?: string; refillsAllowed?: number; validDays?: number }) =>
    req<PrescriptionDTO>(`/api/prescriptions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  requestRefill: (id: string) =>
    req<{ orderId: string; reference: string }>(`/api/prescriptions/${id}/refill`, { method: "POST" }),
}

// ---------- notifications ----------

export const notificationsApi = {
  list: () => req<NotificationDTO[]>("/api/notifications"),
  markRead: (id: string) =>
    req<{ ok: boolean }>("/api/notifications", { method: "PATCH", body: JSON.stringify({ id }) }),
  markAllRead: () =>
    req<{ ok: boolean }>("/api/notifications", { method: "PATCH", body: JSON.stringify({}) }),
  prefs: () => req<NotificationPrefsDTO>("/api/notifications/prefs"),
  updatePrefs: (data: Partial<NotificationPrefsDTO>) =>
    req<NotificationPrefsDTO>("/api/notifications/prefs", { method: "PUT", body: JSON.stringify(data) }),
}

// ---------- assistant ----------

export const assistantApi = {
  chat: (messages: AssistantMessage[]) =>
    req<{ reply: string; escalated: boolean; actions?: import("./assistant/contracts").AssistantAction[] }>("/api/assistant", {
      method: "POST",
      body: JSON.stringify({
        messages: messages.map(({ role, content }) => ({ role, content })),
      }),
    }),
}

// ---------- storage / uploads ----------

export const storageApi = {
  uploadFile: async (
    file: File,
    folder: "products" | "prescriptions" | "avatars" | "services" | "general",
    onProgress?: (percent: number) => void
  ): Promise<UploadResponse> => {
    const form = new FormData()
    form.append("file", file)
    form.append("folder", folder)
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open("POST", "/api/upload")
      xhr.responseType = "json"
      xhr.timeout = 120_000
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100))
      }
      xhr.onerror = () => reject(new ApiError("Upload interrupted. Check your connection and try again.", 0))
      xhr.ontimeout = () => reject(new ApiError("Upload took too long. Check your connection and try again.", 408))
      xhr.onload = () => {
        const body = xhr.response as unknown
        if (xhr.status < 200 || xhr.status >= 300) {
          const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : `Upload failed (${xhr.status})`
          reject(new ApiError(message, xhr.status))
          return
        }
        onProgress?.(100)
        const upload = body as Partial<UploadResponse>
        if (!upload.key) {
          reject(new ApiError("The server did not confirm the stored file. Please try again.", xhr.status))
          return
        }
        resolve({ key: upload.key, url: upload.url ?? "" })
      }
      xhr.send(form)
    })
  },
  uploadBase64: (data: {
    fileData: string
    fileName: string
    fileType: string
    folder?: "products" | "prescriptions" | "avatars" | "services" | "general"
  }) => req<UploadResponse>("/api/upload", { method: "POST", body: JSON.stringify(data) }),
}

// ---------- payments ----------

export const paymentsApi = {
  mpesaInitiate: (orderId: string, phone: string, idempotencyKey: string, accessToken?: string) =>
    req<{ paymentId: string; checkoutRequestId: string; message: string }>(
      "/api/payments/mpesa/initiate",
      { method: "POST", body: JSON.stringify({ orderId, phone, idempotencyKey }), ...(accessToken ? { headers: { "x-order-access-token": accessToken } } : {}) }
    ),
  mpesaQuery: (checkoutRequestId: string, accessToken?: string) =>
    req<{ status: "SUCCESS" | "FAILED" | "PENDING"; payment?: { id: string; status: string; reference?: string; failureReason?: string }; orderStatus?: string }>(
      `/api/payments/mpesa/query?checkoutRequestId=${encodeURIComponent(checkoutRequestId)}`,
      accessToken ? { headers: { "x-order-access-token": accessToken } } : undefined
    ),
  cardCheckoutSession: (orderId: string, idempotencyKey: string, accessToken?: string) =>
    req<{ paymentId: string; status: string; checkoutUrl: string; sessionId: string }>(
      "/api/payments/intasend/initiate",
      { method: "POST", body: JSON.stringify({ orderId, mode: "checkout", idempotencyKey }), ...(accessToken ? { headers: { "x-order-access-token": accessToken } } : {}) }
    ),
  requestPayment: (orderId: string, phone?: string) =>
    req<{ ok: boolean; paymentId: string; checkoutRequestId: string; phone: string; amount: number; message: string }>(
      `/api/orders/${orderId}/request-payment`,
      { method: "POST", body: JSON.stringify({ phone, idempotencyKey: crypto.randomUUID() }) }
    ),
  refund: (paymentId: string) => req<{ ok: boolean }>("/api/payments/refund", { method: "POST", body: JSON.stringify({ paymentId }) }),
}

// ---------- admin ----------

export const adminApi = {
  stats: () => req<AdminStats>("/api/admin/stats"),
  audit: () => req<AuditLogDTO[]>("/api/admin/audit"),
  staff: () => req<StaffDTO[]>("/api/admin/staff"),
  createStaff: (data: { name: string; email: string; phone?: string; role: string; title?: string; password: string }) =>
    req<StaffDTO>("/api/admin/staff", { method: "POST", body: JSON.stringify(data) }),
  updateStaff: (id: string, data: Partial<{ name: string; email: string; phone: string; role: string; title: string; active: boolean; password: string }>) =>
    req<StaffDTO>(`/api/admin/staff/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteStaff: (id: string) => req<{ ok: boolean }>(`/api/admin/staff/${id}`, { method: "DELETE" }),
  upsertProduct: (data: Partial<ProductDTO> & { name: string; price: number; sku?: string }) =>
    req<ProductDTO>("/api/products", { method: "POST", body: JSON.stringify(data) }),
  updateProduct: (id: string, data: Partial<ProductDTO>) =>
    req<ProductDTO>(`/api/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProduct: (id: string) => req<{ ok: boolean }>(`/api/products/${id}`, { method: "DELETE" }),
  importCsv: (csv: string) =>
    req<{ created: number; updated: number; errors: string[] }>("/api/products/bulk", {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),
  reviews: (q: { status?: string } = {}) => {
    const params = new URLSearchParams()
    Object.entries(q).forEach(([k, v]) => v && params.set(k, v))
    return req<AdminReviewDTO[]>(`/api/admin/reviews?${params.toString()}`)
  },
  setReviewStatus: (id: string, status: "PUBLISHED" | "HIDDEN") =>
    req<AdminReviewDTO>(`/api/admin/reviews/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
}

// ---------- promotions / settings ----------

export const promotionsApi = {
  list: (all = false) => req<PromotionDTO[]>(`/api/promotions${all ? "?all=1" : ""}`),
  validate: (code: string, subtotal: number) =>
    req<{ promotion: PromotionDTO; discountAmount: number }>("/api/promotions/validate", {
      method: "POST",
      body: JSON.stringify({ code, subtotal }),
    }),
  create: (data: Omit<PromotionDTO, "id">) =>
    req<PromotionDTO>("/api/promotions", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<PromotionDTO>) =>
    req<PromotionDTO>(`/api/promotions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => req<{ ok: boolean; archived?: boolean }>(`/api/promotions/${id}`, { method: "DELETE" }),
}

export const settingsApi = {
  get: () => req<{ pharmacy: PharmacySettings; delivery: DeliverySettings; compliance: ComplianceInfo }>("/api/settings"),
  update: (data: { pharmacy?: Partial<PharmacySettings>; delivery?: Partial<DeliverySettings>; compliance?: Partial<ComplianceInfo> }) =>
    req<{ ok: boolean }>("/api/settings", { method: "PUT", body: JSON.stringify(data) }),
  deliveryFee: (area: string, subtotal = 0, latitude?: number, longitude?: number) =>
    req<{ fee: number; freeOver: number | null; mode: string; pricingMode?: string; distanceKm?: number | null }>(
      "/api/settings/delivery-fee?area=" +
        encodeURIComponent(area) +
        "&subtotal=" + encodeURIComponent(String(subtotal)) +
        (latitude != null && longitude != null ? "&lat=" + latitude + "&lon=" + longitude : "")
    ),
  uploadBase64: async (data: {
    fileData: string
    fileName: string
    fileType: string
    folder?: "products" | "prescriptions" | "avatars" | "services" | "general"
  }): Promise<UploadResponse> => {
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Upload failed (${res.status})`)
    }
    return res.json()
  },
}

type ServiceWritePayload = Omit<Partial<ServiceDTO>, "images"> & {
  images?: { url: string; storageKey?: string | null; alt?: string | null }[]
}

export const servicesApi = {
  list: (includeInactive = false) => req<ServiceDTO[]>(`/api/services${includeInactive ? "?includeInactive=true" : ""}`),
  get: (id: string) => req<ServiceDTO>(`/api/services/${id}`),
  create: (payload: ServiceWritePayload) => req<ServiceDTO>("/api/services", { method: "POST", body: JSON.stringify(payload) }),
  update: (id: string, payload: ServiceWritePayload) => req<ServiceDTO>(`/api/services/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  remove: (id: string) => req<{ ok: boolean }>(`/api/services/${id}`, { method: "DELETE" }),
}

export const servicesAdminApi = {
  list: () => req<import("./types").ServiceDTO[]>("/api/admin/service-staff"),
  availability: (serviceId: string) =>
    req<import("./types").ServiceAvailabilityDTO[]>(`/api/services/${serviceId}/availability`),
  saveAvailability: (serviceId: string, rows: import("./types").ServiceAvailabilityDTO[]) =>
    req<import("./types").ServiceAvailabilityDTO[]>(`/api/services/${serviceId}/availability`, {
      method: "PUT",
      body: JSON.stringify({ availability: rows }),
    }),
}

export const serviceBookingsApi = {
  slots: (serviceId: string, date: string) =>
    req<import("./types").ServiceSlotDTO[]>(`/api/services/${serviceId}/slots?date=${encodeURIComponent(date)}`),
  mine: () => req<import("./types").ServiceBookingDTO[]>("/api/service-bookings/mine"),
  create: (payload: { serviceId: string; start: string; end: string; customerNotes?: string; expectedPrice?: number | null }) =>
    req<import("./types").ServiceBookingDTO>("/api/service-bookings", { method: "POST", body: JSON.stringify(payload) }),
}

export const serviceStaffApi = { list: () => req<import("./types").StaffDTO[]>("/api/admin/service-staff") }

export const adminServiceBookingsApi = {
  search: (query: import("./types").AdminServiceBookingQuery) => {
    const params = new URLSearchParams({ scope: "manage", view: query.view, page: String(query.page), pageSize: String(query.pageSize || 20) })
    for (const key of ["q", "range", "from", "to", "status", "staffId"] as const) {
      const value = query[key]
      if (value) params.set(key, value)
    }
    return req<import("./types").AdminServiceBookingPage>("/api/admin/service-bookings?" + params.toString())
  },
  detail: (id: string) => req<import("./types").ServiceBookingDTO>("/api/admin/service-bookings?scope=detail&id=" + encodeURIComponent(id)),
  list: (date?: string) =>
    req<import("./types").ServiceBookingDTO[]>(`/api/admin/service-bookings${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  overview: (date: string) =>
    req<import("./types").AdminServiceBookingOverviewDTO>(`/api/admin/service-bookings?scope=overview&date=${encodeURIComponent(date)}`),
  reschedule: (id: string, scheduledStart: string, scheduledEnd: string) => req<{ok:boolean;status:string}>("/api/admin/service-bookings", { method: "PATCH", body: JSON.stringify({ id, scheduledStart, scheduledEnd }) }),
  updateStatus: (id: string, status: string, note?: string, staffNotes?: string) =>
    req<{ ok: boolean; status: string }>("/api/admin/service-bookings", { method: "PATCH", body: JSON.stringify({ id, status, note, staffNotes }) }),
  assign: (id: string, staffId: string | null) =>
    req<{ ok: boolean; assignedStaffId: string | null }>(`/api/admin/service-bookings/${id}/assign`, { method: "PATCH", body: JSON.stringify({ staffId }) }),
}

export const servicePaymentsApi = {
  mpesa: (bookingId: string, phone: string, idempotencyKey = crypto.randomUUID()) =>
    req<{ paymentId: string; checkoutRequestId: string; message: string }>(`/api/service-bookings/${bookingId}/pay/mpesa`, { method: "POST", body: JSON.stringify({ phone, idempotencyKey }) }),
  card: (bookingId: string) =>
    req<{ paymentId: string; checkoutUrl: string; status: string }>(`/api/service-bookings/${bookingId}/pay/card`, { method: "POST", body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) }),
  status: (bookingId: string) =>
    req<{ bookingId: string; status: string; paymentStatus: string; providerReference?: string | null }>(`/api/service-bookings/${bookingId}/payment-status`),
  payAtPharmacy: (bookingId: string) =>
    req<{ ok: boolean; paymentStatus: string }>(`/api/service-bookings/${bookingId}/pay-at-pharmacy`, { method: "POST" }),
}

export const serviceReviewsApi = {
  create: (bookingId: string, rating: number, comment?: string) =>
    req<{ ok: boolean }>(`/api/service-bookings/${bookingId}/review`, { method: "POST", body: JSON.stringify({ rating, comment }) }),
  list: (serviceId: string) =>
    req<{ average: number; count: number; reviews: { id: string; rating: number; comment: string | null; authorName: string; createdAt: string }[] }>(`/api/services/${serviceId}/reviews`),
}

export const serviceAnalyticsApi = {
  summary: (from?: string, to?: string) =>
    req<{ totalBookings:number; completed:number; cancelled:number; revenue:number; completionRate:number; byService:{service:string;bookings:number;completed:number;revenue:number}[] }>(`/api/admin/service-analytics${from ? `?from=${encodeURIComponent(from)}${to ? `&to=${encodeURIComponent(to)}` : ""}` : ""}`),
}
