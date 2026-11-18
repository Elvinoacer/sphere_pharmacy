# Medicine requests

Medicine requests are the guest "find this medicine" flow: a customer who cannot find a product (or cannot travel) submits a medicine name plus a Kenyan phone number and optionally a photo of the prescription or packaging. No account is required by design — the pharmacy calls back. Staff work the requests from an admin queue.

| Audience | Status | Verified |
| --- | --- | --- |
| Engineers, AI coding agents | **Implemented** | November 2026 |

## 1. Purpose

Capture demand the catalogue cannot serve — unlisted medicines, out-of-stock items, photo-based requests — with the lowest possible friction (no auth, phone-only callback), while keeping photos private, size-bounded, and staff-only visible. There are deliberately **no notifications**: staff monitor the queue.

## 2. Users

- **Guests (or anyone):** submit a request; no account, no session.
- **Staff (ADMIN/PHARMACIST/STAFF):** work the queue — search, filter, open photos, set status, record staff notes.

## 3. Screens

- **Catalog CTA** — medicine-request dialog (`src/components/catalog/medicine-request.tsx`) reachable from `catalog-view.tsx` (and the empty-search state).
- **Admin → Medicine requests** — `medicine-requests-section.tsx` (ADMIN/PHARMACIST/STAFF): queue with status filter, search, photo viewer, follow-up notes. Photos stream through a staff-only proxy endpoint — no presigned URLs are exposed.

## 4. Frontend implementation

- `medicineRequestsApi` (typed client): public create; admin list/patch; photo URL points at `/api/admin/medicine-requests/{id}/photo` when a `storageKey` exists.
- Guest form: medicine name (2–200 chars), Kenyan phone, optional photo (jpeg/png/webp, 3MB cap) with base64 upload and client-side size guard; the 3MB server cap is also streamed/enforced server-side.

## 5. Backend implementation

- **Create `POST /api/medicine-requests`** — **no auth (guest by design)**; 10/hour per IP; request body cap `ceil(3MB/3)*4 + 4096` (base64 inflation budget) **plus a hard streamed-size cap** → 413 "Photo is too large — 3MB maximum". Zod validation: `medicineName 2–200`; `phone ≤30 chars` matching `[+\d\s()-]`, normalized to `+2547XXXXXXXX`; optional `photo {name 1–120, type jpeg/png/webp, base64 ≤~4MB}`. Photo bytes are **magic-byte validated**, stored to private R2 under `medicine-requests/{uuid}.{ext}`; if row creation fails, the orphan R2 object is deleted. Returns `{id}` with 201, no-store. **No notifications are queued** — staff monitor the admin queue.
- **Admin list `GET /api/admin/medicine-requests`** (ADMIN/PHARMACIST/STAFF) — status filter, search ≤200 chars (contains over medicineName/phone), page 1–10000, **pageSize fixed at 25**; `photoUrl` populated only when a storage key exists.
- **Admin patch `PATCH /api/admin/medicine-requests/[id]`** (staff) — `{id, status ∈ NEW/CONTACTED/FULFILLED/UNAVAILABLE, staffNotes ≤1000}` + `AuditLog UPDATE_MEDICINE_REQUEST` with previous/new values.
- **Photo proxy `GET /api/admin/medicine-requests/[id]/photo`** (staff) — streams the private R2 object with the original Content-Type, inline disposition, `private no-store`, and `nosniff`; no presigned URL is ever exposed.

## 6. Database

- **MedicineRequest** — `medicineName`, `phone` (normalized), `status @default("NEW")` (`NEW/CONTACTED/FULFILLED/UNAVAILABLE`), `staffNotes?`, `photoName?/photoType?/storageKey?`, timestamps. Index `[status, createdAt]`.
- **AuditLog** — `UPDATE_MEDICINE_REQUEST` events (actor, previous/new details).
- See [../database/data-dictionary.md](../database/data-dictionary.md).

## 7. Workflow

1. Guest submits name + phone (+ optional photo) → row created NEW (photo in private R2).
2. Staff open the admin queue (status filter/search), view the streamed photo, call the customer back.
3. Staff set CONTACTED → FULFILLED or UNAVAILABLE, recording `staffNotes`; every change audited.
4. No automated follow-up or notification exists — the loop closes by phone/WhatsApp.

## 8. Permissions

- Create: public, rate-limited 10/hour/IP.
- List/patch/photo: ADMIN/PHARMACIST/STAFF only (riders excluded).
- Photos are never publicly reachable: private bucket + staff-only streaming proxy.

## 9. Integrations

- Cloudflare R2 private storage for photos (same bucket family as prescriptions; see [../security/file-storage-security.md](../security/file-storage-security.md)).
- Staff may follow up via `waHref`/`telHref` deep links in the admin UI (see [notifications.md](notifications.md) §9 for the WhatsApp-link caveat).

## 10. Validation and business rules

- `medicineName` 2–200 chars; phone ≤30 chars over `[+\d\s()-]` normalized to `+2547XXXXXXXX`.
- Photo: jpeg/png/webp only, ≤3MB decoded, magic-byte verified (extension/MIME agreement), name ≤120 chars.
- Status values are exactly NEW/CONTACTED/FULFILLED/UNAVAILABLE; `staffNotes ≤1000`.
- Rate limit 10/hour/IP (fixed window); oversized requests rejected before body parsing via Content-Length plus the streamed cap.

## 11. Failure handling

- Row-creation failure after photo upload → orphan R2 object deleted (no dangling private objects).
- Oversized/invalid photos → 413/400 with a specific message; nothing persisted.
- Photo fetch failures surface as API errors in the admin queue; the request row remains actionable.

## 12. Testing

- `tests/medicine-requests.test.mjs` — opt-in integration suite (running app + disposable local DB) covering guest submission, private photos, staff workflow, and validation.

## 13. Operational requirements

- `R2_*` credentials for the private medicine-requests storage path.
- No cron, no notification configuration — staff must actively monitor the queue.

## 14. Known limitations

- No notifications by design: requests wait in the queue until a staff member looks (consider pairing with live-changes polling in the admin workspace).
- No customer-facing status view — guests get a phone callback only.
- No dedupe: the same phone can submit repeated requests (bounded only by the IP rate limit).
- Photo proxy streams per request; there is no caching layer.
