---
name: judge-boards
description: "Adjudicate ambiguous ATS-board matches from the roles refresh — decide which web-search candidate link is really each company's hiring board (or none). Use after `pnpm refresh-roles --gather` writes data/board-review.json, before applying decisions. This is the agent layer that web search alone can't do safely (it once matched Insomnia Cookies to Daytona)."
---

# Skill: `judge-boards`

The **agent layer over web search** (ADR-0002: mechanics in the CLI, judgment in
the agent). `refresh-roles` resolves the trustworthy tiers itself — an existing
board URL, or a probe whose token/org identifies the company. But the web-search
tier is a *guess*: searching `"Daytona" careers lever.co` once returned
`jobs.lever.co/insomniacookies` (a bakery with a Daytona Beach store) and 1,477
retail roles got attributed to an AI-infra startup. A regex can't reliably tell a
real board from a same-name collision. **You** can. That's this skill.

## The loop

1. **Gather** (mechanical): `pnpm refresh-roles --gather data/board-review.json`
   auto-applies the trusted boards and writes the unresolved companies — each with
   its web-search board candidates — to the review file.
2. **Judge** (you): read `data/board-review.json` and decide, per company, which
   candidate URL is genuinely that company's board, or `null` if none is.
3. **Apply** (mechanical): write `data/board-decisions.json`, then
   `pnpm refresh-roles --apply-decisions data/board-decisions.json` fetches +
   replaces roles from the boards you chose.

## How to judge each company

Each review entry has the company (`name`, `domain`, `description`) and
`candidates[]`, each candidate carrying `url`, `provider`, `token`, `orgName`
(Greenhouse only), `jobCount`, `sampleTitles`, and a heuristic `identity`
(`match`/`weak`). Decide with judgment, not just the heuristic:

- **Does the board belong to THIS company?** The token or `orgName` should be the
  company, an obvious abbreviation, or its product — not merely a string that
  happens to contain a shared word. `insomniacookies` for *Daytona* → no.
- **Do the `sampleTitles` fit the company's line of work?** An AI-infra company
  posting only "Assistant Manager / Shift Lead" retail titles is the wrong board,
  even if the count is high. A dev-tools company posting "Software Engineer,
  Developer Advocate" fits.
- **Is the `jobCount` plausible for the company's stage?** From the description: an
  early-stage startup with a 1,000+ board is almost always a collision or a
  scaled-enterprise namesake — distrust it.
- **`domain` is the tie-breaker.** Prefer the board the company's own site would
  link to. When two candidates both look plausible, pick the one whose token/org
  best matches the domain; if still unsure, choose `null` — a missing board is
  safer than a wrong one (it falls back to the company's existing roles).
- **When nothing fits, return `null`.** Don't force a match. The cost of a wrong
  board (polluting a company with another org's jobs) is far higher than the cost
  of no board.

## Output

Write `data/board-decisions.json`:

```json
{
  "decisions": [
    { "slug": "daytona", "url": null, "reason": "only candidate was insomniacookies (bakery); retail titles, 1477 jobs — collision" },
    { "slug": "acme-ai", "url": "https://job-boards.greenhouse.io/acmeai", "reason": "orgName 'Acme AI' matches; titles are ML/eng" }
  ]
}
```

One decision per review company. Always include a one-line `reason` — it's the
audit trail for why a board was trusted or rejected.

## Guardrails

- **Never invent a URL.** Choose only from that company's `candidates[]`, or `null`.
- The apply step re-verifies: a chosen board that 404s or returns 0 jobs is
  skipped, and high-volume boards are still filtered to engineering + product and
  capped (see `selectAtsJobs` in `scripts/refresh-roles.ts`). Your job is purely
  *which board is the company's*, not how many roles to keep.
- This skill does not touch the trusted-tier companies the CLI already applied.

## Implementation map

| Step | Code | CLI |
| --- | --- | --- |
| Gather candidates | `src/roles/ats-discovery.ts` (`gatherBoardCandidates`) | `pnpm refresh-roles --gather <file>` |
| Identity heuristic | `ats-discovery.ts` (`identityMatches`, `verifyBoardIdentity`) | — |
| Apply decisions | `scripts/refresh-roles.ts` (`applyDecisions`) | `pnpm refresh-roles --apply-decisions <file>` |
