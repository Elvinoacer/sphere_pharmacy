# Documentation Policy

| Audience | Status | Verified |
| --- | --- | --- |
| All contributors (engineers, AI coding agents, reviewers) | Active policy | November 2026 |

This policy exists because documentation that does not evolve with the code is worse than no documentation — it misleads. The rule is simple: **documentation changes are committed in the same pull request as the code changes they describe.**

## 1. Why documentation lives in this repository

The source code is in GitHub; the documentation lives alongside it. This gives:

- Documentation changes reviewed with code changes (same PR, same reviewers).
- Git history for every technical explanation — who changed it, when, and why.
- Developers and AI coding agents can read it directly from the repository.
- No second, competing copy of the truth drifting out of date in an external tool.

Supplementary material (progress tracking, non-code business knowledge) may live in Notion or similar, but the technical source of truth is here, in Markdown + Mermaid + OpenAPI.

## 2. Required updates per code change

| Code change | Documentation that must be updated |
| --- | --- |
| New API endpoint | [api/api-reference.md](../api/api-reference.md) + [openapi/sphere-api.yaml](../../openapi/sphere-api.yaml) |
| Database schema change | [database/](../database/) — data dictionary, schema overview, migrations |
| New feature | [features/](../features/) page + [product/feature-catalogue.md](../product/feature-catalogue.md) |
| Permission change | [security/access-control.md](../security/access-control.md) + [product/user-roles-and-permissions.md](../product/user-roles-and-permissions.md) |
| Integration change | the relevant [integrations/](../integrations/) page |
| New scheduled job | [operations/scheduled-jobs.md](../operations/scheduled-jobs.md) runbook |
| Deployment change | [operations/deployment.md](../operations/deployment.md) |
| Changed business rule (status, fee, limit, validation) | the relevant [workflows/](../workflows/) page and any [features/](../features/) page that states the rule |
| Security-relevant change (guard, secret, webhook, storage) | the relevant [security/](../security/) page; new concerns go into [governance/technical-debt.md](technical-debt.md) |

## 3. Pull-request checklist

Add this to every PR that changes runtime behavior:

- [ ] If an endpoint was added/changed: API reference and OpenAPI updated.
- [ ] If the schema changed: data dictionary + migrations doc updated; migration added (never edit an applied migration).
- [ ] If a status, limit, fee, or validation rule changed: the corresponding workflow/feature doc updated.
- [ ] If a permission or guard changed: access-control doc updated; no guard was weakened.
- [ ] If an env var was added/renamed: [operations/environment-variables.md](../operations/environment-variables.md) + `.env.example` updated.
- [ ] If AI/assistant behavior changed: [security/ai-access-and-authorized-sessions.md](../security/ai-access-and-authorized-sessions.md) reviewed — session-gating invariants must hold.
- [ ] Status labels on affected features updated (Implemented / Environment-dependent / Planned / Requires live verification).
- [ ] No secrets, customer data, or prescription content in the diff.

Reviewers should treat an undocumented behavioral change as incomplete, the same as a missing test.

## 4. Status labels

Every documented feature carries exactly one label so a reader never mistakes a blueprint for a working system:

- **Implemented** — verified in code; works in a configured environment.
- **Environment-dependent** — code complete, but requires provider credentials/configuration (e.g. M-Pesa production keys, Resend domain) to function.
- **Planned or not shipped** — described for context only; no working backend.
- **Requires live verification** — implemented but not yet exercised against the real provider/production environment.

## 5. Monthly documentation-drift audit

Documentation drift is checked on a monthly cadence (a recurring calendar task owned by the project maintainer; an AI agent can perform the legwork):

1. `git log --oneline --since="1 month ago" -- src prisma` — list code changes.
2. For each change, confirm the matching document (per the table in §2) was touched in the same period.
3. Spot-check load-bearing facts against the code: status lists in `src/lib/constants.ts`, guards in `src/lib/session.ts`, the route inventory under `src/app/api/`, env vars in `.env.example`.
4. Fix stale statements in a dedicated `docs: drift audit <month>` PR; record what drifted and why the process missed it.
5. Update each document's **Verified** date only when it was actually re-checked.

The audit's output is small by design — the goal is catching drift early, not rewriting docs monthly.

## 6. AI agents and documentation

AI coding agents are expected to:

- **Read** [README.md](../../README.md) → [AGENTS.md](../../AGENTS.md) → [docs/README.md](../README.md) before changing code.
- **Update** the affected documentation as part of any code change (per §2), in the same PR.
- **Flag** (never silently "fix") contradictions between code and docs: when the code wins, correct the doc; when the doc reflects an intended behavior the code lost, raise it as an issue.
- **Never** widen authorization guards, expose secrets, or route secure data outside authorized sessions to make an AI-assisted feature work — see [security/ai-access-and-authorized-sessions.md](../security/ai-access-and-authorized-sessions.md).

## 7. The in-app documentation portal (`/docs`)

The repository ships a built-in Next.js App Router documentation portal at **`/docs`** (`src/app/docs/**`, `src/lib/docs/**`, `src/components/docs/**`, shipped in `89b680c`). It renders these exact Markdown files, interactive Mermaid diagrams, the OpenAPI 3.1 contract (`/docs/api-reference`), the Prisma ER explorer (`/docs/database`), the user-journey explorer (`/docs/journeys`), full-text search (⌘K via `/api/docs-index`), and "Ask Sphere Docs" (`/docs/assistant` via `/api/docs-assistant`). The portal is purely a presentation and retrieval layer — **never** author documentation in TSX components or duplicate prose outside `docs/`, `README.md`, `AGENTS.md`, and `openapi/sphere-api.yaml`.
