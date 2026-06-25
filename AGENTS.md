# Job Search Cockpit

A local-only, private tool for running a taste-driven job search: a Claude Code project (skills + TypeScript CLIs) plus a local Next.js triage dashboard, sharing one SQLite store.

## Agent skills

### Cockpit skills

The runnable cockpit skills (`onboard`, `source-companies`, `enrich-company`, `enrich-person`, `find-jobs`, `score-companies`, `find-referrers`, `track`, `daily`, `reach-out`) live as Claude Code Agent Skills in `.claude/skills/<name>/SKILL.md` — discoverable and auto-invocable via their `description` frontmatter, or runnable by a human with `/<name>`.

### Issue tracker

Issues and PRDs live as local markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles with default strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
