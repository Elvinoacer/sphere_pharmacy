# Environment Variables Reference

This is the complete matrix of environment variables consumed by Sphere Pharmacy: every variable documented in `.env.example`, plus the runtime-only variables that exist in code but are absent from `.env.example` (a recurring source of 503s — see the callouts). Use it to configure local development, CI, and production deployments.

| Audience | Status | Verified |
| --- | --- | --- |
| Developers, operators, DevOps | **Implemented** | November 2026 |

## Classification rules

- **Public** — any `NEXT_PUBLIC_*` variable is compiled into the browser bundle. It is **not a secret** and must never hold a credential value. See the [security callout](#security-callout-next_public_pos_sync-secret) below.
- **Server-secret** — must only exist in server-side env / a secrets vault. Marked **Yes** in the Secret column.
- **Required** — the feature or endpoint hard-fails (or refuses to run) without it. **Cron-only** means the variable is required by a cron endpoint but not by normal request paths. **Optional** — feature degrades gracefully (usually fail-closed or silently disabled).

## Database (from `.env.example`)

| Variable | Scope | Required | Secret | Notes |
| --- | --- | --- | --- | --- |
| `sphere_pharmacy_PRISMA_DATABASE_URL` | Server | One of the four URL vars | Yes | Preferred external PostgreSQL URL; use the **pooled** (`-pooler`) hostname on Neon. `db.ts` appends `statement_cache_size=0` on pooled hosts to prevent PgBouncer stale-plan errors (Prisma error `0A000`). |
| `sphere_pharmacy_DATABASE_URL` | Server | Alternative to the above | Yes | Second accepted alias. |
| `sphere_pharmacy_POSTGRES_URL` | Server | Alternative to the above | Yes | Third accepted alias; `.zscripts/start.sh` hard-fails if none of the three `sphere_pharmacy_*` URLs is set. |
| `DATABASE_URL` | Server | Used by CI; resolution-order first | Yes | Not in `.env.example` but checked **first** by `src/lib/db.ts`. CI sets it to the `postgres:16` service. Handy for local Prisma CLI defaults. |

## AI assistant

| Variable | Scope | Required | Secret | Notes |
| --- | --- | --- | --- | --- |
| `GROQ_API_KEY` | Server | Optional | Yes | Enables the LLM-backed assistant mode. **Without it the assistant runs in deterministic rule-based mode** — no error, no network calls. |
| `GROQ_MODEL` | Server | Optional | No | Defaults to `openai/gpt-oss-20b` in `.env.example`. |

## Email (Resend)

| Variable | Scope | Required | Secret | Notes |
| --- | --- | --- | --- | --- |
| `RESEND_API_KEY` | Server | Optional (required for email delivery) | Yes | Drives `sendEmail` (direct REST call, 12s timeout, `Idempotency-Key` per job). Without it email jobs fail at dispatch. |
| `RESEND_FROM_EMAIL` | Server | Optional | No | Production **refuses** to send if unset or still the `@resend.dev` default ("A verified sender domain is required in production"). |
| `RESEND_WEBHOOK_SECRET` | Server | Optional (required for delivery analytics) | Yes | Svix-style `whsec_…` secret for `POST /api/notifications/email-webhook` (HMAC-SHA256 over `id.timestamp.body`, ±300s timestamp window). |

## Push notifications (Firebase FCM)

| Variable | Scope | Required | Secret | Notes |
| --- | --- | --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Server | One of the two server config forms | Yes | Full service-account JSON as a single string; takes precedence over the three-part form. |
| `FIREBASE_PROJECT_ID` | Server | Or the JSON above | No | Falls back to `NEXT_PUBLIC_FIREBASE_PROJECT_ID` if unset. |
| `FIREBASE_CLIENT_EMAIL` | Server | With the two above | No | Service-account email. |
| `FIREBASE_PRIVATE_KEY` | Server | With the two above | Yes | Multi-line key; keep the `\n` escapes intact. |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Public | Optional (push) | No | Browser-side Firebase project id. |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Public | Optional (web push) | No | The web-push **VAPID key** — public by design (it identifies, not authenticates). This is the only VAPID variable in the codebase; the server sends via the FCM v1 API using the service account above. Push silently disables without it. |

## Application URL

| Variable | Scope | Required | Secret | Notes |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Public | Required in production practice | No | Canonical HTTPS origin. Used for notification links, IntaSend `host`/redirect (HTTPS enforced in production), push deep links. Falls back to `https://spherepharmacy.co.ke` in a few places. |

## Payments — M-Pesa Daraja (STK Push)

| Variable | Scope | Required | Secret | Notes |
| --- | --- | --- | --- | --- |
| `MPESA_ENVIRONMENT` | Server | Optional | No | `sandbox` or `production`. **Production also requires `MPESA_ENVIRONMENT=production` plus HTTPS callbacks** (fail-closed in `daraja.ts`). |
| `MPESA_CONSUMER_KEY` | Server | Optional (required for M-Pesa) | Yes | Daraja app consumer key. |
| `MPESA_CONSUMER_SECRET` | Server | Optional (required for M-Pesa) | Yes | Daraja app consumer secret. |
| `MPESA_PASSKEY` | Server | Optional (required for M-Pesa) | Yes | Lipa na M-Pesa Online passkey. |
| `MPESA_SHORTCODE` | Server | Optional | No | `.env.example` ships the public sandbox shortcode `174379`. |
| `MPESA_TRANSACTION_TYPE` | Server | Optional | No | `CustomerPayBillOnline`. |
| `MPESA_CALLBACK_URL` | Server | Optional (required for M-Pesa) | No | Base callback; the app appends `?token=<MPESA_CALLBACK_TOKEN>`. Must be HTTPS in production. |
| `MPESA_CALLBACK_TOKEN` | Server | Optional (required for M-Pesa callbacks) | Yes | ≥ 24 chars; compared timing-safe on both order and service callbacks. Flows in the URL query — keep it unique and rotate if logs leak (see [troubleshooting.md](troubleshooting.md)). |

## Payments — IntaSend (cards)

| Variable | Scope | Required | Secret | Notes |
| --- | --- | --- | --- | --- |
| `INTASEND_ENVIRONMENT` | Server | Optional | No | `sandbox` or `production` (production value enforced fail-closed). |
| `INTASEND_PUBLISHABLE_KEY` | Server | Optional (required for cards) | No | Publishable key (`ISPubKey_…`). |
| `INTASEND_SECRET_KEY` | Server | Optional (required for cards) | Yes | Secret API key. |
| `INTASEND_WEBHOOK_SECRET` | Server | Optional (required for webhooks) | Yes | ≥ 24 chars; must exactly match the dashboard challenge. Verified via body challenge (timing-safe), HMAC signature, or header — and the invoice is **always re-fetched server-side** before trusting state. |

## Object storage (Cloudflare R2)

| Variable | Scope | Required | Secret | Notes |
| --- | --- | --- | --- | --- |
| `R2_ACCOUNT_ID` | Server | Optional (required for uploads) | No | Cloudflare account id; used to derive the default endpoint. |
| `R2_ACCESS_KEY_ID` | Server | Optional (required for uploads) | Yes | S3-compatible access key. |
| `R2_SECRET_ACCESS_KEY` | Server | Optional (required for uploads) | Yes | S3-compatible secret. |
| `R2_BUCKET_NAME` | Server | Optional (required for uploads) | No | Bucket holding prescriptions (private), medicine-request photos (private), product/service imagery (public). |
| `R2_ENDPOINT` | Server | Optional | No | Defaults to `https://<account-id>.r2.cloudflarestorage.com`. |
| `R2_PUBLIC_URL` | Server | Optional (public objects) | No | Public base for public uploads (throws if a public upload is attempted while unset). |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | Public | Optional | No | Browser-visible base for public R2 assets; whitelisted in CSP `img-src`. |

## Cron & webhook auth

| Variable | Scope | Required | Secret | Notes |
| --- | --- | --- | --- | --- |
| `CRON_SECRET` | Server | Required (cron-only) | Yes | ≥ 32 chars. All five cron endpoints require `Authorization: Bearer <CRON_SECRET>`. Without it (or below 32 chars) every cron call fails auth. See [scheduled-jobs.md](scheduled-jobs.md). |

## Hash / session secrets

| Variable | Scope | Required | Secret | Notes |
| --- | --- | --- | --- | --- |
| `SESSION_SECRET` | Server | Yes (effective ≥ 32 chars) | Yes | Backstop secret; `OTP_HASH_SECRET` and `TOKEN_HASH_SECRET` fall back to it. |
| `TOKEN_HASH_SECRET` | Server | Yes (effective ≥ 32 chars) | Yes | HMAC key for guest-order tokens and promotion IP/browser hashes. **Never rotate casually**: existing HMAC-based redemption identifiers must remain comparable across orders (rotation also breaks promotion-limit comparability — see [../governance/technical-debt.md](../governance/technical-debt.md)). |
| `OTP_HASH_SECRET` | Server | Yes (effective ≥ 32 chars) | Yes | HMAC key for OTP code hashes (`OtpCode.codeHash`). |

Generation guidance:

```bash
openssl rand -base64 48   # run once per secret — generate each independently
```

All three must be ≥ 32 chars (the app throws otherwise). Do not derive one from another; independent generation limits blast radius if one leaks. Never commit `.env`, and never paste real values into tickets or docs.

## BandaGo POS & CRM integration

| Variable | Scope | Required | Secret | Notes |
| --- | --- | --- | --- | --- |
| `BANDAGO_SYNC_API_KEY` | Server | Optional (required for POS sync) | Yes | Bearer secret for `POST /api/integrations/bandago/sync`, `csv-import`, and `crm`. **The sync route never validates the bearer when the variable is unset** — set it in every environment. Also see the hard-coded fallback issue below. |
| `NEXT_PUBLIC_POS_SYNC_SECRET` | Public | Optional | **No — browser-visible by definition** | Sent as a Bearer token from the admin CSV dropzone UI, so it is embedded in the client bundle. See the security callout. |

## Runtime-only variables (NOT in `.env.example`)

These exist only in code/CI. Missing ones are a common cause of confusing 503s and skipped behavior.

| Variable | Scope | Required | Secret | Notes |
| --- | --- | --- | --- | --- |
| `ORDER_RESERVATION_TTL_MINUTES` | Server | Required (cron-only) | No | `15`–`10080`. `/api/cron/order-reservations` returns **503 without it**. CI sets `60`. |
| `PRESCRIPTION_RETENTION_DAYS` | Server | Required (cron-only) | No | `30`–`36500`. `/api/cron/prescription-retention` returns **503 without it**. CI sets `365`; the BandaGo blueprint cites a 2-year Kenya PPB Cap 244 retention intent. |
| `AFRICAS_TALKING_USERNAME` | Server | Optional (SMS OTP only) | No | Africa's Talking account username (OTP sign-in is the only SMS caller). |
| `AFRICAS_TALKING_API_KEY` | Server | Optional (SMS OTP only) | Yes | Africa's Talking API key. |
| `AFRICAS_TALKING_SENDER_ID` | Server | Optional | No | Sender id / shortcode for OTP SMS. |
| `SEED_ADMIN_EMAIL` | Server | Optional (seed) | No | Together with the password, creates/updates exactly one dev ADMIN in the guarded seed. |
| `SEED_ADMIN_PASSWORD` | Server | Optional (seed) | Yes | Must be **≥ 14 chars** or the admin upsert is skipped. |
| `ALLOW_DESTRUCTIVE_SEED` | Server | Required to run seed at all | No | Must be `true`; seed also refuses when `NODE_ENV=production`. |
| `SEED_DATABASE_ACK` | Server | Required for non-localhost seed | No | Must equal the database host being seeded (explicit remote acknowledgement). |
| `STANDALONE` | Build-time | Optional | No | `true` makes `next.config.ts` emit `output: "standalone"` (used by `build:standalone` and `.zscripts/build.sh`). |
| `NEXT_PUBLIC_POS_SYNC_SECRET` fallback value | — | — | — | Documented here only as the known-issue cross-reference in the callout below. |

## Security callout: NEXT_PUBLIC_POS_SYNC_SECRET

`NEXT_PUBLIC_POS_SYNC_SECRET` is **browser-visible by definition** (the `NEXT_PUBLIC_` prefix inlines it into the client bundle) yet is used as a Bearer credential for the BandaGo sync/CRM endpoints from the admin CSV upload UI. `.env.example` additionally ships the **same default value** for it and `BANDAGO_SYNC_API_KEY`, and `csv-import/route.ts` contains a hard-coded fallback secret (the literal is intentionally not reproduced here). Consequences and remediation are tracked as a HIGH item in [../governance/technical-debt.md](../governance/technical-debt.md): remove the browser-borne secret (use staff sessions instead), remove the fallback, and rotate any credential that ever equaled the shipped default.

## CI reference values (safe, non-secret)

CI (`.github/workflows/ci.yml`) sets: `DATABASE_URL=postgresql://sphere:sphere@localhost:5432/sphere_test`, `NODE_ENV=test`, dedicated 32+-char CI-only values for `CRON_SECRET`/`SESSION_SECRET`/`OTP_HASH_SECRET`/`TOKEN_HASH_SECRET`, `PRESCRIPTION_RETENTION_DAYS=365`, `ORDER_RESERVATION_TTL_MINUTES=60`. These CI secrets are throwaway values that exist only to satisfy the ≥ 32-char invariants during tests — they are not production secrets.

## Minimum variable sets by goal

Use these checklists when standing up an environment; everything else degrades gracefully (fail-closed) until added:

| Goal | Variables |
| --- | --- |
| App boots, storefront + catalog work | one database URL variable (pooled on Neon) + `SESSION_SECRET`/`TOKEN_HASH_SECRET`/`OTP_HASH_SECRET` (≥ 32 chars each; independent values) |
| Sign-in OTP SMS works | `AFRICAS_TALKING_USERNAME` + `AFRICAS_TALKING_API_KEY` (+ optional `AFRICAS_TALKING_SENDER_ID`) |
| Emails deliver | `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (verified domain — production refuses the `@resend.dev` default) + `NEXT_PUBLIC_APP_URL` |
| Email bounce/complaint handling | `RESEND_WEBHOOK_SECRET` + Resend dashboard webhook pointed at `/api/notifications/email-webhook` |
| Push notifications | FCM service account (`FIREBASE_SERVICE_ACCOUNT_KEY` **or** the PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY triple) + `NEXT_PUBLIC_FIREBASE_PROJECT_ID` + `NEXT_PUBLIC_FIREBASE_VAPID_KEY` |
| M-Pesa STK payments | `MPESA_ENVIRONMENT` + `MPESA_CONSUMER_KEY` + `MPESA_CONSUMER_SECRET` + `MPESA_PASSKEY` + `MPESA_SHORTCODE` + `MPESA_CALLBACK_URL` (HTTPS in production) + `MPESA_CALLBACK_TOKEN` (≥ 24) |
| IntaSend card payments | `INTASEND_ENVIRONMENT` + `INTASEND_PUBLISHABLE_KEY` + `INTASEND_SECRET_KEY` + `INTASEND_WEBHOOK_SECRET` (≥ 24, matching the dashboard challenge) + `NEXT_PUBLIC_APP_URL` |
| Prescription / photo uploads | `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET_NAME` (+ `R2_ENDPOINT` if non-default, `R2_PUBLIC_URL` for public objects) |
| Cron jobs run | `CRON_SECRET` (≥ 32) + `ORDER_RESERVATION_TTL_MINUTES` (15–10,080) + `PRESCRIPTION_RETENTION_DAYS` (30–36,500) |
| BandaGo POS sync | `BANDAGO_SYNC_API_KEY` (strong, unique per environment — never the shipped default) |
| AI assistant LLM mode | `GROQ_API_KEY` (+ optional `GROQ_MODEL`; absent ⇒ deterministic mode, which is fully functional) |
| Standalone deployment build | `STANDALONE=true` at build time |

## Rules of thumb

1. **One secret, one purpose, one environment.** Never share a value across staging and production, and never reuse a database URL variable to mean something else.
2. **Public ≠ secret.** If a value must stay confidential it may not carry the `NEXT_PUBLIC_` prefix — that prefix is a compile-time disclosure.
3. **Fail-closed is the norm.** Payment and notification integrations deliberately refuse to operate half-configured (e.g. production refuses unverified senders; Daraja requires `MPESA_ENVIRONMENT=production` + HTTPS); do not "fix" this by loosening code — complete the configuration.
4. **The 503 cron errors are configuration signals.** `ORDER_RESERVATION_TTL_MINUTES` and `PRESCRIPTION_RETENTION_DAYS` are absent from `.env.example` on purpose (deliberate per-deployment choices); their absence produces explicit 503s rather than silent defaults.
5. **Audit `.env.example` diffs in review.** Any new variable added to code should appear here (or in the runtime-only table) in the same change.
