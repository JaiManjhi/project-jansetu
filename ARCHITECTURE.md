# Architecture — JanSetu (SIH26043)

## 1. Design principle

**One language, one deploy target, minimal moving parts.** This is a solo, AI-assisted, 10-day build. Every architecture decision below optimizes for reducing the number of things that can independently break, not for "proper" enterprise separation of concerns. A microservices architecture is explicitly rejected here — it would cost debugging time a solo developer doesn't have.

## 2. High-level flow

```
Citizen (PWA) ──submit──▶ Next.js API route ──▶ AI classify + embed ──▶ MongoDB (dedup check via vector search)
                                                        │
                                                        ▼
                                          Route to matched institution(s)
                                                        │
                        ┌───────────────────────────────┼───────────────────────────────┐
                        ▼                                ▼                               ▼
              University Dashboard              Industry Dashboard              Admin Dashboard
              (claim, status update)             (browse, pledge)               (analytics, heatmap)
```

## 3. Tech stack

**As built (Day 1, verified installed):** Next.js `16.3.4` · React `19.2.8` · TypeScript `5` strict · Tailwind `4` · Mongoose `9.9.4` · NextAuth `4.24.15` · Zod `4.5.4` · bcryptjs `3.0.3` · Node `24`.

Two notes on those choices. The table below says "Next.js 14+" — 16 satisfies that and is what `create-next-app` now produces; Tailwind 4 means design tokens live in `@theme` inside `app/globals.css` rather than a `tailwind.config.js`. And NextAuth stayed on **v4 stable**, not the v5 beta: v4 declares support for Next 16 and React 19, and its `getServerSession` is the exact API `API_SPEC.md` specifies. A beta auth library is not where a solo build with a fixed deadline should spend its risk budget.

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14+ (App Router) | Single codebase for frontend + backend API routes — no separate Express server, one Vercel deployment |
| Language | TypeScript, strict mode | Catches shape mismatches at build time, which matters more than usual when one person is both writing and reviewing all the code |
| Styling | Tailwind CSS | Fast to iterate, pairs well with AI-generated components |
| Animation | Framer Motion | Used sparingly — see `DESIGN.md` |
| Database | MongoDB Atlas (M0 free tier) | Matches existing team familiarity; native vector search (Atlas Vector Search) and geospatial queries (`2dsphere`) both available on the free tier, so no second database is needed |
| Auth | NextAuth.js | Email magic-link for citizens (optional), institution-domain-restricted credentials for University role, simple credential auth for Industry/Admin |
| AI — embeddings | Google `gemini-embedding-2` at `outputDimensionality: 768` | Verified live 2026-09-01. Returns unit-normalized vectors at 768 (`gemini-embedding-001` does not — see AI_ENGINE.md §2). `text-embedding-004` no longer exists |
| AI — generation (classification, match reasoning) | Groq `openai/gpt-oss-120b` primary, `gemini-3.5-flash` fallback | Verified live 2026-09-01 at 724ms avg. **Groq no longer serves any Llama 3.x chat model.** Do not pin Gemini to a `-latest` alias — the newest Flash models return 503 on the free tier |
| Voice input | Web Speech API (browser-native) as the default; AI4Bharat/Bhashini as an upgrade path if time permits | Web Speech API needs zero backend integration and zero API key — ship this first, upgrade only if Day 6-7 has slack |
| Media storage | Cloudinary (free tier) | Photo/video upload for citizen submissions |
| Maps | MapLibre GL JS + free OpenStreetMap tiles | No API key, no cost |
| Coordinates → district/state | Bundled centroid lookup (`data/districts.json`), nearest-district by haversine | No API key, no network hop in the submit path, nothing to rate-limit or go down on demo day, and deterministic — which is what dedup bucketing actually needs. Live reverse geocoding (Nominatim) is the roadmap upgrade |
| Deployment | Vercel | One command deploy, generous free tier, zero-config Next.js support |
| PWA / offline | `next-pwa` or a hand-rolled service worker + IndexedDB queue | Offline submission queueing is a stated PRD requirement, not optional |

## 4. Why no separate Express/Python service

Everything this project needs — REST endpoints, calling external AI APIs, MongoDB queries including vector search — Next.js API routes handle natively. Introducing a second service (Express, or a Python microservice for embeddings) would mean two deployments, two sets of environment variables, and two things that can be out of sync. For a solo developer, that complexity cost is not worth whatever marginal benefit it buys. Revisit only if a specific feature genuinely can't run in a Next.js API route (none currently identified).

## 5. Folder structure

```
jansetu/
├── app/
│   ├── (citizen)/
│   │   ├── page.tsx                  # submission form (public, no auth)
│   │   ├── feed/page.tsx             # public problem feed
│   │   └── track/[id]/page.tsx       # citizen tracks their own submission
│   ├── (university)/
│   │   ├── dashboard/page.tsx
│   │   └── projects/[id]/page.tsx
│   ├── (industry)/
│   │   └── dashboard/page.tsx
│   ├── (admin)/
│   │   └── dashboard/page.tsx
│   ├── api/
│   │   ├── problems/
│   │   │   ├── route.ts              # POST create, GET list
│   │   │   └── [id]/route.ts         # GET one, PATCH status
│   │   ├── institutions/route.ts
│   │   ├── projects/route.ts
│   │   ├── pledges/route.ts
│   │   ├── auth/[...nextauth]/route.ts
│   │   └── ai/
│   │       ├── classify/route.ts
│   │       ├── embed/route.ts
│   │       └── match/route.ts
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── db.ts                         # MongoDB connection singleton
│   ├── ai/
│   │   ├── classify.ts               # classification prompt + call
│   │   ├── embed.ts                  # embedding generation
│   │   ├── dedup.ts                  # dedup check logic
│   │   └── match.ts                  # routing/matching + department selection + reason generation
│   ├── geo/
│   │   ├── district.ts               # {lat,lng} → {district, state} nearest-centroid lookup
│   │   └── haversine.ts              # shared by district.ts and match.ts distance scoring
│   ├── auth.ts                       # NextAuth config
│   └── validators.ts                 # Zod schemas, shared client+server
├── components/
│   ├── ui/                           # base components — button, card, input, etc.
│   ├── citizen/
│   ├── university/
│   ├── industry/
│   └── admin/
├── models/                           # Mongoose schemas — see DATA_MODEL.md
│   ├── User.ts
│   ├── Problem.ts
│   ├── Institution.ts
│   ├── Project.ts
│   └── Pledge.ts
├── public/
│   ├── manifest.json                 # PWA manifest
│   └── sw.js                         # service worker
├── data/
│   ├── institutions-seed.json        # AISHE/AICTE-sourced + curated deep profiles
│   └── districts.json                # district/state centroids, static — read from disk, never seeded to Mongo
├── scripts/
│   ├── seed-institutions.mts         # loads data/institutions-seed.json into Mongo
│   ├── create-search-indexes.mts     # creates the two Atlas vector indexes (idempotent)
│   └── build-districts.mts           # one-time: boundary GeoJSON → data/districts.json
├── tests/
│   └── geo.test.mts                  # node:test — no test framework dependency
├── .env.local                        # see SETUP.md — never commit
└── next.config.js
```

**On scripts and tests.** Both use Node 24's native TypeScript type-stripping and the `.mts` extension, so they run with plain `node` and need no build step, no `ts-node`, and no `tsx`. Tests use the built-in `node:test` runner — **zero test-framework dependencies**, which matters on a 10-day budget where a Jest/Vitest config is a half-day of yak-shaving that buys nothing at this scale.

Two consequences worth knowing:

- Scripts and tests import with **relative paths and explicit `.ts` extensions** (`../lib/geo/haversine.ts`), not the `@/` alias — plain Node does not read `tsconfig.json` `paths`. `allowImportingTsExtensions` is enabled in `tsconfig.json` to permit this, which is only legal because `noEmit` is set.
- JSON imports carry an explicit import attribute (`with { type: "json" }`), required by Node ESM. Turbopack accepts it too, so the same module works unchanged in the app and under `node --test`.

Run with `npm test`, `npm run db:indexes`, `npm run build:districts <path-to-geojson>`.

## 6. Data flow — problem submission, step by step

1. Citizen submits via `app/(citizen)/page.tsx` → `POST /api/problems`
2. API route validates payload (Zod) and converts `{lat, lng}` → GeoJSON `{type: "Point", coordinates: [lng, lat]}` (note the reversed order — see `API_SPEC.md` for why this is a common silent-bug point)
3. Server calls `lib/geo/district.ts` → nearest-centroid lookup against `data/districts.json` resolves `district` and `state` from the coordinates. Local, synchronous, no network call. **These are never read from the request body** — see `DATA_MODEL.md`. Writes the `problems` doc with `status: "processing"`, `locationSource`, `locationAccuracyM`, `language`, `district`, `state`
4. Server calls `lib/ai/embed.ts` → gets the problem's embedding vector, saves to the doc
5. Server calls `lib/ai/dedup.ts` → runs an Atlas `$vectorSearch` scoped to same `district` + last 90 days → if top match similarity ≥ threshold (see `AI_ENGINE.md §3`), merge into the existing problem and **return immediately** — steps 6-8 are skipped entirely
6. If not a duplicate: server calls `lib/ai/classify.ts` → category + severity signal
7. Server calls `lib/ai/match.ts` → `$vectorSearch` against `institutions.capabilityEmbedding`, applies the distance and load penalties, selects the matched department locally, returns top 3 with generated reason text
8. Doc updated to `status: "routed"`, matches written to the `matches` collection
9. Response returned to citizen; university sees it appear in their queue on next fetch (polling or simple refresh — no need for websockets at this scope)

**On the ordering:** embed → dedup → classify, not classify → embed → dedup. Dedup is pure vector similarity and never consults the category, so classifying first would spend an LLM generation call on every duplicate before discovering it was a duplicate. Running dedup first means the duplicate path costs **zero** generation calls and returns in roughly the time of one embedding call plus one Atlas query — which matters both for free-tier rate limits and because the duplicate-detected response is the demo's best beat (`DESIGN.md §7`) and should be the system's fastest response, not its slowest.

If any AI step fails, `AI_ENGINE.md §7` governs: the doc is already written at step 3, so the submission survives with `needsReview: true` regardless of what breaks downstream. Note that steps 2-3 have no external dependency at all, so district, state, and the map pin are always correct even in total AI outage.

## 7. Auth strategy

| Role | Auth method | Notes |
|---|---|---|
| Citizen | None required for submission; optional magic-link login only for tracking submission history | Do not gate submission behind login — that contradicts the accessibility goal |
| University Coordinator | Credentials, restricted to pre-seeded institution accounts (domain-verified conceptually, hardcoded allowlist for the hackathon) | Full domain-verification email flow is roadmap, not hackathon scope |
| Industry Partner | Simple credentials | |
| Admin | Simple credentials, single hardcoded account is acceptable for the demo | |

## 8. Security considerations (minimum viable, not exhaustive)

- Rate-limit `POST /api/problems` (public, unauthenticated) — a simple IP-based in-memory limiter is sufficient for hackathon scope, note as a roadmap item to harden
- Sanitize all free-text input before storage and before it's ever included in an LLM prompt (prevent prompt injection via a submitted problem description)
- Admin and University routes must check role server-side on every API route, not just hide UI client-side

## 9. Known limitations (accepted for hackathon timeline — state these openly if asked)

- No real-time push notifications — status changes are seen on next page load/refresh
- Institution "deep profile" data covers 40-60 institutions, not all of India, by design (see `PRD.md §8`)
- District/state are assigned by nearest centroid, not by true boundary polygons — a report within roughly 10-20km of a district border can be attributed to the neighbouring district. Chosen deliberately for determinism and zero network dependency; say so plainly rather than implying boundary-accurate geocoding
- SMS is stubbed (logged, not actually sent) unless Day 8-9 has slack for a real Twilio trial integration
- Single-region MongoDB Atlas free cluster — no geographic redundancy, irrelevant at demo scale
