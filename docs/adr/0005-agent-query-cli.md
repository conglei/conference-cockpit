# ADR-0005 — Agent reads the graph via a scoped, read-only query CLI (not MCP, not raw SQL)

Status: accepted

## Context

The agent (Claude Code) needs to explore the conference graph to curate — "people
in healthcare speaking on Day 3", "remote founding-eng roles", etc. Three ways to
give it that access were considered:

1. **Fixed verb skills/CLIs only** (`who-to-meet`, `conf-brief`): safe and easy,
   but inflexible — the agent can only ask the questions we pre-baked.
2. **An MCP server**: flexible, but adds a server, a protocol, and a dependency to
   maintain for a project whose agent surface is Claude Code in the repo already.
3. **Raw SQL** (`sqlite3` / a `run_sql` tool): maximally flexible, but two
   footguns — accidental writes, and unbounded `SELECT *` dumping the table into
   the agent's context (token cost).

Two hard constraints shape the choice: the agent must not be able to **corrupt
data**, and retrieval must stay **cheap** (no bulk data through the model). Per
ADR-0002, judgment lives in skills; mechanics in CLIs.

## Decision

Add **one scoped, read-only query CLI** — `pnpm query` (`src/query` + `scripts/query.ts`) —
alongside the existing judgment skills. **No MCP. No raw-SQL surface for the agent.**

- **Read primitives, not intelligence.** `search{people,companies,roles}` return a
  **compact, projected, capped** envelope (`{ total, nextCursor, items }`);
  `get <entity> <id|slug>` returns the rich detail (with provenance) for the few
  the agent shortlists; `verticals` is a facet for cheap narrowing. The agent does
  the ranking/curation — we serve trustworthy data and it decides.
- **The funnel keeps it cheap.** Coarse, projected search → narrow → `get` detail
  on ~the shortlist. A query returns ≤ `MAX_LIMIT` (50) rows of minimal fields,
  never the table, never full bios/descriptions in a list.
- **Read-only at the seam.** The CLI opens the DB with `createReadOnlyDb`, which
  wraps the connection in a Proxy that throws on every mutating Drizzle method
  (`insert` / `update` / `delete` / `run` / `batch` / `transaction`) while passing
  reads through. The query module only ever reads, so exploration cannot drive a
  write. (libSQL has no connection-level read-only flag, so this is enforced at
  the application seam rather than the transport — unlike the original
  `better-sqlite3 { readonly: true }`. In the cloud, pair it with a read-only
  Turso token for a second, transport-level line of defense.)
- **Writes stay on narrow, deliberate verbs.** Saving / met-logging is
  `conf-followup target | met` (single-person, never bulk-destructive). There is
  no general update/delete surface, and — per the standing rule — **no send path**.

## Consequences

- The agent gets flexible exploration without the ability to write, drop, or
  dump. Safe-by-default; the cheap path is the easy path.
- No new server/daemon/dependency; `pnpm query --json` is just another CLI Claude
  Code already knows how to run.
- If a hosted (Claude Desktop/web, no shell) surface is ever needed, an MCP can
  wrap these same `src/query` primitives — the boundary (decisions to the agent,
  scoped read-only data + narrow writes from us) carries over unchanged.
- A raw read-only SQL escape hatch is deliberately **out of scope** for now; revisit
  only if the fixed filters prove too limiting in practice.
