---
name: who-to-meet
description: "Assemble a people-level hit list for a conference — the specific speakers/attendees worth meeting across your target companies, each with their talk slot and a warm-path note. Use when the user wants names and where to find them rather than a company ranking."
---

# Skill: `who-to-meet`

The **people view** of the plan. `plan-conference` ranks companies; this answers
"so *who* do I actually walk up to, and where will they be?" It reads the same
plan — no separate ranking — and flattens the nested `whoToMeet` into a single
prioritized people list.

## Run it

The data already exists in the plan; pull it structured and assemble:

```bash
pnpm conf-plan --json        # whoToMeet[] is nested under each company
pnpm conf-brief <slug> --json # the people for one target company
```

From the JSON, build the hit list (judgment):

1. **Speakers first.** Anyone with `speaking: true` has a fixed time/room and a
   built-in opener ("caught your talk") — these are the cheapest, warmest
   approaches. List them with `talk.day / time / room`.
2. **Then by connection.** Lower `connectionDegree` = warmer; surface 1st/2nd
   degree before cold contacts.
3. **Tie to the company's why.** For each person, one line on why their company is
   a target (from the plan's why-line) so the user knows what to talk about.
4. **Provenance.** Each person carries a `provenance` (the AIE directory + "as
   of"); if a detail is stale, flag it rather than presenting it as current.

Aim for a **~12-person walkable list**, grouped by day/track so the user can plan
their floor route around talk times.

## What it does NOT do

- No ranking of its own (it reuses the plan), no outreach (that's
  `draft-outreach` / `met-log`), no proximity/live features (out of MVP scope —
  reverse-lookup only; see `docs/product-design.md` §9).

## Implementation map

| Step | Code | CLI |
| --- | --- | --- |
| Nested people + talk slots | `src/plan/career-mover.ts` (`buildPlanned` → `whoToMeet`) | `pnpm conf-plan --json` |
| Talk slots | `src/db/talk-repository.ts` (`bySpeaker`) | — |
