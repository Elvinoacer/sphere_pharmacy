# Architecture Decision Records

Lightweight ADRs (Context / Decision / Consequences) for the major architectural choices embedded in the Sphere Pharmacy codebase, reconstructed and verified from the November 2026 code audit. Each decision is **Accepted** and reflected in shipped code unless noted otherwise. New significant decisions should be appended here rather than rewritten.

| Audience | Status | Verified |
| --- | --- | --- |
| Developers, architects, reviewers | **Implemented** | November 2026 |

---

## ADR-001 — Single-route SPA with a Zustand view router

**Status:** Accepted

**Context.** The storefront (catalog, product pages, cart, checkout, account, and admin panels) lives in one Next.js App Router page at `/`; the original sandbox build targeted a single-page app and the team wanted instant view switching and persistent client state (cart, auth, theme) without route-level server round-trips.

**Decision.** Implement the UI as a single route whose views are swapped by a Zustand-driven view router; persist cart/auth state in `localStorage`/`sessionStorage` keys (`sphere-cart`, etc.). Next.js App Router page routes outside the SPA catch-all are reserved for the dedicated `/docs` documentation portal (ADR-016), API handlers, and static assets.

**Consequences.** (+) Fast, app-like UX; simple mental model; state survives reloads. (−) No per-view URLs or SSR SEO for deep content; the browser bundle carries all views; deep links depend on hash/`?promo=` conventions. The AI assistant similarly sits on one public route (ADR-010).

## ADR-002 — Server-authoritative commerce

**Status:** Accepted

**Context.** Prices, promotions, loyalty balances, stock, and payment eligibility could all be tampered with from a client; the cart is persisted client-side in `localStorage`.

**Decision.** The client stores *intents only* (product ids, quantities, a promo *code*, an offer intent in `sessionStorage`); every price, discount, delivery fee, point quote, stock check, and promotion limit is recomputed and re-validated server-side inside the order-creation transaction (Serializable, `pg_advisory_xact_lock` on the promotion).

**Consequences.** (+) No client input is trusted; limits and balances race safely. (−) More server work per checkout; client must handle 409s (`POINTS_CHANGED`, `PROMOTION_*`) gracefully.

## ADR-003 — Database-backed opaque session tokens (no JWT) + authVersion invalidation

**Status:** Accepted

**Context.** Sessions must be revocable per staff member (role change, password reset, deactivation) and cannot afford stateless tokens that live out their claim.

**Decision.** `sphere_session` cookie carries a 32-byte random opaque token; the `Session` row (with `role`, `expiresAt`, `lastSeenAt`, `authVersion`) is the source of truth. Customer sessions last 30 days; staff 7 days absolute + 12h idle. Bumping `authVersion` on the staff/user row invalidates all their sessions at next check.

**Consequences.** (+) Immediate revocation; no token-signing key to rotate; roles checked server-side every request. (−) A database read per authenticated request; tokens are stored raw at rest (tracked as LOW debt — hashing them is a recognized improvement).

## ADR-004 — String statuses with canonical constant lists (not Prisma enums)

**Status:** Accepted

**Context.** Order/payment/prescription/booking lifecycles evolved repeatedly; Prisma enum changes require migrations and block renaming; historical rows carry legacy values (e.g. `PENDING`, `DELIVERED`).

**Decision.** Statuses are plain `String` columns; the canonical sets live in code (`src/lib/constants.ts`, workflow guards like `STAFF_TRANSITIONS`), with legacy values deliberately still queried where history demands.

**Consequences.** (+) Cheap evolution; legacy data readable; transitions enforceable in typed maps. (−) No database-level constraint against typos; constants must be kept in sync with DTO/API docs. Exception: BandaGo POS sync enums (`PosSyncStatus`, `PosSyncTrigger`, `PosSyncDirection`, `PosOutboundStatus`, `PosOutboundEventType`) **are** Prisma enums (ingestion/reconciliation stability). Legacy `'DELIVERED'` handling is tracked debt.

## ADR-005 — Physical stock deduct-and-restore reservations with optimistic version guards

**Status:** Accepted

**Context.** Double-selling between checkout and counter sale would be a business-critical failure; a virtual-counter reservation approach (BandaGo blueprint) was superseded during the build.

**Decision.** Order creation physically decrements `stockQty`/`stock` inside the Serializable transaction (guarded by the availability formula `max(0, min(stock, stockQty) − safetyBuffer − virtualReserved)`); cancellation/expiry restores stock. Every order mutation is guarded by the `Order.version` optimistic-concurrency column.

**Consequences.** (+) Availability is physical truth; no separate reservation ledger to reconcile for the primary flow. (−) Expiry depends on the order-reservations cron running; the older `InventoryGuard` virtual path survives for BandaGo pre-sync cleanup (partial dead code, tracked). FEFO batch-level deduction at order time is **not** implemented (FEFO applies at ingestion).

## ADR-006 — Durable notification outbox (NotificationDelivery)

**Status:** Accepted

**Context.** Transactional code (payment callbacks, order transitions) must not perform network I/O inline, yet notifications must not be lost when a provider is down.

**Decision.** `notifyCustomer`/`notifyStaff` only write rows (`Notification` in-app + one `NotificationDelivery` job per email/push recipient with dedupe keys) inside the caller's transaction. A cron-driven dispatcher claims leases (atomic `lockToken`/`lockedUntil`), retries with capped exponential backoff (max 8 attempts / 23h window), reconciles provider delivery events, and maintains `EmailSuppression`.

**Consequences.** (+) No lost notifications, no I/O in transactions, crash-safe. (−) Delivery latency is bounded by scheduler cadence (every minute); the dispatcher is an operational dependency ([scheduled-jobs.md](../operations/scheduled-jobs.md)); `ScheduledJobDelivery` became vestigial (tracked debt).

## ADR-007 — Webhook reconciliation-only payment truth

**Status:** Accepted

**Context.** Client-side "I paid" claims and webhook payloads are both spoofable; the payment audit demanded a single trust path.

**Decision.** Only authenticated webhooks/callbacks may set payment success — and they must **re-fetch provider state server-side** (IntaSend invoice re-fetch; M-Pesa `queryStkPush` re-query) and pass `paymentMatchesExpected` (amount/currency/phone/receipt) before transitioning orders. Status endpoints (`/api/payments/mpesa/query`, service payment-status) are read-only views of local state.

**Consequences.** (+) One hardened trust path; replay-safe via `PaymentWebhookEvent` idempotency ledger. (−) A missed callback leaves payments unresolved — missing-callback recovery is a known release blocker ([../payment-notification-audit.md](../payment-notification-audit.md), [technical-debt.md](technical-debt.md)).

## ADR-008 — Uncertain provider outcomes never reset

**Status:** Accepted

**Context.** Network timeouts and ambiguous provider responses cannot safely be mapped to FAILED (customers may have been charged).

**Decision.** Uncertain initiation/outcome responses leave the payment `PROCESSING` with an explicit "Provider response uncertain; reconcile before another attempt" note and a 503 to the caller; nothing auto-resets such rows.

**Consequences.** (+) No false FAILED that invites double-charging. (−) Requires an operator/audit reconciliation workflow, which is an open blocker; a workflow for late/historical outcomes is still missing.

## ADR-009 — One active payment attempt per order

**Status:** Accepted

**Context.** Concurrent STK pushes / card sessions against one order (customer retries, staff requests) could double-charge.

**Decision.** `reservePaymentAttempt` runs a Serializable transaction **before any network I/O**: it rejects duplicate idempotency keys, rejects when any payment is in `[PENDING, PROCESSING, SUCCESS, REFUND_PENDING, REFUNDED]`, verifies payability (status, amount, Rx approvals), then creates the single `PROCESSING` row.

**Consequences.** (+) At most one in-flight attempt; clean 409 semantics (`PAYMENT_ATTEMPT_EXISTS`). (−) Recovery from a stuck attempt depends on reconciliation (ADR-008); M-Pesa attempts < 15 min old are blocked from re-initiation client-side as well.

## ADR-010 — AI assistant session-scoped access

**Status:** Accepted

**Context.** The public assistant must never leak account data, but should still answer catalog/store questions.

**Decision.** The assistant route receives **no session cookie** — it cannot read identity at all. Anything private (orders, prescriptions, points) is served only by authenticated endpoints/panels in the app.

**Consequences.** (+) The leak surface is structurally removed; tests assert the pay intent issues no account queries. (−) The assistant cannot do account tasks; users are routed to sign-in. Detail: [../security/ai-access-and-authorized-sessions.md](../security/ai-access-and-authorized-sessions.md).

## ADR-011 — Deterministic-first assistant (LLM optional)

**Status:** Accepted

**Context.** The assistant must work in demos, offline, and CI without external AI credentials, and must behave predictably for pharmacy queries.

**Decision.** The deterministic rule engine is the default and complete path; `GROQ_API_KEY`/`GROQ_MODEL` (Groq, `openai/gpt-oss-20b`) only add the LLM mode when configured. The Bun assistant tests assert determinism and schema rejections.

**Consequences.** (+) No credential dependency; stable behavior; CI-testable. (−) LLM answers are a per-environment extra, not a guarantee; older docs claiming a different SDK (`z-ai-web-dev-sdk`) are stale (tracked debt).

## ADR-012 — BandaGo server-side receiving with external extension

**Status:** Accepted

**Context.** BandaGo (iDempiere-based POS at go.bandahealth.org) exposes no integration API; the pharmacy needs inventory, batches (Lot/GuaranteeDate), prices, and CRM data mirrored into Sphere.

**Decision.** Sphere implements the **server-side bi-directional integration** (`/api/integrations/bandago/sync`, `csv-import`, `crm`, `outbound`, `outbound/ack`, `telemetry`, plus `/api/admin/pos-sync/{policy,reconcile,sales-export}` and `/api/admin/pos-status`) with a normalizer, PPB classification, FEFO batch logic, stagnant-POS drift protection, `PosOutboundJob` & `PosSyncIncident` ledgers, and the 4-workspace admin hub. The browser-side transformer (Chrome MV3 extension `api_data_transformer`) remains deliberately **external** to this repo.

**Consequences.** (+) Clean trust boundary (timing-safe fail-closed bearer key or `ADMIN`/`PHARMACIST` staff session — the former H1 browser-borne CSV secret was remediated in `061e923`), all hardening server-side; Manual-First Daily Sales Export and opt-in `AUTO_SYNC` both supported. (−) The extension is unversioned here; `AUTO_SYNC` writeback requires an open BandaGo tab; sync normalizes/never downgrades Rx flags (PPB). Blueprint: [../integrations/bandago-pos-crm.md](../integrations/bandago-pos-crm.md).

## ADR-013 — Private R2 + presigned 30–300s URLs + access logging for prescriptions

**Status:** Accepted

**Context.** Prescription files are medical records (Kenya PPB Cap 244 retention; ODPC-sensitive); static/public URLs would be uncontrolled disclosure.

**Decision.** Prescriptions (and medicine-request photos) are stored **private** in R2 under `prescriptions/{userId}/{uuid}.{ext}` with object metadata; downloads go through owner/staff-checked endpoints that presign GET URLs clamped to 30–300s (private, no-store, optional attachment), and **every access writes a `PrescriptionAccessLog` row** (VIEW/DOWNLOAD). DTOs never expose `storageKey`/`fileData`.

**Consequences.** (+) No durable secret URLs; complete access trail; upload ownership verified via HeadObject metadata. (−) R2 presign failures surface as 503; retention deletion is cron-driven and skips shared keys. Detail: [../security/file-storage-security.md](../security/file-storage-security.md).

## ADR-014 — Seed minimalism (never seed clinical data)

**Status:** Accepted

**Context.** The original sandbox seed created demo staff, customers, orders, and prescriptions — unacceptable in a real pharmacy database, and misleading in docs.

**Decision.** `prisma/seed.ts` upserts exactly 7 categories and optionally one dev ADMIN, behind explicit guards (`NODE_ENV=production` refusal, `ALLOW_DESTRUCTIVE_SEED`, `SEED_DATABASE_ACK` for remote hosts, ≥ 14-char admin password). It never creates customers, orders, prescriptions, or clinical history.

**Consequences.** (+) Safe by default; production bootstrap is deliberately manual. (−) Demos need the recording dataset or manual setup; the old README's demo-account claims are now wrong (tracked documentation drift).

## ADR-015 — Standalone + Caddy deployment pipeline

**Status:** Accepted

**Context.** The platform must deploy to a server the team controls (not only Vercel), bundling its own process supervision and reverse proxy, with an external PostgreSQL database.

**Decision.** Build with `STANDALONE=true` (Next.js `output: "standalone"`), package `.next/standalone` + `static` + `public` + `Caddyfile` + `start.sh` via `.zscripts/build.sh` (with a self-healing guard that re-injects the standalone output if missing), and run `start.sh` where **Caddy is PID 1** proxying to the Next server (`bun next-service-dist/server.js`, port 3000), hard-failing without the `sphere_pharmacy_*` database URLs.

**Consequences.** (+) Single-artifact deploys, no bundled database, graceful shutdown owned by Caddy. (−) `.zscripts` hard-codes the sandbox path `/home/z/my-project` (templates to adjust); Vercel remains a documented alternative requiring its own cron setup. Full runbook: [../operations/deployment.md](../operations/deployment.md).

## ADR-016 — In-app `/docs` portal over canonical Markdown, OpenAPI & Prisma schema (with lazy DB Proxy)

**Status:** Accepted (`89b680c`)

**Context.** Storing technical docs only as raw Markdown files makes operational onboarding, API contract exploration, schema visualization, and cross-document search harder for staff and engineers; yet maintaining a separate CMS/Docusaurus copy creates guaranteed drift. Meanwhile, `src/lib/db.ts` previously threw at module import time when `DATABASE_URL` was unset, breaking build-time static analysis/prerendering.

**Decision.** Render the repository's canonical `docs/` Markdown files, 69 user journeys, `openapi/sphere-api.yaml`, and `prisma/schema.prisma` directly via a dedicated Next.js App Router subtree (`/docs`, `/docs/journeys`, `/docs/api-reference`, `/docs/database`, `/docs/assistant`) with client-side Mermaid rendering, ⌘K lexical search (`/api/docs-index`), and a session-free documentation assistant (`/api/docs-assistant`, Groq optional with lexical fallback). Wrap `PrismaClient` in `src/lib/db.ts` behind a lazy `Proxy` (`getClient()`) so missing-DB-URL checks happen on first runtime query rather than module import, and trace doc assets into standalone builds via `outputFileTracingIncludes` in `next.config.ts` without root-wide tracing (`src/lib/docs/content.ts`).

**Consequences.** (+) Markdown remains the single source of truth; zero drift between code, OpenAPI, schema, and portal; builds pass without a live database. (−) New docs must keep valid frontmatter and Mermaid v12 syntax; `content.ts` path restrictions are enforced by static tests (`tests/security-static.test.mjs`).

## ADR-017 — Bi-directional BandaGo POS reconciliation: Manual-First Daily Sales Export, opt-in Auto-Sync, and Stagnant-POS Drift Protection

**Status:** Accepted (`061e923`)

**Context.** Online sales decrement Sphere stock immediately, while BandaGo POS sits at counter level without continuous real-time writeback. Naive inbound POS syncs overwrote online stock back up to stagnant POS counts ("stock resurrection"), and forcing automated writebacks into a live iDempiere POS without explicit operator consent risked double-deducting or failing when no POS browser tab was open. Additionally, the legacy browser-borne CSV secret (H1) needed elimination.

**Decision.** Add an idempotent outbound ledger (`PosOutboundJob` queued on payment capture, order prepare, and `PATCH /api/products/[id]` stock edits; reversed/compensated via `cancelOrderPosDeduction`), stagnant-POS drift protection (`computeReconciledStock` subtracting unreconciled outbound deltas and unpaid holds from inbound POS snapshots), single-tenant pinning (`expectedTenantUU`), and a policy-controlled (`MANUAL_EXPORT` default vs opt-in `AUTO_SYNC` writeback) 4-workspace POS Hub with Zero-PHI Daily Sales Export (A4 PDF, formula-safe CSV, JSON) and deduplicated `PosSyncIncident` triage. Eliminate H1 by moving admin UI calls strictly to the `sphere_session` cookie and enforcing timing-safe fail-closed `verifyBandagoBearerHeader` on machine endpoints.

**Consequences.** (+) Eliminates stock resurrection on stale POS syncs, provides a complete Zero-PHI paper/CSV reconciliation trail even without the Chrome extension open, and closes H1 credential exposure. (−) `AUTO_SYNC` requires an authenticated `go.bandahealth.org` Chrome tab; manual operators must click **Confirm Entered in BandaGo POS** (or set a baseline cutover) so stagnant-POS offsets do not remain open indefinitely.
