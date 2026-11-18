# API Reference — Sphere Pharmacy

| Audience | Status | Verified |
| --- | --- | --- |
| Engineers, AI coding agents | Implemented — verified against code | November 2026 |

This reference covers **all 87 HTTP route handlers** under `src/app/api/` of the Sphere Pharmacy platform (Next.js 16 App Router + TypeScript + PostgreSQL/Prisma 6). Every statement here is grounded in the shipped route handlers and the security/commerce/clinical fact sheets. The machine-readable contract lives at [`../../openapi/sphere-api.yaml`](../../openapi/sphere-api.yaml); request/response DTOs are defined in `src/lib/types.ts` (the single frontend/backend contract consumed by `src/lib/api-client.ts`).

Related reading: [../architecture/api-architecture.md](../architecture/api-architecture.md) (layering, session model), [../security/access-control.md](../security/access-control.md) (route→role matrix, rate limits, webhook auth), [../workflows/](../workflows/) (order, payment, prescription, booking deep dives), [../integrations/](../integrations/) (BandaGo POS/CRM, M-Pesa, IntaSend, Resend, FCM).

---

## 1. Conventions

### 1.1 Base URL, content type, currency

- All endpoints are same-origin relative paths under `/api` (e.g. `POST /api/orders`). Requests and responses are JSON (`Content-Type: application/json`) except `POST /api/upload` and `POST /api/integrations/bandago/csv-import` (`multipart/form-data`) and `GET /api/admin/medicine-requests/[id]/photo` (binary stream).
- All money is Kenyan Shillings (KES), serialized as JSON numbers (2-dp `Decimal` columns behind the scenes). M-Pesa amounts must be whole KES; IntaSend uses `amount.toFixed(2)`.
- `GET /api` is an unused scaffold stub returning `{ "message": "Hello, world!" }`.

### 1.2 Error shape and status codes

Every error response is a single JSON object: `{ "error": "<human-readable message>" }`. Unexpected 500s go through `publicError()`, which returns a random `errorId` (UUID) in the body and logs the full exception server-side for correlation.

| Code | Meaning in this API |
| --- | --- |
| 400 | Validation failure (field formats, sizes, limits) |
| 401 | Not signed in, guest token missing/invalid, OTP invalid; also "prescription items require a verified account" and per-user promo limits for guests |
| 403 | Authenticated but not permitted (role or ownership) |
| 404 | Not found — also used deliberately to avoid resource disclosure (e.g. another customer's refill) |
| 409 | State conflicts: stock, status transitions, duplicates, promotion limits, idempotency collisions, order version conflicts |
| 410 | Gone (expired promotion code) |
| 413 | Payload too large (body caps enforced via `Content-Length`; medicine-requests also caps the stream) |
| 429 | Rate limited; includes `Retry-After` and `Cache-Control: no-store` |
| 500 | Unexpected server error (with `errorId`) |
| 503 | Provider/config unavailable: M-Pesa/IntaSend unconfigured, R2 presign failure, "provider response uncertain" payment states, missing cron env, upstream geocoder failure |

### 1.3 Authentication model

- **Customer & staff sessions** — opaque DB-backed token in the `sphere_session` cookie (httpOnly, SameSite=Lax, `secure` in production). Customers: 30-day expiry. Staff: 7-day absolute + 12-hour idle timeout, `authVersion` revocation on role/password/active changes. `requireCustomer()` → 401; `requireStaff(roles?)` → 401/403 with "You do not have permission to perform this action.".
- **Roles** — staff roles `ADMIN`, `PHARMACIST`, `STAFF`, `RIDER`; customers are the pseudo-role `CUSTOMER`.
- **Guest order access token** — guests who place orders receive a one-time opaque token (32-byte base64url) in the `POST /api/orders` response (also embedded as `#access=` URL fragment). Only its HMAC hash is stored; expiry is 7 days. Present it via the `x-order-access-token` header (≤256 chars; the M-Pesa initiators also accept `accessToken` in the body). Honored by: order GET, order cancel, M-Pesa initiate, IntaSend initiate, M-Pesa query. Cleared when the guest claims the order via OTP sign-in.
- **Webhooks** — IntaSend: HMAC-SHA256 signature headers (or body challenge / shared-secret header) **plus** mandatory server-side invoice re-fetch. M-Pesa callbacks: `?token=` query vs `MPESA_CALLBACK_TOKEN` (timing-safe). Resend: Svix `svix-id`/`svix-timestamp`/HMAC verification. See [../security/access-control.md](../security/access-control.md).
- **Cron** — `Authorization: Bearer <CRON_SECRET>` (≥32 chars). `/api/cron/notifications` uses a constant-time compare; the other four use plain comparison (documented concern).
- **BandaGo sync** — `Authorization: Bearer <BANDAGO_SYNC_API_KEY>` **or** an active ADMIN/PHARMACIST staff session (dual-mode).

### 1.4 Idempotency

- **Payment initiation** requires a client-generated `idempotencyKey` matching `/^[a-zA-Z0-9_-]{16,100}$/`. The server composes storage keys: `order:{id}:mpesa|intasend:{key}`, `staff:{orderId}:mpesa:{key}`, `service:{id}:mpesa|intasend:{key}`, and `cash:{orderId}` for cash confirmation. A `PROCESSING` reservation (`reservePaymentAttempt`, Serializable, before any network I/O) blocks parallel attempts; replays return the original in-flight payment instead of double-charging.
- **Webhooks** deduplicate on unique `PaymentWebhookEvent.eventId` per provider (benign replays are acked; conflicts → 409). **Loyalty ledger** entries are idempotent per `eventKey` (`earn:<orderId>`, `redeem:<orderId>`, `expire:<orderId>`, `refund-earn/redeem:<orderId>`). **Order mutations** use optimistic concurrency (`version` + status guards → 409 "order changed").

### 1.5 Rate limiting

Fixed-window buckets keyed `scope:sha256(clientIp + identity)`. On breach: 429 + `Retry-After` + `no-store`. Limits are listed per endpoint below and in [../security/access-control.md](../security/access-control.md). Body-size caps are enforced *before* parsing via `Content-Length`.

### 1.6 Caching

Sensitive endpoints send `Cache-Control: no-store` (or `private, no-store`); admin live-changes additionally sends `Vary: Cookie`. The only shared-cache response is the popular-sorted product list (`public, s-maxage=60, stale-while-revalidate=300`); the frontend client defaults to `no-store` except catalog reads.

### 1.7 Roles and access model (quick matrix)

| Capability | ADMIN | PHARMACIST | STAFF | RIDER | Customer | Guest |
| --- | --- | --- | --- | --- | --- | --- |
| Catalog / categories / services / promotions read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Place orders, medicine requests, promo validate, location, assistant | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (OTC orders only) |
| Own orders / prescriptions / addresses / bookings / notifications | — | — | — | — | ✓ (own only) | order tracking via guest token |
| Product create/update/bulk, prescriptions review, reviews moderation | ✓ | ✓ | — | — | — | — |
| Orders scope=all/dispatch/dispatch-history, orders/riders, prepare, assign, medicine-requests admin, pos-status, live-changes | ✓ | ✓ | ✓ | — | — | — |
| Order PATCH, cash-confirm, request-payment | ✓ | ✓ | ✓ | ✓ (assigned orders, restricted) | — | — |
| GET /api/orders?scope=rider | — | — | — | ✓ only | — | — |
| Product DELETE, order → REFUNDED, payments/refund, settings PUT, staff CRUD, audit, stats, service-analytics, notification-health, dispatch-test | ✓ only | — | — | — | — | — |
| BandaGo sync / csv-import / CRM POST | ✓ | ✓ | — | — | — | — (or Bearer key) |
| BandaGo CRM GET | ✓ | ✓ | ✓ | — | — | — (or Bearer key) |

Full reasoning, ownership rules, and the rider transition subset: [../security/access-control.md](../security/access-control.md).

---

## 2. Endpoint summary

**Inventory**: 87 route files under `src/app/api/` (86 functional path items + the unused `/api` stub) exposing 115 operations across the 19 groups below — all covered in this reference and in [`../../openapi/sphere-api.yaml`](../../openapi/sphere-api.yaml).

`Auth` column: **Public** (no auth), **Customer** (own data), **Staff(roles)** (staff session, minimum roles listed), **Rider**, **Webhook/Cron/Bearer** (own scheme). Rate limits shown where a dedicated bucket exists.

### Auth

| Method | Path | Purpose | Auth | Rate limit |
| --- | --- | --- | --- | --- |
| POST | /api/auth/register | Create customer account + session | Public | 5/30 min/IP |
| POST | /api/auth/login | Password sign-in (email or phone) | Public | 10/15 min (IP+identifier) |
| POST | /api/auth/staff-login | Staff password sign-in | Public | 5/15 min (IP+email) |
| POST | /api/auth/logout | Destroy session (+ deregister push token) | Any session | — |
| GET | /api/auth/me | Session bootstrap | Any (anonymous OK) | — |
| PATCH | /api/auth/profile | Update name/avatar/email/phone/password | Customer | — |
| POST | /api/auth/otp/request | Send 6-digit SMS OTP | Public | 3/10 min (IP+phone) |
| POST | /api/auth/otp/verify | Verify OTP, create/claim account | Public | 8/10 min (IP+phone) |

### Addresses · Categories · Products

| Method | Path | Purpose | Auth | Rate limit |
| --- | --- | --- | --- | --- |
| GET/POST | /api/addresses | List / create saved addresses | Customer | — |
| PATCH/DELETE | /api/addresses/[id] | Update / delete own address | Customer (owner) | — |
| GET | /api/categories | Active categories + product counts | Public | — |
| GET | /api/products | Catalog search/filter/sort/page | Public (`?admin=yes` → staff) | — |
| POST | /api/products | Create product | Staff (ADMIN, PHARMACIST) | — |
| GET | /api/products/[id] | Product detail | Public | — |
| PATCH | /api/products/[id] | Update product (stock, price, flags) | Staff (ADMIN, PHARMACIST) | — |
| DELETE | /api/products/[id] | Delete / discontinue product | Staff (ADMIN) | — |
| GET/POST | /api/products/[id]/reviews | Review summary / leave review | Public / Customer (purchased) | — |
| POST | /api/products/[id]/stock-alert | Watch for restock | Customer | — |
| GET/DELETE | /api/products/stock-alerts | Watchlist / stop watching (`?id=`) | Customer | — |
| POST | /api/products/bulk | CSV product import (≤1,000 rows) | Staff (ADMIN, PHARMACIST) | — |

### Orders

| Method | Path | Purpose | Auth | Rate limit |
| --- | --- | --- | --- | --- |
| GET | /api/orders | Scope: mine (default) / all / dispatch / dispatch-history / rider | Customer / Staff / Rider | — |
| POST | /api/orders | Place order (guest checkout allowed) | Public | 12/15 min/IP |
| GET | /api/orders/[id] | Order detail (owner, staff, assigned rider, guest token) | Mixed | — |
| PATCH | /api/orders/[id] | Staff status transition | Staff (all roles; riders restricted) | — |
| POST | /api/orders/[id]/cancel | Cancel + release stock/points | Owner / staff (non-rider) / guest token | 8/15 min |
| POST | /api/orders/[id]/assign | Assign rider | Staff (ADMIN, PHARMACIST, STAFF) | — |
| POST | /api/orders/[id]/prepare | Accept order, begin packing | Staff (ADMIN, PHARMACIST, STAFF) | — |
| POST | /api/orders/[id]/cash-confirm | Record cash received | Staff (all roles; rider-restricted) | 20/15 min |
| POST | /api/orders/[id]/request-payment | Staff triggers M-Pesa STK to customer | Staff (all roles incl. RIDER) | 5/15 min (order id) |
| GET | /api/orders/loyalty | Sphere Points summary + history | Customer | — |
| GET | /api/orders/riders | Active riders for assignment | Staff (ADMIN, PHARMACIST, STAFF) | — |

### Prescriptions · Payments

| Method | Path | Purpose | Auth | Rate limit |
| --- | --- | --- | --- | --- |
| GET | /api/prescriptions | Own list / `?scope=queue` pharmacist queue | Customer / Staff (PHARMACIST, ADMIN) | — |
| POST | /api/prescriptions | Register uploaded prescription | Customer | 10/h/user |
| GET | /api/prescriptions/[id] | Detail + presigned file URL (logs access) | Owner / Staff (PHARMACIST, ADMIN) | — |
| PATCH | /api/prescriptions/[id] | Pharmacist review decision | Staff (PHARMACIST, ADMIN) | — |
| DELETE | /api/prescriptions/[id] | Soft delete | Owner / ADMIN | — |
| POST | /api/prescriptions/[id]/refill | Convert approved Rx into new order | Customer (owner) | 5/24 h |
| POST | /api/payments/mpesa/initiate | Start STK push | Owner/staff/guest token | 5/15 min (order+phone) |
| POST | /api/payments/mpesa/callback | Daraja order-payment webhook | `?token=` callback secret | — |
| GET | /api/payments/mpesa/query | Poll local payment state | Owner/staff/guest token | 40/10 min |
| POST | /api/payments/mpesa/service-callback | Daraja booking-payment webhook | `?token=` callback secret | — |
| POST | /api/payments/intasend/initiate | Create hosted checkout session | Owner/staff/guest token | 8/15 min (order) |
| POST | /api/payments/intasend/webhook | IntaSend signed webhook (orders + services) | IntaSend signature | — |
| POST | /api/payments/refund | Record/execute refund | Staff (ADMIN) | 10/h/staff |

### Services · Service bookings · Promotions · Medicine requests

| Method | Path | Purpose | Auth | Rate limit |
| --- | --- | --- | --- | --- |
| GET/POST | /api/services | List (active) / create service | Public / Staff (ADMIN, PHARMACIST, STAFF) | — |
| GET/PATCH/DELETE | /api/services/[id] | Detail / update / deactivate | Public (active) / Staff | — |
| GET/PUT | /api/services/[id]/availability | Read / replace weekly availability | Public GET / Staff PUT | — |
| GET | /api/services/[id]/slots | Bookable slots for a date | Public | — |
| GET | /api/services/[id]/reviews | Anonymized review summary | Public | — |
| GET/POST | /api/service-bookings | My bookings list / create booking | Customer | 8/h/user (POST) |
| GET | /api/service-bookings/mine | My appointments (alias) | Customer | — |
| POST | /api/service-bookings/[id]/pay-at-pharmacy | Mark pay-at-pharmacy intent | Customer (owner) | — |
| POST | /api/service-bookings/[id]/pay/card | IntaSend hosted checkout | Customer (owner) | 8/15 min/booking |
| POST | /api/service-bookings/[id]/pay/mpesa | STK push for booking | Customer (owner) | 5/15 min (booking+phone) |
| GET | /api/service-bookings/[id]/payment-status | Poll local payment state | Customer (owner) | 40/10 min |
| POST | /api/service-bookings/[id]/review | Rate completed booking | Customer (owner) | — |
| GET/POST | /api/promotions | List / create promotions | Public (active) / Staff (ADMIN, STAFF) | — |
| PATCH/DELETE | /api/promotions/[id] | Update / archive or delete | Staff (ADMIN, STAFF) | — |
| POST | /api/promotions/validate | Validate code against subtotal | Public | 40/min |
| POST | /api/medicine-requests | Guest "find this medicine" | Public (guest by design) | 10/h/IP |

### Notifications · Admin · Integrations · Location · Settings · Upload · Assistant · Cron

| Method | Path | Purpose | Auth | Rate limit |
| --- | --- | --- | --- | --- |
| GET/PATCH | /api/notifications | Inbox (last 100) / mark read | Any session | — |
| GET/PUT | /api/notifications/prefs | Channel preferences | Customer | — |
| POST/DELETE | /api/notifications/push-token | Register / remove device token | Any session | — |
| POST | /api/notifications/email-webhook | Resend delivery events | Svix signature | — |
| GET/POST | /api/notifications/dispatch-test | Config probe / send test | Staff (ADMIN) | 10/h (POST) |
| GET | /api/admin/stats | Dashboard KPIs + series | Staff (ADMIN) | — |
| GET | /api/admin/audit | Audit trail (latest 200) | Staff (ADMIN) | — |
| GET/POST | /api/admin/staff | List / create staff | Staff (ADMIN) | — |
| PATCH/DELETE | /api/admin/staff/[id] | Update / deactivate or delete staff | Staff (ADMIN) | — |
| GET | /api/admin/reviews | Review moderation queue | Staff (ADMIN, PHARMACIST) | — |
| PATCH | /api/admin/reviews/[id] | Publish/hide review | Staff (ADMIN, PHARMACIST) | — |
| GET/PATCH | /api/admin/medicine-requests | Queue / update status+notes | Staff (ADMIN, PHARMACIST, STAFF) | — |
| GET | /api/admin/medicine-requests/[id]/photo | Stream private photo | Staff (ADMIN, PHARMACIST, STAFF) | — |
| GET | /api/admin/service-analytics | Booking analytics | Staff (ADMIN) | — |
| GET/PATCH | /api/admin/service-bookings | Manage list / status+reschedule | Staff (ADMIN, PHARMACIST, STAFF) | — |
| PATCH | /api/admin/service-bookings/[id]/assign | Assign staff to booking | Staff (ADMIN, PHARMACIST, STAFF) | — |
| GET | /api/admin/service-staff | Assignable staff dropdown | Staff (ADMIN, PHARMACIST, STAFF) | — |
| GET | /api/admin/pos-status | BandaGo telemetry | Staff (ADMIN, PHARMACIST, STAFF) | — |
| GET | /api/admin/live-changes | Change cursors for polling | Staff (ADMIN, PHARMACIST, STAFF) | — |
| GET | /api/admin/notification-health | Delivery health | Staff (ADMIN) | — |
| POST | /api/integrations/bandago/sync | POS product/batch sync | Bearer key or Staff (ADMIN, PHARMACIST) | — |
| POST | /api/integrations/bandago/csv-import | POS CSV upload | Bearer key or Staff (ADMIN, PHARMACIST) | — |
| GET/POST | /api/integrations/bandago/crm | CRM lookup / reconcile | Bearer key or Staff (POST: ADMIN, PHARMACIST; GET adds STAFF) | — |
| GET | /api/location/search | Nominatim forward search (Kenya) | Public | 30/10 min/IP |
| POST | /api/location/reverse-geocode | Nominatim reverse geocode | Public | 30/10 min/IP |
| GET/PUT | /api/settings | Read / update store settings | Public (compliance redacted) / Staff (ADMIN) | — |
| GET | /api/settings/delivery-fee | Delivery fee quote | Public | — |
| POST | /api/upload | Upload to R2 (direct or presign) | Any session (folder rules) | 20/15 min/principal |
| POST | /api/assistant | AI assistant chat | Public | 40/h/IP |
| GET | /api/cron/notifications | Dispatch notification jobs | Bearer CRON_SECRET | — |
| GET | /api/cron/order-reservations | Expire stale reservations | Bearer CRON_SECRET | — |
| GET | /api/cron/chronic-refills | Chronic refill reminders | Bearer CRON_SECRET | — |
| GET | /api/cron/prescription-retention | Hard-delete expired Rx | Bearer CRON_SECRET | — |
| GET | /api/cron/service-booking-reminders | 24 h / 2 h booking reminders | Bearer CRON_SECRET | — |

---

## 3. Group details

### 3.1 Auth — `/api/auth/*`

**POST /api/auth/register** — Create a customer account and session.
Body ≤8 KB: `{ name (≥2 chars), email?, phone?, password }`; email OR phone required; Kenyan phone `/^(?:\+?254|0)?(7\d{8}|1\d{8})$/` normalized to `+254XXXXXXXXX`; password policy 10–128 chars with ≥1 letter + ≥1 digit. Output: `{ role: "CUSTOMER", user: UserDTO }` + session cookie. Errors: 400 validation, 409 duplicate email/phone. Side effects: scrypt password hash, best-effort NotificationPref row, session created. No email verification flow exists.

**POST /api/auth/login** — `{ identifier (email or phone, case-insensitive), password }` (≤4 KB). Generic 401 "Incorrect email/phone or password." (no account enumeration). Opportunistic scrypt re-hash for legacy hashes. Output: `{ role: "CUSTOMER", user }` + cookie.

**POST /api/auth/staff-login** — `{ email, password }` (≤4 KB). 403 if account inactive. Legacy-password hash upgrade is allowed even when the password fails current policy (documented trade-off). Output: `{ role: <staff role>, staff: StaffDTO }` + cookie.

**POST /api/auth/logout** — Optional body `{ token }` deregisters the caller's own push token; always destroys the session. Output `{ ok: true }`.

**GET /api/auth/me** — Anonymous: `{ ok: true, role: null }`. Signed in: `{ ok: true, role, user?|staff? }` (SessionPayload). `no-store`.

**PATCH /api/auth/profile** — Customer. Partial `{ name?, avatar?, email?, phone?, currentPassword?, newPassword? }`. 409 on email/phone clash; password change requires `currentPassword` + policy. Output: `{ role: "CUSTOMER", user }`.

**POST /api/auth/otp/request** — `{ phone }` (≤4 KB). Invalidates previous unused codes; stores only `HMAC-SHA256(OTP_HASH_SECRET, phone:code)`; 5-minute expiry; sends SMS via Africa's Talking (no demo code path). Output `{ sent: true }`. **Environment-dependent** (requires `AFRICAS_TALKING_*` credentials).

**POST /api/auth/otp/verify** — `{ phone, code }` (`/^\d{6}$/`, max 5 attempts, atomic single-use consume, timing-safe HMAC compare). Auto-creates the User (stamps `phoneVerifiedAt`); claims unclaimed guest orders matching phone + token hash, then clears the guest token; creates a customer session. Output: `{ role: "CUSTOMER", user }`.

### 3.2 Addresses — `/api/addresses`

**GET /api/addresses** — Customer's saved addresses, default first, cap 50. Returns `AddressDTO[]`.
**POST /api/addresses** — ≤16 KB. `{ label (≤80, default "Home"), text (5–500), area? (≤120), notes? (≤500), isDefault?, latitude?, longitude? }`; lat/lon must appear together and be in range. `isDefault: true` clears other defaults in a transaction. Returns `AddressDTO`.
**PATCH /api/addresses/[id]** — Partial update of an owned address (ownership via `findFirst(id + userId)` else 404).
**DELETE /api/addresses/[id]** — Delete owned address; `{ ok: true }`.

### 3.3 Categories — `/api/categories`

**GET /api/categories** — Public. Active categories ordered by `sortOrder` with active-product counts → `CategoryDTO[]` (`id, name, slug, description, icon, productCount`).

### 3.4 Products — `/api/products`

**GET /api/products** — Public catalog. Query: `search` (multi-term, case-insensitive over name/brand/sku/description/packSize/usageInfo/warnings/category), `category` (id or slug), `rx=any|yes|no`, `availability=any|in|low|out`, `sort=popular|price-asc|price-desc|name|name-desc|newest|oldest|stock-asc|stock-desc`, `page` (≥1), `pageSize` (1–100, default 12), `ids` (comma list, ≤50). `?admin=yes` requires a staff session (ADMIN/PHARMACIST/STAFF) and includes inactive products plus a `stockStatus` filter. Output `{ items: ProductDTO[], total, page, pageSize }`. Popular sort uses sold-quantity ranking with `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.

**POST /api/products** — Staff ADMIN/PHARMACIST, ≤32 KB. `{ name (2–160), price (0–10,000,000), stockQty ≥0, lowStockThreshold ≥0, stockStatus?, categoryId?, sku? (^[A-Z0-9._-]{3,64}$, auto-generated if absent), compareAtPrice? (> price), requiresPrescription?, active?, brand?, packSize?, description? (≤5,000), usageInfo?, warnings?, image? }`; image must be a managed image (site `/images/...` path or R2 public URL). 409 on SKU clash. Audits `PRODUCT_CREATED`.

**GET /api/products/[id]** — Public (active only) → `ProductDTO` with `avgRating`/`reviewCount`.
**PATCH /api/products/[id]** — Staff ADMIN/PHARMACIST, ≤32 KB. Partial fields as above; `stockStatus: "DISCONTINUED"` also deactivates; setting `stockQty` recomputes stock status unless overridden. Side effects: back-in-stock notifications to watchers (in-app + email, `notifiedAt` stamped), low-stock staff alerts, `PRICE_UPDATE`/`STOCK_UPDATE`/`PRODUCT_UPDATED` audit entries. Errors: 400 validation, 404.
**DELETE /api/products/[id]** — ADMIN only. If referenced by order items → soft-discontinue (`active:false`, `stockStatus:"DISCONTINUED"`, audit `PRODUCT_DISCONTINUED`); otherwise hard delete (audit `PRODUCT_DELETED`). Returns `{ ok: true }`.

**GET /api/products/[id]/reviews** — Public; published reviews (≤50) + `{ average (1 dp), count, breakdown[5..1] }`; the signed-in caller's own review is included with its moderation status.
**POST /api/products/[id]/reviews** — Customer; `{ rating (1–5), comment? (3–500) }`; one review per customer per product (409); requires a completed purchase (403). 201 → `ReviewDTO`.

**POST /api/products/[id]/stock-alert** — Customer; 400 if currently in stock, 409 if already watching; previously-notified watchers can re-arm. 201 → `StockAlert`.
**GET /api/products/stock-alerts** — Customer watchlist.
**DELETE /api/products/stock-alerts?id=** — Remove own alert (404 if not owned).

**POST /api/products/bulk** — Staff ADMIN/PHARMACIST, ≤2 MB body `{ csv }`. Header row required (`name`, `price` mandatory; optional `sku, category, brand, packSize, compareAtPrice, stockQty, stockStatus, requiresPrescription, description, image`); ≤1,000 product rows; quoted CSV supported. Rows are upserted by SKU (unknown categories left uncategorised with per-row errors). Returns `{ created, updated, errors[] }`; audits `CSV_IMPORT`.

### 3.5 Orders — `/api/orders`

**GET /api/orders** — Scopes:
- default (no `scope`): customer's own orders (401 if not signed in) — `OrderDTO[]`, `private, no-store`.
- `scope=all` (staff ADMIN/PHARMACIST/STAFF): filters `status`, `type`, `search` (≤80 chars over reference/guest contact/delivery area/customer name+phone), cursor pagination via `cursor` + `limit` (1–100, default 50).
- `scope=dispatch` (staff): DELIVERY orders in DISPATCH_STATUSES (PAID, PREPARING, READY_FOR_PICKUP, OUT_FOR_DELIVERY), searchable.
- `scope=dispatch-history` (staff): COMPLETED_DELIVERY within the last 7 days.
- `scope=rider` (RIDER only): own assigned DELIVERY orders in dispatch statuses.

**POST /api/orders** — Place an order. Public (guest) or customer; ≤64 KB; 1–50 items, qty 1–99 per line and aggregate. Body: `{ items: [{ productId, qty }], fulfillment: "PICKUP"|"DELIVERY", paymentMethod: "MPESA"|"CARD"|"CASH"|"LATER", customer?: { name, phone, email? } (guests), addressId? or delivery address fields, prescriptionIds?: [], promotionCode?, redeemPoints?, notes? (≤1,000) }`. The server recomputes all pricing (subtotal, promotion discount, delivery fee via settings, loyalty redemption capped at 25% of the discounted subtotal), re-validates the promotion under an advisory lock, and creates everything in one Serializable transaction (reference `SPH-<12hex>`, physical stock decrement with availability guard, loyalty debit with `gte` guard, order items snapshot, status history, prescription linking, PromotionRedemption, LoyaltyLedger). Initial status: Rx → `UNDER_REVIEW`; MPESA/CARD → `AWAITING_PAYMENT`; else `RECEIVED`. CASH is stored as `CASH_ON_DELIVERY`/`CASH_ON_PICKUP`; LATER creates a RESERVATION. Guest output additionally contains the one-time `guestAccessToken`. Errors: 400 cart/fulfillment/guest details, 401 Rx-without-account, 409 stock ("X does not have enough stock."), points changed, promotion limits. Side effects: in-app + email confirmation, staff notification (`NEW_ORDER` / `NEW_PRESCRIPTION_ORDER`). Deep dive: [../workflows/](../workflows/).

**GET /api/orders/[id]** — Access: owner, any staff (riders only their assigned DELIVERY orders), or guest token (header `x-order-access-token`, hash + 7-day expiry). 401 (no session/token) vs 403 (wrong identity) are distinguished. Returns `OrderDTO` (items, payments, prescriptions, statusHistory, rider).

**PATCH /api/orders/[id]** — Staff (all roles; riders restricted to assigned DELIVERY orders and only READY_FOR_PICKUP→OUT_FOR_DELIVERY→COMPLETED_DELIVERY). Body `{ status, note? (≤500) }`. Enforces the authoritative staff transition map plus semantic guards: CANCELLED/REFUNDED must use their dedicated endpoints; PAID needs a SUCCESS payment; READY_FOR_PICKUP needs all prescriptions APPROVED/PARTIALLY_APPROVED; completions need matching fulfillment + SUCCESS payment (+ rider for delivery); OUT_FOR_DELIVERY needs an assigned rider. Optimistic `version` guard → 409. Side effects: OrderStatusHistory + `ORDER_STATUS_<STATUS>` audit, customer in-app/email status update (special "ready for dispatch" wording), REJECTED notifies ADMIN/PHARMACIST.

**POST /api/orders/[id]/cancel** — Owner, staff (non-rider), or guest token. Allowed from RECEIVED…AWAITING_PAYMENT; blocked with 409 when a SUCCESS payment exists. Retries the optimistic version+inventory guard up to 3 times. Side effects: stock restore, `inventoryReleasedAt`, loyalty re-credit (`cancel:<orderId>`), PENDING/PROCESSING payments failed, history actor SYSTEM, audit `ORDER_CANCELLED`.

**POST /api/orders/[id]/assign** — Staff ADMIN/PHARMACIST/STAFF. Body `{ riderId }`; rider must be an active RIDER; order must be DELIVERY in DISPATCH_STATUSES. Idempotent for the same rider; version-guarded. Audits `RIDER_ASSIGNED`; notifies rider + customer.

**POST /api/orders/[id]/prepare** — Staff ADMIN/PHARMACIST/STAFF. Eligible: (PAID + SUCCESS payment) OR cash order in RECEIVED/PRESCRIPTION_VERIFIED/AVAILABILITY_CONFIRMED/AWAITING_PAYMENT; requires a live inventory reservation and fully-approved prescriptions; unpaid orders must have no PENDING/PROCESSING payment. Moves to PREPARING; audits `ORDER_PREPARATION_STARTED`; notifies customer.

**POST /api/orders/[id]/cash-confirm** — Staff (riders: only assigned CASH_ON_DELIVERY orders OUT_FOR_DELIVERY). Statuses AVAILABILITY_CONFIRMED/AWAITING_PAYMENT/READY_FOR_PICKUP/OUT_FOR_DELIVERY; all Rx approved; no SUCCESS payment. Serializable: creates CASH payment (`idempotencyKey cash:<orderId>`, SUCCESS, providerReference `CASH-<ref>`), moves to PAID when previously unpaid, awards points, audits `CASH_CONFIRMED`.

**POST /api/orders/[id]/request-payment** — Staff incl. riders. PAYABLE statuses PRESCRIPTION_VERIFIED/AVAILABILITY_CONFIRMED/AWAITING_PAYMENT/READY_FOR_PICKUP/OUT_FOR_DELIVERY; all Rx approved; phone = guest phone → user phone fallback; triggers STK push keyed `staff:{orderId}:mpesa:{idempotencyKey}`; moves order to AWAITING_PAYMENT; audits `PAYMENT_REQUESTED`.

**GET /api/orders/loyalty** — Customer. `{ balance, lifetimeEarned, pendingEarned, redeemedTotal, pointValue, minRedeem, maxRedeemPct, history[] (per-order), rules }` — lifetime figures are computed over the most recent 30 active orders, not a true lifetime total.

**GET /api/orders/riders** — Staff ADMIN/PHARMACIST/STAFF. Active RIDER staff for the assignment dropdown.

### 3.6 Prescriptions — `/api/prescriptions`

**GET /api/prescriptions** — Customer: own prescriptions (`limit` 1–100, default 50). `?scope=queue` (PHARMACIST/ADMIN): all prescriptions; the client re-sorts by priority PENDING < CLARIFICATION_REQUESTED < PARTIALLY_APPROVED < APPROVED < REJECTED. DTOs never expose `fileData`/`storageKey`; `fileUrl` is null in lists.

**POST /api/prescriptions** — Customer (guests blocked); 10/h/user. Two paths:
1. R2-first (preferred): the client uploads the binary via `POST /api/upload` (folder `prescriptions`), then posts `{ fileName (≤120), fileType (png/jpeg/jpg/webp/heic/pdf), storageKey, notes? (≤1,000) }`. The route verifies the key prefix `prescriptions/{userId}/`, HeadObject metadata `ownerid`/`category`, content type and 1–10 MB size.
2. base64 fallback: `{ fileName, fileType, fileData }` with magic-byte validation, uploaded to private R2.

Optional `orderId` attaches to one of the customer's own orders. Output: full `PrescriptionDTO` (201). Side effects: order history note when attached; customer IN_APP+email "Prescription received"; PHARMACIST+ADMIN `NEW_PRESCRIPTION` notification. Deep dive: [../workflows/](../workflows/).

**GET /api/prescriptions/[id]** — Owner or ADMIN/PHARMACIST (403 otherwise; 404 if missing/soft-deleted). Every access writes a `PrescriptionAccessLog` row (VIEW, or DOWNLOAD with `?download=1` → 302 redirect). `fileUrl` is a presigned R2 URL (30–300 s, `private, no-store`); presign failure → 503. `fileData` blanked, `storageKey` stripped.

**PATCH /api/prescriptions/[id]** — PHARMACIST/ADMIN review. Body `{ status ∈ PENDING|APPROVED|REJECTED|CLARIFICATION_REQUESTED|PARTIALLY_APPROVED, reviewNotes? (required unless APPROVED/PARTIALLY_APPROVED, ≤2,000), refillsAllowed? (0–6), validDays? ∈ {30,60,90,180} }`. `validUntil = now + validDays` only on approval. Aggregates to the linked order: all approved → PRESCRIPTION_VERIFIED; any REJECTED (all decided) → order REJECTED; else stays UNDER_REVIEW. Version bump + history + customer notification + audit `RX_<STATUS>`.

**DELETE /api/prescriptions/[id]** — Owner or ADMIN; order-linked prescriptions → 409 for non-admins; soft delete.

**POST /api/prescriptions/[id]/refill** — Customer (owner; non-owner sees 404). Eligibility: APPROVED/PARTIALLY_APPROVED, refills remaining, unexpired validity, source order with Rx lines that are still active and in stock. Serializable transaction: optimistic `refillsUsed+1` claim, per-line conditional stock decrement, creates a NEW order (type PRESCRIPTION, UNDER_REVIEW, current prices, copied fulfillment/address, fresh pickup code, `inventoryReservedAt`) plus a NEW PENDING Prescription row sharing the storage key (every refill use is re-verified by a pharmacist). Output 201 `{ orderId, reference }`. Audits `RX_REFILL_REQUESTED` (actor System).

### 3.7 Payments — `/api/payments`

See [../integrations/](../integrations/) for provider details and the payment audit history. Provider readiness is **environment-dependent**: M-Pesa needs `MPESA_*` config, IntaSend needs `INTASEND_*` config — otherwise 503 "not configured for this environment".

**POST /api/payments/mpesa/initiate** — Owner/staff/guest token (403 "You can only pay for your own order."). Body ≤8 KB `{ orderId, phone (Kenyan), idempotencyKey }`. Order must be exactly AWAITING_PAYMENT with total > 0 and no SUCCESS payment; the amount must be a positive whole-KES integer. Replays return the original `{ paymentId, checkoutRequestId, message: "Payment request already sent." }`; a PROCESSING payment <15 min old blocks new attempts (409). Success: `{ paymentId, checkoutRequestId, merchantRequestId, message }`. An uncertain provider response leaves the payment PROCESSING with a reconcile note + 503.

**POST /api/payments/mpesa/callback** — Daraja webhook authenticated by `?token=` vs `MPESA_CALLBACK_TOKEN` (timing-safe). ResultCode 0 → the server re-queries the STK status and verifies amount/currency/phone/receipt before trusting. Serializable: webhook event ledger (eventId `mpesa:{checkoutRequestId}:{resultCode}:{receipt|none}`), payment SUCCESS + providerReference=receipt, order PAID + version + history, loyalty award (`earn:<orderId>`), in-transaction notifications. Non-zero → payment FAILED + notification. Unknown checkoutRequestId → 404.

**GET /api/payments/mpesa/query?checkoutRequestId=** — Owner/staff/guest token. Read-only local DB state: `{ status, payment: { id, status, reference?, failureReason? }, orderStatus }`. Provider reconciliation happens only in authenticated webhooks/jobs (documented gap).

**POST /api/payments/mpesa/service-callback** — Mirrors the order callback for service bookings (ServicePayment; eventId prefix `mpesa-service:`; sets booking `paymentStatus: "PAID"`).

**POST /api/payments/intasend/initiate** — Same access/payability guards. Body `{ orderId, idempotencyKey, mode? }` — `mode` must be `checkout` ("Card details must be entered only on IntaSend's hosted checkout."). Retry while PROCESSING with a stored https providerReference returns the cached `{ paymentId, status, sessionId, checkoutUrl }`. Success: `{ paymentId, status: "PROCESSING", checkoutUrl, sessionId }` — redirect the customer to the hosted page. Returning from hosted checkout never establishes payment success; only the webhook does.

**POST /api/payments/intasend/webhook** — Signature verification (HMAC-SHA256 of the raw body, body challenge, or secret header) plus mandatory server-side invoice re-fetch (`getIntaSendInvoice`); the webhook body is only a trigger. Matches payments by provider INTASEND + (apiRef = payment id | order reference | checkout id). COMPLETE → SUCCESS + order PAID (or booking PAID) + loyalty; FAILED/CANCELLED → FAILED "Card payment was not completed". Event ledger with replay/conflict semantics (409).

**POST /api/payments/refund** — ADMIN only; 10/h/staff; ≤16 KB. Body `{ paymentId, reason (≤100), details? (≤500), cashConfirmed?, cashRefundReference? }`. CASH: requires explicit confirmation + till reference (`CASH:<ref>`). M-Pesa SUCCESS: refused 409 — B2C refunds must be completed/verified in the M-Pesa organisation portal before recording. INTASEND: creates a provider refund (`REFUND_PENDING`), later finalized via refund-state polling → `finalizeRefund` (payment REFUNDED, order REFUNDED + history, loyalty clawback/re-credit, refund notice in-app + email). Audits `REFUND_REQUESTED` / `PAYMENT_REFUNDED` / `CASH_REFUND_CONFIRMED`. Note: captured payments are never auto-refunded on order cancel.

### 3.8 Services — `/api/services`

**GET /api/services** — Public, active-only; `?includeInactive=true` (staff) returns all. `ServiceDTO[]` (duration, price `null` = free/POA, managed hero image, images ≤10).
**POST /api/services** — Staff ADMIN/PHARMACIST/STAFF. Creates a service; slug auto-generated with a `-timestamp` suffix on collision.
**GET /api/services/[id]** — Public if active.
**PATCH /api/services/[id]** — Staff; update fields incl. imagery (managed-image validation) and sortOrder (−10,000..10,000).
**DELETE /api/services/[id]** — Staff; soft deactivate.
**GET /api/services/[id]/availability** — Public: weekly rules (`dayOfWeek` 0–6, `HH:MM` start/end, `enabled`).
**PUT /api/services/[id]/availability** — Staff; replaces the whole rule set (≤35 non-overlapping same-day rules; end > start).
**GET /api/services/[id]/slots?date=YYYY-MM-DD** — Public; per-rule slots stepped by `durationMinutes`; past slots and conflicting bookings (non-CANCELLED/REJECTED/NO_SHOW) rejected; capacity 1 per slot; Nairobi fixed UTC+3. Returns `[{ start, end, label }]`.
**GET /api/services/[id]/reviews** — Public; `{ average (1 dp), count, reviews[] }` with anonymized author names.

### 3.9 Service bookings — `/api/service-bookings`

**POST /api/service-bookings** — Customer; ≤16 KB; 8/h/user. Body `{ serviceId, start, end, expectedPrice?, customerNotes? (≤1,000) }`. `expectedPrice` must equal the current price exactly (409 "price changed"); duration must equal `durationMinutes`; must be future, ≤180 days ahead, fit one Nairobi weekday inside an enabled availability window, and not conflict with another booking (409 "That slot was just booked"). Creates reference `SPB-<12hex uppercase>`, status PENDING, price snapshot, paymentStatus UNPAID, history actor CUSTOMER; notifies customer + staff. 201 → `ServiceBookingDTO`.

**GET /api/service-bookings** and **GET /api/service-bookings/mine** — Customer; own bookings with service info and status history (there is intentionally no public `[id]` GET — clients use these lists or the admin manage scope).

**POST /api/service-bookings/[id]/pay-at-pharmacy** — Customer (owner). Marks intent only: paymentStatus `PAY_AT_PHARMACY` + upsert ServicePayment (IN_STORE/PAY_AT_PHARMACY/PENDING, key `service:{id}:pay-at-pharmacy`); idempotent; rejected if PAID, terminal status, or online payment in flight. No service cash-settlement endpoint exists (documented gap).

**POST /api/service-bookings/[id]/pay/card** — Customer (owner); 8/15 min/booking. `{ idempotencyKey }`; IntaSend hosted checkout keyed `service:{id}:intasend:{key}`; cached checkout URL on retry; returns `{ paymentId, status: "PROCESSING", checkoutUrl, sessionId }`.

**POST /api/service-bookings/[id]/pay/mpesa** — Customer (owner); 5/15 min keyed booking+phone. `{ phone, idempotencyKey }`; STK push with callback `mpesa/service-callback`.

**GET /api/service-bookings/[id]/payment-status** — Customer (owner); 40/10 min; read-only latest ServicePayment status or booking paymentStatus; `private, no-store`.

**POST /api/service-bookings/[id]/review** — Customer (owner); `{ rating (1–5), comment? (≤1,000) }`; booking must be COMPLETED; one review per booking per customer; published with `staffId` = assigned staff.

### 3.10 Promotions — `/api/promotions`

**GET /api/promotions** — Public: active + public + in-window + non-exhausted, ≤100. `?all=1` (ADMIN/STAFF): up to 500 including private/inactive.
**POST /api/promotions** / **PATCH /api/promotions/[id]** — Staff ADMIN/STAFF. Only rule type: percentage discount on subtotal (`discountPct` 1–90); `code ^[A-Z0-9_-]{3,32}$` required for private promos; usage limits (max/per-user/per-IP/per-browser 1–1,000,000); `minimumSpend` 0–10 M; window dates parsed as Kenya-local days. Audits `PROMOTION_CREATED/UPDATED`.
**DELETE /api/promotions/[id]** — Hard-deletes only with zero redemptions; otherwise archives (`active:false`, audit `PROMOTION_ARCHIVED`).
**POST /api/promotions/validate** — Public; 40/min. Body `{ code, subtotal }` (subtotal 0–10 M, non-zero). Checks existence (404), active (409), percentage (409), started (409), expired (410), minimum spend (400 "Add KSh X more"), max uses (409), per-user (guests 401; signed-in 409), per-IP (fails closed 503 without ipHash), per-browser (cookie). Sets the `sphere_promo_device` cookie (httpOnly, Lax, 1 year). Output `{ promotion: {...}, discountAmount }`. Infrastructure failures → 503 with errorId, never mislabeled as invalid codes.

Order-placement enforcement re-validates everything inside the Serializable create transaction under `pg_advisory_xact_lock(promotion.id)` — exactly one promo per order, discount applied before loyalty redemption, delivery never discounted.

### 3.11 Medicine requests — `/api/medicine-requests`

**POST /api/medicine-requests** — Public by design (guest "find this medicine"); 10/h/IP; body cap ≈4 MB plus a hard stream cap → 413 "Photo is too large — 3MB maximum". Zod-validated `{ medicineName (2–200), phone (≤30, normalized +254…), photo? { name (1–120), type jpeg/png/webp, base64 ≤ ~4 MB } }`. The photo is magic-byte validated and stored privately at `medicine-requests/{uuid}.{ext}`; orphan objects are cleaned up if row creation fails. Output 201 `{ id }`, `no-store`. No notifications fire — staff monitor the admin queue.

### 3.12 Notifications — `/api/notifications`

**GET /api/notifications** — Any session (customer or staff); own inbox, last 100, `private, no-store`.
**PATCH /api/notifications** — Mark one (`{ id }`) or all read. `{ ok: true }`.
**GET/PUT /api/notifications/prefs** — Customer. Partial booleans `{ sms?, whatsapp?, email?, push? }` (upsert; "Nothing to update" → 400). Only email+push influence actual delivery; sms/whatsapp are stored but never dispatched.
**POST /api/notifications/push-token** — Any session. `{ token (32–4,096 chars, not JSON/dev-FCM placeholder), platform? (≤200) }`; upserts ownership to user/staff. **DELETE** removes the token (scoped to the caller).
**POST /api/notifications/email-webhook** — Resend/Svix signed (≤64 KB); persists the EmailDeliveryEvent *before* acknowledging (events can precede the send response); maps delivered/bounced/complained/failed; bounced/complained addresses are later suppressed by the dispatcher.
**GET /api/notifications/dispatch-test** — ADMIN config probe: email configuration, push project, device counts.
**POST /api/notifications/dispatch-test** — ADMIN; 10/h. `{ type: EMAIL|PUSH|BOTH, title (≤100), message (≤500) }`; sends a real test email to the admin's own address and a real FCM push to the admin's registered tokens; audits `NOTIFICATION_TEST`; 422 on provider rejection.

### 3.13 Admin — `/api/admin/*`

**GET /api/admin/stats** — ADMIN. `{ ordersToday/ThisWeek, revenueToday/ThisWeek/Total (SUCCESS payments), activeOrders, awaitingPayment, pendingPrescriptions, product counts by stock status, totalCustomers, ordersByDay (14-day gap-filled), topProducts (10), rxVsOtc, statusBreakdown }`.
**GET /api/admin/audit** — ADMIN; latest 200 audit rows newest-first.
**GET/POST /api/admin/staff** — ADMIN. Create: `{ name, email, role ∈ ROLES, password (policy), phone?, title? }` (409 on email clash; audit `STAFF_CREATED`).
**PATCH /api/admin/staff/[id]** — ADMIN. Role/active/password changes bump `authVersion` and revoke that staff member's sessions. Guards: cannot deactivate or delete your own account. Audit `STAFF_UPDATED`.
**DELETE /api/admin/staff/[id]** — ADMIN. With live sessions → deactivate + revoke; otherwise hard delete. Audits `STAFF_DEACTIVATED`/`STAFF_DELETED`.
**GET /api/admin/reviews** — ADMIN/PHARMACIST; moderation queue (`?status=PUBLISHED|HIDDEN`), ≤300 rows.
**PATCH /api/admin/reviews/[id]** — ADMIN/PHARMACIST; `{ status: PUBLISHED|HIDDEN }`; audits `REVIEW_PUBLISHED`/`REVIEW_HIDDEN`.
**GET /api/admin/medicine-requests** — Staff ADMIN/PHARMACIST/STAFF; `?status=`, `?search=` (≤200, contains over name/phone), `page` 1–10000, pageSize fixed 25. The photo URL is the proxied staff endpoint when a photo exists.
**PATCH /api/admin/medicine-requests** — Staff; `{ id, status ∈ NEW|CONTACTED|FULFILLED|UNAVAILABLE, staffNotes? (≤1,000) }`; audits `UPDATE_MEDICINE_REQUEST` with previous/new values.
**GET /api/admin/medicine-requests/[id]/photo** — Staff; streams the private R2 object with the original Content-Type, inline, `private, no-store`, nosniff. No presigned URL is exposed.
**GET /api/admin/service-analytics** — ADMIN; `?from=&to=` (default 30 days): totals, completed, cancelled, revenue, completionRate, byService.
**GET /api/admin/service-bookings** — Staff; `?scope=overview` (pendingCount, upcomingCount, pendingPreview 4, nextBooking) | `manage` (views queue/upcoming/history/all; status, range today|next7|custom ≤366 d, staffId incl. unassigned, search ≤120, page/pageSize 5–50 default 20) | `detail` (latest 100 history rows).
**PATCH /api/admin/service-bookings** — Staff; status transitions per the booking state machine (PENDING→CONFIRMED/CANCELLED/REJECTED/RESCHEDULED; CONFIRMED→ARRIVED/CANCELLED/RESCHEDULED; ARRIVED→IN_PROGRESS/NO_SHOW; IN_PROGRESS→COMPLETED; RESCHEDULED→CONFIRMED/CANCELLED; terminal→none; invalid → 409). Reschedule = same PATCH with `scheduledStart/scheduledEnd` (validation mirrors creation). Notifies on reschedule.
**PATCH /api/admin/service-bookings/[id]/assign** — Staff; `{ staffId | null }`; target must be active ADMIN/PHARMACIST/STAFF; notifies the assignee (`SERVICE_ASSIGNED`).
**GET /api/admin/service-staff** — Staff; active assignable staff list.
**GET /api/admin/pos-status** — Staff ADMIN/PHARMACIST/STAFF; BandaGo telemetry: mapped products, batches, near-expiry count (<90 d), last sync, recent 20 PosSyncLogs.
**GET /api/admin/live-changes** — Staff ADMIN/PHARMACIST/STAFF; metadata-only change cursors for orders/bookings (arrival + change); `Vary: Cookie`. Polled by the admin workspace every 15 s.
**GET /api/admin/notification-health** — ADMIN; delivery job counts by channel/status, oldest pending, last 20 failures, provider configuration flags. Exposes no message bodies, addresses, or tokens.

### 3.14 BandaGo POS integration — `/api/integrations/bandago/*`

Auth is dual-mode: `Authorization: Bearer <BANDAGO_SYNC_API_KEY>` or an active ADMIN/PHARMACIST staff session (CRM GET adds STAFF). See [../integrations/](../integrations/) for the full architecture. **Requires live verification** against the real BandaGo instance; the Chrome MV3 extension (`api_data_transformer`) is external to this repo.

**POST /api/integrations/bandago/sync** — Upsert product/batch inventory. Body: `{ trigger ∈ EXTENSION_STREAM|BACKGROUND_POLL|CSV_IMPORT|MANUAL_RECONCILE, items: [{ externalPosId, name, price, costPrice?, stock, sku?, slug?, categorySlug?, requiresPrescription?, imageUrl?, nearestExpiryDate?, dosageForm?, strength?, batches? [{ batchNumber, qtyOnHand, expiryDate?, externalBatchId? }] }] }`. Pipeline: expired-lot cleanup → normalizer (PPB Rx classification never downgrades; FEFO batch aggregation; slug/SKU collision handling; custom local images preserved) → chunked transactions (50/chunk with per-item fallback). Always HTTP 200 with `{ success, upsertedCount, failedCount, durationMs, timestamp, errors? (≤20) }` where `success` reflects SUCCESS/PARTIAL/FAILED. PosSyncLog telemetry is written at start and finalization. Fatal pipeline errors → 500.

**POST /api/integrations/bandago/csv-import** — `multipart/form-data` file (≥1 header + 1 data row); robust CSV parsing (multiline quotes, escaped `""`, CRLF, BOM) with column aliases for iDempiere headers; delegates internally to the sync route with `trigger: CSV_IMPORT`. Known concern: a hard-coded fallback secret applies when the env var is unset.

**GET /api/integrations/bandago/crm** — `?phone=` (normalized E.164) or `?bpartnerId=` → customer profile + last 5 orders; 404 "Customer not found". Default `?daysThreshold=30` → chronic-refill eligibility list.
**POST /api/integrations/bandago/crm** — Array, `{ customers: [...] }`, or single object of `{ phone (required), name?, email?, externalBPartnerId?, loyaltyDelta?, posCreditBalance?, isChronicPatient? }`; per-record errors keyed by phone; own PosSyncLog row; `{ success: true, reconciledCount, failedCount, errors?, durationMs }`.

### 3.15 Location — `/api/location/*`

OpenStreetMap Nominatim proxy (no Google). **Environment-dependent** on the public Nominatim service.
**GET /api/location/search?q=** — Public; 30/10 min; q 2–120 chars; Kenya-restricted (`countrycodes=ke`), limit 5. Output `{ results: [{ displayName, latitude, longitude }] }`; upstream failure → 502.
**POST /api/location/reverse-geocode** — `{ latitude, longitude }` (range-validated); 30/10 min. Output `{ displayName, area, city, latitude, longitude }`.

### 3.16 Settings — `/api/settings`

**GET /api/settings** — Public. `{ pharmacy, delivery, compliance }`; compliance (PPB licence/superintendent) is redacted to empty strings below ADMIN/PHARMACIST — "Recording compliance details is not PPB verification or authorization to publish". `private, no-store`.
**PUT /api/settings** — ADMIN; ≤64 KB. Partial `{ pharmacy {...} }` and/or `{ delivery { mode flat|zone, pricingMode zone|distance, flatFee ≥0, freeOver?, nightDelivery, zones ≤50, distanceBands ≤30 ordered non-overlapping, pharmacyLocation (required with distance pricing) } }` and/or `{ compliance {...} }` (audited "Internal compliance record updated (not PPB-verified)"). Every save writes an audit row.
**GET /api/settings/delivery-fee?area=&lat=&lon=&subtotal=** — Public quote `{ fee, freeOver, mode, pricingMode, distanceKm? }`.

### 3.17 Upload — `/api/upload`

**POST /api/upload** — Any signed-in session; 20/15 min/principal. Folders and permissions: `prescriptions` (customer-only), `avatars` (any session), `products`/`services` (ADMIN/PHARMACIST), `general` (ADMIN/STAFF). Direct multipart upload: MIME allowlist jpeg/png/webp/gif/heic-heif/pdf, ≤10 MB, magic-byte sniffing, extension/MIME match; keys `{folder}/{ownerId}/{uuid}.{ext}`; metadata `ownerid`/`originalname`/`category`; `safeName` ≤80. `action: "presign"` (presigned PUT, prescriptions folder only): body `{ folder: "prescriptions", fileName, fileType, fileSize (1–10 MB) }` → signed URL valid 30–300 s. Output includes the storage key / public URL as applicable.

### 3.18 Assistant — `/api/assistant`

**POST /api/assistant** — Public (no session is ever read); 40/h/IP; ≤20 KB. Body `{ messages: [{ role: "user"|"assistant", content }] }` (last 8 kept, final user message truncated to 1,800 chars). Pipeline: credential patterns → safety triage (emergency/medical-suitability escalation) → deterministic intent → optional Groq LLM (`GROQ_API_KEY`/`GROQ_MODEL`, 15 s timeout, 650 max tokens; skipped for direct-request patterns and provider outages) → output hardening (zod intent, no credentials, no false success claims). Output `{ reply, actions[], escalated }` where actions are client-side navigation/search/product/book/pay cards. The route can only query PUBLIC catalog/service data; account and payment actions are executed client-side through authenticated endpoints. **Environment-dependent** (degrades deterministically without `GROQ_API_KEY`).

### 3.19 Cron — `/api/cron/*`

All GET with `Authorization: Bearer CRON_SECRET` (≥32 chars). Scheduling is an external deployment responsibility (no in-repo scheduler). **Requires live verification** of the scheduler wiring.

| Endpoint | Cadence (intended) | Behavior |
| --- | --- | --- |
| /api/cron/notifications | every minute | Dispatches ≤10 due NotificationDelivery jobs (claim leases, retries with backoff, email/push send, Resend event reconciliation). Returns `{ accepted, failed, skipped }`. |
| /api/cron/order-reservations | TTL-driven | Cancels stale unpaid reserved orders (requires `ORDER_RESERVATION_TTL_MINUTES` 15–10,080 else 503); batch 100; restores stock, re-credits points (`expire:<orderId>`), fails dangling payments. Returns `{ ok, released }`. |
| /api/cron/chronic-refills | daily | BandaGo CRM chronic-refill eligibility (30 d) → IN_APP + email reminders, ≤1 per patient per 7 days. Returns `{ ok, eligible, notified }`. |
| /api/cron/prescription-retention | periodic | Hard-deletes soft-deleted prescriptions past `PRESCRIPTION_RETENTION_DAYS` (30–36,500 else 503); R2 delete then row delete; skips shared storage keys; batch 100. Returns `{ ok, removed }`. |
| /api/cron/service-booking-reminders | ≥ every 15 min | Queues 24 h and 2 h booking reminders (stable dedupe keys; fail-fast 503 on first queueing error). Returns `{ ok, queued }`. |

---

## 4. Machine-readable contract & further reading

- OpenAPI 3.1.0 document: [`../../openapi/sphere-api.yaml`](../../openapi/sphere-api.yaml)
- DTO source of truth: `src/lib/types.ts` · typed client: `src/lib/api-client.ts`
- Architecture and session model: [../architecture/api-architecture.md](../architecture/api-architecture.md)
- Access control, rate limits, webhook auth: [../security/access-control.md](../security/access-control.md)
- Order/checkout, payment, prescription, and booking deep dives: [../workflows/](../workflows/)
- BandaGo POS/CRM, M-Pesa Daraja, IntaSend, Resend/FCM: [../integrations/](../integrations/)
- Payment notification audit history: [../payment-notification-audit.md](../payment-notification-audit.md)

---

## Appendix A — Rate-limit bucket catalogue

All buckets are fixed-window, keyed `scope:sha256(clientIp + ":" + identity)`; breaches return 429 + `Retry-After` + `no-store`. "Keyed by" adds an identity component beyond the client IP.

| Bucket | Limit / window | Keyed by | Endpoint(s) |
| --- | --- | --- | --- |
| `register` | 5 / 30 min | IP | POST /api/auth/register |
| `customer-login` | 10 / 15 min | IP + identifier | POST /api/auth/login |
| `staff-login` | 5 / 15 min | IP + email | POST /api/auth/staff-login |
| `otp-request` | 3 / 10 min | IP + phone | POST /api/auth/otp/request |
| `otp-verify` | 8 / 10 min | IP + phone | POST /api/auth/otp/verify |
| `order-create` | 12 / 15 min | IP | POST /api/orders |
| `order-cancel` | 8 / 15 min | — | POST /api/orders/[id]/cancel |
| `cash-confirm` | 20 / 15 min | — | POST /api/orders/[id]/cash-confirm |
| `staff-payment-request` | 5 / 15 min | order id | POST /api/orders/[id]/request-payment |
| `mpesa-initiate` | 5 / 15 min | orderId + phone | POST /api/payments/mpesa/initiate |
| `intasend-initiate` | 8 / 15 min | orderId | POST /api/payments/intasend/initiate |
| `mpesa-status` | 40 / 10 min | checkoutRequestId | GET /api/payments/mpesa/query |
| `service-booking` | 8 / 60 min | userId | POST /api/service-bookings |
| `service-mpesa` | 5 / 15 min | bookingId + phone | POST /api/service-bookings/[id]/pay/mpesa |
| `service-card` | 8 / 15 min | bookingId | POST /api/service-bookings/[id]/pay/card |
| `service-payment-status` | 40 / 10 min | — | GET /api/service-bookings/[id]/payment-status |
| `prescription-create` | 10 / 60 min | userId | POST /api/prescriptions |
| `prescription-refill` | 5 / 24 h | — | POST /api/prescriptions/[id]/refill |
| `medicine-request-create` | 10 / 60 min | IP | POST /api/medicine-requests |
| `upload` | 20 / 15 min | principal | POST /api/upload |
| `promotion-validate` | 40 / 60 s | IP | POST /api/promotions/validate |
| `refund` | 10 / 60 min | staffId | POST /api/payments/refund |
| `notification-test` | 10 / 60 min | admin | POST /api/notifications/dispatch-test |
| `assistant` | 40 / 60 min | IP | POST /api/assistant |
| `location-search` | 30 / 10 min | IP | GET /api/location/search |
| `reverse-geocode` | 30 / 10 min | IP | POST /api/location/reverse-geocode |

## Appendix B — Idempotency key catalogue

| Server key | Set by | Purpose |
| --- | --- | --- |
| `order:{orderId}:mpesa:{clientKey}` | POST /api/payments/mpesa/initiate | One STK attempt per client key per order |
| `order:{orderId}:intasend:{clientKey}` | POST /api/payments/intasend/initiate | One hosted-checkout session per client key |
| `staff:{orderId}:mpesa:{clientKey}` | POST /api/orders/[id]/request-payment | Staff-initiated STK pushes |
| `service:{bookingId}:mpesa\|intasend:{clientKey}` | service booking payment endpoints | Booking payment attempts |
| `service:{bookingId}:pay-at-pharmacy` | pay-at-pharmacy endpoint | Intent marker upsert |
| `cash:{orderId}` | POST /api/orders/[id]/cash-confirm | Exactly one cash payment per order |
| `mpesa:{checkoutRequestId}:{resultCode}:{receipt\|none}` | M-Pesa callbacks | Webhook event ledger (order payments) |
| `mpesa-service:{...}` | M-Pesa service callback | Webhook event ledger (bookings) |
| `intasend:{event_id\|invoice:state:tracking}` | IntaSend webhook | Webhook event ledger |
| `earn:\|redeem:\|expire:\|cancel:\|refund-earn:\|refund-redeem:{orderId}` | callbacks, cancel, cron, refund | Loyalty ledger idempotency |
| `Order.version` optimistic guard | all order mutations | 409 "order changed" on concurrent writes |
