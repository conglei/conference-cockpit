---
name: onboard
description: "Set up a user before they plan a conference — capture their résumé + goals into the portable taste profile (profile/preferences.md + narrative.md + resume.md) so the engine ranks to THEIR taste, then point them at the rest of the toolkit. Use when someone says 'help me get started / set this up / personalize the ranking', pastes a résumé, or wants results tuned to them rather than the neutral default."
---

# Skill: `onboard`

The **front door.** Conference Compass ranks against a *goal profile* — plain
markdown the engine reads. This skill gathers that profile from the user (who
they are + what they want) and writes it, so every other skill ranks to *their*
taste instead of the neutral default. It also orients them to what they can do
next.

Per [ADR-0002](../../../docs/adr/0002-skills-vs-clis.md) the **judgment is this
runbook**; the deterministic pieces (ingest résumé, scaffold the files, ensure
the DB) live in `pnpm onboard`. Your job is to *interview* and *fill the files
in* — not to re-implement the machinery.

> **Onboarding is optional.** The demo already ranks (neutrally, from public
> facts) with zero setup. Run this only to *personalize* — to rank by the user's
> founder bar, domain, stage, etc. Never gate the demo behind it.

## When to run

- "Help me set this up" / "get started" / "personalize the ranking."
- The user pastes a résumé, or wants results tuned to them (not the neutral demo).
- Their taste shifted and the ranking should reflect a new goal.

## The profile you're producing (3 files, all under `profile/`, gitignored)

| File | What it holds | Read by |
| --- | --- | --- |
| `resume.md` | the résumé, verbatim | opener drafting, narrative |
| `preferences.md` | taste **weights** + hard **pre-filters** | the scorer (ranking) |
| `narrative.md` | "who I am / what I'm optimizing for" | openers + why-lines |

## Steps

### 1. Run the machinery (idempotent)

```bash
pnpm onboard --resume path/to/resume.txt   # ingest a résumé file
cat resume.txt | pnpm onboard --resume -    # …or pipe it
pnpm onboard                                # no résumé — scaffold only
```

This writes `resume.md` (if given), scaffolds `preferences.md` + `narrative.md`
from templates (kept if they already exist), and ensures the DB is migrated. If
the user has no résumé handy, skip the flag and interview from scratch.

### 2. Interview, then fill in the files

Ask conversationally, then **edit `profile/preferences.md` and
`profile/narrative.md`** to replace the template placeholders with the user's
real answers. Cover:

- **The bet** — one or two sentences on what they're optimizing for (→ both files).
- **Taste weights** — which axes drive the ranking, in plain words. The scorer
  reads five axes; set each to an emphasis word (`high` / `medium` / `low` /
  `ignore`):
  - `founder_quality` · `investor_quality` · `domain_fit` · `stage_fit` · `size_fit`
  - (Default stance: founder & investor quality co-dominant; the rest break ties.)
- **Hard pre-filters** — `Stage`, `Location / work type`, `Category`, `Company
  size band`. These drop rows *before* scoring, so keep them honest and loose
  unless the user is sure.
- **Deal-breakers / nice-to-haves** — automatic passes and soft positives.
- **Narrative** — who they are, 2–4 things they've built, what they want next,
  and the **tone** for outreach (cold founder note vs. warm referral ask).

Write in plain language — no code, no JSON. `loadGoalProfile` re-reads these
files on every run, so edits take effect immediately.

### 3. Hand off to the rest of the toolkit

Once the profile is written, the ranking is now theirs. Point them on:

- **`plan-conference`** (`pnpm conf-plan`) — the ranked ~8-company plan.
- **`who-to-meet`** (`pnpm who-to-meet`) — a people-first hit list.
- **`company-brief`** (`pnpm conf-brief <slug>`) — one company, deep + sourced.
- **`draft-outreach`** — a personalized, copy-ready draft (never sends).
- **`met-log`** (`pnpm conf-followup`) — log who you met, track outcomes.

A good close: *"Your taste is set — run `/plan-conference` to see who to meet."*

## Guardrails

- **One lens today: Career Mover** (job-seeker, company-first). Don't promise a
  lens that isn't in `LENSES` (`src/plan`).
- **Privacy.** `profile/` is gitignored and personal — never commit it, never
  paste it anywhere external. The résumé is ingested locally only.
- **Don't seed data here.** The AIE 2026 demo is already seeded; importing a
  *different* conference is a separate, explicit step (see the README's "Bring
  your own conference").
