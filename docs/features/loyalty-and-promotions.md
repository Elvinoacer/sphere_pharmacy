# Loyalty and promotions

Two coupled incentive systems: **Sphere Points** (earn 1 point per KSh 100 captured, redeem at KSh 1 per point, minimum 100 points, capped at 25% of the post-promo subtotal) and **promotions** (percentage-off codes with per-user/IP/browser/global limits, enforced twice — at validation and again under an advisory lock at order placement). Both are server-authoritative and idempotent through unique ledger event keys.

| Audience | Status | Verified |
| --- | --- | --- |
| Engineers, AI coding agents | **Implemented** | November 2026 |

## 1. Purpose

Reward repeat customers with a spendable points balance that survives cancellations and refunds symmetrically (clawback and re-credit), and run bounded discount campaigns without over-redemption — every limit is re-checked inside the order-creation transaction so concurrent checkouts cannot exceed caps.

## 2. Users

- **Customers (members):** earn on captured payments, redeem at checkout, view balance/history; **guests earn nothing**.
- **Staff (ADMIN/STAFF):** promotion CRUD and campaigns.
- **ADMIN:** archive/delete decisions, settings that affect caps are code-level constants.
- **System:** reversal events on cancel/expiry/refund.

## 3. Screens

- **Cart** (`cart-view.tsx`) — promo apply (server-validated) + suggested offers.
- **Checkout** (`checkout-view.tsx`) — Sphere Points redemption toggle with live quote; promo code field; combined totals.
- **Account** (`account-view.tsx`) — Sphere Points summary + per-order history.
- **Orders** (`orders-view.tsx`) — points indicators per order.
- **Offers** (`offers-view.tsx`) — public active codes (copy / Activate).
- **Admin → Promotions** — `promotions-section.tsx` (ADMIN/STAFF): banners, codes, campaigns (373 ln).

## 4. Frontend implementation

- Loyalty display: `ordersApi.loyalty` → balance, lifetime totals, per-order history; redemption toggle only for signed-in users with eligible balances.
- Promo intent is client-held (cart store `appliedPromo` code + `minimumSpend`; sessionStorage offer intent) and **always re-validated**: checkout withholds the displayed discount unless the validation response matches the current subtotal, the current user, and the cart code (`promoRequestId` race guard). Invalid/exhausted codes are forgotten client-side.
- `promotionsApi.validate` powers cart/checkout; admin CRUD via `adminApi`-adjacent promotions endpoints.

## 5. Backend implementation

### Sphere Points (`src/lib/loyalty.ts`)

- Constants (`LOYALTY`): `earnPerKES 100` (1 pt/KSh 100), `pointValue 1` (1 pt = KSh 1), `minRedeem 100`, `maxRedeemPct 25`. `pointsForAmount = floor(amount/100)`; `maxRedeemablePoints = min(balance, floor(subtotal×25/100))`.
- **Earning:** on payment capture inside the same Serializable transaction (M-Pesa callback, IntaSend webhook, cash-confirm): `points = floor(payment.amount/100)`; `LoyaltyLedger earn:<orderId>` (unique eventKey = idempotent); `user.loyaltyPoints += points`; `order.pointsEarned`. Guest orders earn nothing. (`awardPointsForOrder` exists in lib but is uncalled — callbacks implement it inline.)
- **Redemption:** at order creation, server `redemptionQuote(subtotal−discount, balance)`; debit via `updateMany` gte guard → `POINTS_CHANGED` 409 if the balance moved; ledger `redeem:<orderId>`.
- **Reversals (idempotent eventKeys):** cancel → `cancel:<orderId>` (+pointsRedeemed re-credit); expiry → `expire:<orderId>`; refund → `refund-earn:<orderId>` (−clawback, clamped to balance) + `refund-redeem:<orderId>` (+redeemed re-credit).
- **Summary** `GET /api/orders/loyalty`: balance, `lifetimeEarned`/`redeemedTotal` **over the most recent 30 orders with activity (not true lifetime)**, pointValue/minRedeem/maxRedeemPct, per-order history.

### Promotions (`src/lib/promotions.ts` + `/api/promotions*`)

- Model: only rule type = **percentage discount on subtotal** (`discountPct` 1–90). No fixed-amount or free-shipping types exist.
- Limits: `maxUses/perUserLimit/perIpLimit/perBrowserLimit` (1–1,000,000); `minimumSpend` 0–10M; `isPublic`; windows parsed as **Kenya-local days** (start `T00:00:00+03:00`, end `T23:59:59.999+03:00`).
- Admin CRUD: GET public = active + isPublic + within window + not exhausted (take 100); `?all=1` (ADMIN/STAFF) up to 500; POST/PATCH ADMIN/STAFF; code `^[A-Z0-9_-]{3,32}$`; private promos require a code; **DELETE hard-deletes only when zero redemptions, else archives** (`active:false`, audit `PROMOTION_ARCHIVED`).
- **Validate** `POST /api/promotions/validate` (40/min): exists→404, active→409, discountPct→409, started→409, expired→410, minimumSpend→400 ("Add KSh X more"), maxUses→409; perUserLimit requires sign-in (guests 401); perIpLimit **fails closed** without ipHash (503); perBrowserLimit via cookie. Sets `sphere_promo_device` cookie (httpOnly, SameSite=Lax, 1 year, 24 random bytes base64url). Infrastructure failures → 503 with errorId — never mislabeled as invalid codes.
- **Identity hashing:** `ipHash = HMAC-SHA256(TOKEN_HASH_SECRET|SESSION_SECRET, "promo:ip:v1:"+clientIp)` — null if no ≥32-char secret (IP-limited offers fail closed); `browserHash = HMAC("promo:browser:v1:"+cookie)` or unkeyed SHA-256 fallback. Never casually rotate `TOKEN_HASH_SECRET` (HMAC identifiers must stay comparable).
- **Order-placement enforcement:** inside the Serializable create transaction under `pg_advisory_xact_lock(hashtext(promotion.id))` — re-reads and re-validates everything; errors `PROMOTION_UNAVAILABLE/PROMOTION_LIMIT/PROMOTION_CUSTOMER_LIMIT/PROMOTION_NETWORK_LIMIT/PROMOTION_BROWSER_LIMIT` → 409. Pre-transaction: per-user promo + guest → 401; per-IP + no ipHash → 503; per-browser unvalidated → 409.
- `PromotionRedemption.orderId` unique — **exactly one promo per order**; discount before loyalty redemption; subtotal only (delivery never discounted).

## 6. Database

- **LoyaltyLedger** — `eventKey @unique` (idempotency; prefixes `earn:/redeem:/cancel:/expire:/refund-earn:/refund-redeem:` + orderId), `userId`, `orderId`, `delta Int`, `reason` (ORDER_REDEMPTION, ORDER_CANCELLED, RESERVATION_EXPIRED, PAYMENT_CAPTURED, PAYMENT_REFUNDED). Indexes `[userId, createdAt]`, `[orderId, createdAt]`.
- **User loyalty fields** — `loyaltyPoints` = live web spendable balance (the loyalty engine's authority; DTO `balance`); `loyaltyPointsBalance` = POS-side synced balance (BandaGo `BandaGoCrmReconciler`, not used by the web engine); `posCreditBalance` (POS credit, display/sync only).
- **Promotion** — `title`, `code? @unique`, `discountPct 1–90`, `active`, `isPublic`, `startsAt?/endsAt?`, limit fields, `minimumSpend?`.
- **PromotionRedemption** — `orderId @unique`, `userId?`, `ipHash?`, `browserHash?`; indexes back each limit check.
- See [../database/data-dictionary.md](../database/data-dictionary.md).

## 7. Workflow

Earn on capture → redeem at checkout (quoted, guarded debit) → reverse on cancel/expiry (re-credit) or refund (clawback + re-credit). Promotions: validate → lock-protected redemption counting at placement → archive on attempted delete with history. Deep dives: [../workflows/order-lifecycle.md](../workflows/order-lifecycle.md), [../workflows/payment-lifecycle.md](../workflows/payment-lifecycle.md).

## 8. Permissions

- Earning/redemption: any signed-in customer; no staff override path.
- Promotion CRUD: ADMIN/STAFF (`?all=1` scope too); archive decisions logged.
- Validate endpoint: public (per-user limits require sign-in).
- Refund-triggered reversals: ADMIN-only refund flow (see [payments-and-refunds.md](payments-and-refunds.md)).

## 9. Integrations

- BandaGo POS/CRM syncs `loyaltyPointsBalance`/`posCreditBalance` and reconciles deltas: [../integrations/bandago-pos-crm.md](../integrations/bandago-pos-crm.md) and [customer-crm.md](customer-crm.md).
- Loyalty capture rides payment callbacks: [payments-and-refunds.md](payments-and-refunds.md).

## 10. Validation and business rules

- Points: integer-only; minimum 100 to redeem; 25% cap on post-promo subtotal; balance floor at 0; every mutation idempotent via unique eventKeys.
- Promotions: percentage-only; Kenya-local window days; one promo per order; discount capped at subtotal; delivery excluded.
- IP/browser identities are HMAC hashes — raw IPs/cookies are never stored; missing secret fails closed rather than open.
- `reversePointsForOrder` exists in lib but is uncalled — reversals run inline in cancel/expiry/refund routes with the same eventKey families.

## 11. Failure handling

- Concurrent redemptions → `POINTS_CHANGED` 409 (gte-guarded debit) — checkout re-reads and retries with a fresh quote.
- Concurrent promo use → advisory lock serializes limit counting; over-limit placements 409 with specific limit reasons.
- Validation infrastructure failure → 503 with errorId (never a false "invalid code").
- Reversal replays are no-ops (unique eventKeys); refund clawback clamps to the current balance (never negative).

## 12. Testing

- `tests/promotion-validation-resilience.test.mjs` — identity hashing fail-closed behavior, unkeyed browser fallback, infrastructure error labels.
- `tests/checkout-points-contrast.test.mjs` — redemption panel UI contract.
- `tests/offer-workflow.test.mjs` — offer intent → checkout wiring, stale-subtotal discount withholding.
- `tests/order-dispatch-promotion-workflow.test.mjs` — promo enforcement invariants in the order flow.

## 13. Operational requirements

- `TOKEN_HASH_SECRET` (≥32; falls back to `SESSION_SECRET`) — **do not casually rotate**; promotion HMAC identifiers must remain comparable across time.
- No cron specific to loyalty; reversals run inside their triggering transactions/routes.
- Promotion windows operate on Kenya-local days (UTC+3) — no DST concerns.

## 14. Known limitations

- Loyalty summary lifetime totals cover only the most recent 30 orders with activity — not a true lifetime aggregate.
- Two balances exist by design (`loyaltyPoints` web vs `loyaltyPointsBalance` POS-synced); only the web one is spendable at checkout.
- No fixed-amount or free-shipping promotion types; only percentage-on-subtotal.
- Guests can never earn or redeem; guest orders produce no ledger entries.
- `awardPointsForOrder`/`reversePointsForOrder` lib helpers are uncalled (callbacks implement inline) — keep that in mind when refactoring.
