# Build Tasks — JanSetu

Dependency-ordered. Each item is written to be handed to an AI coding agent close to verbatim. Complete and test each block before moving to the next — do not build all seven days of features and test on day eight, that's how solo AI-assisted builds accumulate invisible bugs.

Consult `SETUP.md` before Day 1 — every account and key must exist first.

---

## Day 1 — Foundation

- [ ] Init Next.js 14 App Router project, TypeScript strict mode, Tailwind configured with the tokens from `DESIGN.md §2-4`
- [ ] Set up MongoDB Atlas M0 cluster, connect via `lib/db.ts` singleton pattern
- [ ] Implement all Mongoose schemas exactly per `DATA_MODEL.md` — every field, every type
- [ ] Set up the two Atlas Vector Search indexes (`problem_embedding_index`, `institution_capability_index`) — confirm embedding dimension against the actual model output first, don't guess it. `problem_embedding_index` must declare `district`, `status`, and `createdAt` as `filter` fields (exact index JSON is in `DATA_MODEL.md`); a missing filter field fails at query time, not at index creation, so it will look fine until Day 3's first dedup run
- [ ] NextAuth config per `ARCHITECTURE.md §7` — four roles, credential-based
- [ ] Deploy a "hello world" version to Vercel immediately — confirms the deploy pipeline works before any real feature is built on top of it

## Day 2 — Institution + district data

- [ ] Source AISHE/AICTE open-data institution list (name, location, type) — write `scripts/seed-institutions.ts` to parse and bulk-insert as `dataDepth: "shallow"`
- [ ] Manually compile 40-60 "deep" institution profiles (real department names, real faculty research areas, sourced from public institution websites) — prioritize Jharkhand institutions, spread the rest across several states
- [x] Build `data/districts.json` (one `{district, state, lat, lng}` per Indian district) and `lib/geo/district.ts` nearest-centroid lookup. **Done:** 788 districts, all 36 states/UTs, built by `scripts/build-districts.mts` from district boundary polygons; 8 tests in `tests/geo.test.mts`. Small, self-contained, and **blocks dedup** — dedup scopes by `district`, so until this exists every dedup query is scoped to an empty string and matches nothing. Sanity-check it with a handful of known coordinates (Ranchi, Jamshedpur, and one point deliberately near a district border) before trusting it
- [ ] Run the embedding pipeline over every institution's `capabilityText` to populate `capabilityEmbedding`, **and** over each department's own text to populate `departments[].embedding` — the latter is what makes department selection and the load-balancing penalty work in Day 3-5 routing. Use the shallow-institution `capabilityText` fallback in `AI_ENGINE.md §2` for institutions with no departments; don't let them embed as a bare name
- [ ] Verify vector search actually returns sane results with a manual test query before moving on

## Day 3-5 — AI engine (the core, per `AI_ENGINE.md`)

- [x] Implement `lib/ai/classify.ts` exactly per the prompt in `AI_ENGINE.md §1`, Groq primary / Gemini fallback, with the invalid-response retry-once logic
- [x] Implement `lib/ai/embed.ts` per `AI_ENGINE.md §2`
- [x] Implement `lib/ai/dedup.ts` per `AI_ENGINE.md §3` — log every similarity score during testing
- [ ] Implement `lib/ai/match.ts` per `AI_ENGINE.md §4`, including matched-department selection (local cosine over `departments[].embedding`, no extra API call) and the reason-generation prompt with its `{departmentLine}` interpolation for both the deep and shallow cases
- [x] Wire `POST /api/problems` to run the full pipeline in sequence per `ARCHITECTURE.md §6` — note the order is **embed → dedup → classify → match**, so a duplicate costs zero LLM generation calls. Include the `{lat,lng}` → GeoJSON `[lng,lat]` conversion and the server-side district/state derivation, both flagged in `API_SPEC.md` — write specific tests for both, they're silent-failure risks
- [x] **Build the evaluation sets now, not later** (`AI_ENGINE.md §6`) — **Done 2026-09-02:** 150 labeled classification examples, 50 labeled dedup pairs. **Classification 86.7% (130/150), dedup F1 0.955** — both above the PRD §9 targets. Threshold swept 0.60-0.95; 0.82 confirmed optimal with evidence. Confusion matrix recorded; `energy` is the weakest category at 9/15.
- [x] Test the fallback path deliberately — kill the AI API keys temporarily and confirm a submission still saves with `needsReview: true` instead of failing, and that `district`/`state` are still correct (they don't depend on any AI call). Confirm the route returns `201`, not an error status

## Day 6-7 — Citizen submission flow

- [x] Build `app/(citizen)/page.tsx` per `DESIGN.md §8` — mobile-first, single column
- [x] Wire Web Speech API for voice input, with visible transcription the citizen can edit before submit
- [ ] Photo upload via Cloudinary
- [x] Location: request GPS immediately on this step and pre-fill the pin the moment it resolves — do not wait for a tap. Show an equally-prominent "Set location manually" option beside the auto-detected pin (Zomato/Swiggy pattern, not a fallback-only path), letting the citizen drag the pin freely. Save `locationSource: "gps"|"manual"` and `locationAccuracyM` per `DATA_MODEL.md` — display a small "Using your current location" / "Location set manually" confirmation label so it's never ambiguous which was used. See `DESIGN.md §8` for the full UI spec.
- [ ] PWA setup: manifest, service worker, IndexedDB submission queue for offline capability — test this by actually toggling airplane mode, not just reading the code
- [x] Public feed page with upvote — includes `GET /api/problems/:id`, `PATCH`, and rate-limited `POST /api/problems/:id/upvote`
- [x] The duplicate-detected UI moment — per `DESIGN.md §7`, this deserves a deliberate transition, it's your best demo beat

## Day 8 — Admin dashboard

- [ ] `GET /api/admin/stats` and `GET /api/admin/heatmap` implemented
- [ ] MapLibre heatmap rendering real submitted-problem coordinates
- [ ] Category breakdown chart, institution activity table
- [ ] This is the module that shows off the all-India scope decision — make sure the map convincingly shows spread across multiple states, not just Jharkhand

## Day 9 — University + Industry flows (simple, per PRD scope)

- [ ] University: institution queue view, claim action, basic status update — no approval workflow, no versioning. The claim route does three writes and the completion route does one `$inc -1`, both spelled out in `API_SPEC.md`; skipping the `activeProjectCount` bookkeeping leaves the Day 3-5 routing penalty permanently zero and it will look like it works
- [ ] Industry: browse claimed projects, pledge form
- [ ] Full integration pass — click through every flow end to end as if you were each of the four roles, fix what breaks
- [ ] QA pass, ideally by a teammate who hasn't been staring at the code

## Day 10 — Rehearsal, not code

- [ ] Do not add new features today
- [ ] Rehearse the demo script against the actual deployed app, not localhost
- [ ] Record a 2-minute backup video in case live demo connectivity fails
- [ ] Prepare honest one-liners for the known limitations (§9 of `ARCHITECTURE.md`) so nobody freezes if a judge asks

---

## Non-negotiable checkpoints

- After Day 5: the AI engine must have real accuracy/F1 numbers written down before you touch any UI. If it doesn't work well, it's cheaper to fix now than after three more days of UI built on top of it.
- After Day 7: the full citizen submission → dedup → routing loop must work end to end in the deployed app, not just locally.
- Day 10 is protected. Do not let feature work bleed into it.
