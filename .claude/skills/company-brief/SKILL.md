---
name: company-brief
description: "Produce a single company's sourced conference brief — fit thesis, funding, open roles, who to meet (speakers + talk slots), and a draft opener, every claim stamped with source + 'as of' date. Use when the user zooms into one company from their plan."
---

# Skill: `company-brief`

The **zoom-in**: once `plan-conference` surfaces the shortlist, this gives one
company the full, sourced treatment so the user can decide whether to spend
relationship energy there.

The engine is shared with `plan-conference` — same lens shaping, one company — so
the brief is **consistent** with the plan's ranking and provenance. The judgment
here is reading the brief *for the user*: what's the real reason to go, and how
trustworthy is each claim.

## Run it

```bash
pnpm conf-brief <company-slug>          # human-readable brief
pnpm conf-brief <company-slug> --json   # structured (claims carry provenance)
```

Find the slug from the plan output or `pnpm conf-plan --json`. The brief returns
the fit-led why-line, **claims** (`source · as of`), **who to meet** (speakers
first, with talk day/time/room), **talks**, **open roles** (with links), and a
**draft opener**.

## Explain it (the judgment)

- **State the thesis in one line**, then the *one* fact that makes it urgent —
  and if that fact is thin (`date unknown` / stale), say so plainly.
- **Surface the warm path**: if someone from the company is speaking, that's the
  cheapest way in — point at the talk slot.
- **Opener = draft.** Hand it over for the user to rewrite; never send.

## What it does NOT do

- No enrichment (fill gaps via the enrichment skills), no scoring (that's
  `score-companies`), no sending (that's `draft-outreach` / `met-log`).

## Implementation map

| Step | Code | CLI |
| --- | --- | --- |
| Single-company shaping | `src/plan/career-mover.ts` (`buildPlanned`) | `pnpm conf-brief <slug>` |
| Lookup + graph | `src/db/repository.ts` (`getBySlug`), `src/plan/plan.ts` (`loadGraph`) | — |
| Provenance chips | `src/provenance` (`formatChip`) | rendered inline |
