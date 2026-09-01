# Agent Instructions — JanSetu

You are building JanSetu (SIH26043 — Societal Innovation Collaboration Portal). This file is your entry point. Read the referenced doc before touching anything it governs — do not guess field names, route shapes, or prompts when a doc already specifies them exactly.

## Doc map — which file governs what

| If you're about to... | Read first |
|---|---|
| Add or change a database field | `DATA_MODEL.md` — this is the single source of truth, never invent a field name |
| Add or change an API route | `API_SPEC.md` |
| Touch anything AI-related (classify, embed, dedup, match) | `AI_ENGINE.md` — the prompts there are exact, don't paraphrase them |
| Build any UI screen | `DESIGN.md` — tokens, spacing, banned patterns |
| Decide what's in scope right now | `PRD.md §5` and `TASKS.md` for the current day |
| Set up an account or env var | `SETUP.md` |

## Working order

Follow `TASKS.md` sequentially, day by day. Do not skip ahead to a later day's feature because it seems easy — the dependency order exists because later modules assume earlier ones are tested and working.

## Coding conventions

- TypeScript strict mode. No `any` — if a type is genuinely unknown, use `unknown` and narrow it.
- Server-side validation with Zod on every API route, even ones with client-side validation too — never trust the client.
- Every API route checks auth/role server-side, per `API_SPEC.md` — do not rely on hiding a button client-side as the only protection.
- Field names in code must match `DATA_MODEL.md` exactly, including casing. If you think a name should change, update `DATA_MODEL.md` first, then propagate — never let code and docs drift.
- Commit in small, working increments. A commit should leave the app in a runnable state.
- When a prompt string is specified exactly in `AI_ENGINE.md`, copy it verbatim into code. Do not "improve" the wording without updating the doc to match — the doc and the code must stay identical.

## When something in these docs seems wrong or incomplete

Flag it plainly rather than silently working around it. This project is being built by one developer without a second reviewer, so an AI agent noticing "this threshold seems off" or "this route is missing an error case" and saying so explicitly is more valuable than quietly patching around a gap.

## What NOT to build right now

Anything listed under "Explicitly roadmap" in `PRD.md §5`. If a feature isn't in `TASKS.md` for the current day, it isn't in scope yet — resist adding it even if it seems quick, because quick features are exactly what causes solo-build scope creep.
