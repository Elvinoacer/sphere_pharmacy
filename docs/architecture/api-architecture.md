# Sphere Pharmacy — API Architecture

This document explains how the HTTP surface of Sphere Pharmacy is organized: the route domains under `src/app/api`, the session-guard pattern every handler starts with, the database-backed fixed-window rate limiter, request body caps, response conventions, and the guest access token pattern that lets signed-out customers pay for and track their orders. For the per-endpoint catalogue see [../api/api-reference.md](../api/api-reference.md); for the machine-readable contract see [../../openapi/sphere-api.yaml](../../openapi/sphere-api.yaml). For how handlers use services and transactions, see [backend-architecture.md](backend-architecture.md).

| Audience | Status | Verified |
| --- | --- | --- |
| Engineers, AI coding agents | Implemented — verified against code | November 2026 |

## 1. Surface organization

The API is one Next.js App Router tree: `src/app/api/**/route.ts`, **95 route modules exporting 126 HTTP method handlers**. (The bare `GET /api` stub returning a placeholder greeting is scaffold residue.) Routes are grouped by domain; authorization is a cross-cutting guard applied per handler, and the authoritative route→role matrix lives in [../security/access-control.md](../security/access-control.md).

| Domain | Route prefix | Scope |
| --- | --- | --- |
| Auth | `/api/auth` | `register`, `login`, `staff-login`, `logout`, `me`, `profile`, `otp/request`, `otp/verify` — see [authentication.md](authentication.md) |
| Addresses | `/api/addresses` | Customer address book CRUD; rows scoped `findFirst({ id, userId })` else 404 |
| Products | `/api/products` | Catalog reads (public), `[id]` detail, `[id]/reviews`, `[id]/stock-alert` + `stock-alerts`, `bulk` (staff upsert); `[id]` mutations PHARMACIST+ADMIN, delete admin-only |
| Categories | `/api/categories` | Public category list |
| Orders | `/api/orders` | Create (guest or customer), my/all/dispatch/dispatch-history/riders/loyalty, `[id]` GET/PATCH, `[id]/cancel`, `[id]/prepare`, `[id]/assign`, `[id]/cash-confirm`, `[id]/request-payment` |
| Prescriptions | `/api/prescriptions` | Upload/list, `[id]` GET (owner or ADMIN/PHARMACIST; every access logged), `[id]/refill` |
| Payments | `/api/payments` | `mpesa/initiate`, `mpesa/query`, `mpesa/callback`, `mpesa/service-callback`, `intasend/initiate`, `intasend/webhook`, `refund` (ADMIN) |
| Service bookings | `/api/service-bookings` | Create, `mine`, `[id]/pay/mpesa`, `[id]/pay/card`, `[id]/pay-at-pharmacy`, `[id]/payment-status`, `[id]/review` |
| Services | `/api/services` | Public service catalog, `[id]`, `[id]/slots`, `[id]/availability`, `[id]/reviews`; staff surface via `/api/admin/service-staff` |
| Promotions | `/api/promotions` | List (public = active, `isPublic`, in window, not exhausted), `[id]` admin CRUD, `validate` |
| Medicine requests | `/api/medicine-requests` | Guest-friendly phone-only requests; staff queue under `/api/admin/medicine-requests` (+ `[id]/photo`) |
| Notifications | `/api/notifications` | List, `prefs`, `push-token`, `email-webhook` (Resend), `dispatch-test` (ADMIN) |
| Admin | `/api/admin` | `stats`, `audit`, `staff` (+ `[id]`), `reviews` (+ `[id]`), `medicine-requests`, `service-bookings` (+ `[id]/assign`), `pos-status`, `pos-sync/policy`, `pos-sync/reconcile`, `pos-sync/sales-export`, `live-changes`, `notification-health`, `service-analytics`, `service-staff` |
| Integrations | `/api/integrations/bandago` | `sync` (POS product/batch push + drift protection), `crm` (GET any staff, POST PHARMACIST+ADMIN), `csv-import`, `outbound` (claim jobs), `outbound/ack`, `telemetry`; dual-authenticated with timing-safe fail-closed `BANDAGO_SYNC_API_KEY` or staff session |
| Location | `/api/location` | `search`, `reverse-geocode` (Nominatim proxies) |
| Settings | `/api/settings` | GET public profile; PUT ADMIN; `delivery-fee` quote endpoint |
| Upload | `/api/upload` | Direct + presigned uploads to R2 with folder-based permissions |
| Assistant & Docs | `/api/assistant`, `/api/docs-index`, `/api/docs-assistant` | AI storefront chat & documentation portal search/Q&A; deliberately **never read the session cookie** — public data only |
| Cron | `/api/cron` | 5 maintenance jobs, `Authorization: Bearer CRON_SECRET` |

## 2. The guard pattern

Guards live in `src/lib/session.ts` and return a discriminated union — either the session or a ready-to-return `Response`. The idiom in every protected handler:

```ts
const { session, error } = await requireStaff(["ADMIN", "PHARMACIST"])
if (error) return error
```

| Guard | Success condition | Failure responses |
| --- | --- | --- |
| `requireCustomer()` | Session exists, `role === "CUSTOMER"`, `userId` set | 401 `{ error: "Please sign in to your account to continue." }` |
| `requireStaff(roles?)` | Session exists with `staffId`; if `roles` given, `staffRole` must be included | 401 `{ error: "Staff sign-in required." }`; 403 `{ error: "You do not have permission to perform this action." }` |
| `requireAuth()` | Any valid session (customer or staff) | 401 `{ error: "Please sign in to continue." }` |

Guards are the *first* authorization step, not the last: handlers follow with ownership checks (order `userId` scope, guest token, rider assignment, prescription owner-or-clinician) and state guards (payable statuses, approved prescriptions, version checks). 404 is preferred over 403 where existence itself is sensitive (e.g. requesting a refill on someone else's prescription returns 404).

### Anatomy of a handler

A representative mutation handler assembles the same blocks in the same order:

```ts
export async function POST(request: Request) {
  const oversized = rejectOversizedRequest(request, 16_384)      // 1. body cap → 413
  if (oversized) return oversized
  const limited = await enforceRateLimit(request, "example", 8, 15 * 60_000, sessionIdentity)
  if (limited) return limited                                     // 2. rate limit → 429
  const { session, error } = await requireCustomer()              // 3. guard → 401
  if (error) return error
  const body = await request.json().catch(() => null)             // 4. parse + field checks → 400
  if (!body || !isValid(body)) {
    return NextResponse.json({ error: "…" }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }
  // 5. service-layer call: business rules + Serializable transaction (see backend-architecture.md)
  // 6. DTO response with no-store; unexpected failures via publicError() → errorId
}
```

Order matters: cheap header-based rejections (413, 429) precede JSON parsing, which precedes any database work.

### Adding a new endpoint — checklist

1. Pick the domain folder; name the method(s) explicitly (`GET`/`POST`/`PATCH`/`PUT`/`DELETE` — no catch-all).
2. Choose the guard (`requireCustomer` / `requireStaff(roles)` / `requireAuth` / public) and the ownership rule; update [../security/access-control.md](../security/access-control.md).
3. Add a rate-limit bucket with a named scope and a sensible identity; add a body cap.
4. Return DTOs from `dto.ts`/`types.ts`; errors as `{ error }` + status; `no-store` for session-scoped data.
5. Add or extend the typed namespace in `src/lib/api-client.ts` and the entry in [../api/api-reference.md](../api/api-reference.md) + [../../openapi/sphere-api.yaml](../../openapi/sphere-api.yaml).

## 3. Rate limiting architecture

Implemented in `src/lib/security/request.ts` (`enforceRateLimit`), state lives in the `RateLimitBucket` table (`key` @id, `count`, `windowEnds`) — the limiter is DB-backed, so it works across instances with no memory affinity.

- **Key formula:** `` `${scope}:${sha256(clientIp + ":" + (identity ?? ""))}` `` — the scope names the bucket, the hash mixes the client IP with an optional identity (identifier, email, phone, orderId, userId, staffId, checkoutRequestId, or principal).
- **Fixed window:** on first hit (or expired window) the row is upserted with `count: 1` and a fresh `windowEnds`; subsequent hits increment `count`. `count > limit` → 429 `{ error: "Too many requests. Please wait and try again." }` with `Retry-After` (seconds until window end) and `Cache-Control: no-store`.
- **`clientIp` derivation:** first `x-forwarded-for` entry → `cf-connecting-ip` → `x-real-ip` → `"unknown"`. This trusts a spoofable header — a known, documented limitation.
- Rows with expired windows are reset lazily by the upsert; the `[windowEnds]` index supports cleanup.

### Bucket inventory

| Scope | Limit / window | Identity |
| --- | --- | --- |
| `register` | 5 / 30 min | IP |
| `customer-login` | 10 / 15 min | IP + lowercased identifier |
| `staff-login` | 5 / 15 min | IP + email |
| `otp-request` | 3 / 10 min | IP + phone |
| `otp-verify` | 8 / 10 min | IP + phone |
| `order-create` | 12 / 15 min | IP |
| `order-cancel` | 8 / 15 min | IP |
| `cash-confirm` | 20 / 15 min | IP |
| `staff-payment-request` | 5 / 15 min | IP + order id |
| `mpesa-initiate` | 5 / 15 min | IP + `orderId:phone` |
| `intasend-initiate` | 8 / 15 min | IP + orderId |
| `mpesa-status` | 40 / 10 min | IP + checkoutRequestId |
| `service-booking` | 8 / 60 min | IP + userId |
| `service-mpesa` | 5 / 15 min | IP |
| `service-card` | 8 / 15 min | IP |
| `service-payment-status` | 40 / 10 min | IP |
| `prescription-create` | 10 / 60 min | IP |
| `prescription-refill` | 5 / 24 h | IP |
| `medicine-request-create` | 10 / 60 min | IP |
| `upload` | 20 / 15 min | IP + principal |
| `promotion-validate` | 40 / 60 s | IP |
| `refund` | 10 / 60 min | IP + staffId |
| `notification-test` | 10 / 60 min | IP |
| `assistant` | 40 / 60 min | IP |
| `docs-assistant` | 20 / 60 min | IP |
| `location-search` | 30 / 10 min | IP |
| `reverse-geocode` | 30 / 10 min | IP |

## 4. Request body caps

`rejectOversizedRequest(request, maxBytes)` checks the `Content-Length` header and returns 413 `{ error: "Request body is too large." }`. Medicine-request photos additionally bound the *streamed* body (3MB) — the only route that does not rely on the header alone.

| Route | Cap |
| --- | --- |
| `POST /api/auth/register` | 8,192 B |
| `POST /api/auth/login`, `/staff-login`, `/otp/request`, `/otp/verify` | 4,096 B |
| `POST /api/orders` | 64 KB |
| `POST /api/payments/refund` | 16 KB |
| `PUT /api/admin/pos-sync/policy` | 16,384 B |
| `POST /api/admin/pos-sync/reconcile` | 65,536 B |
| `POST /api/assistant`, `POST /api/docs-assistant` | 20,000 B |
| Resend `email-webhook` | 65,536 B |
| `POST /api/upload` / prescriptions | 10 MB + magic-byte sniffing; prescription direct uploads re-verified via `HeadObject` (1–10MB, owner metadata match) |
| Medicine-request photos | 3 MB streamed |

## 5. Response conventions

- **Shape:** success payloads are DTOs from `src/lib/dto.ts` / `src/lib/types.ts`; errors are always `{ "error": "<human-readable string>" }` plus the HTTP status. Unexpected failures go through `publicError()`, which adds a random `errorId` and logs details server-side only.
- **Caching:** session-scoped responses carry `Cache-Control: no-store` (or `private, no-store`); `/api/admin/live-changes` adds `Vary: Cookie`. The public catalog read (`catalogApi.products`) is the deliberate exception (`cache: "default"`).
- **Status vocabulary:** 400 validation · 401 sign-in required · 403 role/ownership · 404 missing/non-disclosing · 409 business conflict ("order changed", stock, payment attempt exists, promotion limits, points changed, duplicates) · 410 expired promotion · 413 body too large · 429 rate limited (+ `Retry-After`) · 503 provider-uncertain or infrastructure failure.
- **No envelope:** handlers return the DTO or the error object directly; there is no `{ ok, data }` wrapper (the auth `me` endpoint's `{ ok: true, role: null }` anonymous shape is an exception).

## 6. Guest access token pattern

Signed-out customers can place OTC orders and then pay for and track them without an account:

1. `POST /api/orders` (guest: name ≥2 chars, Kenyan phone, optional email; OTC only — Rx lines 401) returns a **one-time opaque token** — 32 random bytes, base64url — in the response body and mirrored in a `#access=` URL fragment (never sent to the server on subsequent navigations).
2. Only the **HMAC-SHA256 hash** (`tokenHash`, keyed by `TOKEN_HASH_SECRET`) is stored on the order (`guestAccessTokenHash`), with a 7-day `guestAccessExpiresAt`.
3. The client keeps the token in sessionStorage (`sphere_order_access_<orderId>`) and presents it as the `x-order-access-token` header (≤256 chars) or `accessToken` body field.
4. Honored by: order GET and cancel, both payment initiators (M-Pesa/IntaSend), and the M-Pesa status query. Payment initiate still enforces 403 "You can only pay for your own order." for anyone else.
5. **Claiming:** when the guest later signs in via OTP verify, a matching unexpired `guestPhone` + `guestAccessTokenHash` claims the order to the new account and clears the token.

See [authentication.md](authentication.md) for the full token lifecycle and [../workflows/order-lifecycle.md](../workflows/order-lifecycle.md) for the guest checkout flow.

## 7. Cross-cutting notes

- **Ownership is per-route, not per-guard:** e.g. `GET /api/orders/[id]` accepts owner OR staff (riders only for their assigned DELIVERY orders) OR guest token; prescription detail accepts owner or ADMIN/PHARMACIST and writes a `PrescriptionAccessLog` row on every VIEW/DOWNLOAD.
- **Webhooks and cron are their own principals:** provider webhooks authenticate by secret/HMAC (see [backend-architecture.md](backend-architecture.md)); cron routes by Bearer `CRON_SECRET`; the assistant route authenticates nobody by design (public data only).
- **Public routes:** catalog GET, categories GET, `POST /api/orders` (guest), `POST /api/medicine-requests` (guest), `POST /api/promotions/validate`, location APIs, `/api/assistant`, payment initiate/status with guest token.
- **Client contract:** every route is consumed through the typed namespaces of `src/lib/api-client.ts`; adding an endpoint without a client namespace (or vice versa) is a contract break.

## 8. Related documentation

- Endpoint catalogue: [../api/api-reference.md](../api/api-reference.md) · OpenAPI: [../../openapi/sphere-api.yaml](../../openapi/sphere-api.yaml)
- [system-architecture.md](system-architecture.md) · [backend-architecture.md](backend-architecture.md) · [authentication.md](authentication.md) · [state-management.md](state-management.md)
- Role matrix: [../security/access-control.md](../security/access-control.md) · Security posture: [../security/security-architecture.md](../security/security-architecture.md)
