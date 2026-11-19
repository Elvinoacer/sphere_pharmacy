---
id: JOURNEYS-INDEX
title: User journeys
actor: All
area: Overview
status: implemented
objective: Complete, flowchart-first documentation of every operational journey the platform supports
startCondition: A reader wants to understand how a customer, pharmacist, staff member, administrator, rider or system actor uses Sphere Pharmacy
endCondition: The reader can trace any journey from its starting point to every outcome, with verified implementation references
relatedDocs:
  - docs/product/customer-journeys.md
  - docs/product/user-roles-and-permissions.md
  - docs/recording/platform-recording-script.md
recordingRefs: []
verified: November 2026
evidence: Screenshots deliberately deferred — this is the canonical journey index; per-journey evidence notes live in each file.
---

# User journeys

This folder is the **complete journey catalogue**: every way a human or system actor interacts with Sphere Pharmacy, documented as traceable flows — one Mermaid flowchart per journey, every meaningful step explained, every decision branch shown, and every claim tied to real implementation references (views, handlers, API routes, models, guards).

| Audience | Status | Verified |
| --- | --- | --- |
| All audiences | **Implemented** — verified against code | November 2026 |

## How these documents work

- Every journey file has YAML frontmatter with a stable `id`, the primary `actor`, functional `area`, implementation `status`, and cross-references (`relatedJourneys`, `relatedDocs`, `recordingRefs`).
- `status` is **implemented** (works end-to-end in code) or **environment-dependent** (code complete; needs live provider credentials such as Daraja, IntaSend, Resend, FCM or Groq to exercise end-to-end).
- Screenshots are deliberately deferred. Where a journey maps to a scene in the recording script, `recordingRefs` carries the scene ID (e.g. `O03`) so evidence can be attached later without restructuring.
- Journey IDs reuse the recording-script scene IDs (`P*`, `C*`, `O*`, `X*`, `S*`, `H*`, `A*`, `T*`, `R*`) and add `SYS-*` for system-driven flows.

## Role overviews

Start with the actor map, then follow the links:

- [Customer journey map](roles/customer.md) — guests and signed-in customers
- [Pharmacist journey map](roles/pharmacist.md)
- [Staff journey map](roles/staff.md)
- [Administrator journey map](roles/admin.md)
- [Rider journey map](roles/rider.md)
- [System journey map](roles/system.md) — automated and provider-driven workflows

## Journey catalogue

### Customer and guest journeys

| ID | Journey | Coverage |
| --- | --- | --- |
| P01 | [Discover the pharmacy and navigate](customer/discover-home.md) | Homepage, header and mobile navigation |
| P02 | [Find and filter products](customer/find-and-filter-products.md) | Catalogue search, categories, filters, sorting |
| P03 | [View product details and save items](customer/view-product-and-save.md) | Product page, wishlist, back-in-stock prompt |
| P04 | [Request a medicine without a photo](customer/request-medicine-no-photo.md) | Medicine request form, text only |
| P05 | [Request a medicine with a photo](customer/request-medicine-with-photo.md) | Medicine request with an uploaded photo |
| P06 | [Ask questions and contact the pharmacy](customer/contact-pharmacy.md) | Contact channels, WhatsApp, assistant |
| C01 | [Create an account and sign in](customer/register-account.md) | Email/password registration and login |
| C02 | [Sign in with a phone code](customer/otp-signin.md) | OTP request and verification |
| C03 | [Review the cart and return after sign-in](customer/guest-cart-signin-return.md) | Guest cart, sign-in return |
| C04 | [Manage profile and account security](customer/manage-profile-security.md) | Profile, password, sign-out |
| C05 | [Save and manage delivery addresses](customer/manage-addresses.md) | Address book CRUD |
| C06 | [Manage notifications and preferences](customer/notification-preferences.md) | In-app inbox, channels, preferences |
| C07 | [Subscribe to back-in-stock alerts](customer/back-in-stock-alerts.md) | Stock alerts and notification |
| C08 | [Earn and redeem Sphere Points](customer/loyalty-points-redemption.md) | Loyalty ledger, redemption at checkout |
| C09 | [Write a product review](customer/write-product-review.md) | Post-purchase reviews |
| O01 | [Place a cash pickup order](customer/place-cash-pickup-order.md) | OTC checkout, pay on pickup |
| O02 | [Place a delivery order](customer/place-delivery-order.md) | Address, zones, fees |
| O03 | [Pay an order with M-Pesa](customer/pay-with-mpesa.md) | STK Push lifecycle |
| O04 | [Pay an order by card](customer/pay-by-card.md) | IntaSend hosted checkout |
| O05 | [Reserve items for collection](customer/reserve-for-collection.md) | Pay-later reservations |
| O06 | [Track, cancel and reorder](customer/track-cancel-reorder.md) | Order status, cancellation, reorders |
| X01 | [Upload a prescription for review](customer/upload-prescription.md) | Private upload, pharmacist queue |
| X02 | [Order prescription medicines](customer/order-prescription-medicines.md) | Rx checkout requirements |
| X03 | [Prescription outcomes and refills](customer/prescription-outcomes-refills.md) | Decisions, refills, retention |
| S01 | [Browse services and book an appointment](customer/browse-and-book-service.md) | Service catalogue, slots, booking |
| S02 | [Choose appointment payment](customer/choose-appointment-payment.md) | M-Pesa, card, pay-at-pharmacy |
| S03 | [Track an appointment and review a visit](customer/track-appointment-review.md) | Reschedule, cancel, review |
| H01 | [Find products with the assistant](customer/assistant-find-products.md) | Assistant product search |
| H02 | [Book through the assistant](customer/assistant-booking.md) | Assistant-guided booking |
| H03 | [Pay through the assistant](customer/assistant-payment.md) | Assistant-guided payment entry |

### Pharmacist journeys

| ID | Journey | Coverage |
| --- | --- | --- |
| A04 | [Review and approve a prescription](pharmacist/review-approve-prescription.md) | Queue, document access, approval |
| A05 | [Clarify, partially approve or reject a prescription](pharmacist/clarify-partial-reject-prescription.md) | Non-approval outcomes |
| T01 | [Pharmacist workspace and access boundaries](pharmacist/pharmacist-workspace-boundaries.md) | What pharmacists can and cannot reach |

### Staff journeys

| ID | Journey | Coverage |
| --- | --- | --- |
| A02 | [Process an order to pickup](staff/process-order-to-pickup.md) | Order queue to handover |
| A06 | [Manage medicine requests](staff/manage-medicine-requests.md) | Triage and resolve requests |
| A07 | [Update products and stock](staff/update-products-stock.md) | Product editing, stock states |
| A09 | [Import products from CSV](staff/import-products-csv.md) | Bulk catalogue import |
| A10 | [Publish a service and set booking hours](staff/publish-service-booking-hours.md) | Service catalogue management |
| A11 | [Run the appointment workflow](staff/run-appointment-workflow.md) | Check-in, completion |
| A12 | [Reschedule and cancel appointments](staff/reschedule-cancel-appointments.md) | Booking changes |
| T02 | [Counter staff workspace and access boundaries](staff/staff-workspace-boundaries.md) | What staff can and cannot reach |

### Administrator journeys

| ID | Journey | Coverage |
| --- | --- | --- |
| A01 | [Staff sign-in and daily overview](admin/staff-signin-overview.md) | Staff login, dashboard |
| A03 | [Assign and dispatch a delivery](admin/assign-dispatch-delivery.md) | Dispatch board, rider assignment |
| A08 | [Create a product and choose images](admin/create-product-images.md) | Product creation, imagery |
| A13 | [Moderate product reviews](admin/moderate-product-reviews.md) | Review approval |
| A14 | [Create and use a promotion](admin/create-use-promotion.md) | Promotions, limits, redemption |
| A15 | [Manage staff accounts and roles](admin/manage-staff-roles.md) | Staff CRUD, role assignment |
| A16 | [Reports, service analytics and audit activity](admin/reports-analytics-audit.md) | Reporting surfaces |
| A17 | [Compliance information](admin/compliance-information.md) | Audit log, access boundaries |
| A18 | [Pharmacy settings and delivery pricing](admin/settings-delivery-pricing.md) | Settings, zones, fees |

### Rider journeys

| ID | Journey | Coverage |
| --- | --- | --- |
| R01 | [Complete an assigned delivery](rider/complete-assigned-delivery.md) | Delivery lifecycle, cash on delivery |

### System-driven journeys

| ID | Journey | Coverage |
| --- | --- | --- |
| SYS-01 | [M-Pesa STK callback processing](system/mpesa-callback.md) | Daraja callback to order state |
| SYS-02 | [IntaSend card webhook processing](system/intasend-webhook.md) | Card outcome to order state |
| SYS-03 | [Order reservation expiry job](system/cron-order-reservations.md) | Cron release of expired holds |
| SYS-04 | [Chronic refill reminders job](system/cron-chronic-refills.md) | Cron refill nudges |
| SYS-05 | [Notification queue job](system/cron-notifications.md) | Cron multi-channel dispatch |
| SYS-06 | [Prescription retention job](system/cron-prescription-retention.md) | Cron retention windows |
| SYS-07 | [Service booking reminders job](system/cron-service-booking-reminders.md) | Cron appointment reminders |
| SYS-08 | [BandaGo inventory ingestion](system/bandago-inventory-sync.md) | POS sync to catalogue |
| SYS-09 | [Assistant request lifecycle](system/assistant-pipeline.md) | AI request handling and fallback |
| SYS-10 | [Notification fan-out pipeline](system/notification-dispatch.md) | Event to in-app/email/push/SMS |
| SYS-11 | [BandaGo outbound reconciliation and daily sales export](system/bandago-outbound-reconciliation.md) | Website → POS sales export, Auto-Sync writeback, error triage |

## Conventions

1. One flowchart per journey, `flowchart TD` for human actors (decisions as diamonds, terminal states as stadiums) and `sequenceDiagram` for system-to-system flows.
2. Steps follow the fixed bullet order: User action (or Trigger) → Location → Destination → Purpose → System behaviour → Outcome → Next step → Alternative paths.
3. Status strings, role names and file paths come from the code — see `src/lib/constants.ts`, `src/lib/session.ts` and the route under `src/app/api/**`.
4. Related journeys link by ID; related documents use docs-relative paths.
