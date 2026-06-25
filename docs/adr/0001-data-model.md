# ADR 0001 — Data model

Status: Accepted
Date: 2026-06-23

## Context

Conference Compass stores high-cardinality structured entities in SQLite (via Drizzle + better-sqlite3) and narrative/identity in markdown. Five issues each touch the schema (01 companies, 04 people, 05 scores, 07 roles, 08 applications). To avoid schema churn rippling across those issues, the **complete** data model is fixed here up front. Issues introduce tables incrementally but must conform to these definitions; any deviation requires amending this ADR.

This record is the single source of truth for tables, fields, types, enums, relationships, and indexes. It deliberately over-specifies fields that later slices need (scores, connection fields, provenance, meta) so earlier migrations don't have to be rewritten.

## Conventions

- Every table has integer `id` primary key (autoincrement), plus `created_at` and `updated_at` (unix epoch ms, set by the data layer).
- Entities that own a markdown deep-dive also have a unique `slug` (kebab-case, used as the markdown filename).
- SQLite types: `INTEGER`, `REAL`, `TEXT`. Booleans are `INTEGER` 0/1. JSON blobs are `TEXT` containing JSON. Enums are `TEXT` constrained to the documented values (enforced in the typed data layer, not by SQLite).
- All reads/writes go through the typed data layer; no raw SQL elsewhere (per PRD).

## Enums

- **company_status** (the funnel): `new` → `enriched` → `interesting` → `watching` → `pursuing` → `passed`
- **people.relationship**: `founder` · `hiring_manager` · `network_contact` · `referrer`
- **role_status**: `new` · `interesting` · `skipped`
- **application_status**: `interested` · `applied` · `referred` · `screening` · `interviewing` · `offer` · `rejected` · `withdrawn`
- **work_type**: `onsite` · `remote` · `hybrid` · `unknown`
- **outreach_status**: `none` · `drafted` · `contacted` · `replied` · `bounced`
- **source**: `csv` · `startups_gallery` · `google_jobs` · `manual`

## Tables

### companies  *(issue 01; scores added in 05)*

| field | type | notes |
| --- | --- | --- |
| id | INTEGER pk | |
| slug | TEXT unique | filename for `companies/<slug>.md` |
| name | TEXT not null | |
| domain | TEXT | canonical dedupe key #1 (nullable until resolved) |
| linkedin_url | TEXT | canonical dedupe key #2 (nullable until resolved) |
| website_url | TEXT | raw site if known |
| description | TEXT | |
| stage | TEXT | e.g. `Seed`, `Series A` (free text; from source) |
| category | TEXT | e.g. `AI`, `Design` (free text; from source) |
| location | TEXT | |
| work_type | TEXT | `work_type` enum |
| size_band | TEXT | derived bucket for scoring (e.g. `tiny`/`small`/`mid`/`large`); nullable until enriched |
| latest_round | TEXT | e.g. `Series A` (from funding source) |
| latest_amount | TEXT | e.g. `$30M` (keep raw string; parsing optional) |
| last_funding_date | TEXT | ISO date string |
| lead_investor | TEXT | from funding source |
| status | TEXT not null | `company_status` enum, default `new` |
| source | TEXT | `source` enum — how it first entered |
| source_detail | TEXT | e.g. CSV filename or scrape URL |
| enrichment_blob | TEXT (JSON) | raw provider enrichment payload; nullable |
| deep_dive_path | TEXT | path to `companies/<slug>.md`; nullable until enriched |
| score_founder_quality | REAL | 0–1 (or 0–100); nullable until scored |
| score_investor_quality | REAL | nullable until scored |
| score_domain_fit | REAL | nullable |
| score_stage_fit | REAL | nullable |
| score_size_fit | REAL | nullable |
| score_overall | REAL | nullable |
| score_rationale | TEXT | stored one-line explanation (required when scored) |
| scored_at | INTEGER | epoch ms of last scoring; nullable |
| created_at / updated_at | INTEGER | |

Indexes: unique on `slug`; **partial unique** on `domain` (where not null); **partial unique** on `linkedin_url` (where not null); index on `status`; index on `score_overall`.

> Dedupe rule: a company is the same as an existing one if `domain` matches OR `linkedin_url` matches. Name is **not** a dedupe key. Import resolves to a canonical key before insert (issue 03).

### people  *(issue 04)*

| field | type | notes |
| --- | --- | --- |
| id | INTEGER pk | |
| slug | TEXT unique | filename for `people/<slug>.md` |
| name | TEXT not null | |
| company_id | INTEGER fk → companies.id | nullable (a contact may not map to a tracked company) |
| relationship | TEXT not null | `relationship` enum |
| title | TEXT | role at company |
| linkedin_url | TEXT | |
| connection_degree | INTEGER | 1, 2, or null (unknown) |
| can_refer | INTEGER (bool) | default 0 |
| enrichment_blob | TEXT (JSON) | raw provider profile payload; nullable |
| notes_path | TEXT | path to `people/<slug>.md`; nullable until enriched |
| outreach_status | TEXT | `outreach_status` enum, default `none` |
| next_action | TEXT | nullable |
| next_action_date | TEXT | ISO date; nullable |
| last_contacted_at | INTEGER | epoch ms; nullable |
| created_at / updated_at | INTEGER | |

Indexes: unique on `slug`; partial unique on `linkedin_url` (where not null); index on `company_id`; index on `relationship`; index on `(can_refer, connection_degree)` for who-next.

### roles  *(issue 07)*

| field | type | notes |
| --- | --- | --- |
| id | INTEGER pk | |
| company_id | INTEGER fk → companies.id | not null (job-first creates the company first) |
| title | TEXT not null | |
| url | TEXT | listing URL |
| location | TEXT | |
| work_type | TEXT | `work_type` enum |
| description | TEXT | |
| posted_date | TEXT | ISO date; nullable |
| status | TEXT not null | `role_status` enum, default `new` |
| source | TEXT | `source` enum (typically `google_jobs`) |
| external_id | TEXT | provider job id for dedupe; nullable |
| created_at / updated_at | INTEGER | |

Indexes: index on `company_id`; index on `status`; partial unique on `external_id` (where not null) to dedupe job-board results.

> Marking a role `interesting` promotes its company into the funnel (`new` → at least `interesting`) — issue 07.

### applications  *(issue 08)*

| field | type | notes |
| --- | --- | --- |
| id | INTEGER pk | |
| role_id | INTEGER fk → roles.id | not null |
| company_id | INTEGER fk → companies.id | denormalized for cross-entity queries |
| contact_person_id | INTEGER fk → people.id | nullable (the referrer/contact) |
| status | TEXT not null | `application_status` enum, default `interested` |
| next_action | TEXT | nullable |
| next_action_date | TEXT | ISO date; nullable |
| applied_at | INTEGER | epoch ms; nullable |
| notes | TEXT | nullable |
| created_at / updated_at | INTEGER | |

Indexes: index on `role_id`, `company_id`, `status`.

### app_meta  *(issue 11)*

Key-value store for runtime state the daily routine needs (avoids a later migration).

| field | type | notes |
| --- | --- | --- |
| key | TEXT pk | e.g. `last_refresh_at` |
| value | TEXT | |
| updated_at | INTEGER | |

## Relationships

```
companies 1 ──< people          (people.company_id, nullable)
companies 1 ──< roles           (roles.company_id, required)
companies 1 ──< applications    (applications.company_id, denormalized)
roles     1 ──< applications    (applications.role_id, required)
people    1 ──< applications    (applications.contact_person_id, nullable)
```

## Decisions & rationale

- **Scores live denormalized on `companies`, not a separate table.** v1 needs "sort companies by overall score," which is trivial on-row and awkward with a history table. Score *history* / re-score audit is out of scope; if needed later, add a `company_scores` table without touching `companies`.
- **Canonical identity = domain OR linkedin_url**, both nullable until resolved, both partial-unique. This is why robust CSV import (03) depends on the resolver (02): name-based dedupe is unreliable.
- **`source`/`source_detail` capture first-touch provenance only.** A company seen in multiple sources keeps its first source; a full source-history join table is over-engineering for one user.
- **Outreach state is on the row** (`people.outreach_status` + `applications.status`), not an event log. Per-attempt history is out of scope for v1.
- **Funding amounts kept as raw strings** (`latest_amount` = `"$30M"`). Numeric parsing is optional and can be derived later without a schema change.
- **`size_band` is a stored derived field** so the deterministic pre-filter (05) reads it directly rather than recomputing.

## Out of scope

- Investors as a first-class entity (kept as `lead_investor` text on companies).
- Score history / outreach event log.
- Multi-source provenance join tables.
