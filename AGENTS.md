<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# Sphere Pharmacy — agent guide

You are working on **Sphere Pharmacy**, a full-stack retail pharmacy operations platform (Next.js 16 App Router SPA, React 19, TypeScript strict, PostgreSQL + Prisma 6, Tailwind 4 + shadcn/ui, Zustand) for a community pharmacy in Roysambu, Nairobi, Kenya. It processes prescriptions, payments (M-Pesa Daraja, IntaSend, cash), clinical bookings, and customer data — treat every change as touching regulated, sensitive territory.

**Read the documentation before writing code.** Start at [docs/README.md](docs/README.md). The most load-bearing documents:

- [docs/architecture/system-architecture.md](docs/architecture/system-architecture.md) — how the system fits together
- [docs/architecture/api-architecture.md](docs/architecture/api-architecture.md) + [docs/api/api-reference.md](docs/api/api-reference.md) — API surface and conventions
- [docs/security/access-control.md](docs/security/access-control.md) — guards, roles, ownership rules
- [docs/security/ai-access-and-authorized-sessions.md](docs/security/ai-access-and-authorized-sessions.md) — **the AI access policy (below)**
- [docs/governance/architecture-decisions.md](docs/governance/architecture-decisions.md) — why the code is the way it is (17 ADRs)
- [docs/governance/technical-debt.md](docs/governance/technical-debt.md) — known issues; do not add to them silently

## Non-negotiable rules

1. **Authorization guards are sacred.** Every privileged route uses `requireCustomer()` / `requireStaff([roles])` from `src/lib/session.ts` plus ownership checks. Never weaken, bypass, or "temporarily remove" a guard to make a feature work. Never rely on UI gating — the UI is derived from `/api/auth/me`; the server guards are the enforcement.
2. **AI access is session-scoped.** AI features may freely use public catalogue data. Secure, account-scoped information may only be surfaced within an **authorized session**, through the same authenticated endpoints and guards a human uses. The assistant route never reads the session cookie, and account data must never transit the LLM. If you extend AI capabilities, inherit the existing guards — never read around them. Full policy: [docs/security/ai-access-and-authorized-sessions.md](docs/security/ai-access-and-authorized-sessions.md).
3. **No secrets in code, ever.** This repository is public. Never commit real credentials, customer data, or prescription content. Anything prefixed `NEXT_PUBLIC_` is embedded in the browser bundle and is public by definition. Never add hard-coded fallback secrets (see the remediated H1 csv-import incident in [docs/governance/technical-debt.md](docs/governance/technical-debt.md) — never reintroduce one). Never log secrets, tokens, or prescription content.
4. **Server-authoritative state.** Clients store intents (cart, promo codes, wishlist); the server re-validates everything at mutation time. Never trust client-side prices, stock, promo discounts, or payment status.
5. **Clinical safety.** A medicine-classification heuristic is not pharmacist verification. Never build paths that dispense, diagnose, dose, or substitute without pharmacist review. The AI assistant must not diagnose or prescribe — it escalates to pharmacists.
6. **Money is KES, `Decimal(12,2)` in the DB, 2-dp comparisons in code** (`money()` / `sameMoney()` in `src/lib/security/payment.ts`). M-Pesa amounts must be whole shillings.
7. **Statuses are strings** with canonical value lists in `src/lib/constants.ts` (orders, payments, prescriptions, bookings, stock) — reuse the constants; never hard-code a status literal in a second place. Order transitions must go through `canTransitionOrder` (`src/lib/security/order-workflow.ts`).
8. **Idempotency is structural.** Payments (`idempotencyKey`), webhook events (`PaymentWebhookEvent.eventId`), loyalty (`LoyaltyLedger.eventKey`), promo redemptions (`PromotionRedemption.orderId`), and outbound POS sync jobs (`PosOutboundJob.idempotencyKey`) rely on unique keys. Preserve them. Uncertain provider outcomes stay `PROCESSING` with a reconcile note — never falsely reset them.
9. **Prescriptions are private R2 objects.** Access is owner-or-staff only, via presigned URLs (30–300 s) with an access log row on every read. Never expose `storageKey` or raw bytes through a public route.
10. **Run the checks before declaring done:** `npm run typecheck`, `npm run lint`, `npm test`, and (for assistant changes) `npm run test:assistant`. CI runs all of these plus `prisma migrate deploy` and `npm audit`.

## Documentation must evolve with the code

If your change falls into any of these categories, update the matching documentation **in the same pull request** (full policy: [docs/governance/documentation-policy.md](docs/governance/documentation-policy.md)):

| Code change | Documentation to update |
| --- | --- |
| New API endpoint | [docs/api/api-reference.md](docs/api/api-reference.md) + [openapi/sphere-api.yaml](openapi/sphere-api.yaml) |
| Database schema change | [docs/database/](docs/database/) (data dictionary, migrations) |
| New feature | [docs/features/](docs/features/) + feature catalogue |
| Permission change | [docs/security/access-control.md](docs/security/access-control.md) + [docs/product/user-roles-and-permissions.md](docs/product/user-roles-and-permissions.md) |
| Integration change | [docs/integrations/](docs/integrations/) |
| New scheduled job | [docs/operations/scheduled-jobs.md](docs/operations/scheduled-jobs.md) |
| Deployment change | [docs/operations/deployment.md](docs/operations/deployment.md) |
| Changed business rule | the relevant [docs/workflows/](docs/workflows/) page |

## Orientation map

| Path | What it is |
| --- | --- |
| `src/app/page.tsx` + `src/app/[...route]/page.tsx` | The SPA storefront/admin shell (Zustand view router); `src/app/docs/` + `src/lib/docs/` serve the interactive `/docs` portal over canonical Markdown, OpenAPI, and Prisma |
| `src/store/` | `use-app-store` (views/URLs), `use-auth-store`, `use-cart-store`, `use-wish-store` |
| `src/app/api/` | 96 route handlers (127 HTTP method handlers) — every mutation goes through these |
| `src/lib/session.ts` | Sessions and the role guard helpers |
| `src/lib/security/` | Rate limits, file validation, payment integrity, order workflow, BandaGo timing-safe auth (`bandago-auth.ts`, `bandago-bearer.ts`) |
| `src/lib/pos-reconciliation*.ts` + `src/lib/pdf/` | BandaGo stagnant-POS drift protection, outbound reconciliation ledger, Daily Sales PDF generator (`daily-sales-pdf.ts`), and full documentation PDF generator (`full-docs-pdf.ts`) |
| `src/lib/constants.ts` | Canonical status lists, roles, loyalty rules, delivery defaults |
| `prisma/schema.prisma` | 41 models, 5 POS enums, 11 migrations; stock-field authority explained in [docs/database/schema-overview.md](docs/database/schema-overview.md) |
| `src/lib/assistant/` + `src/app/api/assistant/route.ts` | The storefront AI assistant (Groq, deterministic-first, session-gated, live public `pharmacy`/`delivery` settings + customer-safe navigation); companion `src/app/api/docs-assistant/route.ts` ("Ask Sphere Docs", staff-gated via `requireStaff`, docs/OpenAPI/Prisma corpus only) |
| `.zscripts/` + `Caddyfile` | Standalone deployment pipeline (authoritative path) |

Known traps: `SPHERE_PHARMACY_FULL_CODEBASE.md` is a generated snapshot (use `npm run update:codebase` to refresh — do not treat as source of truth over live code); `reference/archive/worklog.md` describes the historical SQLite/simulated-payment era; `reference/archive/PROJECT_README.md` predates BandaGo and the real payment providers; several dependencies (`z-ai-web-dev-sdk`, `next-auth`, `@tanstack/react-query`) are declared but never imported. When docs and code disagree, **the code wins** — then fix the doc.
