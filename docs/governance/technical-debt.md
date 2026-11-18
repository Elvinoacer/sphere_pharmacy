# Technical Debt Register

Prioritized register of known debt and defects, verified against the November 2026 code audit. Nothing here is hypothetical: every item cites where it lives and what it affects. Items are **Open** until fixed and verified; update the Status column (do not silently delete rows) when remediating. Deliberate trade-offs that are *not* up for reversal live in [architecture-decisions.md](architecture-decisions.md) instead — this file is for things that should eventually change.

| Audience | Status | Verified |
| --- | --- | --- |
| Developers, maintainers, owner | **Implemented** (register of open items) | November 2026 |

## Priority summary

| Tier | Count | Meaning |
| --- | --- | --- |
| HIGH | 3 | Blocks production trust; security exposure or payment certification failure |
| MEDIUM | 5 | Hygiene, dead weight, and false documentation — misleads maintainers, inflates risk surface |
| LOW | 9 | Hardening and polish; fix opportunistically when touching the area |

## HIGH — fix before production trust

| # | What | Where | Impact | Recommended action | Status |
| --- | --- | --- | --- | --- | --- |
| H1 | Browser-exposed POS sync secret + hard-coded fallback + shared default (detail below) | `pos-sync-section.tsx`, `api/integrations/bandago/csv-import/route.ts`, `.env.example` | Credential exposure to any browser; fail-closed defeated | Remove browser secret, remove fallback, rotate reused credentials | Open |
| H2 | No in-repo cron scheduler; scheduling is external and undocumented per environment | `/api/cron/*`, deployment layer | Silent operational failure across five jobs | Checklist enforcement + ship a scheduler reference | Open |
| H3 | Payment-audit release blockers (six items) | payments/service-payment paths | Production payments uncertifiable | Implement per audit, preserving ADR-007/008/009 invariants | Open |

### H1 — BandaGo credential exposure (detail)

Three compounding problems:

1. **Browser-borne credential.** The admin "BandaGo POS Integration Hub" CSV dropzone sends `Authorization: Bearer ${process.env.NEXT_PUBLIC_POS_SYNC_SECRET}` from the browser, so the value is embedded in the public client bundle and extractable by any visitor — then honored by the sync/CRM endpoints as a server credential.
2. **Hard-coded fallback.** `csv-import/route.ts` (line 122) falls back to a hard-coded secret literal when `BANDAGO_SYNC_API_KEY` is unset, so internal bearer auth passes even in an unconfigured environment — defeating the fail-closed expectation elsewhere in the codebase. (The literal is deliberately not reproduced in docs.)
3. **Shipped default, shared value.** `.env.example` sets `BANDAGO_SYNC_API_KEY` and `NEXT_PUBLIC_POS_SYNC_SECRET` to the **same** default value, encouraging copy-paste reuse across environments and making the "secret" public by construction.

**Impact:** unauthorized catalog/stock writes, CRM profile manipulation, and POS telemetry pollution; any environment that kept the shipped default is effectively open.

**Remediation order:** (a) make the CSV upload rely on the already-implemented staff-session auth path and delete the `NEXT_PUBLIC_POS_SYNC_SECRET` usage; (b) delete the hard-coded fallback so an unset key fails closed like every other integration; (c) set distinct strong `BANDAGO_SYNC_API_KEY` values per environment; (d) **rotate every credential that ever equaled the shipped default**; (e) update [../operations/environment-variables.md](../operations/environment-variables.md) and the admin UI copy. See also the security callout there.

### H2 — Scheduling is someone else's job (detail)

All five cron endpoints are implemented and idempotent ([../operations/scheduled-jobs.md](../operations/scheduled-jobs.md)), but no `vercel.json`, no scheduler config, and no per-environment documentation exists in-repo. Consequences when an operator misses this: notification queue never drains; unpaid orders hold reserved stock indefinitely; booking reminders never send; chronic-refill outreach stops; soft-deleted prescriptions are retained past policy (compliance exposure). The payment/notification audit's operational requirements name this explicitly.

**Remediation:** make "scheduler registered + verified" a hard checklist item in every deployment record; add a committed reference (crontab file or Vercel Cron snippet) next to the runbook; consider a startup-time warning when `CRON_SECRET` is set but no scheduler verification is configured.

### H3 — Payment audit release blockers (detail)

From [../payment-notification-audit.md](../payment-notification-audit.md) (5 Sep 2026), still open:

1. **Missing-callback recovery/reconciliation** — no job or workflow resolves payments whose callback never arrived (status endpoints are read-only by design).
2. **Uncertain-initiation workflow** — PROCESSING rows with the "Provider response uncertain; reconcile before another attempt" note have no operator path to a resolution.
3. **Historical/late payments** — no policy for payments that complete after expiry/cancellation.
4. **Refund-operation reservation** — refunds do not re-reserve/restore stock-and-points in all paths the way cancellations do.
5. **In-store service settlement endpoint** — `PAY_AT_PHARMACY` on service bookings records intent only; no endpoint records that cash was actually taken.
6. **Live deployment credentials** — no environment has been certified with production provider credentials.

**Remediation:** implement in the order listed (1–2 unblock daily operations; 3–5 close correctness gaps; 6 is the final gate), preserving the reconciliation-only and never-reset-uncertain invariants ([architecture-decisions.md](architecture-decisions.md) ADR-007/008/009). The customer cancel-toast contradiction (M5) must be resolved alongside item 4.

## MEDIUM — hygiene and accuracy

| # | What | Where | Impact | Recommended action | Status |
| --- | --- | --- | --- | --- | --- |
| M1 | Dual lockfiles (`bun.lock` + `package-lock.json`) and mixed bun/npm scripts | repo root, `package.json`, `.zscripts/*` | Installs are not reproducible across environments; CI (npm) and deployment (bun) can drift apart | Pick one package manager per environment (CI is npm today); delete the unused lockfile; align scripts and docs | Open |
| M2 | Unused declared dependencies: `z-ai-web-dev-sdk`, `next-auth`, `@tanstack/react-query`, `@tanstack/react-table`, `next-intl`, `@mdxeditor/editor` — none used in `src/` | `package.json` | Bigger install/attack surface, audit noise, false capability signals (e.g. next-auth implies a second auth system) | Verify per package, then remove; re-run `npm audit` + build | Open |
| M3 | Dead code: `ScheduledJobDelivery` table (zero references — the active queue is `NotificationDelivery`); `awardPointsForOrder`/`reversePointsForOrder` (callbacks write the ledger inline); legacy `InventoryGuard` virtual-reservation path (only `getAvailableStock` + `cleanupExpiredReservations(45)` are still invoked, by BandaGo sync); unused home view + home components; unused layout header | `prisma/schema.prisma`, `src/lib/loyalty.ts`, `src/lib/inventory-guard.ts`, view/layout components | Maintainers edit the wrong implementation; schema carries a phantom table; the reservation story is ambiguous next to ADR-005 | Remove dead exports/components; drop the table via a dedicated migration once historical queries are confirmed unnecessary | Open |
| M4 | Documentation drift: README demo accounts/orders (the seed creates none — 7 categories + optional admin only); "payments (simulated for demo)" while the code is real-provider-capable and fail-closed; broken `upload/requirements.md` PRD reference; `worklog.md` describes only the SQLite/simulated era; README credits `z-ai-web-dev-sdk` for an assistant that uses Groq; README predates BandaGo entirely | `PROJECT_README.md`, `worklog.md` | New staff try demo logins that don't exist; readers underestimate payment integration maturity; POS integration invisible | Rewrite the README against the current docs tree; mark the worklog historical; treat this register + [release-history.md](release-history.md) as authoritative | Open |
| M5 | Customer cancel toast promises automatic refunds; the server blocks cancelling captured payments (SUCCESS → 409) and refunds are ADMIN-only and partly manual (M-Pesa portal B2C) | cancel flow UI vs `api/orders/[id]/cancel` + `api/payments/refund` | Customers expect instant money-back that requires staff action → complaints, support load, trust damage | Reword the toast to set the real expectation (refund handled by staff); optionally add a refund-request intent endpoint feeding H3-remediation work | Open |

## LOW — hardening and polish

| # | What | Where | Impact | Recommended action | Status |
| --- | --- | --- | --- | --- | --- |
| L1 | Non-constant-time Bearer comparison (`===`) in 4 of 5 cron routes and the BandaGo routes; only `/api/cron/notifications` uses `authorizedJob()` timing-safe compare | cron + bandago route handlers | Theoretical timing side-channel | Route all bearer checks through one `timingSafeEqual` helper | Open |
| L2 | Chronic-refills queries legacy `'DELIVERED'` order status alongside `COMPLETED_DELIVERY`/`COMPLETED_PICKUP` | `src/lib/crm/bandago-crm.ts` | Legacy rows skew eligibility; semantic ambiguity | Keep for history, but normalize legacy values at the constants layer (ADR-004) | Open |
| L3 | `GET /api/prescriptions` header comment says "GET /api/orders" (copy-paste artifact) | `api/prescriptions/route.ts` | Minor reader confusion | Fix the comment | Open |
| L4 | `Payment.cardLast4` declared but never populated by any code path | `prisma/schema.prisma` | Dead column; misleading schema | Populate from IntaSend webhook data or drop via migration | Open |
| L5 | Loyalty "lifetime" summary is computed over the most recent 30 orders with activity, not true lifetime | `GET /api/orders/loyalty` | Misstated lifetime figures for very active customers | Aggregate from `LoyaltyLedger` or relabel the field | Open |
| L6 | Session tokens stored plaintext at rest in `Session.token` (guest tokens are HMAC-hashed; sessions are not) | `src/lib/session.ts` | Database read access ⇒ directly usable sessions | Store `tokenHash` and compare by hash; migrate during one rotation window | Open |
| L7 | CSP allows `'unsafe-inline'` for scripts and styles | `next.config.ts` | Weakens XSS containment | Move to nonces/hashes via Next.js CSP plumbing | Open |
| L8 | No CSRF tokens or origin checks — relies on `sameSite=lax` cookies | session cookie configuration | Cross-site state-changing requests only partially mitigated | Add origin checks on mutating routes or real CSRF tokens | Open |
| L9 | Webhook token travels in the URL query (`?token=` appended to M-Pesa callbacks) | `daraja.ts` callback URL construction | Token can leak into proxy/access logs | Header-based verification if the provider permits; meanwhile treat matching logs as secret-bearing | Open |

## Detection & prevention

How each class of debt was found in the November 2026 audit, and what guard would keep it from recurring:

| Debt class | How it was detected | Prevention going forward |
| --- | --- | --- |
| Credential exposure (H1) | Cross-referencing `.env.example` values with browser-referenced `process.env.NEXT_PUBLIC_*` reads and searching route handlers for fallback literals | Code-review rule: no `NEXT_PUBLIC_*` variable may feed an `Authorization` header; no secret literal may appear in source (add a `security-static` grep for the pattern) |
| Missing scheduler (H2) | Absence of `vercel.json`/scheduler config combined with the audit's operational requirements | Deployment checklist item with a verification step (one manual cron run per environment, recorded) |
| Payment blockers (H3) | The dedicated source/config audit (its six-item list) | Keep the audit doc as the acceptance list; re-run its checks after each payment change |
| Dead code (M3) | Schema/exports cross-referenced against call sites (e.g. zero references to `ScheduledJobDelivery`) | Remove-on-refactor rule: when a superseding path ships (like NotificationDelivery), delete the old path in the same release |
| Dependency bloat (M2) | `package.json` diffed against actual `src/` imports | Periodic `depcheck`-style pass during release planning; no dependency lands "for later" |
| Documentation drift (M4) | Fact-sheet comparison of README claims vs. actual seed/tests/assistant implementation | This docs tree + [release-history.md](release-history.md) as the only authoritative narrative; README links into it instead of restating facts |
| UX-vs-server contradiction (M5) | Reading the cancel endpoint guards next to the customer-facing toast | When adding customer-facing promises, quote the server response text in the same PR |

## Effort & risk estimates

Rough sizing to help sequencing (not commitments):

| Item | Effort | Risk to fix | Notes |
| --- | --- | --- | --- |
| H1 | S (hours) | Low | Mostly deletion + one UI change; rotation is procedural |
| H2 | S | Low | Documentation/checklist; optional startup warning is small |
| H3 | L (multi-release) | High | Money paths — each item needs its own tests and audit sign-off |
| M1 | S | Medium | Lockfile removal affects every environment's install |
| M2 | S | Low | Verify per package before removing |
| M3 | M | Medium | Migration needed for the table; inventory of component usage |
| M4 | M | Low | Writing work; coordinate landing after runbooks stabilize |
| M5 | S | Low | Copy change; optional intent endpoint is M |
| L1 | S | Low | One helper, several call sites |
| L2 | S | Low | Constants-layer normalization |
| L3 | XS | None | Comment fix |
| L4 | S | Medium | Either populate correctly or migrate-drop a financial column |
| L5 | S | Low | Switch source to ledger aggregates |
| L6 | M | High | Auth hot path; needs a rotation window and dual-read migration |
| L7 | M | Medium | CSP plumbing through Next.js |
| L8 | M | Medium | Must not break legitimate cross-origin POSTs (none expected today) |
| L9 | M | Medium | Provider-dependent; coordinate with Daraja capabilities |

(Effort: XS < an hour, S < a day, M < a week, L multi-release. Risk = chance the fix itself breaks something.)

## Dependencies between items

Order matters when remediating — several items unlock or constrain others:

- **H1 before any BandaGo hardening** — while the browser secret and fallback exist, other sync fixes (L1, M3 InventoryGuard cleanup) operate on a compromised surface.
- **H3 items 1–2 before item 6** — live-provider certification is meaningless without a recovery workflow for the failures certification will surface.
- **M5 rides along with H3 item 4** — fixing refund reservation is the moment to correct the cancel-toast promise, otherwise the UI re-introduces the contradiction.
- **M1 before M2** — remove unused dependencies after the package manager is settled, so only one lockfile has to converge.
- **M3 partially blocked by history** — dropping `ScheduledJobDelivery` needs a migration and a check that no analytics query (even ad-hoc) still reads it.
- **L6 interacts with L8** — if CSRF tokens or origin checks land first, re-test session-hash migration against them; both touch the auth hot path.
- **M4 depends on the docs tree** — the README rewrite should land after these runbooks stabilize, to avoid pointing at moving targets.

## Working the register

- **Picking up an item:** set Status to `In progress (owner, date)`. HIGH items gate any claim of production readiness (echoed by [../payment-notification-audit.md](../payment-notification-audit.md) and [../operations/deployment.md](../operations/deployment.md)).
- **Completing an item:** set Status to `Fixed in <commit/PR>` with a one-line verification note; on the next edit, move the row to the Closed section below.
- **Discovering new debt:** add a row with real Where/Impact — no speculative entries; if it is a deliberate trade-off, it belongs in [architecture-decisions.md](architecture-decisions.md) instead.
- **Review cadence:** HIGH weekly until closed; MEDIUM at each release planning; LOW opportunistically when touching the owning area.

## Closed

| # | What | Fixed in | Verification |
| --- | --- | --- | --- |
| — | — | — | — |

## Activity log

| Date | Item | Change |
| --- | --- | --- |
| Nov 2026 | — | Register created from the full code audit (17 items: 3 HIGH, 5 MEDIUM, 9 LOW) |

*(Append one row per status change — picked up, fixed, verified — so the register doubles as its own audit trail.)*
