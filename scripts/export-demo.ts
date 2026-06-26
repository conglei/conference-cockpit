/**
 * One-off: export a **clean, complete** snapshot of the conference graph to
 * `seed/demo-snapshot.json`, so a fresh clone (or a deploy) can rebuild a full DB
 * with no API keys and no working `.db`.
 *
 * "Clean" (no taste, nothing tailored to one user): we DROP every `score_*`
 * field, the score rationale/verdict, `enrichment_blob`, `deep_dive_path`, the
 * raw `linkedin_profile` scrape, and the personal CRM columns
 * (connection_degree, can_refer, outreach_status, next_action*, last_contacted).
 * Ranking is NOT baked — the engine computes a neutral public-facts ranking when
 * no `profile/preferences.md` is present, and a forker's taste re-ranks it.
 *
 * "Complete" (the whole public graph): ALL companies, ALL people (with their
 * public profile — bio, photo, headline, work history, education), ALL talks,
 * and ALL roles (not just the ones at scored companies). Role descriptions are
 * truncated to keep the file reasonable.
 *
 * Run: DATABASE_URL=<abs path to conference.db> pnpm exec tsx scripts/export-demo.ts
 */
import { createClient, type Row } from "@libsql/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadEnvFile } from "../src/onboarding/load-env";
import { resolveDbUrl } from "../src/db/client";

// Honor a DATABASE_URL from .env.local (an explicit shell var still wins).
loadEnvFile();

/** Mirror the driver's URL mapping so bare paths become file: URLs. */
function toLibsqlUrl(url: string): string {
  if (url === ":memory:") return ":memory:";
  if (/^(file|libsql|https?|wss?):/.test(url)) return url;
  mkdirSync(dirname(url), { recursive: true });
  return `file:${url}`;
}

/** Convert a libsql Row into a plain object keyed by column name. */
function toPlain(row: Row): Record<string, unknown> {
  return { ...row } as Record<string, unknown>;
}

const client = createClient({
  url: toLibsqlUrl(resolveDbUrl()),
  authToken: process.env.TURSO_AUTH_TOKEN ?? process.env.LIBSQL_AUTH_TOKEN,
});

// Companies — firmographics + funding + public identity. No score_* / rationale /
// verdict / enrichment_blob / deep_dive_path / enrichment_cost (taste + scrape).
const companies = (
  await client.execute(
    `SELECT id, slug, name, domain, linkedin_url, linkedin_company_id, website_url,
            recruiting_website, description, stage, category, industry, keywords,
            founded_year, headcount, verticals, location, work_type, size_band,
            latest_round, latest_amount, last_funding_date, lead_investor,
            funding_total, status, source, source_detail, created_at, updated_at
     FROM companies`,
  )
).rows.map(toPlain);

// People — full public professional profile. No connection_degree / can_refer /
// outreach_status / next_action* / last_contacted (personal CRM), no
// enrichment_blob / notes_path / linkedin_profile (raw scrape). `relationship`
// is kept only because the column is NOT NULL (a default label, not personal).
const people = (
  await client.execute(
    `SELECT id, slug, name, company_id, relationship, title, linkedin_url,
            twitter_url, bio, photo_url, headline, location, about,
            current_company, work_history, education, created_at, updated_at
     FROM people`,
  )
).rows.map(toPlain);

const talks = (
  await client.execute(
    `SELECT id, speaker_id, company_id, title, description, day, time, room, track,
            type, source, source_detail, created_at, updated_at
     FROM talks`,
  )
).rows.map(toPlain);

// ALL roles across every company (job-first entry) — truncate long descriptions.
const roles = (
  await client.execute(
    `SELECT id, company_id, title, url, location, work_type, description,
            posted_date, status, source, external_id, salary, last_seen_at,
            created_at, updated_at
     FROM roles`,
  )
).rows
  .map(toPlain)
  .map((r) => ({
    ...r,
    description: r.description ? String(r.description).slice(0, 600) : null,
  }));

const snapshot = {
  meta: {
    conference: "AI Engineer World's Fair 2026",
    note: "Clean, complete conference graph — public firmographics, profiles, agenda & jobs. No taste scores, no personal CRM data; ranking is computed by the engine.",
    counts: {
      companies: companies.length,
      people: people.length,
      talks: talks.length,
      roles: roles.length,
    },
  },
  companies,
  people,
  talks,
  roles,
};

writeFileSync("seed/demo-snapshot.json", JSON.stringify(snapshot, null, 2));
console.log(
  `Wrote seed/demo-snapshot.json — ${companies.length} companies, ${people.length} people, ${talks.length} talks, ${roles.length} roles`,
);
client.close();
