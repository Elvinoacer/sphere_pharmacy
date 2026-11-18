# Feature catalogue

This is the complete inventory of what the Sphere Pharmacy platform does, module by module, written for the pharmacy team. Each row states the purpose, who mainly uses it, where to find it, and — most importantly — an honest backend status. Read [product-overview.md](product-overview.md) first for the big picture.

| Audience | Status | Verified |
| --- | --- | --- |
| Pharmacy owner, pharmacists, staff | Implemented — verified against code | November 2026 |

## How to read the status labels

| Label | Meaning |
| --- | --- |
| **Implemented** | Built and working in the code today. |
| **Environment-dependent** | Code is complete, but it only works once provider credentials or infrastructure are configured (Resend email, Firebase push, R2 file storage, an external scheduler for background jobs, Africa's Talking for SMS codes). |
| **Requires live verification** | Fully built against sandbox/test settings; must be certified with the live provider before real use (M-Pesa Daraja, IntaSend cards, the external BandaGo browser extension). |
| **Planned or not shipped** | Appears in plans or older documents but is **not** in the code today. |

**Where to find things:** customer-facing screens live on the public storefront (for example `/catalog`, `/cart`, `/checkout`). Staff features live in the admin workspace at `/admin` — sign in via the footer's "Staff dashboard" link. A status of "server-side" means the behaviour happens automatically in the background with no screen of its own.

## Public storefront and home

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Landing page | First impression: hero, search, category cards, care-service previews, contact routes | Everyone | `/` (home) | **Implemented** | Opening-hours indicator follows 8:00–22:30 daily |
| Navigation and browser back/forward | Move between views; phone bottom navigation | Everyone | All public views | **Implemented** | Every screen has its own URL; back/forward fully supported |
| WhatsApp and call buttons | Reach a human at the pharmacy | Everyone | Header, footer, order screens, assistant | **Implemented** | Click-to-chat links only (wa.me) — not automated messaging |
| AI assistant ("Sphere companion") | Find products, prepare bookings and payments, answer questions | Everyone | Floating button, bottom-right | **Environment-dependent** | Deterministic actions work always; conversational replies need a Groq API key |

## Product catalogue

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Browse and search | Find medicines by name, brand or pack size | Everyone | `/catalog` | **Implemented** | Filters: category, prescription, availability; sorts by popularity, price, name, newest |
| Product detail page | Photos, price, pack size, stock and Rx badges, related items | Everyone | `/products/{id}` | **Implemented** | Shows stock state and whether a prescription is required |
| Back-in-stock alerts | Get notified when a watched item is restocked | Customers | Bell icon on product page; watchlist in `/account` | **Implemented** | Delivery uses the notification system (email/push once configured) |
| Medicine request CTA | Ask for an item missing from the catalogue | Everyone, incl. guests | `/catalog` and product pages | **Implemented** | See the Medicine requests module below |

## Shopping

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Cart | Collect items, edit quantities (max 99 per line), see Rx notices | Everyone | `/cart` | **Implemented** | Saved on the customer's device; survives sign-in during checkout |
| Promo code entry | Apply a discount code, checked by the server | Customers | `/cart`, `/checkout` | **Implemented** | Per-user codes require sign-in; the server re-validates at order time |
| Wishlist | Save items for later | Everyone, incl. guests | Product pages | **Implemented** | Stored on the device only; never synced to the server |
| Recently viewed | Jump back to recently seen items | Everyone | Home and account | **Implemented** | Last 12 items, stored on the device |
| Offers page | See active public promo codes | Everyone | `/offers` | **Implemented** | Copy a code, or activate it straight into checkout |

## Checkout

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| 4-step checkout | Fulfilment → details → payment → confirm | Everyone | `/checkout` | **Implemented** | Works on mobile and desktop |
| Pickup or delivery | Choose fulfilment and see the zone fee | Everyone | Step 1 | **Implemented** | Zone fees (Roysambu 150 → other Nairobi 500 KSh); free over KSh 3,000 pre-discount; optional distance-based pricing in Settings |
| Address book and GPS | Save delivery addresses, use current location | Customers | Step 2 and `/account` | **Implemented** | Address search uses OpenStreetMap — no Google Maps account needed |
| OTC / Rx separation | Prescription items follow the review workflow | Customers | Steps 3–4 | **Implemented** | Orders containing prescriptions start in "under review", not payment |
| Guest checkout | Order without an account | Guests | `/checkout` | **Implemented** | OTC items only; prescriptions require an account |
| Prescription upload | Attach prescription photos/PDF (max 10 MB) | Customers | Step 3 and `/prescriptions` | **Environment-dependent** | File storage needs R2 credentials |
| Stock validation and reservation | Server checks real stock and reserves it at order time | Server-side | — | **Implemented** | Insufficient stock blocks the order with a clear message; reserved stock is released if the order is cancelled or expires unpaid |
| Promo + Sphere Points redemption | Apply discount, then redeem points | Customers | Step 3 | **Implemented** | Points: min 100, max 25% of subtotal; discount applies to items only, never the delivery fee |

## Customer accounts

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Registration | Create an account with email or Kenyan phone | Customers | `/auth` (register tab) | **Implemented** | Password policy: 10+ characters with a letter and a digit |
| OTP phone sign-in | Sign in with a 6-digit SMS code | Customers | `/auth` (OTP tab) | **Environment-dependent** | Needs Africa's Talking credentials; codes expire after 5 minutes |
| Password sign-in | Sign in with email/phone + password | Customers | `/auth` (login tab) | **Implemented** | Kenyan phone numbers normalised automatically |
| Profile and avatar | Manage name, contacts, password, photo | Customers | `/account` | **Implemented** | Password change requires the current password |
| Addresses | Add, edit and remove delivery addresses | Customers | `/account` | **Implemented** | Customers can only touch their own addresses |
| Notification preferences | Choose how updates arrive | Customers | `/account` | **Implemented** | Only email and push actually deliver; SMS/WhatsApp toggles are stored but nothing is sent |
| Guest order claiming | Move past guest orders into a new account | Customers | OTP verification | **Implemented** | Matching by phone number; the guest access token is then cleared |

## Prescriptions

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Upload prescription | Send a photo or PDF for review | Customers | `/prescriptions`, checkout | **Environment-dependent** | Private storage on R2; png/jpeg/webp/heic/pdf up to 10 MB |
| Pharmacist review | Approve, reject, request clarification or partially approve | Pharmacists, Admins | Admin → Prescriptions | **Implemented** | Can allow 0–6 refills and set 30/60/90/180-day validity |
| Refills | Re-order an approved prescription with one tap | Customers | `/prescriptions` | **Implemented** | Every refill creates a fresh prescription record that a pharmacist re-verifies — no automatic re-issue |
| Secure storage and access log | Keep files private; audit every view | Server-side | — | **Implemented** | Downloads use 5-minute private links; every access is logged; retention cleanup follows the configured retention days |
| Linked-order automation | Order advances as prescriptions are decided | Server-side | — | **Implemented** | All approved → "prescription verified"; any rejected → order rejected |

## Inventory

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Batch (lot) and expiry tracking | Know which batch sells and what expires when | Server-side | Admin → POS Sync | **Implemented** | Populated by BandaGo sync or CSV import |
| FEFO sellable stock | First-expiry-first-out: expired batches never count as sellable | Server-side | — | **Implemented** | Applied when stock is received; per-order batch picking is not implemented |
| Near-expiry flags | Highlight batches expiring within 90 days | Admins, Pharmacists | Admin → POS Sync | **Implemented** | Labelled as a Kenya PPB audit alert |
| Stock statuses | In stock / low stock (≤5) / out of stock | Everyone (badges) | Catalogue and admin | **Implemented** | A safety buffer of 2 units is held back from what customers can buy |
| Order-time reservation | Prevent double-selling the last pack | Server-side | — | **Implemented** | Physical deduct-and-restore; released on cancel or expiry |
| Reservation expiry | Release stock from unpaid orders | Server-side | — | **Environment-dependent** | Needs the TTL setting and the scheduled job |
| Manual product/stock/price editing | Fix or extend catalogue data by hand | Admins, Pharmacists, Staff | Admin → Catalogue | **Implemented** | Deleting products is admin-only; custom local images are never overwritten by POS sync |
| CSV bulk import | Load many products at once | Admins, Pharmacists, Staff | Admin → Catalogue / POS Sync | **Implemented** | Robust parser with many column aliases; same pipeline as POS sync |

## Orders

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Order lifecycle | 14 statuses from "received" to "completed" | Staff | Admin → Orders | **Implemented** | Only valid transitions are allowed; every change is history-logged and audited |
| Queue and focus lanes | Work orders in stages: review / pack / handoff / collect | Admins, Pharmacists, Staff | Admin → Orders | **Implemented** | Bulk "start packing"/"mark ready" up to 25 orders |
| Preparation action | One deliberate action accepts the order and begins packing | Admins, Pharmacists, Staff | Admin → Orders | **Implemented** | Requires payment success (or a cash order) and approved prescriptions |
| Cancellation | Cancel before payment; restore stock and points | Customers, Staff | Order screens | **Implemented** | Captured payments are never auto-refunded on cancellation |
| Rider dispatch | Assign riders and track drops | Admins, Pharmacists, Staff | Admin → Dispatch | **Implemented** | Riders see only their own board; customers and riders are notified |
| Customer order views | History, tabs, search, reorder, invoice download, rider info | Customers | `/orders`, `/orders/{id}` | **Implemented** | Timeline shows every status change |
| Guest order tracking | Track an order without an account | Guests | Order link | **Implemented** | Private access token, valid 7 days |

## Payments

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| M-Pesa STK push | Customer pays from their phone | Customers | Checkout, order screen, assistant | **Environment-dependent** · **Requires live verification** | Needs Daraja production credentials; receipts, amounts and phone numbers are verified before an order is marked paid |
| Staff-requested payment | Staff trigger an M-Pesa prompt (e.g. at the counter) | All staff incl. riders | Admin → Orders / rider board | **Environment-dependent** · **Requires live verification** | Available while an order is payable and prescriptions are approved |
| Card via IntaSend | Pay by card on a secure hosted page | Customers | Checkout, order screen | **Environment-dependent** · **Requires live verification** | Card details are only ever entered on IntaSend's page, never in the app; returning from the page alone does not mark an order paid |
| Cash on pickup or delivery | Pay at the counter or to the rider | Customers | Checkout | **Implemented** | Staff confirm cash — see the cash rules in [pharmacy-operations.md](pharmacy-operations.md) |
| Reserve and pay later | Hold items for later payment | Customers | Checkout | **Implemented** | Creates a reservation order; stock stays reserved until paid, cancelled or expired |
| Refunds — IntaSend (card) | Return a card payment | Admins | API endpoint | **Environment-dependent** | Automated: requested, tracked, and finalised when the provider confirms |
| Refunds — cash | Record a cash refund | Admins | API endpoint | **Implemented** | Requires explicit confirmation and a till reference number |
| Refunds — M-Pesa | Return an M-Pesa payment | Admins | — | **Planned or not shipped** | The endpoint refuses and instructs staff to complete the refund in the M-Pesa organisation portal first, then record it |
| Refund admin screen | Click a button to refund | Admins | — | **Planned or not shipped** | The secure refund endpoint exists but no admin screen calls it yet |
| Service payments (M-Pesa / card) | Pay for a clinical service booking | Customers | `/services` bookings tab | **Environment-dependent** · **Requires live verification** | Same providers as order payments |
| Pay at pharmacy (services) | Record intent to pay in person | Customers | `/services` bookings tab | **Implemented** | Marks the booking "pay at pharmacy" — an intent, not money; a cash-settlement endpoint for services is **Planned or not shipped** |

## Loyalty — Sphere Points

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Earning | 1 point per KSh 100 paid | Customers | `/account` | **Implemented** | Awarded when payment is captured; guest orders earn nothing |
| Redemption | 1 point = KSh 1 at checkout | Customers | Checkout step 3 | **Implemented** | Minimum 100 points; max 25% of the (discounted) subtotal |
| Reversals | Undo points on cancel, expiry or refund | Server-side | — | **Implemented** | Earned points are clawed back; redeemed points are re-credited |
| POS-synced balance | Mirror the balance to BandaGo CRM | Server-side | — | **Implemented** | Via the CRM sync; the app shows the live web balance |

## Promotions

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Percentage promo codes | Discount a % of the subtotal with usage limits | Admins, Staff (create); Everyone (use) | Admin → Promotions; `/offers` | **Implemented** | Limits per code, per user, per IP or per browser; public or private codes |
| Banners and campaigns | Present offers on the storefront | Admins, Staff | Admin → Promotions | **Implemented** | Managed alongside codes |
| Validation hardening | Stop abuse and mis-labelled errors | Server-side | — | **Implemented** | IP-limited offers fail closed if the required secret is missing |
| Fixed-amount or free-shipping promos | Other discount types | — | — | **Planned or not shipped** | Only percentage discounts exist today |

## Clinical services

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Service catalogue | Publish services with duration, price (or "price on asking"), images | Admins, Pharmacists, Staff | Admin → Services; `/services` | **Implemented** | Duration 5–480 minutes (default 15) |
| Availability rules and slots | Weekly hours; customers pick a live slot | Admins, Pharmacists, Staff (rules); Customers (booking) | Admin → Services; booking dialog | **Implemented** | Nairobi timezone; one customer per slot |
| Booking | Reserve an appointment | Customers | `/services` | **Implemented** | Price re-checked at booking; calendar (.ics) download; SPB-… reference |
| Appointment management | Confirm, reschedule, cancel, assign staff | Admins, Pharmacists, Staff | Admin → Service bookings | **Implemented** | Statuses: pending → confirmed → arrived → in progress → completed |
| Service reviews | Rate a completed visit 1–5 | Customers | `/services` bookings tab | **Implemented** | Only after a completed booking; one review per booking |
| Reminders (24 h and 2 h before) | Reduce no-shows | Server-side | — | **Environment-dependent** | Implemented as a scheduled job — needs an external scheduler |
| Service analytics | Bookings, completion rate, revenue | Admins | Admin → Service analytics | **Implemented** | Default 30-day window |
| Group / multi-capacity bookings | Several people in one slot | — | — | **Planned or not shipped** | Slot capacity is strictly 1 |

## Product reviews

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Write a review | Rate and describe a product | Customers | Product pages | **Implemented** | Star rating with comment |
| Moderation | Publish or hide reviews | Admins, Pharmacists | Admin → Reviews | **Implemented** | Hidden reviews stay stored but are not shown |

## Medicine requests

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Request form | Ask the pharmacy to source a missing medicine | Everyone, incl. guests | Catalogue dialog | **Implemented** | Medicine name + Kenyan phone; optional photo up to 3 MB |
| Photo handling | Show the exact pack | Guests | Request form | **Environment-dependent** | Photos need R2 storage; kept private and streamed only to staff |
| Staff queue | Work requests: contact, fulfil or mark unavailable | Admins, Pharmacists, Staff | Admin → Medicine requests | **Implemented** | Statuses: new → contacted → fulfilled / unavailable, with notes |
| New-request alerts | Notify staff of a new request | — | — | **Planned or not shipped** | No notification is sent today — staff monitor the queue |

## Notifications

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| In-app inbox | Every update lands in a notification centre | Everyone (customers); staff via toasts | Bell icon; `/account` | **Implemented** | Always on; the reliable baseline channel |
| Email updates | Order, payment, prescription and booking emails | Customers | Managed in `/account` | **Environment-dependent** | Needs Resend credentials; production requires a verified sender domain |
| Push alerts | Phone notifications | Customers and staff | Opt-in per device | **Environment-dependent** | Needs Firebase credentials; staff use them for "new order" alerts |
| Admin health monitor and test send | Check delivery is working | Admins | Admin → Settings / notification health | **Implemented** | Shows queue counts and failures; test email/push to the admin's own devices |
| Booking and refill reminders | Automatic nudges | Server-side | — | **Environment-dependent** | Implemented as scheduled jobs — need an external scheduler |
| Transactional SMS | Order updates by SMS | — | — | **Planned or not shipped** | SMS is used only for sign-in codes (OTP) |
| Transactional WhatsApp | Order updates by WhatsApp | — | — | **Planned or not shipped** | WhatsApp is click-to-chat links only |

## AI assistant

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Deterministic actions | "Find paracetamol", "take me to checkout" — always work | Everyone | Assistant widget | **Implemented** | Product search, navigation, booking and payment preparation survive AI outages |
| Conversational replies | Natural chat | Everyone | Assistant widget | **Environment-dependent** | Needs a Groq API key; provider failures fall back to deterministic replies |
| Private account panels | Pay or book from chat, safely | Customers | Assistant panels | **Implemented** | Account and payment data never pass through the AI model — panels call the app directly after sign-in |
| Medical guardrails | Never diagnose or dose; escalate to humans | Everyone | Assistant widget | **Implemented** | Medical questions get a pharmacist referral plus WhatsApp/call buttons; emergencies get immediate emergency guidance |

## BandaGo POS sync and CRM

| Feature | Purpose | Primary users | Where | Backend status | Notes |
| --- | --- | --- | --- | --- | --- |
| Sync API | Receive stock, price and batch updates from the POS | Server-side | `/api/integrations/bandago/sync` | **Implemented** | Accepts streamed or CSV-triggered batches; chunked, error-tolerant |
| Data normalizer | Clean prices ("KSh 3,400"), names, categories, Rx flags | Server-side | — | **Implemented** | Kenya PPB keyword list classifies prescription items; existing Rx flags are never downgraded |
| FEFO batch handling | Deduplicate batches, exclude expired stock | Server-side | — | **Implemented** | Sellable stock ignores expired batches (PPB-aligned) |
| CRM sync | Reconcile customer profiles by phone number | Server-side | `/api/integrations/bandago/crm` | **Implemented** | Links loyalty balances and chronic-patient flags; clinical data is never synced |
| Chronic refill reminders | Nudge patients ~30 days after an Rx order | Server-side | — | **Environment-dependent** | Implemented as a scheduled job (in-app + email); time-based only |
| POS Sync hub | Watch sync telemetry and import CSVs | Admins, Pharmacists | Admin → POS Sync | **Implemented** | Products mapped, active batches, near-expiry flags, last sync signal, sync ledger |
| Browser extension (api_data_transformer) | Capture data from the BandaGo POS screen | Pharmacists | External | **Requires live verification** | A separate Chrome extension, not part of this repository; the hub shows "awaiting extension" until connected |

## Related documentation

- Module deep-dives: [../features/](../features/) · Engineering workflows: [../workflows/](../workflows/)
- Payments and notification audit: [../payment-notification-audit.md](../payment-notification-audit.md)
- Roles and access: [user-roles-and-permissions.md](user-roles-and-permissions.md) · Day-to-day use: [pharmacy-operations.md](pharmacy-operations.md)
- Full 51-journey acceptance matrix: [../recording/recording-checklist.md](../recording/recording-checklist.md) · Project README: [../../README.md](../../README.md)
