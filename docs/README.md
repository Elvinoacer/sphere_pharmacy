# Sphere Pharmacy — Documentation

This folder is the **canonical, version-controlled documentation** for Sphere Pharmacy. It lives in the same repository as the code it describes, so every documentation change has Git history, can be reviewed in pull requests alongside code changes, and can be read directly by developers and AI coding agents.

> **Format strategy:** Markdown is the source of truth (with Mermaid for diagrams and OpenAPI for the API contract). The in-app documentation portal at **/docs** renders these same files — it is a presentation, navigation, search and AI-retrieval layer, never a second place where documentation is written. PDFs are export-only.

## Audiences

| Audience | Start here | Coverage |
| --- | --- | --- |
| **Engineers & AI coding agents** | [architecture/system-architecture.md](architecture/system-architecture.md) | Architecture, frontend, backend, database, API, security, integrations, workflows, testing, operations |
| **Pharmacy operators** (owner, pharmacists, staff, riders) | [product/product-overview.md](product/product-overview.md) | What the platform does, feature catalogue, roles, customer journeys, day-to-day operations |
| **Project governance** | [governance/architecture-decisions.md](governance/architecture-decisions.md) | Architecture decisions, documentation policy, technical debt, release history |

AI coding agents are a first-class audience: [AGENTS.md](../AGENTS.md) at the repository root is their entry point, and [security/ai-access-and-authorized-sessions.md](security/ai-access-and-authorized-sessions.md) defines the policy governing how AI systems may touch secure information — public data freely, account-scoped data only within authorized sessions.

## Index

### Product (pharmacy-facing)
| Document | What it covers |
| --- | --- |
| [product/product-overview.md](product/product-overview.md) | Business context, customer groups, value proposition, honest system boundaries |
| [product/feature-catalogue.md](product/feature-catalogue.md) | Complete feature inventory with implementation status per feature |
| [product/user-roles-and-permissions.md](product/user-roles-and-permissions.md) | The five roles (customer, admin, pharmacist, staff, rider) in operational terms |
| [product/customer-journeys.md](product/customer-journeys.md) | The six core operational journeys, simply explained |
| [product/pharmacy-operations.md](product/pharmacy-operations.md) | Day-in-the-life operator guide to the admin workspace |

### Architecture (engineering)
| Document | What it covers |
| --- | --- |
| [architecture/system-architecture.md](architecture/system-architecture.md) | System map, request lifecycle, tech stack, external providers |
| [architecture/frontend-architecture.md](architecture/frontend-architecture.md) | SPA view router, view inventory, theming, UI patterns |
| [architecture/backend-architecture.md](architecture/backend-architecture.md) | API layer, service layer, transactions, idempotency, concurrency |
| [architecture/api-architecture.md](architecture/api-architecture.md) | API organization, guards, rate limiting, conventions |
| [architecture/authentication.md](architecture/authentication.md) | Sessions, login/OTP flows, password hashing, guest tokens |
| [architecture/state-management.md](architecture/state-management.md) | Zustand stores, persistence, client vs server authority |

### User journeys
| Document | What it covers |
| --- | --- |
| [journeys/README.md](journeys/README.md) | Complete flowchart-first catalogue across Customer, Pharmacist, Staff, Admin, Rider, and System journeys (69 files incl. role maps) |

### Features (subsystem deep-dives)
[features/storefront-and-catalogue.md](features/storefront-and-catalogue.md) · [features/inventory-and-stock.md](features/inventory-and-stock.md) · [features/prescriptions.md](features/prescriptions.md) · [features/orders-and-fulfillment.md](features/orders-and-fulfillment.md) · [features/payments-and-refunds.md](features/payments-and-refunds.md) · [features/services-and-bookings.md](features/services-and-bookings.md) · [features/loyalty-and-promotions.md](features/loyalty-and-promotions.md) · [features/notifications.md](features/notifications.md) · [features/medicine-requests.md](features/medicine-requests.md) · [features/customer-crm.md](features/customer-crm.md) · [features/ai-assistant.md](features/ai-assistant.md)

Each follows the same 14-section template: purpose, users, screens, frontend, backend, database, workflow, permissions, integrations, business rules, failure handling, testing, operational requirements, known limitations.

### Database
| Document | What it covers |
| --- | --- |
| [database/schema-overview.md](database/schema-overview.md) | Provider config, 41 models in 9 domains, design decisions (stock authority, loyalty fields, string statuses) |
| [database/data-dictionary.md](database/data-dictionary.md) | Every model, every field, relations, indexes |
| [database/entity-relationship-diagram.md](database/entity-relationship-diagram.md) | Mermaid ER diagrams per domain with relationship walkthroughs |
| [database/migrations.md](database/migrations.md) | The 11 migrations, apply workflow, seed truth, production safety |
| [database/data-lifecycle.md](database/data-lifecycle.md) | How each data class is born, transitions, and expires |

### API
| Document | What it covers |
| --- | --- |
| [api/api-reference.md](api/api-reference.md) | All 95 route handlers: auth, rate limits, validation, errors, side effects, idempotency |
| [../openapi/sphere-api.yaml](../openapi/sphere-api.yaml) | Machine-readable OpenAPI 3.1 contract (94 paths, 125 operations, 61 schemas) |

### Integrations
| Document | What it covers |
| --- | --- |
| [integrations/bandago-pos-crm.md](integrations/bandago-pos-crm.md) | BandaGo bi-directional POS/CRM sync, drift protection, Daily Sales Export, FEFO, CRM matching (H1 remediated) |
| [integrations/mpesa-daraja.md](integrations/mpesa-daraja.md) | Safaricom Daraja STK Push: OAuth, callbacks, verification |
| [integrations/intasend.md](integrations/intasend.md) | Hosted card checkout, webhooks, refunds |
| [integrations/cloudflare-r2.md](integrations/cloudflare-r2.md) | Object storage: public/private model, presigned URLs |
| [integrations/firebase.md](integrations/firebase.md) | FCM web push: registration, delivery, tokens |
| [integrations/resend.md](integrations/resend.md) | Transactional email: templates, queue, signed webhooks, suppression |
| [integrations/ai-provider.md](integrations/ai-provider.md) | Groq configuration and the deterministic-first assistant design |

### Security
| Document | What it covers |
| --- | --- |
| [security/security-architecture.md](security/security-architecture.md) | Defence-in-depth overview, rate limits, headers, secrets, known-concerns register |
| [security/privacy-and-health-data.md](security/privacy-and-health-data.md) | Data classes, Kenya PPB / Data Protection Act posture |
| [security/access-control.md](security/access-control.md) | Enforcement reference: guards, route→role matrix, ownership checks, rider model |
| [security/ai-access-and-authorized-sessions.md](security/ai-access-and-authorized-sessions.md) | **The AI access policy — secure information only within authorized sessions** |
| [security/file-storage-security.md](security/file-storage-security.md) | Upload validation, private R2, presigned access, prescription access logging |
| [security/retention-and-deletion.md](security/retention-and-deletion.md) | Retention windows, deletion runbooks, what is never auto-deleted |

### Workflows (business processes)
[workflows/order-lifecycle.md](workflows/order-lifecycle.md) · [workflows/prescription-lifecycle.md](workflows/prescription-lifecycle.md) · [workflows/payment-lifecycle.md](workflows/payment-lifecycle.md) · [workflows/inventory-lifecycle.md](workflows/inventory-lifecycle.md) · [workflows/service-bookings.md](workflows/service-bookings.md) — state machines, sequence diagrams, failure cases, recovery procedures.

### Operations
| Document | What it covers |
| --- | --- |
| [operations/local-development.md](operations/local-development.md) | Setup, seed truth, tests, CI parity |
| [operations/environment-variables.md](operations/environment-variables.md) | Complete variable matrix incl. runtime-only vars |
| [operations/deployment.md](operations/deployment.md) | Standalone + Caddy (authoritative) and Vercel paths |
| [operations/database-operations.md](operations/database-operations.md) | Migrations, safety, monitoring, common Prisma errors |
| [operations/scheduled-jobs.md](operations/scheduled-jobs.md) | The 5 cron runbooks — and the fact that nothing schedules them for you |
| [operations/backup-and-restore.md](operations/backup-and-restore.md) | What to back up, restore procedures, verification |
| [operations/troubleshooting.md](operations/troubleshooting.md) | Symptom → cause → fix, by area |

### Testing & governance
| Document | What it covers |
| --- | --- |
| [testing/testing-strategy.md](testing/testing-strategy.md) | The 13 Node test suites + 1 Bun assistant suite, runner distinction, gaps |
| [governance/architecture-decisions.md](governance/architecture-decisions.md) | 17 ADRs: why the code is the way it is |
| [governance/documentation-policy.md](governance/documentation-policy.md) | How documentation must evolve with the code |
| [governance/technical-debt.md](governance/technical-debt.md) | Prioritized register of known issues |
| [governance/release-history.md](governance/release-history.md) | Chronological release narrative |

### Pre-existing references (retained)
| Document | Status |
| --- | --- |
| [payment-notification-audit.md](payment-notification-audit.md) | Payment/notification audit (Sep 2026) — re-run and update periodically |
| [recording/](recording/) | 51-journey recording script, checklist, captions — the functional acceptance matrix |
| [../reference/archive/PROJECT_README.md](../reference/archive/PROJECT_README.md) | Original build guide — historical; demo-account and "simulated payments" claims are corrected by these docs |
| [../reference/bandago-pos-crm-blueprint.md](../reference/bandago-pos-crm-blueprint.md) | BandaGo integration architecture blueprint |
| [../reference/bandago-api-and-integration-architecture.md](../reference/bandago-api-and-integration-architecture.md) | BandaGo API & iDempiere GraphQL integration architecture reference |
| [../reference/archive/worklog.md](../reference/archive/worklog.md) | Sandbox-era build log — historical |
| [../reference/SPHERE_PHARMACY_OWNER_OPERATIONS_MANUAL.pdf](../reference/SPHERE_PHARMACY_OWNER_OPERATIONS_MANUAL.pdf) | Printable owner manual (export copy) |

## Conventions

- Every document opens with a metadata table: `| Audience | Status | Verified |`. The **Verified** date states when it was last checked against the code. Journey documents under [journeys/](journeys/README.md) additionally carry YAML frontmatter (id, actor, area, status, cross-references).
- Status labels, used consistently: **Implemented** · **Environment-dependent** (code complete, needs provider credentials or environment) · **Planned or not shipped** · **Requires live verification**.
- Diagrams are Mermaid inside fenced code blocks; the API contract is OpenAPI 3.1 in [`openapi/sphere-api.yaml`](../openapi/sphere-api.yaml). The portal renders these diagrams interactively (zoom, pan, fullscreen, SVG download) at `/docs`.
- When documentation and code disagree, **the code wins — then fix the documentation** (and record why in the PR).
- Nothing in this public repository may contain real credentials, customer or prescription data, or unredacted security findings. Restricted internal documents belong in a private location.

## Keeping docs honest

Documentation changes are committed alongside the code changes they describe — see [governance/documentation-policy.md](governance/documentation-policy.md) for the required-mapping table, the pull-request checklist, and the monthly documentation-drift audit. AI coding agents are expected to update documentation as part of any code change that alters documented behavior.
