# Pharmacy operations guide

This is the day-in-the-life guide to running Sphere Pharmacy with the platform: how the staff workspace is organised, what each section is for, how cash and riders are handled, and what to do when something misbehaves. Keep it beside the counter. Who may use which section is covered in [user-roles-and-permissions.md](user-roles-and-permissions.md); this page is about *how*.

| Audience | Status | Verified |
| --- | --- | --- |
| Pharmacy owner, pharmacists, staff | Implemented — verified against code | November 2026 |

## Signing in for your shift

1. Open the storefront and scroll to the footer → **Staff dashboard** (or go straight to `/auth?mode=staff`).
2. Sign in with your staff email and password. You land in the staff workspace at `/admin`.
3. Your session lasts at most 7 days and expires after 12 hours of inactivity. If an admin changes your role, password or deactivates you, you are signed out immediately.
4. Riders: the workspace opens straight onto your personal delivery board.

Turn on push alerts when prompted (topbar → the bell icon). The workspace polls for changes every 15 seconds and raises a toast — "New order received", "New care appointment" — plus a phone notification if push is enabled. It also refreshes when you refocus the tab or come back online. `Cmd/Ctrl + K` opens a quick-jump palette to any section.

## The workspace at a glance

The sidebar has four groups and 16 sections:

| Group | Sections | Group | Sections |
| --- | --- | --- | --- |
| **Workspace** | Overview · Orders · Dispatch | **Business** | Catalogue · Promotions · Reviews · Reports · Service analytics |
| **Patient care** | Prescriptions · Medicine requests · Service bookings · Services | **Management** | Staff · Compliance · Settings · POS Sync |

You only see the sections your role allows; the server enforces the same limits even if a section is requested directly. Dark mode lives in the topbar (the storefront itself is light by default).

## Workspace group

### Overview
Your morning dashboard (Admin, Pharmacist, Staff): orders today and this week, revenue, active orders, orders awaiting payment, prescriptions pending review, stock-status counts and total customers, plus a 14-day orders/revenue chart, top products, prescription-vs-OTC split, order-status breakdown and the latest audit entries. Use it to size the day before opening the queues.

### Orders queue and focus lanes
The heart of the operation (Admin, Pharmacist, Staff). The queue view splits work into **focus lanes** that mirror physical stages:

- **Review** — new orders needing attention (check details, prescriptions, availability).
- **Pack** — accepted orders being prepared. One deliberate action ("Start packing") accepts an order and begins packing; it requires a confirmed payment (or a cash order) and fully approved prescriptions.
- **Handoff** — packed orders waiting for pickup or a rider.
- **Collect** — ready for pickup.

Staff move orders forward with status buttons; only valid transitions are offered (the server rejects anything else). Bulk actions ("Start packing" / "Mark ready") cover up to 25 orders at a time. From any order you can request an M-Pesa payment prompt for the customer, confirm cash, or assign a rider. Every change lands in the order's history and the audit log. If two staff touch the same order simultaneously, the second is told the order changed and can retry — nothing is silently overwritten.

Two automatic rules protect you here:

- **Reservation expiry:** an unpaid order holds its stock only for the configured window; after that a background job cancels it, returns the stock and re-credits any redeemed points. The order history shows "Inventory reservation expired before payment" with the actor "System".
- **Cancellation:** customers (and staff) can cancel only before payment succeeds; captured payments are never auto-refunded by a cancellation.

### Dispatch: control room vs rider board
- **Dispatch control room** (Admin, Pharmacist, Staff — everyone except riders): tabs for all / unassigned / handoff / on-road / completed deliveries, searchable by reference, name, phone or area. Assign riders, open map links, collect cash confirmations, and use the 2-hour triage view to chase deliveries that have been out too long.
- **Rider board** (Rider): a personal list of assigned drops with call and WhatsApp buttons. Riders mark a delivery **out for delivery** and then **completed** — those are the only two transitions they can perform. Riders cannot cancel orders or see anyone else's.

The dispatch flow end to end: order paid for delivery → appears in the control room → assign an active rider (customer and rider are notified) → pack and mark ready → rider (or staff) marks it out for delivery → rider completes the drop → if it is cash on delivery, the rider confirms cash on the spot.

## Patient care group

### Prescriptions review (Admin, Pharmacist)
The clinical queue, sorted so pending items surface first. Open a prescription to view the uploaded file via a short-lived private link (every view is logged). Decide per prescription:

- **Approve** — optionally allow 0–6 refills and set validity (30/60/90/180 days).
- **Partially approve** — some items fine, others not; add notes.
- **Request clarification** — ask the customer a question; the order stays under review until resolved.
- **Reject** — with a reason; the linked order is rejected and the customer notified.

When every prescription on an order is decided (all approved/partially approved), the order automatically becomes payable; if any is rejected, the order is rejected. **Refills never skip review**: each refill use creates a new pending prescription that a pharmacist must verify.

### Medicine requests (Admin, Pharmacist, Staff)
The "find this medicine" queue from guests and customers. Each request shows the medicine name, phone number and — when provided — a photo of the exact pack, stored privately and streamed only to staff. Work them through statuses: **new → contacted → fulfilled** or **unavailable**, with staff notes for follow-up. No notification fires when a request arrives, so glance at this queue periodically through the day.

### Service bookings management (Admin, Pharmacist, Staff)
Views: queue (pending), upcoming, history and all, with date ranges, staff filters and search. Actions: confirm, reschedule (the system re-checks availability and notifies the customer), cancel, mark arrived / in progress / completed / no-show, and assign a team member. The overview shows pending and upcoming counts with the next booking front and centre.

### Services catalogue editing (Admin, Pharmacist, Staff)
Create and edit services: name, description, duration (5–480 minutes), price or "price on asking", imagery, featured/sort order, publish state, and weekly availability rules (per weekday time windows; one customer per slot). Slot rules replace as a set, so edit them as a whole list.

## Business group

### Catalogue and CSV import (Admin, Pharmacist, Staff)
Full product management: create and edit products, prices, stock, categories and images; discontinue items; bulk import from CSV. Deleting products is admin-only. Custom local images are never overwritten by POS sync. Use CSV import for day-one loads and corrections — it accepts many column aliases (POS-style headers included) and runs through the same hardened pipeline as the live sync.

### Promotions (Admin, Staff)
Create percentage discount codes with usage limits (total uses, per user, per IP, per browser), minimum spend, active windows (Kenya-local dates) and public/private visibility; manage banners and campaigns. Codes with zero redemptions can be deleted; used codes are archived instead, preserving history. Only percentage discounts exist — fixed-amount and free-shipping types are not shipped.

### Reviews moderation (Admin, Pharmacist)
Publish or hide customer product reviews. Hidden reviews are retained but not shown on the storefront.

### Reports and CSV export (Admin)
Sales, product and funnel reports with 14-day series; every table exports to CSV (with a friendly filename, opened directly from the section). Service analytics (its own section) summarises bookings, completion rate and revenue over a chosen window.

## Management group

### Staff (Admin)
The team roster: create staff, set roles, reset access, deactivate. Changing someone's role, password or active status immediately ends their open sessions — use deactivation the moment someone leaves.

### Compliance (Admin, Pharmacist)
An internal record of the premise licence (number and expiry) and the superintendent pharmacist (name and registration), plus notes. The platform is explicit that recording this is **not** PPB verification or authorisation to publish it; the public storefront makes no licence claim. Every save is audited, and the details are hidden from roles below Admin/Pharmacist.

### Settings (Admin)
- **Pharmacy profile** — name, tagline, phone, WhatsApp, email, address, hours label, maps link. Replace the placeholder email (orders@spherepharmacy.co.ke) before going live.
- **Delivery** — choose zone pricing (Roysambu/TRM 150, Kasarani 200, Githurai 44 250, Ruaraka/Baba Dogo 250, Nairobi CBD 400, other Nairobi 500; free over KSh 3,000) or distance-based pricing with up to 30 bands around the pharmacy's location; up to 50 zones; a flat-fee fallback.
- **Demo data** — helpers used when preparing recordings; leave untouched in production.

### POS Sync hub (Admin, Pharmacist)
The BandaGo integration control room: metric cards for POS products mapped, active batches (lots), near-expiry flags (<90 days, shown as a Kenya PPB audit alert) and the last live signal ("Awaiting extension" until the external Chrome extension is connected). Below, a stock-sync ledger of every synchronization event, and a manual CSV dropzone for imports. The hub auto-refreshes every 30 seconds. One known hardening item: the browser-side CSV import carries the POS sync key in the page (it is a client-exposed credential) — acceptable for controlled pharmacy use, and tracked with the other security follow-ups in [../security/access-control.md](../security/access-control.md).

## Cash handling rules

Cash is confirmed — never assumed. The "confirm cash" action (any staff; riders only for **their own** cash-on-delivery orders that are out for delivery) is allowed when:

- the order is in one of: availability confirmed, awaiting payment, ready for pickup, out for delivery;
- every prescription on the order is approved; and
- no successful payment already exists for it.

Confirming records a cash payment marked successful, moves an unpaid order to **paid** if it was not already there, and awards the customer's Sphere Points at that moment. Cash refunds are an admin action requiring an explicit confirmation and a till reference number, and they are logged.

## Notifications: what rings where

| Channel | Who gets it | Notes |
| --- | --- | --- |
| In-app inbox and toasts | Customers (inbox); staff (toasts) | Always on; the reliable baseline |
| Email | Customers | Needs Resend credentials; production needs a verified sender domain |
| Push | Staff and customers | Needs Firebase; staff get "new order" / "new care appointment" alerts |
| SMS | Sign-in codes only | Transactional SMS is not shipped |
| WhatsApp | Click-to-chat only | Buttons open a chat with the pharmacy; nothing is sent automatically |

Customers manage their email/push preferences in "My Sphere" (only those two matter today). Admins can check delivery health (queue counts, failures) and send a test email/push to their own devices from the admin tools. If email or push seem silent, check the health monitor before assuming customers were not notified.

## Background jobs that need a scheduler

These features are implemented as secure scheduled endpoints that an external scheduler must call with the secret key (they do nothing until scheduled):

| Job | Suggested frequency | What it does |
| --- | --- | --- |
| Notifications dispatch | Every minute | Sends queued email/push (10 per run) |
| Order reservations | Every few minutes | Cancels stale unpaid orders, restores stock and points |
| Service booking reminders | Every 15 minutes or less | Sends 24-hour and 2-hour appointment reminders |
| Chronic refill reminders | Daily | Nudges patients ~30 days after a prescription order |
| Prescription retention | Daily (e.g. weekly is fine) | Deletes expired prescription records per the retention setting |

## When things go wrong

- **A payment is stuck "processing"** — do not re-trigger blindly. The system deliberately preserves uncertain outcomes for reconciliation; check the payment's status and the audit trail first.
- **A customer says they paid but the order is unpaid** — verify the payment reference in the provider's portal; only provider-confirmed payments mark orders paid.
- **Emails or pushes not arriving** — check the admin notification health monitor; test-send to your own device.
- **Stock looks wrong** — check the POS Sync hub ledger for the last sync and any item errors; re-import the CSV as a stopgap.
- **"Order changed" errors** — someone else updated the order first; refresh and retry.
- Systematic troubleshooting lives in [../operations/troubleshooting.md](../operations/troubleshooting.md), and the payment/notification audit in [../payment-notification-audit.md](../payment-notification-audit.md) lists the known release blockers in detail.

## Demo vs production realities

Be aware of what a fresh install gives you:

- **The database seed creates only starter categories and — optionally — one admin account** (set up with an email and a strong password through environment variables). No demo customers, orders, prescriptions, promotions or riders are created.
- **The demo credentials in the older project README (admin123, pharm123 and friends) are historical** — they date from the demo era and do not exist in a fresh install. Do not hand them to staff.
- **Load real inventory** via CSV import or the BandaGo sync before opening the storefront to customers.
- **Payments** are real-provider capable but **Require live verification**: production Daraja credentials for M-Pesa, IntaSend certification for cards, verified callback URLs, and a certified sender domain for email. The sandbox values in the configuration template are examples.
- **Configure the scheduler** (see the table above) or reminders, reservation expiry and notification delivery will not run.
- **Record your compliance details** in Admin → Compliance — and remember it is an internal record, not a PPB licence claim.
- The [../recording/recording-checklist.md](../recording/recording-checklist.md) (51 journeys) doubles as a go-live acceptance test: run the starred journeys after major configuration changes.

## Related documentation

- The big picture: [product-overview.md](product-overview.md) · Every feature and its status: [feature-catalogue.md](feature-catalogue.md)
- The six core journeys: [customer-journeys.md](customer-journeys.md) · Roles and access: [user-roles-and-permissions.md](user-roles-and-permissions.md)
- Engineering workflows: [../workflows/](../workflows/) · Operations runbooks: [../operations/](../operations/) · Project README: [../../README.md](../../README.md)
