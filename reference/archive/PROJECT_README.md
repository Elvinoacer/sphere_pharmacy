# Sphere Pharmacy — Digital Platform

A full-stack retail pharmacy platform for **Sphere Pharmacy (The Sphere Pharmacy – Lumumba Drive, Roysambu, Nairobi, Kenya)**, built to the PRD in `upload/requirements.md`.

## What's inside

- **Public storefront** (single-page app at `/`): hero + search, category browsing (16 categories), product catalogue with filters/sort, product detail pages, promotions, FAQ, pharmacy info (hours/phone/WhatsApp/Maps), AI assistant with medication-question escalation.
- **Dark mode** — one-tap light/dark toggle in the header (teal/emerald palette in both themes).
- **Real photography** — AI-generated brand imagery: hero pharmacy interior with floating glass stat cards, pharmacist consultation photo, and a same-day delivery banner.
- **Sphere Points loyalty** — earn 1 pt per KSh 100 spent (awarded automatically on successful payment) and redeem at checkout: 1 pt = KSh 1, from 100 pts, capped at 25% of the order. Balance + lifetime stats + per-order history on My account; cancellation/refund claws points back server-side.
- **Product ratings & reviews** — star ratings on cards and product pages, verified-customer reviews with a rating breakdown, and a "write a review" form for signed-in customers (one review per product per customer). **Review moderation**: staff can hide/restore reviews from Admin → Reviews (hidden reviews drop out of public averages).
- **Rider dispatch (FR-8.5)** — Admin → Dispatch board: assign delivery orders to riders (workload chips, contact links); riders sign in and land straight on "My deliveries" where they can Start delivery / Mark delivered (server-enforced: only their own delivery orders, only delivery statuses).
- **Notification preferences** — per-channel toggles (SMS / WhatsApp / Email) on My account, persisted server-side and respected when notifications are generated (in-app is always on).
- **Wishlist / saved items** — tap the heart on any product (works for guests too, persisted on the device); header shows a wishlist sheet with add-to-cart.
- **Recently viewed** — the home page remembers the last products you opened ("Pick up where you left off").
- **Promo codes at checkout** — apply codes like `SAVE10` / `VITC15` in the order summary; the discount is validated server-side and flows through order totals, M-Pesa/card amounts, order tracking and the admin order view.
- **Back-in-stock alerts** — "Notify me when back in stock" on out-of-stock products; when staff restocks the item, watchers get an in-app notification (watchlist managed in My account).
- **Medicine requests** — the catalogue’s "Request medicine" form accepts a medicine name, Kenyan callback number and optional JPG/PNG/WebP photo (up to 3MB), without an account. Admin → Medicine requests lets Admin, Pharmacist and Staff search/filter requests, view private photos, call customers, save internal notes and set New / Contacted / Fulfilled / Unavailable statuses. Photos use private R2 storage; requests without a photo do not require R2. Apply the additive `20261022000000_medicine_requests` migration with `npx prisma migrate deploy` when deploying.
- **Cart & checkout**: OTC vs prescription separation, guest checkout (OTC), 4-step checkout (fulfillment → details → payment → confirm), zone-based delivery fees, reservations ("hold in store, pay at counter").
- **Payments (simulated for demo)**: M-Pesa Daraja STK Push flow (with PIN dialog), IntaSend card flow (with decline rules: card ending 0000 / CVV 000), cash on pickup/delivery, refunds. Independent payment records track status separately from order status.
- **Prescription workflow (compliance-first)**: upload image/PDF → pharmacist review queue → Approve / Reject / Request clarification / Partially approve (with refills + validity) → linked order auto-advances → refills re-verification. Prescription files are access-controlled (owner + staff only). Prescription-only items can NEVER be ordered without an uploaded, pharmacist-verified prescription — enforced server-side, not just UI.
- **Customer accounts**: email+password or phone-OTP (demo returns the code), order tracking with full timestamped status timeline, prescription history, saved addresses, notifications feed, reorder.
- **Staff dashboard** (`/` → "Staff dashboard"): role-based (Admin / Pharmacist / Staff / Rider) with overview KPIs & charts, unified order queue with workflow actions, **dispatch board for rider assignment**, prescription review, catalogue management (inline price/stock editing, product editor, CSV import), **review moderation**, promotions, staff management, reports (CSV exports), compliance section (licence pending — intentionally NOT published until the client provides the current PPB licence, per the PRD), settings (pharmacy profile, delivery zones).
- **Order lifecycle**: Received → Under Review → Prescription Verified → Availability Confirmed → Awaiting Payment → Paid → Preparing → Ready for Pickup / Out for Delivery → Completed, plus Rejected/Cancelled/Refunded — every transition timestamped, notified in-app (WhatsApp/SMS channels modelled), and audit-logged.

## Recording guides

For filming the platform, use the [detailed recording script](docs/recording/platform-recording-script.md), [short recording checklist](docs/recording/recording-checklist.md), and [caption cues](docs/recording/recording-captions.txt). Printable copies are in `output/pdf/`. The guide covers 51 customer and staff journeys and flags conditional or unavailable UI paths before recording.

## Tech stack

- Next.js 16 (App Router) + TypeScript (strict)
- Tailwind CSS 4 + shadcn/ui (New York style), teal/emerald theme, light+dark
- Prisma ORM + PostgreSQL (configured through environment variables)
- Zustand (view router + persisted cart), custom cookie sessions (scrypt password hashing)
- z-ai-web-dev-sdk (backend only) for the AI assistant with guardrails
- Recharts for admin analytics

## Run it

```bash
bun install            # or npm/yarn/pnpm install
bun run db:generate    # regenerate Prisma client (optional — already generated once)
bun run dev            # starts on http://localhost:3000
```

The PostgreSQL database is managed externally. Apply the Prisma schema with `bun run db:push`, then seed it with `bun prisma/seed.ts`

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@spherepharmacy.co.ke | admin123 |
| Pharmacist | pharmacist@spherepharmacy.co.ke | pharm123 |
| Staff | staff@spherepharmacy.co.ke | staff123 |
| Rider | rider@spherepharmacy.co.ke | rider123 |
| Customer | customer@spherepharmacy.co.ke | customer123 |

Staff sign-in: open the site → footer → "Staff dashboard" → Staff tab.
M-Pesa demo rule: any 4-digit PIN approves; `1234`/`0000` simulates a wrong PIN.
Card demo rule: any valid card approves; numbers ending `0000` or CVV `000` are declined.
Promo codes: `SAVE10` (10% off) and `VITC15` (15% off) work at checkout — tap the code chip on the home page to copy it.
Sphere Points demo: the demo customer starts with **620 pts** (≈ KSh 620 at checkout). Add items worth KSh 1,600 to see the 25% cap in action (400 pts = KSh 400 off). The rider account starts with a delivery assigned (check Admin → Dispatch, or sign in as the rider).

## Production notes (per PRD §11 — pending client confirmation)

- **Payments are simulated.** Real M-Pesa needs Safaricom Daraja credentials + the client's registered Paybill/Till; real cards need IntaSend KYC. Simulation boundaries are documented in the route files.
- **No licence claim is published** anywhere on the storefront until the client provides their current PPB licence — fill it in Admin → Compliance.
- Opening hours/contact details use the current public listing and are editable in Admin → Settings.
- Product catalogue is demo data — load the real inventory via Admin → Catalogue → CSV import.
- WhatsApp ordering uses `wa.me` deep links (no Business Cloud API).

## Database environment

Sphere Pharmacy uses PostgreSQL through Prisma. Configure these server-side variables in the deployment environment (never expose them to the browser):

```
sphere_pharmacy_PRISMA_DATABASE_URL=
sphere_pharmacy_DATABASE_URL=
sphere_pharmacy_POSTGRES_URL=
```

Use the Prisma URL for the application datasource, the Postgres/direct URL for Prisma direct connections, and keep the generic database URL available as the runtime fallback used by the Prisma client.
