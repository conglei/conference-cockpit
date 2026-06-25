---
name: plan-conference
description: "Turn a conference's flat directory into a goal-ranked, company-first plan — ~8 target companies with a sourced why-line, who to meet (speakers + talk slots), open roles, and a draft opener. Use when someone asks who to meet / what's worth their time at a conference, or to prep for an event like AIE."
---

# Skill: `plan-conference`

The **doorway** to the conference cockpit and the product's one "aha": ask once →
a **ranked ~8-company plan** (sourced fit-thesis + who-to-meet + openers) in under
a minute, instead of scrolling a 488-name flat directory.

Per ADR-0002 the **judgment is this runbook**; the deterministic engine
(`pnpm conf-plan`, the `src/plan` lens) is the mechanical executor. Your job is to
read the user's goal, run the plan, and *curate + explain* the result — not to
re-implement ranking.

## When to run

- "Who should I meet at <conference>?" / "What's worth my time at AIE?"
- Prepping the night before an event, or re-prepping as data refreshes.
- The user wants targets, not a directory dump.

## The goal profile (judgment seam #1)

The plan ranks against the **goal profile** — `profile/preferences.md` (taste
weights + hard criteria) and, when present, `profile/narrative.md` /
`profile/resume.md` (a one-paragraph "who I am" that seeds openers). Before
running, confirm the user's lens and that the profile reflects their *current*
goal; if their taste has shifted, edit `preferences.md` in plain language first
(no code change — `loadGoalProfile` re-reads it).

The MVP populates one lens, **Career Mover** (job-seeker, company-first). The
lens *seam* is documented in `src/plan/types.ts`; a second lens (e.g. Recruiter,
people-first) is a drop-in scorer — but don't claim a lens exists that isn't in
`LENSES`.

## Run it

```bash
pnpm conf-plan                 # Career Mover, top 8, human-readable
pnpm conf-plan --limit 12      # widen the hit list
pnpm conf-plan --json          # structured plan — every claim carries provenance
```

Each company comes back with: a **fit-led why-line** (a timing clause appears
*only* when the raise is recently sourced), **claims** (funding/roles/taste
rationale) each stamped `source · as of <date>`, **who to meet** (speakers at that
company first, with talk slot), **open roles**, and a **draft opener**.

## Curate + explain (judgment seam #2)

The CLI ranks; **you** make it land for this user:

- **Lead with the why.** For each surfaced company, say in one line why it's on
  the list and read the provenance honestly — if a claim is `date unknown` or
  stale, *say so* and treat it as weak. Never dress up a thin signal (the trust
  rule; see `docs/product-design.md` §8).
- **The opener is a draft.** Present it as a starting point the user will rewrite
  in their own voice — never send anything.
- **Respect scope.** This plan is *fit-led*. If the user wants pure "who just had
  layoffs / is in trouble" timing, that's the (unbuilt) Recruiter lens — say it's
  out of scope, don't fake it.

## What this skill does NOT do

- **No outreach.** Drafting/logging contact is the `draft-outreach` / `met-log`
  skills; planning never sends.
- **No enrichment/scoring.** It ranks what's already in the graph. Filling
  founders/funding/roles is the enrichment skills; taste sub-scores come from
  `score-companies`.
- **No ranking logic in chat.** Don't hand-rank; run `conf-plan`. The engine keeps
  the scoring consistent and sourced.

## Implementation map

| Step | Code | CLI |
| --- | --- | --- |
| Goal profile | `src/plan/profile.ts` (`loadGoalProfile`) | reads `profile/*.md` |
| Lens scoring + shaping | `src/plan/career-mover.ts`, `src/plan/types.ts` (`Lens`) | — |
| Orchestrate + graph | `src/plan/plan.ts` (`buildPlan`, `loadGraph`) | `pnpm conf-plan` |
| Provenance chips | `src/provenance` (`formatChip`) | rendered inline |
