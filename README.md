# Sphere Pharmacy

A full-stack retail pharmacy operations platform for **The Sphere Pharmacy** — Lumumba Drive, Roysambu, Nairobi, Kenya. Daily hours 8:00–22:30 · +254 707 475 208.

This repository is more than a storefront. It is a pharmacy operations platform covering customer accounts, prescriptions with pharmacist review, inventory with batch/expiry control, orders and rider dispatch, M-Pesa and card payments, clinical service bookings, Sphere Points loyalty, multi-channel notifications, medicine requests, an AI assistant, and BandaGo POS/CRM integration.

| | |
| --- | --- |
| **Framework** | Next.js 16 (App Router, single-route SPA) · React 19 · TypeScript strict |
| **Data** | PostgreSQL · Prisma 6 · 39 models · 10 migrations |
| **UI** | Tailwind CSS 4 · shadcn/ui · Zustand · Recharts |
| **Payments** | Safaricom Daraja (M-Pesa STK Push) · IntaSend hosted cards · cash on pickup/delivery |
| **Messaging** | In-app inbox · Resend email · Firebase Cloud Messaging push · Africa's Talking SMS (OTP only) |
| **Storage** | Cloudflare R2 (private prescriptions + public catalogue imagery) |
| **POS/CRM** | BandaGo (iDempiere) ingestion API + CRM reconciliation |
| **AI** | Groq-powered assistant with deterministic fallback — see the [AI access policy](docs/security/ai-access-and-authorized-sessions.md) |

> **Architecture note:** although this uses the Next.js App Router, the frontend is a single-page application with a Zustand view router — the catch-all route re-exports the main page. See [docs/architecture/frontend-architecture.md](docs/architecture/frontend-architecture.md).

## Documentation

The canonical documentation lives in this repository, next to the code it describes. Start at **[docs/README.md](docs/README.md)** — the complete index for three audiences:

- **Engineering** — architecture, frontend, backend, database, API reference, security, integrations, workflows, testing, operations
- **Pharmacy operations** — product overview, feature catalogue, roles, customer journeys, the operator guide, and the complete user-journey explorer
- **Governance** — architecture decisions, documentation policy, technical debt, release history

The documentation is also rendered as an interactive portal inside the app at **`/docs`** — audience navigation, full-text search (⌘K), the user-journey explorer with interactive flowcharts, an API reference generated from the OpenAPI contract, a database explorer generated from the Prisma schema, and an AI documentation assistant ("Ask Sphere Docs"). The Markdown files remain the single source of truth; the portal is a rendering layer over them.

Key entry points:

| Document | Purpose |
| --- | --- |
| [docs/README.md](docs/README.md) | Documentation index and conventions |
| [docs/architecture/system-architecture.md](docs/architecture/system-architecture.md) | How the system fits together |
| [docs/api/api-reference.md](docs/api/api-reference.md) + [openapi/sphere-api.yaml](openapi/sphere-api.yaml) | All 87 route handlers + machine-readable contract |
| [docs/security/security-architecture.md](docs/security/security-architecture.md) | Security model and known concerns |
| [docs/security/ai-access-and-authorized-sessions.md](docs/security/ai-access-and-authorized-sessions.md) | **AI access policy — how AI can give secure information only within authorized sessions** |
| [docs/operations/local-development.md](docs/operations/local-development.md) | Setup, seed truth, running tests |
| [docs/operations/deployment.md](docs/operations/deployment.md) | Standalone + Caddy pipeline (authoritative) and Vercel notes |
| [docs/governance/documentation-policy.md](docs/governance/documentation-policy.md) | How documentation must evolve with the code |

Pre-existing references, retained deliberately: [reference/archive/PROJECT_README.md](reference/archive/PROJECT_README.md) (original build guide — historical demo-account and payment claims corrected in the new docs), [reference/SPHERE_PHARMACY_OWNER_OPERATIONS_MANUAL.pdf](reference/SPHERE_PHARMACY_OWNER_OPERATIONS_MANUAL.pdf) (owner manual), [reference/bandago-pos-crm-blueprint.md](reference/bandago-pos-crm-blueprint.md) (BandaGo blueprint), [reference/bandago-api-and-integration-architecture.md](reference/bandago-api-and-integration-architecture.md) (BandaGo API architecture), [reference/archive/worklog.md](reference/archive/worklog.md) (historical sandbox-era build log), [docs/payment-notification-audit.md](docs/payment-notification-audit.md), and [docs/recording/](docs/recording/) (51 customer/staff journeys used as the acceptance matrix).

## Getting started

```bash
npm install            # postinstall runs: prisma generate
cp .env.example .env   # then fill in secrets — see docs/operations/environment-variables.md
npm run db:migrate     # apply the 11 migrations (or db:push for a throwaway dev DB)
npm run dev            # http://localhost:3000
```

The seed creates **7 categories and (optionally) one development admin** — it never creates demo customers, orders, or prescription data. Bootstrap the first admin with `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` (≥ 14 chars). Full details: [docs/operations/local-development.md](docs/operations/local-development.md).

```bash
npm test               # node --test tests/*.test.mjs (12 suites)
npm run test:assistant # bun test tests/assistant.test.ts (separate runner — keep both in CI)
```

## Repository structure

```
sphere_pharmacy/
├── docs/            # canonical documentation (see docs/README.md)
├── openapi/         # sphere-api.yaml — machine-readable API contract
├── prisma/          # schema.prisma (39 models), migrations/, guarded seed
├── src/app/api/     # 87 route handlers
├── src/lib/         # business logic, security guards, integrations
├── src/store/       # Zustand stores (view router, auth, cart, wishlist)
├── src/components/  # views/, admin sections, assistant, shared UI
├── tests/           # 12 node:test suites + assistant bun tests
├── .zscripts/       # standalone build/deploy pipeline (Caddy, tarball)
└── .github/         # CI: typecheck → lint → migrate deploy → test → build → audit
```

## Security

This repository is **public**. Never commit real credentials, customer or prescription data, or unredacted security findings. Keep restricted internal documents in a private location.

Known issues being tracked — including the browser-exposed POS sync secret and the hard-coded CSV-import fallback — are catalogued with remediation guidance in [docs/governance/technical-debt.md](docs/governance/technical-debt.md) and [docs/integrations/bandago-pos-crm.md](docs/integrations/bandago-pos-crm.md). Clinical safety boundaries (no AI diagnosis or dosing; pharmacist verification before dispensing) are documented in [docs/security/privacy-and-health-data.md](docs/security/privacy-and-health-data.md).

## AI coding agents

`AGENTS.md` at the root is the entry point for AI agents working on this codebase. The governing rule for anything AI-related: **AI may assist with public information freely, but secure, account-scoped information is only ever surfaced within authorized sessions — AI must never become a bypass around the application's own authorization guards.** Full policy: [docs/security/ai-access-and-authorized-sessions.md](docs/security/ai-access-and-authorized-sessions.md).
