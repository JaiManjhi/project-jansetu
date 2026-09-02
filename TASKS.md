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

- [x] Institution ingestion — `scripts/seed-institutions.mts` parses the CSV shape, groups rows per institution, resolves district names, and upserts. **Chhattisgarh loaded: 163 institutions (3 deep, 160 shallow), 29 departments.** Remaining states drop in with the same command.
- [x] Deep institution profiles — **226 institutions across 9 states, 204 with real department/faculty research areas**, merged from seven team-supplied sources by `scripts/convert-institution-sources.mjs`. Jharkhand has 20 institutions incl. IIT (ISM) Dhanbad, NIT Jamshedpur, BIT Mesra, CUJ, BIT Sindri, CSIR-CIMFR and CSIR-NML. Exceeds the 40-60 target. **186/226 embedded — the remaining 40 are waiting on the Gemini daily quota; re-run `npm run seed:institutions -- --embed-only`.**
- [x] Build `data/districts.json` (one `{district, state, lat, lng}` per Indian district) and `lib/geo/district.ts` nearest-centroid lookup. **Done:** 788 districts, all 36 states/UTs, built by `scripts/build-districts.mts` from district boundary polygons; 8 tests in `tests/geo.test.mts`. Small, self-contained, and **blocks dedup** — dedup scopes by `district`, so until this exists every dedup query is scoped to an empty string and matches nothing. Sanity-check it with a handful of known coordinates (Ranchi, Jamshedpur, and one point deliberately near a district border) before trusting it
- [x] Run the embedding pipeline over every institution's `capabilityText` to populate `capabilityEmbedding`, **and** over each department's own text to populate `departments[].embedding` — the latter is what makes department selection and the load-balancing penalty work in Day 3-5 routing. Use the shallow-institution `capabilityText` fallback in `AI_ENGINE.md §2` for institutions with no departments; don't let them embed as a bare name
- [x] Verify vector search actually returns sane results with a manual test query — **done, and it exposed a ranking flaw**: institution-vector-only scoring put the first genuinely-capable institution at #23. Fixed via wider pool + department max-pooling; see the amendment in `AI_ENGINE.md §4`.

## Day 3-5 — AI engine (the core, per `AI_ENGINE.md`)

- [x] Implement `lib/ai/classify.ts` exactly per the prompt in `AI_ENGINE.md §1`, Groq primary / Gemini fallback, with the invalid-response retry-once logic
- [x] Implement `lib/ai/embed.ts` per `AI_ENGINE.md §2`
- [x] Implement `lib/ai/dedup.ts` per `AI_ENGINE.md §3` — log every similarity score during testing
- [x] Implement `lib/ai/match.ts` per `AI_ENGINE.md §4`, including matched-department selection (local cosine over `departments[].embedding`, no extra API call) and the reason-generation prompt with its `{departmentLine}` interpolation for both the deep and shallow cases
- [x] Wire `POST /api/problems` to run the full pipeline in sequence per `ARCHITECTURE.md §6` — note the order is **embed → dedup → classify → match**, so a duplicate costs zero LLM generation calls. Include the `{lat,lng}` → GeoJSON `[lng,lat]` conversion and the server-side district/state derivation, both flagged in `API_SPEC.md` — write specific tests for both, they're silent-failure risks
- [x] **Build the evaluation sets now, not later** (`AI_ENGINE.md §6`) — **Done 2026-09-02:** 150 labeled classification examples, 50 labeled dedup pairs. **Classification 86.7% (130/150), dedup F1 0.955** — both above the PRD §9 targets. Threshold swept 0.60-0.95; 0.82 confirmed optimal with evidence. Confusion matrix recorded; `energy` is the weakest category at 9/15.
- [x] Test the fallback path deliberately — kill the AI API keys temporarily and confirm a submission still saves with `needsReview: true` instead of failing, and that `district`/`state` are still correct (they don't depend on any AI call). Confirm the route returns `201`, not an error status

## Day 6-7 — Citizen submission flow

- [x] Build `app/(citizen)/page.tsx` per `DESIGN.md §8` — mobile-first, single column
- [x] Wire Web Speech API for voice input, with visible transcription the citizen can edit before submit
- [x] Photo upload via Cloudinary — signed direct-to-Cloudinary upload via `POST /api/media/sign`. **Verified end to end 2026-09-02:** signature issued → real upload accepted → thumbnail rendered from the returned URL → submitted report persisted with its `mediaUrls`. Test assets deleted from both Mongo and Cloudinary afterwards.
- [x] Location: request GPS immediately on this step and pre-fill the pin the moment it resolves — do not wait for a tap. Show an equally-prominent "Set location manually" option beside the auto-detected pin (Zomato/Swiggy pattern, not a fallback-only path), letting the citizen drag the pin freely. Save `locationSource: "gps"|"manual"` and `locationAccuracyM` per `DATA_MODEL.md` — display a small "Using your current location" / "Location set manually" confirmation label so it's never ambiguous which was used. See `DESIGN.md §8` for the full UI spec.
- [x] PWA setup: manifest, service worker, IndexedDB submission queue. **Round trip verified 2026-09-02:** offline submit → queued in IndexedDB → reconnect → auto-flushed with no user action → reached the server and classified. **Caveat:** offline was simulated via a navigator.onLine override, not literal airplane mode — repeat on a real device before demo day.
- [x] Public feed page with upvote — includes `GET /api/problems/:id`, `PATCH`, and rate-limited `POST /api/problems/:id/upvote`
- [x] The duplicate-detected UI moment — per `DESIGN.md §7`, this deserves a deliberate transition, it's your best demo beat

## Day 8 — Admin dashboard

- [x] `GET /api/admin/stats` and `GET /api/admin/heatmap` implemented — both admin-only, verified 401 unauthenticated
- [x] MapLibre heatmap rendering real submitted-problem coordinates — heat layer at national zoom, per-point circles above zoom 6 distinguishing GPS-verified (filled) from manually placed (hollow), per DESIGN.md §8
- [x] Category breakdown chart, institution activity table — **caveat:** the institution table renders an explicit empty state, because no institutions are seeded yet. It will rank by claimed problems once the data lands.
- [x] This is the module that shows off the all-India scope decision — 150 demo problems across **20 states/UTs** via `npm run seed:demo`, Jharkhand-weighted but visibly national

## Day 9 — University + Industry flows (simple, per PRD scope)

- [x] University: queue view, claim action, status update. **Bookkeeping verified live:** claim took activeProjectCount 0→1, completion took it 1→0, and two further saves on an already-completed project left it at 0 rather than going negative.
- [x] Industry: browse claimed projects, pledge form — verified end to end; pledge recorded and surfaced on the project. Copy states plainly that no money is taken (PRD §3).
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
