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

### `PATCH /api/problems/:id/moderation` — **auth: admin**
Takes a report down, or restores it.

**Request:** `{ "removed": true, "reason": "abusive" | "spam" | "personal_information" | "not_a_civic_problem" | "other" }`
or `{ "removed": false }` to restore.

**Response `200`:** `{ "problemId", "removed", "removedReason", "status" }`

**Errors:** `INVALID_ID` (400), `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404).

Submission is open to anyone without an account — the accessibility decision the product rests on — which also means nothing stops someone posting abuse. This is the counterweight, and it was missing until 2026-09-05.

**Soft delete, always.** The document is never destroyed, `removedAt` / `removedReason` / `removedBy` record who did it and why, and restoring is the same endpoint with `removed: false`. A deletion nobody can account for is its own problem in a government portal.

**Removal is not a status.** Status is a workflow stage, and a removed report may already be `claimed` with a live project against it; overwriting that would destroy the record of where the work had reached. The two are independent, so a report can be removed from any stage and restored to the one it was in.

**Admin only, never university** — a coordinator able to remove reports from their own queue could hide work rather than moderate content.

Removed reports disappear from: the public feed, `GET /api/problems`, `GET /api/problems/:id` (404), every institution queue, the admin figures and heatmap, dedup candidates, **and both `translate` and `upvote`**. Those last two are the easiest to miss and the most damaging — a removed report that can still be translated is still fully readable, just in another language. Every one of those paths composes `VISIBLE_PROBLEM_FILTER` from `lib/constants.ts` rather than repeating the condition.

⚠ **Known limit:** an attached photo stays reachable at its Cloudinary URL for anyone who already has it. Hiding the report does not unpublish the image. Deleting from Cloudinary would be a hard delete that destroys the evidence of what was removed, so it is deliberately not done.

---

### `POST /api/problems/:id/translate` — **public**, rate-limited
Returns a report in another language, translating on first request and caching the result.

**Request:** `{ "targetLanguage": "hi" | "en" | "bn" | "mr" | "or" }`

**Response `200`:**
```json
{
  "targetLanguage": "bn",
  "title": "string",
  "description": "string",
  "source": "original" | "cached" | "translated"
}
```

`source` says where the text came from, which is worth exposing rather than hiding: `original` when the report was already written in that language and nothing was spent, `cached` when a previous reader already paid for it, `translated` when this request generated it.

**Errors:** `INVALID_ID` (400), `VALIDATION_FAILED` (400), `NOT_FOUND` (404), `TRANSLATION_UNAVAILABLE` (503), `RATE_LIMITED` (429).

Nothing is translated at submission time — that would multiply AI spend on every submission for readers who may never come. The rate limit is checked **after** the cache, so re-reading a translation someone else already paid for never counts against a reader's budget.

The cache is written with a targeted `$set` on `translations.<code>` rather than by saving the whole document, so two readers requesting two different languages at the same moment cannot clobber each other.

**Odia is translation-only.** Groq's Whisper endpoint rejects `language=or` with `unsupported language: or`, so Odia is a language JanSetu can be *read* in, not one it can be *spoken* to in. `lib/constants.ts` holds both enums and a test guards the asymmetry.

---

## Voice

### `POST /api/transcribe` — **public**, rate-limited
Turns a recorded audio clip into text for the citizen report form. Accepts `multipart/form-data`.

**Request fields:**

| field | type | notes |
|---|---|---|
| `audio` | File | required; the recorded clip, max 8 MB |
| `language` | string | optional; one of `en`, `hi`, `bn`, `mr`. Anything else is ignored rather than rejected |

**Response `200`:**
```json
{ "text": "string" }
```

**Errors:** `VALIDATION_FAILED` (no file), `EMPTY_AUDIO`, `AUDIO_TOO_LARGE` (413),
`UNSUPPORTED_AUDIO` (415), `TRANSCRIPTION_UNAVAILABLE` / `TRANSCRIPTION_FAILED` /
`TRANSCRIPTION_RATE_LIMITED` (503), `RATE_LIMITED` (429).

Transcribed with `whisper-large-v3` on Groq at `temperature: 0`, with a
short vocabulary hint in the target language passed as Whisper's `prompt`.

**Model choice (revised 2026-09-05).** This was `whisper-large-v3-turbo`, chosen
for latency. A user reported Bengali and Marathi transcription as badly
inaccurate, and Groq's own figures explain it: turbo is **12% WER** against
large-v3's **10.3%**, and Groq's guidance is explicit — *"if your application is
error-sensitive and requires multilingual support, use whisper-large-v3."* A
citizen reporting a civic problem in Bengali is precisely that case. Measured
cost of the switch on a 25-second clip: **~60ms** (770-884ms → 834-900ms), for a
17% relative error reduction.

The `language` field is passed
upstream as a hint — it measurably improves Hindi accuracy and stops a Hindi clip
being rendered as phonetic English.

This route exists because the browser-native Web Speech API, which ARCHITECTURE.md
§3 originally specified, does not work on the phones this app is for: Android
Chrome mishandles continuous recognition and iOS needs Siri dictation enabled, and
in both cases the citizen speaks and sees nothing appear. Recording locally and
transcribing server-side behaves the same on every device.

Rate-limited per IP at 40/hour. Like `POST /api/problems`, this is an
unauthenticated route that spends provider quota on every call.

The transcript is returned for the citizen to **edit before submitting**, never
submitted directly — PRD §6 requires that, because recognition of Indian-accented
speech is imperfect and a wrong word must cost a tap, not a bad report.

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
