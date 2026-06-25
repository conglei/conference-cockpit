---
name: met-log
description: "Log who you met at the conference and advance the follow-up funnel (met → contacted → replied), then surface the week-after queue of people who still owe an action. Use after an event to capture contacts and track outcomes."
---

# Skill: `met-log`

The **follow-up loop** — the "pure money" phase (product-design.md §4): the week
after the event, turn the people you met into tracked relationships so nothing
slips. Built on the drafts-only outreach primitive: this records *what happened*,
it never sends.

## When to run

- Right after a conference, to capture who you met.
- Any time, to see who you still owe a follow-up and advance outcomes.

## Run it

```bash
pnpm conf-followup met <personId> --note "talked about agent evals" --next "send the eval repo"
pnpm conf-followup list                         # the queue: who you met, status, draft, next action
pnpm conf-followup log <personId> contacted     # advance: contacted | replied | bounced
```

- **`met`** stamps `outreach_status = met` + `last_contacted_at` and records your
  next step. It never regresses someone you've already contacted/replied with.
- **`list`** is the queue — everyone still "open" (met / drafted / contacted),
  newest-touched first, each with their company and a draft suggestion.
- **`log`** advances the funnel as replies come in.

## The judgment

- Find the `personId` from the plan (`pnpm conf-plan --json`) or
  `pnpm conf-brief <slug> --json` — the people you targeted are already in the
  graph.
- When reviewing the queue, prioritize by who you said you'd do something for and
  by freshness; flag anyone you met but never followed up.
- Outcomes only — **never send**. Drafting the message is `draft-outreach`;
  sending is the user's manual step.

## What it does NOT do

- No sending (no email/LinkedIn/API path anywhere). No enrichment. No mass-blast.

## Implementation map

| Step | Code | CLI |
| --- | --- | --- |
| Log met / queue / drafts | `src/followup/index.ts` (`logMet`, `followupQueue`) | `pnpm conf-followup met` / `list` |
| Advance outcome | `src/outreach/log-outreach.ts` (`logOutreach`) | `pnpm conf-followup log` |
