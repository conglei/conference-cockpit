/**
 * One-off: export a privacy-safe demo snapshot of the enriched graph to
 * `seed/demo-snapshot.json`, so a fresh clone can run the demo without the 28 MB
 * working DB, scraped blobs, or any API keys.
 *
 * Privacy (design §8 risk #4): public professional data only — we export
 * firmographics, funding, the public conference agenda, and the taste scores,
 * and we DROP enrichment_blob / deep_dive / score_verdict / notes and truncate
 * long role descriptions. Roles are limited to the scored (surfaced) companies.
 *
 * Run: DATABASE_URL=<abs path to conference.db> pnpm exec tsx scripts/export-demo.ts
 */
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { DB_URL } from "../src/db/client";

const db = new Database(DB_URL, { readonly: true });

const companies = db
  .prepare(
    `SELECT id, slug, name, domain, linkedin_url, linkedin_company_id, website_url,
            recruiting_website, description, stage, category, location, work_type,
            size_band, latest_round, latest_amount, last_funding_date, lead_investor,
            funding_total, status, source, source_detail,
            score_founder_quality, score_investor_quality, score_domain_fit,
            score_stage_fit, score_size_fit, score_overall, score_rationale,
            score_scored_by, scored_at, created_at, updated_at
     FROM companies`,
  )
  .all();

const people = db
  .prepare(
    `SELECT id, slug, name, company_id, relationship, title, linkedin_url,
            connection_degree, can_refer, outreach_status, next_action,
            next_action_date, last_contacted_at, created_at, updated_at
     FROM people`,
  )
  .all();

const talks = db
  .prepare(
    `SELECT id, speaker_id, company_id, title, description, day, time, room, track,
            type, source, source_detail, created_at, updated_at
     FROM talks`,
  )
  .all();

// Roles only for scored companies (what the plan surfaces); truncate descriptions.
const roles = (
  db
    .prepare(
      `SELECT id, company_id, title, url, location, work_type, description,
              posted_date, status, source, external_id, salary, last_seen_at,
              created_at, updated_at
       FROM roles
       WHERE company_id IN (SELECT id FROM companies WHERE score_overall IS NOT NULL)`,
    )
    .all() as { description: string | null }[]
).map((r) => ({
  ...r,
  description: r.description ? String(r.description).slice(0, 600) : null,
}));

const snapshot = {
  meta: {
    conference: "AI Engineer World's Fair 2026",
    note: "Privacy-safe demo snapshot — public firmographic + agenda data only.",
    counts: { companies: companies.length, people: people.length, talks: talks.length, roles: roles.length },
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
db.close();
