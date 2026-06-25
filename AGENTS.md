# Conference Compass

An open-source, agent-native tool that turns a conference's flat directory into a
goal-ranked, sourced plan — who to meet, why, and how to open it. A Claude Code
project (skills + TypeScript CLIs) over a small engine, plus one Next.js web view
(the showcase), sharing a SQLite store. The engine is the project; the app is the
trailer. See [`README.md`](README.md) and [`docs/product-design.md`](docs/product-design.md).

## Agent skills

### Conference skills

The user-facing skills (`plan-conference`, `who-to-meet`, `company-brief`,
`met-log`, `draft-outreach`) live as Claude Code Agent Skills in
`.claude/skills/<name>/SKILL.md` — discoverable and auto-invocable via their
`description` frontmatter, or runnable by a human with `/<name>`. Each is a thin
runbook over a deterministic CLI (`pnpm conf-plan`, `pnpm who-to-meet`,
`pnpm conf-brief`, `pnpm conf-followup`); see [ADR-0002](docs/adr/0002-skills-vs-clis.md)
for the skills-vs-CLIs split.

### Issue tracker

Issues and PRDs live as local markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles with default strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
