# PRD — JanSetu (SIH26043)

## 1. Problem

Citizens across India encounter real, local problems every day — a broken hand pump, an inaccessible school building, a market with no cold storage — and have no structured channel to report them to anyone capable of solving them.

Meanwhile:
- **Universities** have thousands of students needing real final-year projects and faculty with idle research expertise.
- **Industry, startups, and CSR arms** have funding earmarked for social impact and no vetted pipeline of real, local problems to back.

These three groups never connect. NEP 2020 explicitly calls for experiential learning and industry collaboration; no platform currently operationalizes that at scale.

## 2. Goal

Build a platform where a citizen-reported problem is automatically classified, deduplicated against existing reports, and routed to the university best equipped to solve it — with industry partners able to fund and mentor the resulting work.

## 3. Non-goals (explicitly out of scope for the hackathon build)

- Real payment/fund disbursement — pledges are tracked, not processed
- SAHYOG or any restricted government system integration
- Full patent-filing workflow
- Production-grade SMS delivery infrastructure (stubbed/logged, not wired to a live provider, unless time permits)
- Supporting every Indian language — see §7 language scope

## 4. Users

| Role | Who | Primary need |
|---|---|---|
| Citizen | Anyone reporting a local problem | Report easily, in their language, know what happened to it |
| University Coordinator | Faculty/admin at a university | See relevant matched problems, claim one, form a team |
| Industry Partner | CSR/startup/MSME rep | Browse claimed projects, pledge support |
| Government Admin | State Higher Ed dept official | See the state of the whole system: volume, coverage, activity |

## 5. Scope for the 10-day hackathon build

Given a single solo developer building with AI coding assistants, scope is deliberately triaged. **This section is the actual contract — build exactly this, nothing more, until it's done and tested.**

### Build to full depth
- **Citizen submission flow** — text + voice input, photo upload, location tagging, offline-capable PWA
- **AI engine** — classification, deduplication, routing with generated match reasoning (see `AI_ENGINE.md` — this is the differentiator, it gets the most time and the most testing)
- **Government Admin dashboard** — national/state heatmap, category breakdown, institution/problem stats

### Build, functional but simple
- **University claim flow** — see routed problems, claim one, mark status (no multi-step approval workflow, no document versioning)
- **Industry pledge flow** — browse claimed projects, submit a pledge (mentorship/funding/prototyping — recorded, not processed)

### Explicitly roadmap — do not build, state clearly in the pitch
- Milestone/Gantt project tracking
- Patent/IP outcome tracking
- CSR Schedule VII compliance export
- Production SMS/email notification infrastructure
- Full document upload/versioning for solution proposals

## 6. User stories & acceptance criteria

### Citizen
- **As a citizen**, I can submit a problem by speaking in Hindi or English, so that literacy isn't a barrier.
  - *Acceptance:* voice input transcribes to text with a visible confidence indicator; citizen can edit the transcription before submit.
- **As a citizen**, I can submit with no internet connection, and it sends automatically once I'm back online.
  - *Acceptance:* submission queues in local storage (IndexedDB via the PWA service worker) when offline; a visible "queued, will send" state is shown; auto-retries on reconnect.
- **As a citizen**, I can see that my problem is similar to one already reported, instead of it silently vanishing.
  - *Acceptance:* on submit, if a duplicate is detected, the citizen sees "similar to an existing report — your submission has been added as support for it" and is shown the merged problem.

### University Coordinator
- **As a coordinator**, I see problems ranked by relevance to my institution, with a reason for each match.
  - *Acceptance:* each routed problem card shows a plain-language reason string (not just a score).
- **As a coordinator**, I can claim a problem and it disappears from other institutions' unclaimed queues.
  - *Acceptance:* claiming sets `problems.status = "claimed"`; other institutions still see it in a read-only "claimed elsewhere" state, not hidden entirely (transparency).

### Industry Partner
- **As an industry partner**, I can see which claimed projects need support and pledge to help.
  - *Acceptance:* pledge form captures type (mentorship/funding/prototyping) and a free-text note; pledge appears on the project's page.

### Government Admin
- **As an admin**, I can see problem density by state/district on a map.
  - *Acceptance:* heatmap renders from real submitted-problem coordinates, filterable by category and date range.
- **As an admin**, I can see which institutions are most/least active.
  - *Acceptance:* a ranked table of institutions by claimed-problem count.

## 7. Language scope

Ship Hindi + English + one regional language chosen by whichever the developer can actually verify works (test with real speech, don't assume). State in the pitch that the architecture supports adding more via Bhashini without a redesign — do not claim broad language coverage that hasn't been tested.

**As built (2026-09-04).** Speaking: English, Hindi, Bengali, Marathi. Reading: those four plus Odia, via an on-demand translate control on every report in the feed.

Two honest caveats, in the spirit of the paragraph above:

- **Odia cannot be spoken to JanSetu**, only read. Groq's Whisper endpoint rejects `language=or` outright. Every other code here was confirmed accepted by the live API before being offered.
- **"Accepted by the transcriber" is not "verified with real speech."** Only English has been tested end to end with an actual recording. Bengali and Marathi are offered because Whisper accepts them and is documented as supporting them — say exactly that in the pitch, not more.

## 8. Geographic scope

**All-India institute coverage, tiered:**
- **Broad (shallow):** all institutions sourced from AISHE/AICTE open data — name, location, broad type. Used for national heatmap and general routing fallback.
- **Deep (rich):** 40–60 hand-curated institutions across multiple states with real department/faculty research-area profiles, used for high-quality matching and the live demo. Jharkhand institutions are prioritized in this set since the PS originates there.

State this tiering explicitly and honestly in any pitch — do not imply full national depth that wasn't built.

## 9. Success metrics (for the demo, not production)

- Classification accuracy ≥ 85% on the synthetic 150-item labeled test set (see `AI_ENGINE.md §6`)
- Deduplication F1 ≥ 0.80 on a labeled duplicate/non-duplicate test pair set
- Citizen submission to routed-match, end to end, under 5 seconds in the live demo
- Offline submission → sync round-trip demonstrably works when connectivity toggles

## 10. Constraints

- One developer, AI-assisted, 10 calendar days
- Zero budget — every service used must have a genuinely free tier
- Must run entirely on JS/TS (Next.js/Node/MongoDB) — no polyglot services, to keep solo cognitive load manageable

## 11. Risks (see `TASKS.md` for mitigation ownership)

- Dedup threshold miscalibration is the single highest-risk item for the live demo — must be tested against the real demo script before presentation day
- Free-tier API rate limits under live demo conditions — mitigate with response caching for the rehearsed demo path
- Solo developer is a single point of failure on demo day — at least one teammate must understand the architecture well enough to narrate it
