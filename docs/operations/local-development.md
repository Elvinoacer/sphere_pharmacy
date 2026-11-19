# Local Development Setup

This guide covers standing up Sphere Pharmacy on a developer workstation, understanding the guarded database seed, running the automated test suites, reproducing CI locally, and refreshing the generated single-file codebase snapshot.

| Audience | Status | Verified |
| --- | --- | --- |
| Developers, AI coding agents | **Implemented** | November 2026 |

## Prerequisites

| Tool | Version / Notes | Needed for |
| --- | --- | --- |
| **Node.js** | 22 (matches `.github/workflows/ci.yml`) | App runtime, `npm test`, Next.js build |
| **PostgreSQL** | 16 (local Docker/native instance or a Neon dev branch) | Schema migrations, API routes, test suites |
| **Bun** | Optional (`^1.3`) | `npm run test:assistant` and `npm run start:standalone` |
| **Python 3** | 3.x | `npm run update:codebase` snapshot script |

## Quick start

```bash
npm install            # postinstall runs: prisma generate
cp .env.example .env   # populate database URL + required secrets
npm run db:migrate     # creates/applies the 11 PostgreSQL migrations (prisma migrate dev)
npm run dev            # http://localhost:3000 (also serves /docs portal)
```

### Minimum environment for local boot

`src/lib/db.ts` resolves the PostgreSQL connection string from the first non-empty variable in this order:

1. `DATABASE_URL`
2. `sphere_pharmacy_PRISMA_DATABASE_URL`
3. `sphere_pharmacy_DATABASE_URL`
4. `sphere_pharmacy_POSTGRES_URL`

If you use a Neon pooled endpoint (`-pooler.` in the hostname), `src/lib/db.ts` automatically appends `statement_cache_size=0` so PgBouncer does not serve stale prepared plans after schema changes.

You must also generate independent ≥ 32-character values for the hash/session secrets (otherwise authenticated/token operations throw via `requiredSecret()`):

```bash
openssl rand -base64 48   # run separately for SESSION_SECRET, TOKEN_HASH_SECRET, OTP_HASH_SECRET
```

For full variable coverage (including runtime-only cron variables `ORDER_RESERVATION_TTL_MINUTES` and `PRESCRIPTION_RETENTION_DAYS`), see [environment-variables.md](environment-variables.md).

### Build-time DB deferral (`src/lib/db.ts`)

`src/lib/db.ts` wraps the Prisma client in a lazy `Proxy` (`getClient()`), so missing-database-URL errors are deferred until runtime property access rather than thrown at module import. This allows `npm run build` and static generation of the `/docs` portal (`http://localhost:3000/docs`) to succeed without a live database connection while still failing fast whenever an API route or query executes without configuration.

## Guarded database seed (`prisma/seed.ts`)

`prisma/seed.ts` is intentionally minimal and **never** creates products, customers, orders, prescriptions, or clinical history.

| Guard / behavior | Detail |
| --- | --- |
| Production refusal | Refuses when `NODE_ENV=production` or `ALLOW_DESTRUCTIVE_SEED≠true` |
| Remote host guard | Any hostname other than `localhost` / `127.0.0.1` / `::1` requires `SEED_DATABASE_ACK=<hostname>` |
| Categories upserted | Exactly 7 starter categories: `prescription`, `otc`, `pain-fever`, `cold-flu`, `vitamins`, `personal-care`, `medical-devices` |
| Optional dev `ADMIN` | Upserted only when both `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (≥ 14 characters) are set; bumps `authVersion` and deletes that admin's sessions |

Example local seed run:

```bash
ALLOW_DESTRUCTIVE_SEED=true \
SEED_ADMIN_EMAIL="admin@example.com" \
SEED_ADMIN_PASSWORD="change-me-to-14-plus-chars" \
bun prisma/seed.ts
```

> **Historical README correction:** Older build docs (`reference/archive/PROJECT_README.md`) describe a SQLite seed with demo staff/customer accounts (`admin123`, `pharm123`, etc.) and 62 preloaded products. That seed no longer exists — use `prisma/seed.ts` for categories and an optional admin account, then import products via Admin → Catalogue / POS Sync CSV import or BandaGo POS sync.

## Scripts & testing

| Script | Command | Notes |
| --- | --- | --- |
| `npm run dev` | `next dev -p 3000 2>&1 \| tee dev.log` | Local dev server (`http://localhost:3000` and `/docs`) |
| `npm run typecheck` | `tsc --noEmit --pretty false` | Strict TypeScript check |
| `npm run lint` | `eslint .` | CI enforces `--max-warnings=0` |
| `npm test` | `node --test tests/*.test.mjs` | Runs all **13** `.mjs` test suites |
| `npm run test:assistant` | `bun test tests/assistant.test.ts` | Bun runner — **not run in CI**; run manually when touching assistant code |
| `npm run build` | `prisma generate && next build` | Production build incl. `/docs` static corpus generation |
| `npm run build:standalone` | `STANDALONE=true next build` + asset copy | Packages `.next/standalone` for Caddy/standalone deployment |
| `npm run db:migrate` | `prisma migrate dev` | Generates and applies a new migration locally |
| `npm run db:push` | `prisma db push --accept-data-loss` | Throwaway dev prototyping only — never use on shared/prod DBs |
| `npm run update:codebase` | `python3 scripts/generate_codebase_file.py` | Regenerates `SPHERE_PHARMACY_FULL_CODEBASE.md` (`--check` validates freshness) |

### CI parity check

Before pushing changes, run the same check sequence enforced by `.github/workflows/ci.yml` (plus the Bun assistant suite):

```bash
npm run typecheck
npm run lint -- --max-warnings=0
npx prisma migrate deploy
npm test
npm run test:assistant
npm run build
```

If you run tests against a local throwaway Postgres instance matching CI, export `DATABASE_URL="postgresql://sphere:sphere@localhost:5432/sphere_test"`, 32+-char test values for `CRON_SECRET`, `SESSION_SECRET`, `OTP_HASH_SECRET`, and `TOKEN_HASH_SECRET`, plus `PRESCRIPTION_RETENTION_DAYS=365` and `ORDER_RESERVATION_TTL_MINUTES=60`. See [../testing/testing-strategy.md](../testing/testing-strategy.md) for the full suite inventory.

## Related reading

- [environment-variables.md](environment-variables.md) — complete environment variable matrix and runtime-only flags
- [database-operations.md](database-operations.md) — migrations, connection pooling, and transaction budgets
- [deployment.md](deployment.md) — standalone + Caddy and Vercel deployment guides
- [../testing/testing-strategy.md](../testing/testing-strategy.md) — test suites, CI ordering, and gaps
- [../README.md](../README.md) — canonical documentation index
