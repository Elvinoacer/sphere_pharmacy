# User roles and permissions

This page explains who uses the Sphere Pharmacy platform, what each role can see and do, and how access is really enforced. It is written for the pharmacy team — you do not need any technical background to follow it.

| Audience | Status | Verified |
| --- | --- | --- |
| Pharmacy owner, pharmacists, staff | Implemented — verified against code | November 2026 |

## The short version

There are two doors into the platform:

- **The public storefront** (for example `/catalog`, `/cart`, `/orders`) — used by **Customers** and **guests**.
- **The staff workspace** at `/admin` — used by **Admin**, **Pharmacist**, **Staff** and **Rider**. Staff reach it through the "Staff dashboard" link in the storefront footer and sign in on the **Staff** tab.

| Role | Who this usually is | Where they work | In one line |
| --- | --- | --- | --- |
| Customer | Registered shoppers and patients | Public storefront | Buys, uploads prescriptions, books services, earns points |
| Admin | Owner or manager | Staff workspace | Full control: money, people, settings and reports |
| Pharmacist | Registered pharmacists | Staff workspace | Clinical authority: prescriptions and catalogue quality |
| Staff | Counter and shop staff | Staff workspace | Orders, requests, bookings, catalogue day-to-day |
| Rider | Delivery riders | Staff workspace (personal board) | Delivers assigned orders and confirms cash on delivery |

## How sign-in works

- **Customers** sign in with email or phone plus a password, or with a one-time 6-digit SMS code (OTP — a single-use password sent by text). Their sessions last up to **30 days**.
- **Staff** (admin, pharmacist, staff, rider) always use the separate staff sign-in with email and password. Staff sessions last at most **7 days**, and expire after **12 hours of inactivity**.
- The same person can have both a customer account and a staff account, but they are separate accounts with separate sign-ins.

## What about guests?

Guests are not a fifth staff role — they are simply visitors on the public storefront. They can browse, keep a cart and wishlist on their device, request medicines and check out over-the-counter items with a private tracking link. They cannot touch anything staff-related, and the prescriptions queue is closed to them by design (uploading requires a customer account). When a guest later signs in with the same phone number, their past guest orders are claimed into the new account.

## Role-by-role guide

### Customer

| Question | Answer |
| --- | --- |
| What do they do? | Shop the catalogue, place pickup and delivery orders, upload prescriptions and request refills, book clinical services, write reviews, earn and redeem Sphere Points, request hard-to-find medicines |
| Screens they see | Home, catalogue, offers, product pages, services, cart, checkout, orders and order detail, prescriptions, account ("My Sphere") |
| Key actions | Place orders; pay by M-Pesa, card or cash; upload prescriptions; manage addresses; set notification preferences; watch items for restock alerts; claim past guest orders |
| Actions needing a higher privilege | None — customers cannot reach staff functions at all; the server refuses them |
| What they cannot do | See other people's orders or prescriptions; buy prescription medicines without pharmacist review; use per-user promo codes while signed out; earn points on guest orders |
| How sessions end | Signing out, or automatically after 30 days |

### Admin

| Question | Answer |
| --- | --- |
| What do they do? | Run the business: money, people, settings, reporting and compliance records |
| Screens they see | All 16 admin sections (see the matrix below) |
| Key actions | Everything staff and pharmacists can do, plus: record refunds, manage staff accounts and roles, edit pharmacy settings and delivery pricing, view reports and service analytics, delete products, read the full audit log, send test notifications |
| Actions needing a higher privilege | None within the platform — Admin is the highest role |
| What they cannot do | See clinical data that lives only in BandaGo (it is never synced); skip pharmacist review for prescription medicines — the workflow applies to everyone |
| How sessions end | Signing out; 7-day absolute expiry; 12-hour idle timeout; immediate revocation if another admin changes their role, password or active status |

### Pharmacist

| Question | Answer |
| --- | --- |
| What do they do? | Clinical gatekeeping: they are the only role (with Admin) that decides prescriptions |
| Screens they see | Workspace (overview, orders, dispatch control room), Patient care (prescriptions, medicine requests, service bookings, services), Business (catalogue, reviews), Management (compliance, POS Sync) — 12 of 16 sections |
| Key actions | Approve / reject / clarify / partially approve prescriptions and set refills and validity; manage medicine requests; create and edit products and import CSVs; moderate reviews; manage service bookings and the service catalogue; view compliance records |
| Actions needing a higher privilege | Recording refunds (Admin); managing staff and roles (Admin); editing pharmacy settings and delivery fees (Admin); reports and service analytics (Admin); deleting products (Admin) |
| What they cannot do | Change order status to "refunded"; access staff management or settings |
| How sessions end | Signing out; 7-day absolute expiry; 12-hour idle timeout; immediate revocation on role, password or active-status change by an admin |

### Staff (counter staff)

| Question | Answer |
| --- | --- |
| What do they do? | The daily queue: orders, preparation, dispatch, requests, bookings, catalogue upkeep |
| Screens they see | Workspace (overview, orders, dispatch control room), Patient care (medicine requests, service bookings, services), Business (catalogue, promotions) — 8 of 16 sections |
| Key actions | Move orders through their statuses, start packing, mark ready, confirm cash payments, assign riders, work medicine requests, manage service bookings and services, create and edit promotions, update products and import CSVs |
| Actions needing a higher privilege | Reviewing prescriptions (Pharmacist/Admin); refunds, settings, staff, reports, product deletion, analytics (Admin); moderating reviews (Admin/Pharmacist); compliance records (Admin/Pharmacist) |
| What they cannot do | Approve or reject prescriptions; mark orders refunded or rejected; see compliance details or staff management |
| How sessions end | Signing out; 7-day absolute expiry; 12-hour idle timeout; immediate revocation on role, password or active-status change by an admin |

### Rider

| Question | Answer |
| --- | --- |
| What do they do? | Deliver assigned orders and close them out |
| Screens they see | Their personal dispatch board only (the admin workspace opens straight onto it) |
| Key actions | See their assigned deliveries; mark a delivery out for delivery and then completed; call or WhatsApp the customer from the board; confirm cash on delivery for their own cash orders; request an M-Pesa payment prompt for their own deliveries |
| Actions needing a higher privilege | Everything else — order transitions other than their two delivery steps, preparation, cancellation, assignments, prescriptions, catalogue |
| What they cannot do | Cancel orders; see orders not assigned to them; change any status besides their delivery steps; access any other admin section |
| How sessions end | Signing out; 7-day absolute expiry; 12-hour idle timeout; immediate revocation on role, password or active-status change by an admin |

## Admin section access matrix

The staff workspace is organised into four sidebar groups with 16 sections. What each role sees:

| # | Section | Group | Admin | Pharmacist | Staff | Rider |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Overview | Workspace | ✅ | ✅ | ✅ | — |
| 2 | Orders | Workspace | ✅ | ✅ | ✅ | — |
| 3 | Dispatch | Workspace | ✅ | ✅ | ✅ | ✅ (personal board only) |
| 4 | Prescriptions | Patient care | ✅ | ✅ | — | — |
| 5 | Medicine requests | Patient care | ✅ | ✅ | ✅ | — |
| 6 | Service bookings | Patient care | ✅ | ✅ | ✅ | — |
| 7 | Services | Patient care | ✅ | ✅ | ✅ | — |
| 8 | Catalogue | Business | ✅ | ✅ | ✅ (delete is admin-only) | — |
| 9 | Promotions | Business | ✅ | — | ✅ | — |
| 10 | Reviews | Business | ✅ | ✅ | — | — |
| 11 | Reports | Business | ✅ | — | — | — |
| 12 | Service analytics | Business | ✅ | — | — | — |
| 13 | Staff | Management | ✅ | — | — | — |
| 14 | Compliance | Management | ✅ | ✅ | — | — |
| 15 | Settings | Management | ✅ | — | — | — |
| 16 | POS Sync | Management | ✅ | ✅ | — | — |

Sections a role cannot see are not merely hidden in the menu — requesting their data is refused by the server (see below).

## Hiding a button is not security

It is tempting to think that if a rider cannot see the "Prescriptions" menu item, they cannot reach prescriptions. That is not how safety works here, and it is important to understand why:

- **The screen is just a picture.** What a role sees is built from the server's answer to "who am I?" (an internal check the app makes on every visit). It decides which buttons and sections to draw.
- **The real enforcement is on the server.** Every action — cancelling an order, approving a prescription, recording a refund — is sent to the platform as a request. Before doing anything, the server independently verifies the session and the role using central guards (in `src/lib/session.ts` and in each API route). If the role is not allowed, the request is refused with a clear "You do not have permission" error, no matter what the screen looked like.
- **Ownership is checked too.** Customers can only fetch their own orders, prescriptions, addresses and bookings; riders only their assigned deliveries; guest order tracking requires a private access token that expires after 7 days.
- **Everything sensitive is logged.** Refunds, staff changes, settings updates, prescription decisions, cash confirmations and more are written to an audit trail that Admins can review.

So: even a crafty user sending hand-crafted requests directly to the server gets refused. The friendly menus are a convenience, not the lock. The technical details live in [../security/access-control.md](../security/access-control.md).

## How sessions end

| Situation | Customer | Staff (Admin / Pharmacist / Staff / Rider) |
| --- | --- | --- |
| Signs out | Ends immediately | Ends immediately (also removes the device's push registration) |
| Does nothing for a while | Stays signed in up to 30 days | Ends after **12 hours of inactivity** |
| Away for a long time | Ends after 30 days | Ends after **7 days** at most, no matter what |
| An admin changes their role, password or deactivates them | — (no such action for customers) | All their open staff sessions end **immediately** |

That last row matters: if a staff member leaves the team, an Admin deactivating them in **Admin → Staff** locks them out everywhere at once — no need to chase devices.

## Quick answers to common permission questions

| Question | Answer |
| --- | --- |
| Can a rider confirm cash? | Only on their own assigned cash-on-delivery orders that are out for delivery. |
| Can counter staff approve a prescription? | No — only a Pharmacist or an Admin. |
| Who can record a refund? | Only an Admin, through the secure refund endpoint (no admin screen calls it yet). |
| Who can change delivery fees or pharmacy details? | Only an Admin, in Settings. |
| Can a pharmacist see the staff roster? | No — staff management is Admin-only. |
| What happens the moment a role or password changes? | That person's open staff sessions end immediately. |
| Can a customer see another customer's order? | No — the server checks ownership on every request. |

## Related documentation

- [pharmacy-operations.md](pharmacy-operations.md) — how each role uses the workspace day to day.
- [customer-journeys.md](customer-journeys.md) — the six core journeys, including guest access and order claiming.
- Technical enforcement: [../security/access-control.md](../security/access-control.md) · Workflows: [../workflows/](../workflows/).
- Full 51-journey acceptance matrix: [../recording/recording-checklist.md](../recording/recording-checklist.md) · Project README: [../../README.md](../../README.md).
