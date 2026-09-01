# JanSetu — SIH26043 Project Documentation

**App name:** JanSetu (Hindi: "people's bridge" — the platform bridging citizens, universities, and industry).

**Problem Statement:** SIH26043 — Societal Innovation Collaboration Portal
**Sponsor:** Government of Jharkhand, Dept. of Higher & Technical Education
**Builder:** Solo developer, AI-assisted (Claude Code / Codex / Antigravity)
**Timeline:** 10 days
**Scope:** National (all-India institute coverage), piloted on Jharkhand data

## What this is

One sentence: citizens report real local problems, AI classifies and routes each one to the university best equipped to solve it, deduplicates repeat reports, and lets industry partners fund the resulting student projects.

## How to use this doc set

Read in this order if you're a human. If you're an AI coding agent, `CLAUDE.md` is your entry point — it tells you which doc to consult for what.

| # | File | What it answers |
|---|---|---|
| 1 | `PRD.md` | What are we building and why? What's in scope for the 10-day build vs. later? |
| 2 | `ARCHITECTURE.md` | How is the system structured? What talks to what? |
| 3 | `DESIGN.md` | What should it look and feel like? |
| 4 | `DATA_MODEL.md` | Exact database schema — collections, fields, types, indexes |
| 5 | `API_SPEC.md` | Every API route, its method, auth, request/response shape |
| 6 | `AI_ENGINE.md` | The classification/dedup/routing logic — the actual differentiator |
| 7 | `TASKS.md` | The dependency-ordered build checklist, day by day |
| 8 | `SETUP.md` | Every account, API key, and env var you need before writing code |
| 9 | `CLAUDE.md` | Entry point + coding conventions for AI coding agents |

## The one rule that keeps everything consistent

**`DATA_MODEL.md` is the single source of truth for field names.** Every other doc — API_SPEC, AI_ENGINE, TASKS — references those exact field names. If you ever need to change a field name, change it in `DATA_MODEL.md` first, then propagate. This is what stops a solo AI-assisted build from drifting into three different names for the same thing across different files.

## Current status

All docs below are the pre-build spec. Nothing has been coded yet. Start at `TASKS.md` Day 1.
