# ADR 0002 — Skills vs CLIs: where adaptation and judgment live

Status: Accepted
Date: 2026-06-23

## Context

Conference Compass is a Claude Code project. The work is done by a set of
**skills** — Claude Code Agent Skills at `.claude/skills/<name>/SKILL.md` — that an
**agent invokes, or a human runs manually**. Skills call deterministic
TypeScript **CLIs** (e.g. `pnpm import-csv`, `pnpm resolve`) for mechanical work.

We observed a failure mode: an agent implementing CSV import baked an
input-adaptation heuristic — a dictionary of "known" header keywords
(`"round type"`, `"lead investor"`, `"work type"`…) that scores columns and
*guesses* the mapping — directly into a CLI (`src/import/column-mapping.ts`).
This is brittle (it silently mis-maps any CSV whose vocabulary it didn't
anticipate) and it puts judgment in the wrong layer. The root cause was that the
division of responsibility between skills and CLIs was never written down: the
PRD lists skill *names* but not the *principle*. This ADR fixes that.

## Decision

The system has two layers with a hard boundary between them.

### 1. Skills — the agentic / exploratory layer

- Live as **Claude Code Agent Skills** at `.claude/skills/<name>/SKILL.md`, each
  with `name` + `description` frontmatter so Claude auto-discovers them. The
  `description` is what makes a skill discoverable and auto-invocable; a human
  can also run one explicitly with `/<name>`.
- Invokable **two ways, by the same doc**: an agent in a loop, or a human
  running the steps manually. The doc reads as a runbook either way —
  deterministic steps are shown as exact CLI commands; judgment steps are
  written as "you (Claude, or you the human) do X."
- This is where **adaptation and judgment live**. A skill inspects messy,
  varied, real-world input (an arbitrary CSV, a scraped page, a job listing),
  reasons about what it means, and — when the situation is novel — **writes a
  one-off transform/mapping for that specific input** before handing clean,
  explicit data to a CLI.
- A skill encodes **constraints and invariants**, not a fixed catalogue of
  inputs: the canonical identity rule (domain OR linkedin_url), the funnel
  statuses, idempotency, which fields exist — and how to think about mapping an
  unfamiliar shape onto them.

### 2. CLIs — the deterministic primitive layer

- Live in `scripts/` (entry) + `src/` (logic), run via `tsx` (`pnpm <cmd>`).
- **No LLM, no guessing.** They take **explicit, already-normalized inputs** —
  or an explicit mapping/transform spec the skill produced — and do mechanical,
  repeatable work: parse, apply-the-given-mapping, resolve, dedupe, insert,
  query. Fully unit-testable.
- A CLI **may** accept a declarative mapping/transform supplied by the skill. A
  CLI **must not** embed a dictionary of "known" column names or file shapes as
  its intelligence. Exact 1:1 passthrough (a header that already equals a
  canonical field name) is fine; anything requiring interpretation is the
  skill's job.

### The rule

> Adapting to arbitrary or messy input shapes is the **skill's** job, performed
> at runtime by reasoning. It is never a heuristic baked into a CLI. Every
> agentic slice ships a **skill doc**, even when it also ships a CLI — the CLI is
> what the skill calls; the skill is where adaptation and judgment live.

### Testing

Test the deterministic primitives: given inputs (and a given mapping) → assert
outputs, dedupe behavior, idempotency, funnel transitions — against
`FakeProvider` + a temp DB (per the PRD's testing seam). Do **not** try to
unit-test the agent's judgment; the skill doc + fixtures are that seam.

## Consequences

- Each agentic slice = **a skill doc + thin CLIs**:
  `source-companies`, `enrich-company` / `enrich-person`, `find-jobs`,
  `find-referrers`, `reach-out`, `track`, `daily`.
- The CSV importer carries **no header dictionary**. The `source-companies`
  skill inspects each file and produces the mapping (a `{from, transform}` spec
  the importer applies); the importer is a thin parse → map → resolve → dedupe →
  insert primitive.
- `.claude/skills/onboard/SKILL.md` (from issue 10) is the **canonical example**:
  deterministic pieces are CLIs (`pnpm onboard`, `pnpm env:check`); the
  interview — the judgment — is conducted conversationally and the doc serves
  agent and human alike.

## Out of scope

- This ADR governs the agentic skills, not the repo's meta-skills (issue
  tracker, triage labels, domain docs) documented in `AGENTS.md`.
