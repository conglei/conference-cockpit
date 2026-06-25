---
name: who-to-meet
description: "Assemble a people-first hit list for a conference — the specific people worth meeting ranked directly (not gated by a company shortlist), each with why-meet, their talk slot, a warm-path note, and a draft opener. Use when the user wants names and where to find them."
---

# Skill: `who-to-meet`

The **people-first doorway** (ADR-0004). At a conference you meet *people*, so this
ranks the **person** as the atomic unit — across the whole graph, not gated by a
company shortlist — and carries the company as an attribute. This is the inverse
of the old flow (which ranked companies and nested people, so anyone at company
#9+ was invisible).

## Run it

```bash
pnpm who-to-meet                              # top 12 overall, by your taste
pnpm who-to-meet --vertical Healthcare        # scope to one vertical (AI in Healthcare, …)
pnpm who-to-meet --intent learner --vertical Healthcare  # rank by on-topic depth, not pedigree
pnpm who-to-meet --speaking                   # only people with a fixed talk slot
pnpm who-to-meet --limit 20
pnpm who-to-meet --json                       # structured PlannedPerson[] (provenance on each)
```

**Intent drives the lens** (ADR-0004). `--intent career-mover` (default) prizes the
founder-bar pedigree; `--intent learner` prizes on-topic depth + reachability (you
learn by attending the talk) and downweights ex-FAANG pedigree — so a
clinician-founder who'd rank low for a job hunt rises to the top for learning a
space. Same engine, different objective.

It ranks against `profile/preferences.md` (taste) and `profile/resume.md` (for
warm paths). Each person comes back with a **score**, a **why-meet** line, their
**talk slot** (when/where to catch them), the **warm path** in, **pedigree**
flags, and a **draft opener**.

## How a person is scored (the signals)

- **Pedigree (the founder-bar)** — *past* top-lab / big-tech employers (never the
  current one) from `work_history`; a PhD / research title from `education`; a
  founder/exec title.
- **Warm path** — connection degree, can-refer, and **shared employer/school**
  between you (resume) and the person.
- **Reachability** — speaking ⇒ a concrete time/place to meet (a boost).
- **Role fit** — technical IC / leadership (the Career Mover taste).
- **Company fit** — the employer's taste score + vertical match, as a *feature*,
  not a gate.

## Curate + explain (judgment)

The CLI ranks; you make it land:

1. **Group by day/track** so the user can plan a floor route around talk times —
   aim for a **~12-person walkable list**.
2. **Lead with the why-meet**, and read provenance honestly — if a profile detail
   is stale, flag it rather than presenting it as current.
3. **Mind the lens.** Ranking is the Career Mover taste (founder-bar dominant), so
   it can *underrate* domain-deep people without big-tech pedigree (e.g. a
   clinician-founder in healthcare). Say so, and surface them anyway when the
   user's real intent is "learn the space."
4. **Openers are drafts** the user rewrites — never send (that's `draft-outreach`).

## What it does NOT do

- No outreach (that's `draft-outreach` / `met-log`), no proximity/live features
  (reverse-lookup only; see `docs/product-design.md` §9).
- It does not re-enrich — it ranks what's in the graph (run the enrich passes
  first: `enrich-people`, `roll-up-verticals`).

## Implementation map

| Step | Code | CLI |
| --- | --- | --- |
| Person scorer + ranker | `src/plan/who-to-meet.ts` (`scorePerson`, `rankPeople`) | `pnpm who-to-meet` |
| The atom | `src/plan/types.ts` (`PlannedPerson`) | — |
| Taste + warm-path inputs | `src/plan/profile.ts` (`loadGoalProfile`) · `extractBackground` | reads `profile/*.md` |
