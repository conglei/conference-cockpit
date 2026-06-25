# ADR 0004 — People-first atom + the scratchpad/intent input model

Status: Accepted
Date: 2026-06-25

## Context

The product's Job-To-Be-Done is *"tell me **who** to meet, what to attend, and how
to approach them"* (product-design.md §JTBD), and every persona's win condition is
phrased as meeting **people** — investors, engineers, buyers, peers,
decision-makers. Yet the shipped plan engine's atomic output unit is the
**company**: `buildPlan` ranks companies (`PlannedCompany`) and *nests* people
underneath as a "who-to-meet" warm path. The `Lens` seam in
[`src/plan/types.ts`](../../src/plan/types.ts) is hard-coded company-shaped
(`scoreCompany(company)` → `PlannedCompany`; `PlanGraph` is indexed by company).

This was a deliberate **beachhead shortcut** for the Career Mover lens, taken in
part because per-person data was thin — there was little to score a person *on*.
That constraint is now gone: people carry deep profiles (`work_history`,
`education`, `headline`, `about`, bios, and 128-dim speaker embeddings). Scoring a
person directly is now viable, and the company-first atom actively buries the
action the user actually takes at a conference (meeting a person in a room).

Separately, the input layer is two rigid, job-search-shaped files
(`profile/preferences.md` + `profile/resume.md`). That does not generalize to the
other personas (Recruiter, Founder, Investor, Seller, Learner), each of whom needs
to declare a *different goal* and *different context*.

## Decision

1. **The Person is the atomic output unit.** A plan is a ranked list of
   **PlannedPerson** — a person plus the context to act: their company (as an
   *attribute*), their talk slot (when/where to catch them), the *why-meet*, the
   *warm path*, and a copy-ready opener. The **Company demotes to an attribute of
   a person and a filter/grouping dimension** — never the atom.

2. **A Lens is an objective over people, not companies.** The lens scores and
   shapes *people* for one intent (`scorePerson` / `buildPlannedPerson`),
   composing the now-populated signals: topical match (embeddings + talk track),
   pedigree (`work_history` / `education`), warm path (connection degree + shared
   employer/school), reachability (is the person speaking, and when), and role
   fit. The company-shaped `Lens` interface in `src/plan/types.ts` is **superseded**
   by this ADR.

3. **The input layer is a Scratchpad.** A free-form surface the user dumps context
   into; the agent ingests it into structured **slots**: *Who I am*, *What I want*
   (the **Intent**), *Constraints*, *Watchlist*, *Anti-targets*, *Network*, and
   *Encounters*. The Intent is the ranking objective; the other slots feed warm
   paths, exclusion, logistics, and openers.

4. **Personas are intents over one shared people graph**, not separate apps. Career
   Mover, Recruiter, Founder, Investor, Seller, and Learner differ only in their
   Intent and a few specialized slot fields — they reuse the same graph, slots, and
   person-scoring engine. (This makes concrete the product-design lens vocabulary
   Job hunt / Hire / Raise / Sell / Learn.)

5. **Consistent with ADR-0002.** Ingesting a free-form scratchpad into structured
   intent + slots is the **skill / judgment** layer; person-scoring and plan
   rendering remain **deterministic CLIs**. The pivot does not move judgment into
   the CLIs.

## Considered options

- **Keep company-first, people stay nested.** Rejected: contradicts the JTBD and
  buries the atomic action (meeting a person) one level down.
- **Dual atom (rank people *and* companies as co-equal units).** Rejected: two
  engines and an ambiguous "primary" view; company is better expressed as an
  attribute/grouping of the person.
- **Keep the rigid `preferences.md` + `resume.md` input.** Rejected: it encodes one
  persona (job search) and cannot express another persona's goal/context.

## Consequences

- `src/plan` is reshaped person-centric: a `PlannedPerson` atom, a person-indexed
  `PlanGraph`, and `scorePerson` / `buildPlannedPerson` on the `Lens`. The existing
  company-first code stays until the people-first lens lands — **no big-bang**.
- The `who-to-meet` skill becomes the primary doorway; `plan-conference`'s company
  ranking becomes a *grouping view* over ranked people, not the headline output.
- `profile/` grows beyond `preferences.md` + `resume.md` into a scratchpad/intent
  model (the slots above).
- Docs to update when the lens lands: the "company-first beachhead" framing in
  product-design.md and the `Lens` seam comment in `src/plan/types.ts`.
