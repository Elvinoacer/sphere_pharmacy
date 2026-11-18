# Customer CRM

Customer identity and profile management: registration (email+password or phone-first OTP), profile and address book with GPS, guest-order claiming that converts anonymous orders into account history, local-only wishlist/recently-viewed, and the BandaGo POS/CRM mapping that keeps phone-canonical customers, POS-side loyalty balances, and chronic-patient flags in sync.

| Audience | Status | Verified |
| --- | --- | --- |
| Engineers, AI coding agents | **Implemented** | November 2026 |

## 1. Purpose

Give customers one durable identity across web orders, prescriptions, bookings, and loyalty, and give the pharmacy a single customer record reconciled with the BandaGo/iDempiere POS — keyed on the E.164-normalized phone number — including chronic-patient identification that drives refill-reminder campaigns.

## 2. Users

- **Guests:** can become members via OTP without ever setting a password; their past guest orders (matching the verified phone) are claimed automatically.
- **Customers (members):** profile, avatar, addresses, notification prefs, stock alerts, points summary, member UX surfaces.
- **Staff (any):** CRM reads; PHARMACIST/ADMIN: CRM writes/sync.
- **System:** BandaGo reconciler + chronic-refill cron.

## 3. Screens

- **Auth** — `auth-view.tsx`: tabs login / register / OTP / staff (`AdminAccessFrame`); Kenyan phone normalization; `authNext` return-to-intent.
- **Account** — `account-view.tsx` (1516 ln): profile + avatar upload, addresses CRUD + geolocation, notification prefs, stock-alert watchlist, Sphere Points summary + history, sign-out.
- **Checkout step 2** — address book selection + GPS capture for delivery.
- **Member UX** — `CustomerHubNav` ("My Sphere — Hi, {firstName}") on account/orders/order/prescriptions + services bookings tab; `MemberIntro` heroes (4 variants, incl. the assistant CTA "A little help from Sphere").
- **Admin** — customer data surfaces indirectly through orders/prescriptions and the BandaGo pos-sync/CRM tooling.

## 4. Frontend implementation

- `authApi` (register/login/otp request+verify/me/logout/profile patch), `addressesApi` (15s AbortController + friendly 408), `storageApi` (avatar uploads), `notificationsApi` (prefs) — all typed in `src/lib/api-client.ts`.
- `use-auth-store` (Zustand): session payload, `refresh()` → `GET /api/auth/me` no-store, `finishAuth()` routing (staff → admin; customer → `authNext ?? account`), logout with push-token deregistration.
- Wishlist (`use-wish-store`, localStorage `sphere-wishlist`, cap 100, guests OK) and recently viewed (localStorage `sphere-recent`, last 12) are **local-only and never synced** — by design.
- Guest→member moment: OTP verify response triggers session bootstrap; claimed orders simply start appearing under Orders.

## 5. Backend implementation

- **Register `POST /api/auth/register`** — ≤8192B; 5/30min/IP; name ≥2; email OR phone required (Kenyan phone normalized `+254XXXXXXXXX`); 409 on duplicate email/phone; scrypt password hash (when a password is set); `NotificationPref` created best-effort; session issued. **No email verification.**
- **Login `POST /api/auth/login`** — 10/15min keyed IP+lowercased identifier; generic 401 (no enumeration); opportunistic scrypt re-hash upgrade for legacy hashes.
- **OTP phone-first** — `POST /api/auth/otp/request` (3/10min IP+phone; 6-digit random; previous unused codes invalidated; `codeHash = HMAC-SHA256(OTP_HASH_SECRET, phone:code)`; 5-min expiry; SMS via Africa's Talking — the **only** SMS use in the app; no demo code path). `POST /api/auth/otp/verify` (8/10min; attempts <5; atomic single-use `updateMany`; timingSafeEqual on the HMAC): auto-creates the `User` (stamping `phoneVerifiedAt`) or stamps an existing phone match, then **claims guest orders**: rows whose `guestPhone` + `guestAccessTokenHash` match and are unexpired get their tokens cleared and are bound to the account; finally a customer session is created.
- **Profile `PATCH /api/auth/profile`** (requireCustomer) — name/avatar/email/phone with 409 clash checks; password change requires `currentPassword` + policy (10–128 chars, ≥1 letter + ≥1 digit). Avatars upload via `/api/upload` folder `avatars` (any signed-in session).
- **Addresses** — CRUD under `userId`; PATCH/DELETE scoped `findFirst id+userId` else 404; `latitude/longitude Float?` GPS; `isDefault` with index `[userId, isDefault]`.
- **BandaGo CRM mapping** (`src/lib/crm/bandago-crm.ts`) — canonical key is the **E.164-normalized phone**; `User.externalBPartnerId @unique` maps to the iDempiere C_BPartner; `BandaGoCrmReconciler` syncs `loyaltyPointsBalance` (POS-side), `posCreditBalance`, and `isChronicPatient`, incrementing both balances via `loyaltyDelta`. CRM API: `GET` any staff, `POST` PHARMACIST/ADMIN; sync/CSV ingestion writes `PosSyncLog` telemetry.
- **Chronic patient identification** — `checkChronicRefillEligible`: orders created ≤ now−30d, status ∈ [DELIVERED (legacy), COMPLETED_DELIVERY, COMPLETED_PICKUP], ≥1 Rx item; deduped per identity (userId/guestPhone/order id); excludes users with newer non-CANCELLED/REJECTED Rx orders. Time-based only — **no dosage inference**. The `chronic-refills` cron (Bearer CRON_SECRET) sends ≤1 `CHRONIC_REFILL_REMINDER` per user per 7 days (IN_APP + email listing prescription-only medicine names, link to the source order).

## 6. Database

- **User** — `name?`, `phone? @unique`, `email? @unique`, `passwordHash?`, `phoneVerifiedAt?`, `avatar?`, `loyaltyPoints` (web engine), `externalBPartnerId? @unique` (BandaGo C_BPartner), `loyaltyPointsBalance` (POS-synced), `posCreditBalance Decimal(10,2)`, `isChronicPatient Boolean`.
- **Address** — `userId`, `label`, `text`, `area?`, `notes?`, `isDefault @default(false)`, `latitude/longitude Float?`; cascade on user; index `[userId, isDefault]`.
- **Session / OtpCode** — DB-backed opaque sessions (customer 30 days; staff 7 days + 12h idle); OTP rows carry HMAC code hashes only.
- Guest claiming touches **Order** (`guestPhone`, `guestAccessTokenHash`, `guestAccessExpiresAt`).
- See [../database/data-dictionary.md](../database/data-dictionary.md).

## 7. Workflow

Register/OTP → session → profile/addresses → checkout uses the address book → guest orders claimed on phone verification → BandaGo reconciler maps the phone to C_BPartner and syncs POS fields → chronic heuristic flags patients → refill reminders via the notification outbox. Deep dive: [../workflows/prescription-lifecycle.md](../workflows/prescription-lifecycle.md) (refill side) and [../operations/scheduled-jobs.md](../operations/scheduled-jobs.md).

## 8. Permissions

- Profile/addresses/avatars/prefs/stock-alerts/wishlist surfaces: customer session (`requireCustomer` → 401).
- CRM `GET`: any staff; CRM `POST` + bandago sync/CSV: PHARMACIST/ADMIN (routes authenticate with their own bearer secret — see [inventory-and-stock.md](inventory-and-stock.md) §14 for the credential caveats).
- OTP endpoints are public but tightly rate-limited (3/10min request, 8/10min verify, keyed IP+phone).

## 9. Integrations

- **BandaGo POS/CRM (iDempiere)** — customer mapping, POS balances, chronic flag: [../integrations/bandago-pos-crm.md](../integrations/bandago-pos-crm.md).
- Africa's Talking for OTP SMS: [notifications.md](notifications.md) §9.
- Chronic-refill reminders ride the notification outbox: [notifications.md](notifications.md).

## 10. Validation and business rules

- One account per phone (unique) and per email (unique); phone is normalized to `+254…` before any lookup (E.164 canonical key for CRM too).
- Password policy: 10–128 chars, ≥1 letter + ≥1 digit; scrypt (N=16384, r=8, p=1) with legacy-hash verification fallback.
- OTP codes: 6 digits, 5-minute expiry, max 5 verify attempts, single-use atomically, previous unused codes invalidated.
- Guest claiming requires an unexpired `guestAccessExpiresAt` (7 days) and matching token hash; tokens are cleared on claim.
- Wishlist (≤100) and recently viewed (≤12) never leave the device.
- Chronic identification is a 30-day Rx-order heuristic only — no clinical inference.

## 11. Failure handling

- Login failures are generic (no account enumeration); OTP brute force is bounded by attempts + rate limits.
- OTP delivery failure surfaces as an error (no fallback channel — WhatsApp/SMS are not alternates).
- BandaGo CRM failures are logged into `PosSyncLog` (PARTIAL/FAILED) and never block web auth/checkout.
- Address PATCH/DELETE on foreign rows → 404 (no disclosure).

## 12. Testing

- `tests/bandago-pos-crm-integration.test.mjs` — `normalizeKenyaPhone` E.164 canonicalization, normalizer behaviors.
- `tests/security-static.test.mjs` — no OTP demo code, codeHash column, staff-login legacy upgrade.
- See [../testing/testing-strategy.md](../testing/testing-strategy.md).

## 13. Operational requirements

- `AFRICAS_TALKING_USERNAME/API_KEY/SENDER_ID` (OTP SMS); `OTP_HASH_SECRET`/`TOKEN_HASH_SECRET` (≥32; fall back to `SESSION_SECRET`).
- Cron `GET /api/cron/chronic-refills` (Bearer `CRON_SECRET`) on a daily-ish cadence — [../operations/scheduled-jobs.md](../operations/scheduled-jobs.md).
- BandaGo credentials for CRM sync (see caveats in [inventory-and-stock.md](inventory-and-stock.md)).

## 14. Known limitations

- No email verification — email is a contact field, not an identity proof (phone is the verified channel).
- `loyaltyPointsBalance`/`posCreditBalance`/`isChronicPatient` are POS-synced values; the web loyalty engine only spends `loyaltyPoints` (see [loyalty-and-promotions.md](loyalty-and-promotions.md)).
- Chronic-refill eligibility still queries the legacy `"DELIVERED"` status alongside the current completion statuses.
- Wishlist/recently-viewed are device-local; clearing browser storage loses them (by design).
- Guest claiming only covers orders whose guest token hash is still stored and unexpired — token-less guest orders are not claimed.
