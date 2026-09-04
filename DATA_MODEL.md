# Data Model — JanSetu

**This file is the single source of truth for field names.** Every other doc references these exact names. If you rename a field, update it here first.

Database: MongoDB Atlas (free M0 tier). Collections below, each with fields, types, and required indexes.

---

## `users`

```ts
{
  _id: ObjectId,
  role: "citizen" | "university" | "industry" | "admin",
  name: string,
  email: string,               // optional for citizen, required for others
  phone: string,                // optional
  passwordHash: string | null,  // bcrypt hash. Required for university/industry/admin — all three are credential-authenticated per ARCHITECTURE.md §7. null for citizens, who never authenticate with a password
  institutionId: ObjectId,      // required if role === "university", references institutions._id
  organizationName: string,     // required if role === "industry"
  createdAt: Date
}
```

**Indexes:** `{ email: 1 }` unique sparse, `{ role: 1 }`

`passwordHash` carries `select: false` on the schema path, so it is excluded from every query unless explicitly asked for (only the NextAuth `authorize` callback should ever ask). Excluding it at the schema level rather than stripping it from response objects is deliberate — the stripping approach leaks the first time someone adds a route that forgets to strip. It must never appear in an API response, a NextAuth session, or a JWT.

---

## `problems`

> **Language fields (amended 2026-09-04).** `language` is the language the report
> was *written or spoken in*; `translations` caches renderings of it into other
> languages. The two enums are deliberately different sizes, and the difference is
> empirical, not arbitrary: **Whisper cannot transcribe Odia** — the Groq API
> rejects `language=or` outright with `unsupported language: or` — while the LLM
> translates into Odia correctly. So Odia is a language you can *read* JanSetu in,
> not one you can *speak to* it in. See `lib/constants.ts`, where the two enums are
> defined and this split is enforced.
>
> **Moderation (added 2026-09-05).** Anyone can report a problem without an
> account — the accessibility decision the whole product rests on — which also
> means anyone can post abuse. `removedAt` / `removedReason` / `removedBy` are a
> **soft delete with an audit trail**: the report stops being publicly visible,
> the document survives, and who removed it and why is recorded.
>
> Moderation is deliberately NOT a `status` value. Status is a workflow stage,
> and a removed report may already be `claimed` with a live project attached;
> overwriting that would destroy the record of where the work had got to. The two
> are independent, so a report can be removed from any stage and restored to the
> one it was in.
>
> Every public read path composes `VISIBLE_PROBLEM_FILTER` from `lib/constants.ts`
> rather than writing `removedAt: null` inline. There are ten such paths, and the
> easy failure is missing one — translation and upvote in particular, where a
> forgotten filter lets anyone still read or boost removed content by asking for
> it in another language.

> `translations` is written only by `POST /api/problems/:id/translate` and only on
> demand. Nothing is translated at submission time, because translating every
> report into every language would multiply the AI spend on every submission for
> readers who may never come.

```ts
{
  _id: ObjectId,
  title: string,                          // short, either citizen-provided or LLM-summarized from description
  description: string,                    // full text, from typed input or voice transcription
  language: string,                       // language the citizen submitted in — one of VOICE_LANGUAGE_ENUM (PRD.md §7). Defaults to "en" if the client omits it
  translations: {                         // on-demand translations, cached so the second reader costs nothing. Empty until someone asks
    [languageCode: string]: {             // key is one of TRANSLATION_LANGUAGE_ENUM
      title: string,
      description: string,
      translatedAt: Date
    }
  },
  category: string | null,                // one of CATEGORY_ENUM (see AI_ENGINE.md §1). null only while unclassified — i.e. a submission saved during total AI outage, which always carries needsReview: true
  severityScore: number | null,           // 0-100, from AI severity signal. null under the same condition as category
  location: {
    type: "Point",
    coordinates: [number, number]         // [lng, lat] — GeoJSON order, do not swap
  },
  locationSource: "gps" | "manual",       // how the pin was set — GPS-detected or citizen-dragged
  locationAccuracyM: number | null,       // GPS accuracy radius in meters, from the browser Geolocation API; null if locationSource is "manual"
  district: string,                       // derived server-side from location — never accepted from the client (see "Deriving district and state" below)
  state: string,                          // derived server-side from location, same lookup as district
  mediaUrls: string[],                    // Cloudinary URLs
  submittedBy: ObjectId | null,           // users._id if citizen logged in, else null
  status: "processing" | "routed" | "claimed" | "in_progress" | "resolved" | "duplicate_merged",
  needsReview: boolean,                   // default false. Set true when classification failed twice or both AI providers were unreachable (AI_ENGINE.md §1, §7). Drives the admin manual-classification queue
  duplicateOf: ObjectId | null,           // set if this was merged into an existing problem
  upvoteCount: number,
  removedAt: Date | null,                 // set when an admin takes the report down; null means visible. Soft delete — the document is never destroyed
  removedReason: string | null,           // one of REMOVAL_REASON_ENUM. Required whenever removedAt is set
  removedBy: ObjectId | null,             // users._id of the admin who removed it                    // default 0
  embedding?: number[],                   // vector, from lib/ai/embed.ts — dimension per model, document it in AI_ENGINE.md. Absent (not empty) if embedding failed; Atlas simply does not index a doc missing the path, which is the behaviour we want — an unembedded problem should be invisible to dedup, not a zero-vector that matches everything
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:**
- `{ location: "2dsphere" }` — geospatial queries
- `{ district: 1, createdAt: -1 }` — dedup scoping (same district, recent window)
- `{ needsReview: 1, createdAt: -1 }` — admin manual-classification queue
- Atlas Vector Search index named `problem_embedding_index`, defined as:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" },
    { "type": "filter", "path": "district" },
    { "type": "filter", "path": "status" },
    { "type": "filter", "path": "createdAt" }
  ]
}
```

`numDimensions: 768` matches `gemini-embedding-2` at `outputDimensionality: 768`, verified against the live API — see `AI_ENGINE.md §2` for why that model and that size.

**The three `filter` entries are required, not optional.** The dedup query in `AI_ENGINE.md §3` filters on `district`, `status`, and `createdAt` inside `$vectorSearch`, and Atlas rejects a filter on any path the index did not declare as a filter field. This fails at *query* time, not at index-creation time — the index will create cleanly and look correct until the first dedup run.

### Deriving `district` and `state`

Both are required fields and dedup scopes on `district`, but `POST /api/problems` only receives `{lat, lng}`. The API route resolves them server-side via `lib/geo/district.ts`, which does a nearest-centroid lookup against `data/districts.json` (a bundled list of Indian districts with `district`, `state`, `lat`, `lng`).

Chosen over live reverse geocoding deliberately: no network hop inside the citizen's sub-5-second submit path, nothing that can be rate-limited or down on demo day, and — the property that actually matters — it is **deterministic**, so two reports of the same hand pump always resolve to the same bucket. Dedup needs stable bucketing more than it needs cartographic accuracy. Accepted cost: a point within ~10-20km of a district border may resolve to the neighbouring district. Live reverse geocoding is a roadmap upgrade, not a hackathon requirement.

Never accept `district` or `state` from the client, even as a hint — a client-supplied value that disagrees with the coordinates silently splits dedup buckets.

---

## `institutions`

```ts
{
  _id: ObjectId,
  name: string,
  type: "university" | "college" | "technical_institute",
  state: string,
  district: string,
  location: {
    type: "Point",
    coordinates: [number, number]
  },
  dataDepth: "shallow" | "deep",          // shallow = AISHE/AICTE sourced only, deep = curated with real dept/faculty profiles
  departments: [
    {
      name: string,
      facultyExpertise: string[],         // e.g. ["rural water systems", "structural engineering"]
      embedding: number[],                // vector for THIS department's own text (name + ": " + facultyExpertise.join(", ")), generated at seed time. Used to pick the matched department locally at routing time — see AI_ENGINE.md §4
      activeProjectCount: number          // default 0. Incremented on claim, decremented on completion — see API_SPEC.md. Used for load-balancing in routing
    }
  ],
  capabilityText: string,                 // concatenated department/faculty text, source for capabilityEmbedding — construction rule in AI_ENGINE.md §2
  capabilityEmbedding: number[],          // vector, institution-level; what institution_capability_index searches
  contactEmail: string,
  verifiedDomain: string,                 // e.g. "nitjsr.ac.in", used for login allowlist
  createdAt: Date
}
```

**Indexes:**
- `{ location: "2dsphere" }`
- `{ state: 1 }`
- Atlas Vector Search index named `institution_capability_index` on `capabilityEmbedding`, similarity `cosine`, `numDimensions: 768`, identical to `problem_embedding_index` — problem and institution vectors are compared against each other, so they must come from the same model at the same dimension. No `filter` fields required; routing does not filter this search.
- `departments[].embedding` is deliberately **not** indexed. Department selection happens in JS over the ~10 candidates already returned by the institution-level search, so it needs no second Atlas index and costs no extra API call.

---

## `matches`

```ts
{
  _id: ObjectId,
  problemId: ObjectId,
  institutionId: ObjectId,
  score: number,                          // combined similarity + distance-penalty score
  distanceKm: number,
  matchedDepartment: string | null,       // name of the best-matching department within this institution, selected per AI_ENGINE.md §4. null for shallow institutions, which have no department data
  reason: string,                         // LLM-generated plain-language explanation
  rank: number,                           // 1, 2, 3 — position among returned matches
  createdAt: Date
}
```

**Indexes:** `{ problemId: 1, rank: 1 }`

---

## `projects`

```ts
{
  _id: ObjectId,
  problemId: ObjectId,
  institutionId: ObjectId,
  claimedBy: ObjectId,                    // users._id, university role
  matchedDepartment: string | null,       // copied from the matches doc at claim time. Records which department's activeProjectCount was incremented, so completion decrements the same one
  teamMembers: string[],                  // free text names for hackathon scope, not full user accounts
  status: "claimed" | "in_progress" | "completed",
  statusNote: string,                     // free text update, latest only — full history is roadmap
  claimedAt: Date,
  updatedAt: Date
}
```

**Indexes:** `{ institutionId: 1, status: 1 }`, `{ problemId: 1 }` unique

---

## `pledges`

```ts
{
  _id: ObjectId,
  projectId: ObjectId,
  partnerId: ObjectId,                    // users._id, industry role
  type: "mentorship" | "funding" | "prototyping",
  note: string,
  amount: number | null,                  // only if type === "funding"
  createdAt: Date
}
```

**Indexes:** `{ projectId: 1 }`

---

## Category enum (used in `problems.category`)

```
"water_resources"
"healthcare"
"education"
"agriculture"
"environment"
"energy"
"urban_infrastructure"
"accessibility"
"public_administration"
"rural_livelihoods"
```

This exact list must match the one in `AI_ENGINE.md §1` classification prompt — keep them in sync.

## Seed data

`data/institutions-seed.json` populates `institutions` on first setup via `scripts/seed-institutions.ts`. Structure: an array of objects matching the `institutions` schema above, minus `_id`, `capabilityEmbedding`, and `departments[].embedding` — all vectors are generated at seed time by calling the embedding function on `capabilityText` and on each department's own text respectively.

`data/districts.json` is a static reference dataset, not a seeded collection — it stays on disk and is imported directly by `lib/geo/district.ts`. Structure: an array of `{ district: string, state: string, lat: number, lng: number }`, one entry per Indian district. It is never written to MongoDB.
