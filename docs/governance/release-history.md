# Release History

Chronological narrative of how Sphere Pharmacy reached its current state, reconstructed from the Prisma migration timeline, audit-document dates, the historical worklog, and the Git log. Going forward this file (plus Git tags) is the authoritative release record — see [Going forward](#going-forward).

| Audience | Status | Verified |
| --- | --- | --- |
| Owner, developers, maintainers | **Implemented** | November 2026 |

## September 2026 — initial build era (historical)

The platform was built in the original sandbox by a multi-agent team (worklog Tasks 0–5 plus review rounds, dated 31 Aug 2026): single-route SPA storefront, ~30 API routes, an 18-model schema on **SQLite**, **simulated payments end-to-end**, and a demo-heavy seed (16 categories, 62 products, 4 staff, demo customer, 7 demo orders, 2 prescriptions). That world is gone: PostgreSQL replaced SQLite, real payment providers landed, and the seed was reduced to guarded minimalism (ADR-014). The worklog and `PROJECT_README.md` still partially describe this era — treat them as historical artifacts ([technical-debt.md](technical-debt.md) M4). Migration `20260902000000_initial` is the schema baseline that survived this era.

## September 2026 — security hardening and durable notifications

Two migrations landed immediately after the baseline:

- `20260903000000_security_hardening` — `lastSeenAt`/`authVersion` session machinery, and the plaintext OTP code column was **dropped** (codes now stored only as HMAC hashes).
- `20260905100000_notification_delivery` — the durable `NotificationDelivery` outbox (ADR-006) with leases, bounded retries, suppression list, and provider delivery-event reconciliation.

## 5 September 2026 — payment & notification audit

`docs/payment-notification-audit.md` (the project's source/config audit) delivered its verdict: **"Not yet production-ready"** — no live-provider certification; the audited local environment had sandbox providers and lacked `MPESA_CALLBACK_TOKEN`, `CRON_SECRET`, and `RESEND_WEBHOOK_SECRET`. It codified the invariants the payment code still enforces (webhook reconciliation-only truth, uncertain outcomes never reset, one active payment attempt) and listed **six release blockers** (missing-callback recovery, uncertain-initiation workflow, historical/late payments, refund-operation reservation, in-store service settlement, live deployment credentials) plus operational requirements (every-minute cron, notification-health monitoring, queued-payload retention policy). These remain the HIGH items in [technical-debt.md](technical-debt.md).

## October 2026 — medicine requests and the recording program

- `20261022000000_medicine_requests` — the guest "find this medicine" queue with private R2 photos and staff-proxied streaming.
- **22 Oct 2026** — the recording program: `docs/recording/platform-recording-script.md` (95KB, per-scene scripts) and the 51-journey acceptance matrix (`recording-journeys.json`, checklist codes P01–…–T02), with printables in `output/pdf/`.

## Late October 2026 — booking, promotion, and admin-index migrations

`20261027170000_booking_management_lookup_indexes` and `20261027183500_promotion_redemption_limits` (per-user/IP/browser promotion limits with HMAC identity hashes). The Git log of this window shows the order-operations hardening wave: action-based staff queues with priority sorting and bulk selection, one-step accept-and-pack with safe cash-on-delivery eligibility, explicit cash collection, payment-required completion guards, rider cash+delivery confirmation, customer/destination search, and the responsive scroll-free worklist with the collapsible admin sidebar.

## 28 October 2026 — order payment intent, private promotions, live admin

Three migrations on one day:

- `20261028000000_order_payment_intent` — nullable order payment-intent fields so pay-on-pickup orders can be prepared without claiming cash was received.
- `20261028190000_private_promotion_visibility` — share-only (non-public) promotion codes.
- `20261028194500_admin_live_cursor_indexes` — cursor-pair indexes (`updatedAt,id` / `createdAt,id`) powering authenticated low-cost admin live updates (incoming orders/appointments discovered across sessions, silent reconciliation, optimistic staff actions with rollback).

The same window hardened checkout/promotions: persisted promo codes revalidated across reloads and account changes, payment guarded during revalidation, and points-redemption contrast fixed for dark theme.

## 4 November 2026 — BandaGo POS & CRM support

`20261104200000_add_bandago_pos_support` introduced the POS/CRM block: `Product.externalPosId`, `ProductBatch` (iDempiere Lot/GuaranteeDate with FEFO rules), `PosSyncLog`, and the User CRM extensions (`externalBPartnerId`, POS loyalty balance, POS credit, chronic-patient flag). Shipped with it: the sync/CSV/CRM endpoints with the Kenya-PPB prescription classifier and phone normalization, the InventoryGuard interplay, the admin "BandaGo POS Integration Hub", the chronic-refills cron, and the integration test suite. Git records the landing (`184c370 preparation with bandaGo`) followed immediately by `ea52096 fix(pos-sync): harden sync transactions, slug collision, image preservation, and expired reservation cleanup` — chunked sync transactions with per-item fallback, `externalPosId`-derived slug-collision suffixes, preservation of custom product imagery, and expired-reservation cleanup ahead of sync — and the tree was finalized as `77c8689 add the sphere pharmacy changes to it`.

## 5 November 2026 — full-codebase snapshot

`SPHERE_PHARMACY_FULL_CODEBASE.md` generated ("Complete Platform Codebase & Architecture") — a point-in-time snapshot for review, not a living document (refreshable via `npm run update:codebase`).

## 18 November 2026 — canonical documentation program (`55eba08`)

A full code audit re-verified the codebase (39 models, 87 routes, 10 migrations, 12+1 test suites) and shipped the canonical documentation tree under `docs/`, `AGENTS.md`, `README.md`, and `openapi/sphere-api.yaml` — operations, testing, security, workflows, and governance runbooks grounded in verified fact sheets.

## 19 November 2026 — interactive `/docs` portal, lazy DB client & v0.3.0 upgrades (`89b680c`)

Shipped the built-in documentation portal at `/docs` (`src/app/docs/**`, `src/lib/docs/**`, `src/components/docs/**`, `sitemap.ts` + footer/landing links): interactive Mermaid diagrams, 68 flowchart-backed user journeys (`docs/journeys/**`), OpenAPI API explorer, Prisma ER database explorer, ⌘K lexical search (`GET /api/docs-index`), and "Ask Sphere Docs" (`POST /api/docs-assistant`). Fixed build-time evaluation by wrapping `PrismaClient` in `src/lib/db.ts` behind a lazy `Proxy` (`getClient()`), added `outputFileTracingIncludes` in `next.config.ts` (pinned by `tests/security-static.test.mjs`), bumped `package.json` to `0.3.0`, and upgraded `next` (`^16.4.6`) and `prisma` / `@prisma/client` (`^6.19.3`).

## 19 November 2026 — BandaGo bi-directional POS sync, drift protection, Daily Sales Export & H1 fix (`061e923`)

Added migration `20261119120000_add_bandago_bidirectional_sync` (`pos_outbound_jobs`, `pos_sync_incidents`, POS baseline/warehouse fields on `Product`, `PosSyncLog.direction`, and 3 new + 1 extended POS enums), stagnant-POS drift protection (`computeReconciledStock`), order/refund/expiry/admin-stock-edit reconciliation hooks (`enqueueOrderPosDeduction`, `cancelOrderPosDeduction`, `enqueueAdminStockEdit`), Zero-PHI Daily Sales Export (`GET /api/admin/pos-sync/sales-export` generating multi-page A4 PDF, formula-safe CSV, or JSON), policy & reconciliation APIs (`/api/admin/pos-sync/policy`, `/api/admin/pos-sync/reconcile`), extension bridge endpoints (`/api/integrations/bandago/outbound`, `/outbound/ack`, `/telemetry`), the 4-workspace `pos-sync-section.tsx` hub (migrated to `sonner`), and `tests/bandago-bidirectional-sync.test.mjs`. **Closed H1** by removing `NEXT_PUBLIC_POS_SYNC_SECRET` and the hardcoded `csv-import` fallback, clearing the `.env.example` placeholder, and enforcing timing-safe fail-closed Bearer verification (`src/lib/security/bandago-bearer.ts`).

## 19 November 2026 — root cleanup, `reference/` archive & `update:codebase` script (`c4629b7`, `6e5aad0`)

Organized historical and blueprint files into `reference/` (`reference/archive/PROJECT_README.md`, `reference/archive/worklog.md`, `reference/bandago-pos-crm-blueprint.md`, `reference/bandago-api-and-integration-architecture.md`, `reference/SPHERE_PHARMACY_OWNER_OPERATIONS_MANUAL.pdf`), deleted the duplicate `FULL_CODEBASE.md` and stray `--full-page` binary, and added `npm run update:codebase` (`scripts/generate_codebase_file.py`).

## Recent commit history (verbatim `git log --oneline -65`)

```text
6e5aad0 chore: keep single update:codebase npm script
c4629b7 chore: organize root files, remove duplicates, and add codebase export npm scripts
061e923 feat: BandaGo bidirectional POS sync, telemetry, reconciliation & docs
89b680c feat(docs): ship interactive documentation portal, fix build-time db evaluation and upgrade dependencies
55eba08 documentation
77c8689 add the sphere pharmacy changes to it
ea52096 fix(pos-sync): harden sync transactions, slug collision, image preservation, and expired reservation cleanup
184c370 preparation with bandaGo
4ec6377 test(orders): align queue age assertion with current table labels
fcad5b3 fix(checkout): restore Sphere Points redemption contrast in dark theme
acf8f80 feat(service-bookings): refresh open appointment details after external changes
d610706 test(admin): exclude harmless documentation wording from metadata-only check
0e62f05 test(admin): cover live order and booking updates, optimistic changes, and safe indexing
6a4054f db: add indexes for low-cost admin live updates
cb5b276 perf(db): index incoming order and booking live-change cursors
a1b21c1 fix(orders): prevent a replaced initial request leaving the work queue loading
fc35ea1 feat(service-bookings): silent incoming-appointment updates and optimistic staff actions with rollback
703fed9 feat(orders): quietly reconcile incoming orders and update rows immediately after staff actions
affc1d4 feat(admin): automatically discover new orders and service appointments across sessions
0f0352b feat(admin): authenticated low-cost order and care-booking change cursor
e51b277 fix(a11y): keep sidebar collapse control linked to navigation in both states
484b760 test(admin): protect responsive Orders totals and persisted sidebar collapse
032d4c7 fix(orders-ui): replace overflowing 10-column table with grouped scroll-free responsive worklist
613b3e0 style(admin): compact collapsible sidebar and scroll-free grouped Orders table
301b7da feat(admin): collapsible persisted desktop sidebar with accessible compact navigation
155992c test(orders): guard descriptive batch-selection UX on desktop and mobile
497ea61 fix(orders): explain batch selection restrictions instead of disabled dead-end checkboxes
ec45f7f feat(dispatch): compact scannable delivery rows with expandable actions
2027eda test(fulfillment): cover private offers, order pagination and dispatch handoff
54e8e6c feat(orders): newest-first queue, contextual Rx review, reliable dispatch handoff
f78597f fix(checkout): require fulfillment choice and derive delivery from address
f7c9a3c feat(promotions): support private share-only discount codes
74138bb test(orders): cover explicit cash collection and payment-required handoff
61dc6c8 fix(orders-ui): show cash-on-pickup collection and block premature completed statuses
bbc9255 fix(orders): disable bulk packing for orders with active payment attempts
145d987 test(order-ops): prevent unpaid pickup completion and enable cash pickup preparation
7885f2a fix(orders): search registered customers and delivery destinations
4d1bfbf fix(orders): load a fuller working queue for staff bulk actions
c33b21b fix(orders): require real payment before completed pickup
c8f28c3 fix(orders-ui): allow fast preparation for pay-on-pickup orders
6be38e9 feat(orders): prepare pay-on-pickup orders without claiming cash was received
9c21e79 test(orders): cover cash-on-delivery preparation, batch UX, zone and rider collection
5a80f43 feat(orders): action-based queues, priority sorting and direct confirmation from rows
f198841 feat(rider): confirm cash plus delivery in one action, clarify zone and map
0a6e367 fix(payment): riders may collect cash only for explicitly COD orders
b7a2508 fix(types): keep historical order DTO consumers compatible
b6f47ce feat(dispatch): show cash-due handoff and exact drop-off pin with priced zone
44a2576 feat(orders): one-click accept in drawer and full delivery-zone/location/payment details
fdb7461 feat(orders-ui): bulk selection, next-action controls and delivery-zone visibility
121183c feat(orders-ui): derive safe next actions and multi-order processing
13e9c14 feat(orders): typed one-step preparation action
62a7a51 feat(orders): one-step accept and pack with safe cash-on-delivery eligibility
6e3fd60 db: add nullable order payment intent for safe cash-on-delivery dispatch
5011695 feat(orders): retain payment intent and expose delivery zone plus map coordinates
5c457f7 feat(orders): retain payment intent and expose delivery zone plus map coordinates
3251e5c feat(orders): retain payment intent and expose delivery zone plus map coordinates
500c110 feat(orders): retain payment intent and expose delivery zone plus map coordinates
fc23398 test(cart): assert saved code visibility and minimum-spend feedback
0f7a0eb feat(cart): show saved promo and explain invalidation when quantities drop
72181a6 test(offers): cover account-change revalidation and payment guard
e4578c2 fix(checkout): guard payment during promo revalidation and recheck on customer changes
fa3f694 test(offers): correct persisted-promotion regex assertions
b78cf38 test(offers): cover persisted code and cart qualification invariants
ed2c5cd feat(checkout): restore and revalidate saved cart promo across reloads
```

## Timeline cross-reference

| Date | Marker | Theme |
| --- | --- | --- |
| 31 Aug – Sep 2026 | worklog Tasks 0–5, R2/R3 rounds; migration `…0902000000_initial` | Sandbox build (SQLite, simulated payments, demo seed) |
| Sep 2026 | `…0903000000_security_hardening` | Sessions hardened, plaintext OTP dropped |
| Sep 2026 | `…0905100000_notification_delivery` | Durable outbox ships |
| 5 Sep 2026 | `docs/payment-notification-audit.md` | "Not yet production-ready" verdict; six blockers |
| 22 Oct 2026 | `…1022000000_medicine_requests`; recording script + 51 journeys | Guest medicine requests; acceptance matrix |
| 27 Oct 2026 | `20261027170000_booking_management_lookup_indexes`, `20261027183500_promotion_redemption_limits` | Booking lookup indexes; promotion limits |
| 28 Oct 2026 | `20261028000000_order_payment_intent`, `20261028190000_private_promotion_visibility`, `20261028194500_admin_live_cursor_indexes` | Payment intent, private codes, live admin |
| 4 Nov 2026 | `…1104200000_add_bandago_pos_support` (+ `ea52096` hardening) | BandaGo POS/CRM integration lands and hardens |
| 5 Nov 2026 | `SPHERE_PHARMACY_FULL_CODEBASE.md` snapshot | Point-in-time review artifact (`npm run update:codebase`) |
| 18 Nov 2026 | `55eba08` documentation | Canonical docs tree + OpenAPI 3.1 contract |
| 19 Nov 2026 | `89b680c` `/docs` portal + `v0.3.0` | Interactive docs portal, 68 journeys, lazy DB Proxy, Next `^16.4.6` & Prisma `^6.19.3` |
| 19 Nov 2026 | `…1119120000_add_bandago_bidirectional_sync` (`061e923`) | Bi-directional POS reconciliation, drift protection, Daily Sales Export, H1 fixed |
| 19 Nov 2026 | `c4629b7`, `6e5aad0` | Root organization into `reference/`, single `update:codebase` script |

## How this history was reconstructed

Sources, in order of reliability: the eleven committed Prisma migrations (dates are in the migration directory names and are the strongest signal); the audit document's own date (5 Sep 2026); the recording program's dates (22 Oct 2026, stated in its files); the worklog (31 Aug 2026 era — historical only); the generated snapshot's stated date; and `git log --oneline` (above) for commit-level sequencing. Where the worklog and migrations disagree, the migrations win. Known source weaknesses: earlier pre-`0.3.0` versions (`0.2.1`) did not track releases; the git history begins mid-project (the pre-October work is represented by the migrations and docs, not individual commits).

## State at time of writing (November 2026)

For orientation of future readers: 41 Prisma models, 95 API routes (126 HTTP method handlers), 11 migrations, 13 Node test suites + 1 Bun assistant suite, five cron endpoints awaiting an external scheduler, two remaining open HIGH debt items (scheduling gap, payment blockers — H1 closed in `061e923`) — full inventory in [../operations/](../operations/) and [technical-debt.md](technical-debt.md). The platform's payment layer is real-provider capable and fail-closed, but **no environment has been certified with live production provider credentials**; treat "production-ready" claims accordingly.

Reading order for someone catching up on this project: this file (how it got here) → [architecture-decisions.md](architecture-decisions.md) (why it is built this way) → [../operations/local-development.md](../operations/local-development.md) (how to run it) → [technical-debt.md](technical-debt.md) (what to fix first).

## Going forward

- **This file is the release log.** Each meaningful change wave gets a dated section (what shipped, why, migration numbers if any) and an updated [technical-debt.md](technical-debt.md) cross-reference where relevant.
- **Tag releases** (`git tag -a v0.x.y`) at deployment points and reference the tag in the narrative above (`package.json` is at `0.3.0`).
- **Release-notes convention:** one dated section per release containing — shipped changes (user-visible first), migrations added, env vars added/changed, deployment/ops actions required (cron, callbacks, secrets), and debt items opened or closed. Anything requiring an operator action must also update the relevant runbook in [../operations/](../operations/).
- Keep narrative sections short and factual; link to the runbooks that explain operation rather than duplicating them.
- **Corrections welcome, evidence required:** if a date or attribution above is wrong, fix it with the commit/migration/document that proves the correction — never from memory alone.
