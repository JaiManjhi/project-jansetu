# API Specification — JanSetu

All routes under `/api`. All request/response bodies are JSON. Field names match `DATA_MODEL.md` exactly.

Auth header convention: NextAuth session cookie, checked server-side in each protected route via `getServerSession`. Public routes marked explicitly.

---

## Problems

### `POST /api/problems` — **public**
Create a new problem submission. Triggers the full AI pipeline (classify → embed → dedup check → route) synchronously before responding.

**⚠ Coordinate order:** the request body takes human-friendly `{lat, lng}`. MongoDB's GeoJSON format (used in `problems.location` per `DATA_MODEL.md`) requires `[lng, lat]` — reversed order. The API route MUST explicitly convert `{lat, lng}` → `{type: "Point", coordinates: [lng, lat]}` before writing to the database. This is a common, silent bug: get the order wrong and every submission still saves successfully, but every point on the map lands in the wrong place (or the wrong hemisphere entirely) with no error thrown. Write a test that asserts this conversion specifically.

**⚠ Derived fields:** `district` and `state` are **not** in the request body and must never be accepted from the client, even as a hint. The route derives both from the coordinates via `lib/geo/district.ts` before writing the doc (`ARCHITECTURE.md §6` step 3). A client-supplied district that disagrees with the coordinates would silently split dedup buckets — two reports of the same problem landing in different districts never get compared. If a request body contains `district` or `state`, the Zod schema should strip them, not trust them.

**Request:**
```json
{
  "title": "string, optional — server generates one if omitted",
  "description": "string, required",
  "location": { "lat": 23.6, "lng": 85.3 },
  "locationSource": "gps | manual",
  "locationAccuracyM": "number, optional — GPS accuracy radius in meters, omit if locationSource is manual",
  "mediaUrls": ["string"],
  "language": "hi | en | ... — optional, defaults to \"en\", stored on problems.language"
}
```

**Response `201`:**
```json
{
  "problemId": "string",
  "status": "routed | duplicate_merged",
  "category": "string | null",
  "severityScore": 0,
  "district": "string",
  "state": "string",
  "needsReview": false,
  "duplicateOf": "string | null",
  "matches": [
    { "institutionId": "string", "institutionName": "string", "matchedDepartment": "string | null", "reason": "string", "score": 0.0 }
  ]
}
```

`district` and `state` are echoed back so the citizen-facing confirmation can name where the report was filed, and so a wrong centroid assignment is visible during testing instead of buried in the database.

Three response shapes are possible and the client must handle all three:
- **Routed** — `status: "routed"`, `category` set, `matches` has 1-3 entries, `duplicateOf: null`
- **Duplicate merged** — `status: "duplicate_merged"`, `duplicateOf` set, `matches: []`, and `category` is the *existing* problem's category. The citizen is shown the merged problem per `PRD.md §6`
- **AI unavailable** — `status: "processing"`, `needsReview: true`, `category: null`, `matches: []`. The submission is saved and the citizen is told it was received and is being reviewed — never an error (`AI_ENGINE.md §7`)

> **Interim behaviour while matching is unbuilt.** `lib/ai/match.ts` needs seeded institution data, so `matches` is currently always `[]` and **no problem reaches `status: "routed"`** — a successfully classified problem stays `"processing"` with `needsReview: false`. "Routed" means routed *to* something; marking it otherwise would tell the Day 8 admin dashboard that problems reached institutions that do not exist yet. The two states are distinguishable by `needsReview`: `true` means the AI failed and a human must classify, `false` means classified and awaiting routing. This resolves itself once matching returns candidates — no code change needed beyond building `match.ts`.

### `GET /api/problems` — **public**
List problems. Query params: `category`, `state`, `district`, `status`, `page`, `limit`, and `needsReview` (**admin only** — returns the manual-classification queue from `AI_ENGINE.md §7`; reject or ignore this param for unauthenticated callers so the public feed can't enumerate failed submissions). Used for the public feed, the admin dashboard, and the admin review queue.

### `GET /api/problems/:id` — **public**
Single problem detail, including its current status and any linked project.

### `PATCH /api/problems/:id` — **auth: university (must own the claim) or admin**
Update status. Body: `{ "status": "..." }`

### `POST /api/problems/:id/upvote` — **public**
Increment `upvoteCount`. Simple rate-limit by IP/session to prevent trivial abuse.

---

## Media

### `POST /api/media/sign` — **public**, rate-limited
Returns a short-lived Cloudinary upload signature so the browser can upload **directly to Cloudinary**, and the file bytes never pass through our server.

**Response `200`:**
```json
{
  "cloudName": "string",
  "apiKey": "string",
  "timestamp": 0,
  "folder": "jansetu/problems",
  "signature": "string"
}
```

Two reasons it is built this way rather than proxying the upload:

- `CLOUDINARY_API_SECRET` must never reach the browser. Signing server-side and uploading client-side is Cloudinary's documented pattern for exactly this.
- A citizen photographing a broken hand pump is uploading a multi-megabyte phone image over a rural connection. Routing that through a Vercel function burns the request body limit and the function timeout for no benefit — the bytes should go straight to Cloudinary.

The signature covers `folder` and `timestamp` only, and Cloudinary rejects it after ~1 hour. It authorises *an* upload into the problems folder, nothing more; it is not a credential and grants no read or delete access.

Rate-limited per IP, since an unauthenticated signing endpoint is otherwise an open invitation to use the account's storage quota.

---

## Institutions

### `GET /api/institutions` — **public**
List institutions. Query params: `state`, `type`, `dataDepth`. Used for admin dashboard institution list and any public "who's involved" page.

### `GET /api/institutions/:id/queue` — **auth: university (own institution only) or admin**
Returns problems routed to this institution, sorted by match score, with `status: "routed"` (not yet claimed by anyone).

### `POST /api/institutions/:id/claim` — **auth: university**
Body: `{ "problemId": "string" }`.

Three writes, in this order:
1. Create the `projects` doc with `status: "claimed"`, copying `matchedDepartment` from this institution's `matches` doc for this problem (null if the institution is shallow or no match doc exists)
2. Set `problems.status = "claimed"`
3. If `matchedDepartment` is not null, `$inc` that department's `activeProjectCount` by 1 on the `institutions` doc — this is the *only* place the counter goes up, and the routing penalty in `AI_ENGINE.md §4` is permanently zero if it's skipped

`projects` has a unique index on `{ problemId: 1 }`, which is what actually prevents two institutions claiming the same problem in a race — create the project first and let a duplicate-key error reject the second claim with `409`. Do not implement this as a read-then-write check; that has a window.

---

## Projects

### `GET /api/projects` — **auth: university (own) / industry (all claimed) / admin (all)**
List projects with filters: `institutionId`, `status`.

### `GET /api/projects/:id` — **public read of basic info; full detail requires auth**

### `PATCH /api/projects/:id` — **auth: university (own project only)**
Body: `{ "status": "...", "statusNote": "...", "teamMembers": ["..."] }`

**On a transition to `status: "completed"`:** if the project's `matchedDepartment` is not null, `$inc` that department's `activeProjectCount` by **-1** on the `institutions` doc. This is the only place the counter goes down. Guard it on an actual *transition* — read the current status first and skip the decrement if the project is already `completed`, otherwise a coordinator saving the form twice drives the count negative and the routing penalty starts silently rewarding the busiest departments.

The counter is denormalized, so it can drift. Cheap insurance: an admin-only script that recomputes every department's `activeProjectCount` from the `projects` collection (count where `institutionId` and `matchedDepartment` match and `status !== "completed"`). Worth having before demo day, not worth a UI.

---

## Pledges

### `POST /api/pledges` — **auth: industry**
Body: `{ "projectId": "string", "type": "mentorship|funding|prototyping", "note": "string", "amount": number | null }`

### `GET /api/pledges?projectId=` — **public**
List pledges for a project (shown on the project detail page).

---

## AI (internal — called server-side by `POST /api/problems`, not exposed as separate public endpoints unless needed for testing/admin tooling)

### `POST /api/ai/classify` — **auth: admin only (for testing/debugging)**
Body: `{ "description": "string" }` → Response: `{ "category": "string", "severityScore": number }`

### `POST /api/ai/match` — **auth: admin only (for testing/debugging)**
Body: `{ "problemId": "string" }` → Response: same shape as the `matches` array in `POST /api/problems`

---

## Admin analytics

### `GET /api/admin/stats` — **auth: admin**
Response:
```json
{
  "totalProblems": 0,
  "byCategory": { "water_resources": 0, "...": 0 },
  "byState": { "Jharkhand": 0, "...": 0 },
  "institutionsActive": 0,
  "projectsClaimed": 0,
  "projectsCompleted": 0
}
```

### `GET /api/admin/heatmap` — **auth: admin**
Returns `[{ lat, lng, weight, locationSource }]` — one point per problem, or pre-aggregated by district if problem count is large. `locationSource` is included so the admin UI can visually distinguish GPS-verified points from manually-placed ones, per `DESIGN.md §8`. Query params: `category`, `dateFrom`, `dateTo`.

---

## Error convention

Every error response:
```json
{ "error": "human-readable message", "code": "MACHINE_READABLE_CODE" }
```
HTTP status codes used conventionally: `400` validation, `401` unauthenticated, `403` unauthorized (wrong role), `404` not found, `409` conflict (a problem already claimed — see the claim route), `429` rate-limited, `500` server error.

**`POST /api/problems` is the exception to all of this.** A failure in the AI pipeline must not surface as an error response — the submission is saved with `needsReview: true` and returns `201` with the AI-unavailable shape above (`AI_ENGINE.md §7`). Only genuine validation failures, rate-limiting, and a database write failure return an error status on that route. Losing a citizen's report because a model provider was down is the one failure mode this system is not allowed to have.
