# Deployment Guide

This document describes how Sphere Pharmacy ships: the authoritative in-repo pattern (Next.js standalone output behind Caddy, packaged by `.zscripts/`), the Vercel alternative referenced by `.env.example`, external PostgreSQL requirements, and the post-deploy checklist including cron scheduling, which the repo deliberately does not perform itself.

| Audience | Status | Verified |
| --- | --- | --- |
| Operators, DevOps | **Requires live verification** | November 2026 |

The deployment *code* (build scripts, Caddyfile, start script) is implemented and verified in-repo; the *production specifics* (real server paths, DNS, provider dashboards) have not been exercised on live infrastructure and are marked accordingly.

## Pattern choice at a glance

| Concern | A — Standalone + Caddy | B — Vercel |
| --- | --- | --- |
| Automation in repo | `.zscripts/build.sh` + `start.sh` + `Caddyfile` (authoritative) | None (no `vercel.json`); `.env.example` prose references Vercel Production env |
| Runtime | `bun next-service-dist/server.js`, Caddy as PID 1 on `:81` → `:3000` | Vercel serverless/Node runtime |
| Cron scheduling | System crontab / external monitor calling the endpoints | Vercel Cron (or external); `/api/cron/notifications` already sets `maxDuration 300` |
| Database | External PostgreSQL via `sphere_pharmacy_*` env (hard-fail if absent) | Same external PostgreSQL via project env vars |
| Caveats | `.zscripts` hard-codes the sandbox path `/home/z/my-project` — treat as templates | Callback URLs and cron must be configured in the Vercel dashboard; **Requires live verification** |

## Pattern A — Standalone + Caddy (authoritative in-repo flow)

This is the flow the repository actually automates.

### Build

```bash
npm run build:standalone
```

`build:standalone` sets `STANDALONE=true` for `next build` (which makes `next.config.ts` emit `output: "standalone"`) and then copies `.next/static` and `public/` into `.next/standalone/` so the self-contained server can serve static assets. There is also `npm run start:standalone` (`NODE_ENV=production bun .next/standalone/server.js`, logging to `server.log`) for running the standalone server directly.

The full pipeline is `.zscripts/build.sh`:

1. `bun install` → `bunx prisma generate` → `bun run build`.
2. **Self-healing standalone guard** — if `.next/standalone/server.js` is missing after the build, the script checks `next.config.*`: if `output: "standalone"` is absent it injects it and rebuilds; if a conflicting `output` (e.g. `"export"`) is declared, or the key exists but `server.js` still is not produced, it fails loudly instead of shipping a broken package. (Rationale in the script: a missing `server.js` surfaces only as a 120s health-check timeout after deployment.)
3. Builds `mini-services/*` sub-projects if present (currently only `.gitkeep` — skipped).
4. Collects into a build directory: `.next/standalone` → `next-service-dist/`, `.next/static` → `next-service-dist/.next/static`, `public/` → `next-service-dist/public`, the `Caddyfile`, `start.sh`, and a pinned Python runtime if applicable.
5. Produces a `tar.gz` artifact. **The database is never bundled** — schema and data live in external PostgreSQL (explicit comment in `build.sh`).

> **Caveat:** `.zscripts/build.sh` hard-codes `NEXTJS_PROJECT_DIR="/home/z/my-project"` — the original sandbox layout, not this repository path. Treat `.zscripts/*` as **templates**: copy and adjust the path for the real server before use. Nothing else in the flow is sandbox-specific.

### Start

`.zscripts/start.sh` (shipped inside the tarball):

- Sets Python paths if the bundled runtime exists.
- Starts the Next.js server: `bun next-service-dist/server.js` with `NODE_ENV=production`, `PORT` (default 3000), `HOSTNAME` (default `0.0.0.0`).
- **Hard-fails** when none of `sphere_pharmacy_PRISMA_DATABASE_URL` / `sphere_pharmacy_DATABASE_URL` / `sphere_pharmacy_POSTGRES_URL` is set — the deployment refuses to start half-configured.
- Starts `mini-services` if present.
- `exec caddy run --config Caddyfile` — **Caddy runs as PID 1** and owns graceful shutdown of the whole group.

### Caddyfile

The repo-root `Caddyfile` listens on `:81`:

- Route 1: requests with an `XTransformPort=*` query parameter are reverse-proxied to `localhost:{query.XTransformPort}` (a sandbox ingress convention for co-located mini-services).
- Route 2 (default): reverse proxy to `localhost:3000`, forwarding `Host`, `X-Forwarded-For {remote_host}`, `X-Forwarded-Proto`, and `X-Real-IP` — the headers the app's client-IP resolution and secure-cookie logic rely on.

On a real server you will typically terminate TLS upstream or adjust the Caddyfile site address; keep the `X-Forwarded-*` forwarding intact.

### Artifact inventory (what ends up in the tarball)

| Artifact | Purpose |
| --- | --- |
| `next-service-dist/` | The standalone Next.js server (`server.js`) + traced dependencies (incl. `docs/`, `openapi/`, `prisma/schema.prisma`, `README.md`, `AGENTS.md` via `outputFileTracingIncludes` for `/docs` & `/api/docs-*`) |
| `next-service-dist/.next/static/` | Client assets (copied in by the build pipeline / `build:standalone`) |
| `next-service-dist/public/` | Public assets incl. the curated product image library |
| `Caddyfile` | Reverse proxy config (`:81`, `XTransformPort` route, `:3000` proxy with `X-Forwarded-*`) |
| `start.sh` | Boot script: env hard-fails, `bun server.js`, Caddy as PID 1 |
| Python runtime (optional) | Only when Python sources/dependencies are detected by `python-runtime-build.sh` |
| — | **No database**: schema/data live in external PostgreSQL exclusively |

## Pattern B — Vercel (alternative)

There is **no `vercel.json`** in the repo, but `.env.example` explicitly instructs configuring secrets "in Vercel's Production environment and redeploying after updating", so Vercel is a supported-by-design alternative. Required configuration beyond the standard Next.js deployment:

- **All environment variables** from [environment-variables.md](environment-variables.md) set in the Vercel project (Production + Preview as appropriate), including the runtime-only cron variables.
- **Provider callback URLs** pointed at the Vercel domain (`MPESA_CALLBACK_URL`, IntaSend dashboard webhooks → `/api/payments/intasend/webhook`, Resend webhook → `/api/notifications/email-webhook`).
- **Cron scheduling** for the five `/api/cron/*` endpoints (Vercel Cron or an external scheduler) — see [scheduled-jobs.md](scheduled-jobs.md); the repo does not schedule anything itself.
- Note that `/api/cron/notifications` already declares `maxDuration 300`, matching Vercel's serverless limits.

Status: **Environment-dependent** — no live Vercel deployment is verified from this repository.

## External PostgreSQL

The application requires an external PostgreSQL database (recommended: Neon, per `.env.example`):

- Use the **pooled** connection URL (hostname containing `-pooler.`) for application traffic. `src/lib/db.ts` automatically appends `statement_cache_size=0` on pooled hosts — **without this, PgBouncer-style poolers serve stale prepared statements after schema changes and you will see Prisma error `0A000`**.
- Any of the four accepted URL variables works (see [environment-variables.md](environment-variables.md)); the standalone `start.sh` checks the three `sphere_pharmacy_*` names specifically.
- Schema is managed exclusively by `prisma migrate deploy` — never ship or restore a bundled database file.

See [database-operations.md](database-operations.md) and [backup-and-restore.md](backup-and-restore.md).

## Post-deploy checklist

Run top-to-bottom on first deployment; re-check items 3–5 after any environment-variable change.

| # | Item | How |
| --- | --- | --- |
| 1 | **Migrations applied** | `npx prisma migrate deploy`, then `npx prisma migrate status` must show all 11 applied, none pending — before accepting traffic |
| 2 | **Admin bootstrap** | Create the first ADMIN (guarded seed refuses production; controlled manual procedure — one-off script or direct insert with a correctly scrypt-hashed password). **Requires live verification**; no dedicated bootstrap command exists in-repo |
| 3 | **Provider callbacks** | M-Pesa callback with `?token=` (appended automatically), IntaSend webhook → `/api/payments/intasend/webhook`, Resend → `/api/notifications/email-webhook`; confirm `MPESA_CALLBACK_TOKEN` / `INTASEND_WEBHOOK_SECRET` / `RESEND_WEBHOOK_SECRET` match the dashboards |
| 4 | **Cron scheduling** | Every-minute notifications + ≥ 15-min reminders + TTL/retention jobs scheduled by the platform — the repo does **not** schedule cron itself ([scheduled-jobs.md](scheduled-jobs.md)) |
| 5 | **Health checks** | Storefront loads; `/api/settings` responds; admin can sign in; `/api/admin/notification-health` shows dispatcher configured; POS sync status via `/api/admin/pos-status` if BandaGo is live |
| 6 | **Rollback ready** | Previous tarball retained; rollback = redeploy it + `npx prisma migrate status` (migrations are forward-only in practice — see [database-operations.md](database-operations.md) and [backup-and-restore.md](backup-and-restore.md)) |

### Rollback procedure (detail)

1. Stop accepting traffic on the bad release (swap the Caddy upstream or take the instance out of rotation).
2. Redeploy the last known-good tarball and let `start.sh` boot it.
3. Run `npx prisma migrate status`. If the bad release applied a **new** migration, decide deliberately: forward-fix (preferred) or a coordinated restore from backup ([backup-and-restore.md](backup-and-restore.md)). Never `db:push` production to "revert" a migration.
4. Re-verify with the health checks above; re-run `/api/cron/notifications` once to confirm the dispatcher claims cleanly.

## Environment promotion (staging → production)

1. Build once per environment (`STANDALONE=true`), or promote the same tarball with environment-specific env vars — the artifact itself is environment-agnostic except for baked `NEXT_PUBLIC_*` values, so **if any `NEXT_PUBLIC_*` variable differs between environments, rebuild rather than reuse the tarball**.
2. Apply migrations to the target database (`migrate deploy`) before switching traffic.
3. Rotate per-environment secrets (never share `BANDAGO_SYNC_API_KEY`, callback tokens, or the hash secrets across environments).
4. Re-run the post-deploy checklist items 3–5 against the new environment.

## Security posture at the edge

The app sets its own security headers in `next.config.ts` (HSTS with preload, `nosniff`, `X-Frame-Options: DENY`, strict Referrer-Policy, restrictive Permissions-Policy, COOP, and a CSP that whitelists `*.r2.dev` / `*.cloudflarestorage.com` for images). When you put Caddy (or any TLS terminator) in front:

- Terminate TLS and forward `X-Forwarded-Proto: https` — production behavior (secure cookies, HTTPS-enforced payment callbacks, IntaSend `host`) depends on it.
- Preserve `X-Forwarded-For` (client-IP resolution for rate limiting reads it first; note it is spoofable by design — known LOW concern in [../governance/technical-debt.md](../governance/technical-debt.md)).
- Do not strip the `Authorization` header (cron calls) or the `?token=` query (M-Pesa callbacks) at the proxy.
- Keep request body limits compatible with the app's own caps (uploads ≤ 10MB; medicine-request photos 3MB) — the app enforces them itself, but a smaller proxy limit would surface as confusing 413s.

## Pre-flight before every release

```bash
npm run typecheck && npm run lint -- --max-warnings=0
npx prisma migrate status        # know your migration state before you ship
npm test && npm run test:assistant
npm run build:standalone         # proves the standalone artifact builds
```

This mirrors CI ([testing-strategy.md](../testing/testing-strategy.md)) plus the standalone build that CI's plain `npm run build` does not exercise.

## Related reading

- [local-development.md](local-development.md) — building and testing before you ship.
- [environment-variables.md](environment-variables.md) — the complete variable matrix for each deployment target.
- [database-operations.md](database-operations.md) — `migrate deploy` workflow and connection safety.
- [scheduled-jobs.md](scheduled-jobs.md) — the cron scheduling this deployment must provide.
- [../governance/architecture-decisions.md](../governance/architecture-decisions.md) — ADR-015 records why standalone + Caddy is the chosen pipeline.
- [../payment-notification-audit.md](../payment-notification-audit.md) — provider configuration the audit found missing locally (`MPESA_CALLBACK_TOKEN`, `CRON_SECRET`, `RESEND_WEBHOOK_SECRET`) — ensure these exist in production.
- [../governance/technical-debt.md](../governance/technical-debt.md) — deployment-relevant debt (no in-repo scheduler, hard-coded `.zscripts` path, payment blockers).
- [backup-and-restore.md](backup-and-restore.md) — artifact retention and the restore side of rollback.
