# Testing Strategy

This document inventories what is actually tested in Sphere Pharmacy, how to run each suite locally, what CI enforces and why it is ordered the way it is, and where the accepted gaps are. The companion acceptance artifact is the 51-journey recording matrix under [../recording/recording-checklist.md](../recording/recording-checklist.md).

| Audience | Status | Verified |
| --- | --- | --- |
| Developers, QA, reviewers | **Implemented** (with documented gaps) | November 2026 |

## Two commands, two runners — the distinction matters

```bash
npm test                 # node --test tests/*.test.mjs   — 13 suites, Node test runner
npm run test:assistant   # bun test tests/assistant.test.ts — 1 TypeScript suite, Bun runner
```

`npm test` globs only `tests/*.test.mjs`. `tests/assistant.test.ts` is **not** picked up by it (different extension, different runner) and is **not run in CI** — anyone touching the assistant must run `test:assistant` manually. CI only executes `npm test`. (The two shell scripts in `tests/` — `python-runtime-build.sh`, `python-runtime-container.sh` — are deployment-flow stubs, not tests.)

## Inventory of the 13 `.mjs` suites

| Suite (actual file) | Area | What it validates |
| --- | --- | --- |
| `admin-live-sync.test.mjs` | Admin live updates | Order/booking cursors and live-change behavior for the admin work queues. |
| `bandago-bidirectional-sync.test.mjs` | BandaGo bi-directional sync & H1 security | Stagnant-POS drift protection (`computeReconciledStock`), policy normalization, deterministic UUIDv4 generation, multi-page A4 Daily Sales PDF generation (`buildDailySalesPdfBuffer`), timing-safe fail-closed Bearer auth (`verifyBandagoBearerHeader`) & legacy placeholder detection (`isUsingInsecureDefaultBandagoKey`), H1 secret elimination, auth guards, and no-`catch(...: any)` checks. |
| `bandago-pos-crm-integration.test.mjs` | BandaGo POS/CRM | Slug generation, Kenya PPB prescription classification (word-boundary rules), FEFO expired-lot exclusion, available-stock formula, Kenya phone normalization, and **source-contract greps** that pin key implementation strings. |
| `checkout-points-contrast.test.mjs` | Checkout + loyalty | Sphere Points redemption visibility/contrast in checkout (dark theme regression). |
| `compliance-workspace.test.mjs` | Compliance | Admin compliance workspace behavior and redaction below ADMIN/PHARMACIST. |
| `dispatch-readiness.test.mjs` | Dispatch | Rider/dispatch readiness of orders (cash-due handoff, dispatch statuses). |
| `medicine-requests.test.mjs` | Medicine requests | Guest request validation, 3MB photo caps, private storage handling. |
| `offer-workflow.test.mjs` | Offers/promotions | Persisted promo codes, revalidation on cart/account changes, payment guard. |
| `order-dispatch-promotion-workflow.test.mjs` | Orders + dispatch + promotions | Order workflow invariants across dispatch and promotion paths (payment-required handoffs, safe next actions). |
| `order-operations-ux.test.mjs` | Order operations UX | Work-queue labels/ages, batch-selection UX, responsive tables. |
| `promotion-validation-resilience.test.mjs` | Promotions | Validation resilience: infrastructure failures fail closed (503 + errorId), limits enforced, cookies set. |
| `reports-layout.test.mjs` | Reports | Admin reports layout/labels. |
| `security-static.test.mjs` | Security (static) | Codifies: no build-error bypass; private prescription storage strings; no OTP demo code; `codeHash` column present; webhook auth functions present; security-hardening migration exists; staff-login legacy-hash upgrade; real FCM tokens (no placeholders); admin product view requires staff; lazy `db.ts` Proxy defers missing-URL throw to runtime property access; `/docs` loader avoids root-wide tracing. |

Plus the Bun suite:

| Suite | Area | What it validates |
| --- | --- | --- |
| `tests/assistant.test.ts` (`test:assistant`) | AI assistant | Intent schema rejections; pay-intent never issues account queries; determinism of the deterministic-first engine. |

## Test types in this codebase

- **Static checks / contract greps** — assert that security-critical source strings, migrations, and columns exist (most of `security-static`, parts of `bandago-pos-crm-integration`). Cheap, fast, and they catch regressions that compile fine.
- **Unit tests** — pure-function behavior (classification, slug/phone normalization, stock formula, loyalty math, validation edge cases).
- **UI-behavior tests** — assert on rendered strings/labels for critical UX (checkout points contrast, queue labels).

**Not present:** a full integration/E2E browser suite, provider-sandbox tests, or visual regression in CI (see [Known gaps](#known-gaps)).

## Required setup

- `DATABASE_URL` (or a `sphere_pharmacy_*` alias) — some suites touch Prisma; CI provisions a `postgres:16` service (`postgresql://sphere:sphere@localhost:5432/sphere_test`, `pg_isready` gated).
- CI-only secrets satisfying the ≥ 32-char invariants: `CRON_SECRET`, `SESSION_SECRET`, `OTP_HASH_SECRET`, `TOKEN_HASH_SECRET`.
- `PRESCRIPTION_RETENTION_DAYS=365` and `ORDER_RESERVATION_TTL_MINUTES=60` (cron-gated env the tests expect to exist).
- `NODE_ENV=test`.

Locally, a throwaway database plus the same variables is enough — nothing in `npm test` requires real provider credentials (providers fail closed, not open, when unset).

## CI pipeline order and rationale

`.github/workflows/ci.yml` (push to `main` + all PRs, ubuntu-latest, 20-min timeout):

| Step | Rationale |
| --- | --- |
| `npm ci` → `npx prisma generate` | Deterministic install; client generation for typecheck. |
| `npm run typecheck` **before any migration step** | Comment in ci.yml: *"Static checks must run even when a database migration is broken."* Type errors should surface regardless of DB state. |
| `npm run lint -- --max-warnings=0` | Zero-warning policy. |
| `npx prisma migrate deploy` | Applies the 11 committed migrations to the service database — tests run against the real schema. |
| `npm test` | The 13 `.mjs` suites (assistant suite excluded — run it manually). |
| `npm run build` | Production build must pass. |
| `npm audit --omit=dev --audit-level=high` | Advisory only — comment: *"Build still runs even if the separate dependency audit reports a vulnerability."* The audit informs; it does not block. |

## Known gaps

- **No E2E/browser automation** — real checkout, STK dialogs, and admin flows are not machine-tested.
- **No provider sandbox tests** — M-Pesa/IntaSend/Resend/FCM paths are only exercised by their fail-closed config checks; the [payment audit](../payment-notification-audit.md) lists live-provider certification as an open release blocker.
- **No visual regression** — dark-mode/contrast issues are guarded only by targeted string assertions (e.g. checkout points contrast).
- **Assistant suite outside CI** — the `bun` runner dependency keeps `assistant.test.ts` out of the Node-based pipeline.
- **Coverage of admin write paths is mostly static** — staff transitions, refunds, and POS sync are covered by contract greps and unit math, not by end-to-end writes against a live database.
- **Acceptance matrix is manual** — the 51 customer/staff journeys in [../recording/recording-journeys.json](../recording/recording-journeys.json) (codes P01–P06, C01–C09, O01–O06, X01–X03, S01–S03, H01–H03, A01–A18, R01, T01–T02) and the [recording checklist](../recording/recording-checklist.md) are the functional acceptance surface; treat any behavior change against those journeys as a regression even when `npm test` is green.

### Prioritized gap remediation (when investing here)

1. Add the assistant suite to CI (either a Bun job in ci.yml or a port to `node --test` TypeScript support) — cheapest coverage win.
2. Provider sandbox smoke script (one STK + one IntaSend + one Resend round-trip behind a flag) — directly reduces the audit blockers.
3. A thin E2E over the top recording journeys (checkout OTC, checkout Rx, staff queue actions) — highest human-effort saving.

## How to run locally

```bash
# One-off env for a throwaway database
export DATABASE_URL="postgresql://sphere:sphere@localhost:5432/sphere_test"
export CRON_SECRET="local-only-secret-that-is-at-least-32-characters"   # same for the other three
export PRESCRIPTION_RETENTION_DAYS=365 ORDER_RESERVATION_TTL_MINUTES=60

npx prisma migrate deploy   # schema for the test database
npm test                    # the 13 suites
npm run test:assistant      # requires Bun; run before touching assistant code
```

## What to run when you change…

| If you touch… | Run | Why |
| --- | --- | --- |
| `prisma/schema.prisma` or migrations | typecheck, `npm test` (esp. `security-static`), `migrate deploy` on a scratch DB | Static greps pin migration names/columns; CI applies migrations before tests. |
| Payment/webhook code | `npm test` + manual provider-sandbox check | No provider tests exist in CI — the audit's blockers live here. |
| Notification enqueue/dispatch | `npm test`; watch `notification-health` on a dev environment | Queue semantics (leases, dedupe keys, backoff) are only partially covered statically. |
| BandaGo normalizer/CRM/reconciliation | `bandago-pos-crm-integration.test.mjs` + `bandago-bidirectional-sync.test.mjs` | Unit tests + contract greps pin FEFO, drift protection, PDF export, and fail-closed Bearer auth. |
| `/docs` portal, Markdown corpus, `openapi/sphere-api.yaml` | `npm run typecheck && npm run build` + `security-static.test.mjs` | Verifies static corpus/OpenAPI/Prisma parsing and ensures `docs/content.ts` avoids root-wide tracing. |
| Assistant code | `npm run test:assistant` (**CI will not**) | The only suite for intent schema and determinism. |
| Admin UI strings/layout | the matching UX suite (`order-operations-ux`, `reports-layout`, `admin-live-sync`) | These suites assert on rendered labels and live-update behavior. |
| Security-relevant auth/session code | `security-static.test.mjs` + manual sign-in matrix | Static invariants (hashing, no demo OTP, migration presence) are codified there. |
| Anything shipping | full CI order: typecheck → lint(0 warnings) → migrate deploy → test → build | Mirrors [CI pipeline order](#ci-pipeline-order-and-rationale). |

## Test philosophy in this codebase

1. **Static invariants beat runtime luck.** Security properties that live in source text (the hardening migration exists, OTP codes are hashed not stored, prescription storage is private) are pinned by greps — trivially cheap, impossible to regress silently.
2. **The server is the contract.** Client stores intents; therefore tests target server behavior (validation, transitions, idempotency) rather than client rendering, except where UX correctness is itself a requirement (contrast, labels).
3. **Idempotency is testable without providers.** Dedupe keys, event keys, and lease semantics are exercised with unit tests; provider certification is deliberately left to live sandbox work (tracked as a gap).
4. **Humans close the loop.** The 51 recording journeys are the acceptance matrix; automated suites narrow the space, the recording pass certifies it.

## Adding tests

Follow the existing split: pure logic → unit tests in the matching `.mjs` suite; security invariants that live in source/migrations → static greps in `security-static.test.mjs`; assistant behavior → `tests/assistant.test.ts` (and remember CI will not run it for you). New commerce behavior should be checked against the relevant recording journey before merging.

## Review checklist (merging with confidence)

- [ ] `npm run typecheck` and `npm run lint -- --max-warnings=0` clean locally.
- [ ] `npm test` green against a migrated scratch database.
- [ ] `npm run test:assistant` run **if** any file under the assistant path changed.
- [ ] New/changed env vars documented in [../operations/environment-variables.md](../operations/environment-variables.md).
- [ ] Schema changes carry a migration and updated DTO/API docs (see [../operations/database-operations.md](../operations/database-operations.md)).
- [ ] Security-relevant string invariants (auth, storage privacy, webhook verification) added to `security-static.test.mjs` when introduced.
- [ ] Behavior differences vs. the recording journeys called out in the PR description.
- [ ] If debt was knowingly introduced or discovered, a row exists in [../governance/technical-debt.md](../governance/technical-debt.md).

## Suite ↔ recording-journey alignment (rough map)

| Suite | Guarded recording journey groups |
| --- | --- |
| `checkout-points-contrast`, `offer-workflow`, `promotion-validation-resilience` | P01–P06 (customer storefront/checkout) |
| `order-dispatch-promotion-workflow`, `dispatch-readiness`, `order-operations-ux` | O01–O06, X01–X03 (order ops, dispatch handoffs) |
| `admin-live-sync` | A01–A18 (admin console behaviors) |
| `compliance-workspace` | S01–S03 / H01–H03 (compliance and settings) |
| `medicine-requests` | C01–C09 (customer requests) |
| `bandago-pos-crm-integration`, `bandago-bidirectional-sync` | T01–T02, SYS-08, SYS-11 (POS/technical integration & reconciliation) |
| `reports-layout` | A-group reporting views |
| `security-static`, `assistant.test.ts` | cross-cutting (no single journey) |

Use the map in reverse when a journey fails during a recording pass: it points at the suite most likely to gain a regression test.

## Note on the shell scripts in `tests/`

`tests/python-runtime-build.sh` and `tests/python-runtime-container.sh` are **deployment-flow stubs**, not test files — `npm test`'s glob (`tests/*.test.mjs`) correctly ignores them. Do not mistake their presence (or CI's silence about them) for coverage of the Python runtime path; that path belongs to [../operations/deployment.md](../operations/deployment.md).
