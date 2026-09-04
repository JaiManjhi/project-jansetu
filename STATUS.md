# JanSetu — build status

**Live:** https://project-jansetu.vercel.app
**Source:** https://github.com/JaiManjhi/project-jansetu
**As of:** 4 Sep 2026 · 35 commits · 15/15 tests passing

A citizen reports a local problem. The system classifies it, checks whether
someone already reported it, and routes it to the university department best
equipped to work on it. Industry partners then pledge support.

---

## How to test it

Start as a citizen — no login needed, and it is the flow that matters most.

**Citizen** (no login)
1. Report a real problem near you — use the microphone, it transcribes in ~2s
2. Attach a photo from your camera **or** your gallery
3. Check the result: category, severity, and three institutions with reasons
4. Submit the *same problem in different words* — it should merge, not duplicate
5. Open the Feed and add support to someone else's report

**University** (NIT Jamshedpur coordinator)
1. See problems routed to your departments, with match score and written reason
2. Claim one — it leaves every other institution's queue
3. Move it Claimed → In progress → Completed, and post an update

**Industry** (CSR partner)
1. Browse projects universities have claimed
2. Offer support: mentorship, funding or prototyping
3. Pledges are intentions only — no money moves through the platform

**Admin** (state administrator)
1. National overview: totals, duplicates merged, anything awaiting review
2. Heatmap of where problems are being reported
3. Breakdowns by category and state, plus institution coverage

> **Logins:** there is no public sign-up — accounts are pre-provisioned on
> purpose, so nobody can register as a university and start claiming problems.
> Ask Jai for the three test passwords directly. They are deliberately not
> written down here or in the repo.

---

## Measured, not claimed

| Figure | Value | Note |
|---|---|---|
| Classification accuracy | **86.7%** | target was 80%, scored on 150 hand-labelled problems |
| Duplicate detection F1 | **0.955** | target was 0.90 |
| Report to routed, end to end | **~6s** | measured in production |
| Speech to text | **2.4s** | Whisper, verified live |
| Institutions loaded | **299** | 11 states, 584 departments, all embedded |
| Reports seeded | **16** | 9 districts · 10 routed · 1 claimed · 1 merged |

---

## The bug worth knowing about

Routing was quietly broken until 3 Sep. Institutions with no published research
profile carried a placeholder line where their expertise should be — and
identical generic text sits close to *everything* in the model's view. 126 of
the 218 described departments shared just three such lines, and they were
outranking the ~92 departments describing real research.

| Problem | Was routed to | Now |
|---|---|---|
| Broken hand pump, Ranchi | Pharmacy college, 160 km away, another state | Not routed — refuses to guess |
| Health centre with no doctor | A different pharmacy college | Not routed — refuses to guess |
| Coal dust, Dhanbad | IIT (ISM) Dhanbad — Environmental Science | Unchanged, still correct |
| Steel slag dumping, Jamshedpur | — | NIT Jamshedpur — Metallurgy, slag recycling |

**The important part:** the system now refuses to route when nothing scores well
enough, instead of inventing a confident answer. Four of the fifteen seeded
problems are deliberately unrouted. If a judge asks "what happens when you don't
know?", that is the answer.

---

## Built and working

All verified against the live deployment, not just locally.

- **Citizen reporting** — text or voice, GPS or map pin, photo upload, works
  offline and submits when the connection returns. Installable on a phone.
- **Voice input** — records on the phone, transcribes server-side. The browser's
  own speech API was removed; it does not work reliably on Android or iOS.
- **AI engine** — classification, deduplication and routing, each measured
  against an evaluation set. Every routing result carries a written reason.
- **Public feed** — browse by category, add support, follow your own submission.
- **All four dashboards** — claim, project status updates, pledges, heatmap,
  analytics.
- **Security** — every route checks permissions server-side, rate limits on all
  three public endpoints, one university cannot touch another's claims.
- **Deployed** — Vercel with automatic deployment from GitHub. Database, AI
  providers, image hosting and maps all verified in production.

---

## Known limits — say these out loud

Better admitted than discovered by a judge.

- **Routing is weak on generic infrastructure.** Broken solar street lights
  currently route to a *Biotechnology* department. Problems with distinctive
  vocabulary — mining, metallurgy, water, agriculture — route very well.
  Generic ones do not. The fix is known and unbuilt: blend keyword matching with
  the current meaning-based search.
- **Institution data quality varies.** 299 loaded, but only ~92 departments
  publish real research detail. The system handles that honestly now, but better
  data would immediately improve routing.
- **Free-tier AI quotas.** Heavy repeated testing can hit a rate limit for a few
  minutes. Fine for a demo; a real deployment needs paid keys.
- **Seeded data is Jharkhand only.** The heatmap shows one state. Institutions
  cover 11 states, so wider seeding is possible.
- **No institution self-sign-up.** Deliberate. Real onboarding needs domain
  verification, otherwise anyone could register as a university and claim civic
  problems. Scoped, not built.

---

## What's left

Four of the six remaining tasks are demo rehearsal. Nothing structural.

- **Test it and report back** — the main ask. Try to break it: odd phrasing,
  Hindi, a very short report, a very long one, bad GPS, no network. Tell Jai
  exactly what you did and what happened.
- **Rehearse against the live URL**, not localhost — full loop, timed.
- **Record a 2-minute backup video** in case venue connectivity fails.
- **Prepare one honest sentence** for each known limit above.
- *Maybe:* hybrid retrieval for routing — the real fix, but a new feature.
- *Maybe:* seed more states so the heatmap looks national. Costs AI quota.
