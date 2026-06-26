/**
 * Ingest a `ConnectionSource` (the user's 1st-degree graph) into `people`
 * (issue 06).
 *
 * Each `Connection` becomes — or updates — a `people` row with
 * `relationship: network_contact` and `connection_degree: 1`. This is the raw
 * personal network; the company cross-reference (cross-reference.ts) later flags
 * which of these contacts can give a warm intro into a target company.
 *
 * Deterministic primitive (ADR-0002): no guessing, no network. Idempotent —
 * re-ingesting the same export creates no duplicates:
 *   - a contact with a LinkedIn URL dedupes on that URL (the canonical identity);
 *   - a contact without one dedupes on a stable name-based slug.
 */

import type { PersonRepo } from "../db/people-repository";
import type { Person } from "../db/schema";
import type { Connection, ConnectionSource } from "./connection-source";

export type IngestOutcome =
  | { kind: "inserted"; person: Person }
  | { kind: "updated"; person: Person }
  | { kind: "skipped"; reason: string };

export interface IngestResult {
  inserted: number;
  updated: number;
  skipped: number;
  outcomes: IngestOutcome[];
}

/** Ingest all contacts a source yields. */
export async function ingestConnections(
  repo: PersonRepo,
  source: ConnectionSource,
): Promise<IngestResult> {
  const outcomes: IngestOutcome[] = [];
  for (const conn of source.read()) {
    outcomes.push(await ingestOne(repo, conn));
  }
  return tally(outcomes);
}

/** Ingest a single contact (exported for focused tests). */
export async function ingestOne(repo: PersonRepo, conn: Connection): Promise<IngestOutcome> {
  const name = conn.name.trim();
  if (!name) return { kind: "skipped", reason: "contact has no name" };

  // Dedupe identity: LinkedIn URL first (canonical), else a stable name slug.
  const existing = conn.linkedinUrl
    ? await repo.getByLinkedinUrl(conn.linkedinUrl)
    : await repo.getBySlug(slugify(name));

  if (existing) {
    // Promote to a 1st-degree network contact and backfill what the export
    // tells us, without clobbering a stronger existing relationship's fields.
    const person = await repo.update(existing.id, {
      relationship: "network_contact",
      connectionDegree: 1,
      linkedinUrl: existing.linkedinUrl ?? conn.linkedinUrl ?? null,
      title: existing.title ?? conn.title ?? null,
    });
    return { kind: "updated", person: person ?? existing };
  }

  const person = await repo.create({
    slug: await uniqueSlug(repo, name),
    name,
    relationship: "network_contact",
    connectionDegree: 1,
    linkedinUrl: conn.linkedinUrl ?? null,
    title: conn.title ?? null,
  });
  return { kind: "inserted", person };
}

function tally(outcomes: IngestOutcome[]): IngestResult {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const o of outcomes) {
    if (o.kind === "inserted") inserted++;
    else if (o.kind === "updated") updated++;
    else skipped++;
  }
  return { inserted, updated, skipped, outcomes };
}

/** kebab-case slug, made unique against existing rows (ADR-0001 convention). */
async function uniqueSlug(repo: PersonRepo, name: string): Promise<string> {
  const base = slugify(name) || "contact";
  let candidate = base;
  let n = 2;
  while (await repo.getBySlug(candidate)) {
    candidate = `${base}-${n}`;
    n++;
  }
  return candidate;
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
