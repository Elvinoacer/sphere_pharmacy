# Notifications

Notifications use a durable database outbox: business code writes an in-app row plus channel jobs transactionally, and a cron-driven dispatcher delivers EMAIL (Resend) and PUSH (Firebase Cloud Messaging) with claim leases, bounded retries, and provider-event reconciliation. SMS exists **only** for OTP via Africa's Talking; WhatsApp exists **only** as `wa.me` links — neither is a dispatched notification channel.

| Audience | Status | Verified |
| --- | --- | --- |
| Engineers, AI coding agents | **Implemented** (dispatcher requires an external every-minute scheduler) | November 2026 |

## 1. Purpose

Tell customers and staff what changed (orders, payments, prescriptions, bookings, refills, stock) without coupling business transactions to network calls: queue writes are pure DB work that can join the caller's transaction, and delivery happens later, idempotently, with observability.

## 2. Users

- **Customers:** in-app inbox (bell), email and web-push delivery, per-channel preferences.
- **Staff (any role incl. RIDER):** in-app inbox, staff fan-out by role or staffId, push alerts for new orders/appointments.
- **ADMIN:** notification-health observability + dispatch-test.
- **System:** cron dispatcher + Resend webhook.

## 3. Screens

- **Inbox** — `notification-center.tsx` (header bell, both customers and staff): last 100, mark one/all read, opens the notification destination.
- **Account** (`account-view.tsx`) — notification prefs, "Enable push on this device", stock-alert watchlist.
- **Admin topbar** — push enable; **Admin → Settings** — dispatch-test surface.
- **Admin → Notification health** — via `/api/admin/notification-health` (no dedicated section; read through admin tooling/observability).
- Foreground pushes render as sonner toasts (`setupForegroundNotificationListener`) with a same-origin View action.

## 4. Frontend implementation

- `notificationsApi` (typed client): list, mark read, prefs, push-token register/delete.
- **Push registration** (`src/lib/firebase/client.ts`): secure-context + serviceWorker + `Notification` + `PushManager` capability checks; requires `NEXT_PUBLIC_FIREBASE_*` + VAPID key; permission prompt; `/firebase-messaging-sw.js` at scope `/`; `getToken` → `POST /api/notifications/push-token`; token cached in localStorage `sphere_device_token`. `disablePushNotifications` deletes + unsubscribes. On authenticated app start, granted permissions re-enable push automatically.
- Service worker forwards `PUSH_NOTIFICATION` postMessages to the page for foreground toasts.
- Logout (`use-auth-store`) posts the device token so the server deregisters it.

## 5. Backend implementation

- **Queueing (`src/lib/notify.ts`)** — `notifyCustomer`/`notifyStaff` do **DB work only** (no network I/O), running in their own 15s transaction or joining the caller's transaction. `enqueue()` resolves links (same-origin as `NEXT_PUBLIC_APP_URL` else `/account`; staff → `/admin`), writes the in-app `Notification` row (dedupeKey skipDuplicates), **one email job per recipient** (`{key}:email`; payload `{to, subject, html, text}`) and **one push job per registered device token** (`{key}:push:{tokenId}`). `notifyStaff` fans out by roles (default `[ADMIN]`) or staffId; staff emails only when `emailHtml` is supplied. Helpers: `addStatusEvent`, `audit`, `statusNotification`, `notifyServiceBooking`, `notifyPaymentOutcome` (payment dedupeKey `payment:{paymentId}:{success|failed}`; used by webhooks/cash-confirm **inside** their transactions; success also notifies staff `PAYMENT_RECEIVED`).
- **Dispatcher (`src/lib/notifications/delivery.ts`, via `GET /api/cron/notifications`)** — `dispatchNotifications(limit=10)`: picks due jobs (PENDING `availableAt ≤ now` OR PROCESSING with expired lease — crash recovery), atomically claims (PROCESSING, random `lockToken`, `lockedUntil = now+120s`, attempts+1); re-validates recipient exists/active + prefs (opt-out → SKIPPED); retry window 23h → FAILED "Retry window expired"; EMAIL skips `EmailSuppression` and sends with `Idempotency-Key = job.id` → SENT + providerId; PUSH re-verifies token ownership before sending; failure → attempts ≥8 ? FAILED : PENDING with backoff `min(3600, 60·2^(attempts−1))`s. After the batch, `reconcileEmailEvents()` processes ≤100 unprocessed `EmailDeliveryEvent`s matched by providerId; events <24h with no match wait; updates job status (never overwriting BOUNCED/COMPLAINED); BOUNCED/COMPLAINED → upsert `EmailSuppression`; marks events processed.
- **Email (`src/lib/email/resend.ts`)** — direct Resend REST POST, native fetch, 12s timeout; from `RESEND_FROM_EMAIL` or default onboarding address; **production refuses missing/@resend.dev senders**. Templates (`src/lib/email/templates.ts`, teal `#0f766e` table layout, Lumumba Drive footer): orderConfirmation, orderStatusUpdate, paymentReceipt, prescriptionStatus, backInStock, adminNotification, serviceBooking — subjects suffixed "— Sphere Pharmacy".
- **Email webhook** — `POST /api/notifications/email-webhook` (Svix: `svix-id` + `svix-timestamp` ±300s + HMAC-SHA256 over `id.timestamp.rawBody`, v1 timing-safe) persists `EmailDeliveryEvent` **before** acknowledging (events can precede the send response).
- **In-app** — `GET /api/notifications` (session-scoped, last 100, private no-store); `PATCH` mark one/all read.
- **Prefs** — `GET/PUT /api/notifications/prefs` (customer-only; partial booleans; **only email+push influence delivery** — sms/whatsapp flags are stored but never dispatched).
- **Admin observability** — `GET /api/admin/notification-health` (ADMIN): groupBy(channel,status) counts, oldestPendingAt, last 20 FAILED/BOUNCED/COMPLAINED, config flags; exposes no bodies/addresses/tokens. `GET/POST /api/notifications/dispatch-test` (ADMIN; 10/h): config probe + real test email/push to the admin's own address/devices.

## 6. Database

- **Notification** — `userId?/staffId?` either-or, `channel` always `"IN_APP"` in practice, `event?`, `title`, `message`, `read @default(false)`, `metadata?` (JSON incl. link).
- **NotificationDelivery** — durable outbox ("SENT means provider accepted"): `dedupeKey @unique`, channel EMAIL/PUSH, `payload Json`, status PENDING/PROCESSING/SENT/FAILED (+SKIPPED/DELIVERED/BOUNCED/COMPLAINED via reconciliation), `attempts`, `availableAt`, `lockedUntil?/lockToken?`, `providerId?`, `lastError?`, `sentAt?`.
- **PushToken** — `token @unique`, `userId?/staffId?`, `role?`, `platform?`.
- **NotificationPref** — `userId @unique`, sms/whatsapp/email/push booleans (only email+push effective).
- **EmailSuppression** (`email @id`, reason BOUNCED/COMPLAINED), **EmailDeliveryEvent** (svix id, providerId, status, processed).
- **ScheduledJobDelivery is dead schema** — zero references; the active queue is `NotificationDelivery`.
- See [../database/data-dictionary.md](../database/data-dictionary.md).

## 7. Workflow

Business event → `notifyCustomer/notifyStaff` (in-tx) → in-app row + per-recipient/per-device jobs → cron dispatcher claims leases → provider send (idempotency key) → Resend webhook events → reconciliation + suppression. Deep dive: [../operations/scheduled-jobs.md](../operations/scheduled-jobs.md).

## 8. Permissions

- All notification reads/writes strictly session-scoped; push tokens bind to the calling user/staff.
- Health + dispatch-test: ADMIN only.
- Email webhook authenticates via Svix signature; cron via Bearer `CRON_SECRET` (timingSafeEqual in `authorizedJob()`).

## 9. Integrations

- Resend (email): [../integrations/resend.md](../integrations/resend.md).
- Firebase Cloud Messaging (push): [../integrations/firebase.md](../integrations/firebase.md).
- Africa's Talking: **OTP SMS only** (`src/lib/sms.ts`; only caller `otp/request`) — not part of this feature.
- WhatsApp: `wa.me` deep links only (UI buttons, email footers) — never a delivery integration. Do not represent preference flags or click-to-chat links as delivery channels.

## 10. Validation and business rules

- Channel truth: in-app always; EMAIL + PUSH via outbox; SMS/WHATSAPP never dispatched by the queue.
- One email job per recipient; one push job per registered device; dedupe keys prevent duplicates.
- Max 8 attempts; backoff `min(3600, 60·2^(attempts−1))`s; 23h retry window; 120s claim leases.
- Prefs enforced at dispatch time (EMAIL/PUSH only); `channelAllowed()` exists but is unused.
- Bounced/complained addresses are suppressed until an admin removes the row.
- Push token re-verification (ownership) happens on every dispatch attempt.

## 11. Failure handling

- Provider failure → bounded retry with exponential backoff; terminal FAILED retains `lastError` for investigation (do not blindly reset).
- Crash recovery: expired leases are reclaimable by the next run.
- Events-before-send-response are reconciled later by `reconcileEmailEvents()`.
- Older business routes that call the notifier *after* their transaction still have a commit-to-enqueue gap (payment callbacks, cash-confirm, and service payment selection were moved inside their transactions).

## 12. Testing

- `tests/admin-live-sync.test.mjs` — adjacent admin sync surfaces; notification-specific static assertions live in `tests/security-static.test.mjs` (webhook auth functions).
- Live delivery verification is manual via admin dispatch-test; see [../testing/testing-strategy.md](../testing/testing-strategy.md) and [../payment-notification-audit.md](../payment-notification-audit.md).

## 13. Operational requirements

- **Cron every minute:** `GET /api/cron/notifications` (Bearer `CRON_SECRET` ≥32; maxDuration 300; ≤10 jobs per invocation) — external scheduler required (no in-repo vercel.json).
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (verified sender in production), `RESEND_WEBHOOK_SECRET` (`whsec_…`); register the webhook for delivered/bounced/complained/failed.
- `NEXT_PUBLIC_FIREBASE_*` + `VAPID_KEY` (browser) and `FIREBASE_SERVICE_ACCOUNT_KEY` or `FIREBASE_PROJECT_ID+CLIENT_EMAIL+PRIVATE_KEY` (server).
- Retention policy for sent jobs/provider events (payloads contain recipient details/tokens).

## 14. Known limitations

- `ScheduledJobDelivery` is vestigial schema; `channelAllowed()` unused; prefs for SMS/WhatsApp are stored but inert.
- `Notification.channel` only ever IN_APP; `NotificationDelivery.channel` only EMAIL/PUSH — the `NOTIFICATION_CHANNELS` constant is broader than reality.
- Provider-accepted push is best-effort device delivery; SENT ≠ read.
- The every-minute scheduler is a hard external dependency; reminder windows depend on its uptime.
- Some legacy mutations still notify after commit (commit-to-enqueue gap noted above).
