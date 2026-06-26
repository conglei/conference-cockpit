import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// --- Enums (see docs/adr/0001-data-model.md) ---
// Enforced in the typed data layer via Drizzle's `enum` option on text columns.

export const COMPANY_STATUS = [
  "new",
  "enriched",
  "interesting",
  "watching",
  "pursuing",
  "passed",
] as const;
export type CompanyStatus = (typeof COMPANY_STATUS)[number];

export const WORK_TYPE = ["onsite", "remote", "hybrid", "unknown"] as const;
export type WorkType = (typeof WORK_TYPE)[number];

export const SOURCE = ["csv", "startups_gallery", "google_jobs", "manual", "ats", "apollo"] as const;
export type Source = (typeof SOURCE)[number];

export const RELATIONSHIP = [
  "founder",
  "hiring_manager",
  "network_contact",
  "referrer",
] as const;
export type Relationship = (typeof RELATIONSHIP)[number];

export const OUTREACH_STATUS = [
  "none",
  // "targeted" is the PREP touchpoint: you saved this person to your who-to-meet
  // list before the event (no contact yet). It precedes "met". TS-only enum
  // (SQLite stores text) so adding it needs no migration.
  "targeted",
  // "met" is the conference touchpoint (product-design §11 Phase 5): you met the
  // person in-person at the event, before any digital follow-up.
  "met",
  "drafted",
  "contacted",
  "replied",
  "bounced",
] as const;
export type OutreachStatus = (typeof OUTREACH_STATUS)[number];

// Score provenance (ADR-0003 §3): every score row is tagged as cheap rubric
// triage or LLM deep-review, so the two are always distinguishable downstream.
export const SCORED_BY = ["rubric", "llm"] as const;
export type ScoredBy = (typeof SCORED_BY)[number];

// --- companies (issue 01; score columns are present now so issue 05 needs no migration) ---
//
// Note on dedupe: SQLite treats NULLs as distinct in UNIQUE indexes, so a plain
// unique index on `domain` / `linkedin_url` already behaves as "partial unique
// where not null" — multiple unresolved (NULL) rows are allowed, but two rows
// sharing a non-null domain/linkedin are rejected. This is the canonical
// identity rule from ADR-0001.
export const companies = sqliteTable(
  "companies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    domain: text("domain"),
    linkedinUrl: text("linkedin_url"),
    /**
     * LinkedIn's numeric company id (stringified), e.g. "1815218". A durable
     * canonical identifier — the numeric form of `linkedin_url`, same family as
     * `domain` — captured for free from the harvest `/linkedin/company` element.
     * Persisting it lets company-scoped find-jobs search by id without
     * re-resolving the company on every run.
     */
    linkedinCompanyId: text("linkedin_company_id"),
    websiteUrl: text("website_url"),
    /**
     * The company's careers/recruiting link (ATS board or a careers.* / /careers
     * page), extracted from the same aggregator crawl that yields `domain` /
     * `website_url`. Nullable: partial across companies — many pages embed no
     * careers link, and that's fine (ADR-0003 §1).
     */
    recruitingWebsite: text("recruiting_website"),
    description: text("description"),
    stage: text("stage"),
    category: text("category"),
    /**
     * Apollo's fine-grained industry label, e.g. "information technology &
     * services". Distinct from `category` (the coarse CSV/gallery bucket like
     * "DevTools"); kept separate so neither source clobbers the other.
     */
    industry: text("industry"),
    /**
     * Apollo `keywords[]` — the company's self-described focus terms (e.g.
     * "clinical documentation", "single-cell rnaseq"). Stored as a JSON array
     * string; the single richest field for keyword/vertical search.
     */
    keywords: text("keywords"),
    /** Founding year (Apollo `founded_year`), when known. */
    foundedYear: integer("founded_year"),
    /** Raw headcount (Apollo `estimated_num_employees`); `sizeBand` is its bucket. */
    headcount: integer("headcount"),
    /**
     * Conference verticals this company appears in, rolled up from the distinct
     * `track`s of its speakers' talks (e.g. ["AI in Healthcare", "Security"]).
     * JSON array string — the queryable taxonomy behind "show me healthcare
     * companies". Derived, not from a provider.
     */
    verticals: text("verticals"),
    location: text("location"),
    workType: text("work_type", { enum: WORK_TYPE }),
    sizeBand: text("size_band"),
    latestRound: text("latest_round"),
    latestAmount: text("latest_amount"),
    lastFundingDate: text("last_funding_date"),
    leadInvestor: text("lead_investor"),
    /** Cumulative funding raised, e.g. "$2.1B" (Apollo `total_funding_printed`). */
    fundingTotal: text("funding_total"),
    status: text("status", { enum: COMPANY_STATUS }).notNull().default("new"),
    source: text("source", { enum: SOURCE }),
    sourceDetail: text("source_detail"),
    enrichmentBlob: text("enrichment_blob"),
    deepDivePath: text("deep_dive_path"),
    /** USD spent on the last enrichment pass for this company (cost tracking). */
    enrichmentCost: real("enrichment_cost"),
    scoreFounderQuality: real("score_founder_quality"),
    scoreInvestorQuality: real("score_investor_quality"),
    scoreDomainFit: real("score_domain_fit"),
    scoreStageFit: real("score_stage_fit"),
    scoreSizeFit: real("score_size_fit"),
    scoreOverall: real("score_overall"),
    scoreRationale: text("score_rationale"),
    /** Provenance of the current score: `rubric` (triage) or `llm` (deep-review). */
    scoreScoredBy: text("score_scored_by", { enum: SCORED_BY }),
    /**
     * LLM deep-review verdict — a JSON/markdown blob holding thesis, concerns,
     * what-to-verify, and confidence. NULL for rubric-only rows (ADR-0003 §3).
     */
    scoreVerdict: text("score_verdict"),
    scoredAt: integer("scored_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("companies_slug_ux").on(t.slug),
    uniqueIndex("companies_domain_ux").on(t.domain),
    uniqueIndex("companies_linkedin_ux").on(t.linkedinUrl),
    index("companies_status_ix").on(t.status),
    index("companies_score_overall_ix").on(t.scoreOverall),
  ],
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;

// --- people (issue 04; connection + outreach fields present now so issues 06/09 need no migration) ---
//
// As with companies, a plain `uniqueIndex` on the nullable `linkedin_url` column
// behaves as "partial unique where not null" in SQLite (NULLs are distinct), so
// many people without a known LinkedIn URL coexist while a real URL stays unique.
export const people = sqliteTable(
  "people",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    companyId: integer("company_id").references(() => companies.id),
    relationship: text("relationship", { enum: RELATIONSHIP }).notNull(),
    title: text("title"),
    /** Speaker bio as published in the conference directory (speakers.json). */
    bio: text("bio"),
    /** Speaker headshot URL from the conference directory (relative to ai.engineer). */
    photoUrl: text("photo_url"),
    /** Twitter/X profile, captured from the speakers-embeddings feed. */
    twitterUrl: text("twitter_url"),
    linkedinUrl: text("linkedin_url"),
    // --- Deep LinkedIn profile (harvest getProfile); filled by `enrich-people` ---
    /** LinkedIn headline, e.g. "Member of Technical Staff at Anthropic". */
    headline: text("headline"),
    /** Free-text location, e.g. "United Kingdom" / "San Francisco Bay Area". */
    location: text("location"),
    /** LinkedIn "about"/summary section. */
    about: text("about"),
    /** Current employer name (from the profile's current position). */
    currentCompany: text("current_company"),
    /**
     * Full work history as a JSON array of {company,title,start,end}. The signal
     * behind founder-bar pedigree queries (e.g. ex-OpenAI/DeepMind/Anthropic).
     */
    workHistory: text("work_history"),
    /** Education as a JSON array of {school,degree,field} — the researcher/faculty signal. */
    education: text("education"),
    /** Raw LinkedIn profile element (JSON), stored verbatim for anything not flattened. */
    linkedinProfile: text("linkedin_profile"),
    /** When the deep profile was last fetched (ms epoch); null = never enriched. */
    profileEnrichedAt: integer("profile_enriched_at"),
    connectionDegree: integer("connection_degree"),
    canRefer: integer("can_refer", { mode: "boolean" }).notNull().default(false),
    enrichmentBlob: text("enrichment_blob"),
    notesPath: text("notes_path"),
    outreachStatus: text("outreach_status", { enum: OUTREACH_STATUS })
      .notNull()
      .default("none"),
    nextAction: text("next_action"),
    nextActionDate: text("next_action_date"),
    lastContactedAt: integer("last_contacted_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("people_slug_ux").on(t.slug),
    uniqueIndex("people_linkedin_ux").on(t.linkedinUrl),
    index("people_company_ix").on(t.companyId),
    index("people_relationship_ix").on(t.relationship),
    index("people_can_refer_degree_ix").on(t.canRefer, t.connectionDegree),
  ],
);

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;

// --- roles (issue 07; the job-first doorway into the funnel) ---

export const ROLE_STATUS = ["new", "interesting", "skipped"] as const;
export type RoleStatus = (typeof ROLE_STATUS)[number];

// A role (job listing) always links to a company. The job-first flow may have
// created that company moments earlier as `status: new` / unenriched, so
// `company_id` is NOT NULL but the company need not be resolved yet (ADR-0001).
//
// `external_id` is the provider's stable job id; a plain uniqueIndex behaves as
// "partial unique where not null" in SQLite (NULLs are distinct), so multiple
// id-less roles are allowed while two roles sharing a provider job id are
// rejected — the job-board dedupe key.
export const roles = sqliteTable(
  "roles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    title: text("title").notNull(),
    url: text("url"),
    location: text("location"),
    workType: text("work_type", { enum: WORK_TYPE }),
    description: text("description"),
    postedDate: text("posted_date"),
    status: text("status", { enum: ROLE_STATUS }).notNull().default("new"),
    source: text("source", { enum: SOURCE }),
    externalId: text("external_id"),
    // Conference-tailored job detail (Apollo job_postings + ATS/LinkedIn enrichment).
    salary: text("salary"),
    lastSeenAt: text("last_seen_at"),
    raw: text("raw"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("roles_company_ix").on(t.companyId),
    index("roles_status_ix").on(t.status),
    uniqueIndex("roles_external_id_ux").on(t.externalId),
  ],
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;

// --- talks (product-design.md §11 Phase 1) ---
//
// A conference session, linked to its speaker (a `people` row) and — denormalized
// for the plan engine's company-first queries — that speaker's company. For the
// MVP Career Mover lens talks are *metadata* ("where/when to catch your target"),
// but they are first-class in the model so the Builder lens can rank them later.
//
// Dedupe key: a plain uniqueIndex on (speaker_id, title, time) makes re-ingesting
// the same agenda idempotent (NULLs distinct, like the rest of the schema).
export const talks = sqliteTable(
  "talks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Nullable: speaker-less agenda items (expo sessions, keynotes/TBA, breaks)
    // are real sessions with no person to link.
    speakerId: integer("speaker_id").references(() => people.id),
    /** The speaker's company at the event (denormalized off the speaker). */
    companyId: integer("company_id").references(() => companies.id),
    title: text("title").notNull(),
    description: text("description"),
    /** Agenda day label as published, e.g. "Day 2 — Session Day 1". */
    day: text("day"),
    /** Time slot as published, e.g. "3:20pm-3:40pm". */
    time: text("time"),
    /** Room/stage, e.g. "Track 5". */
    room: text("room"),
    /** Track/topic, e.g. "Security", "Agents". */
    track: text("track"),
    /** Session type as published, e.g. "keynote", "sponsor", "workshop". */
    type: text("type"),
    source: text("source", { enum: SOURCE }),
    sourceDetail: text("source_detail"),
    raw: text("raw"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("talks_speaker_ix").on(t.speakerId),
    index("talks_company_ix").on(t.companyId),
    index("talks_track_ix").on(t.track),
    uniqueIndex("talks_dedupe_ux").on(t.speakerId, t.title, t.time),
  ],
);

export type Talk = typeof talks.$inferSelect;
export type NewTalk = typeof talks.$inferInsert;

// --- speaker_embeddings (semantic search over the conference) ---
//
// One precomputed embedding per conference speaker (AIE speakers-embeddings.json,
// Gemini 128-dim MRL vectors). Linked to a `people` row when we can match by name
// (nullable: the feed has speakers not in our directory). SQLite has no native
// vector type, so the vector is a JSON array of floats; cosine similarity runs in
// the app layer. `external_id` (e.g. "worldsfair-speaker-0") is the feed's stable
// key and the idempotent dedupe anchor.
export const speakerEmbeddings = sqliteTable(
  "speaker_embeddings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Matched directory person, when found by name; null when unmatched. */
    personId: integer("person_id").references(() => people.id),
    /** Feed-stable id, e.g. "worldsfair-speaker-0". Dedupe key. */
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    role: text("role"),
    company: text("company"),
    /** Embedding model, e.g. "gemini-embedding-2-preview". */
    model: text("model"),
    /** Vector length actually stored (128 for the MRL-truncated feed). */
    dimensions: integer("dimensions"),
    /** JSON array of floats — the embedding vector. */
    embedding: text("embedding").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("speaker_embeddings_external_id_ux").on(t.externalId),
    index("speaker_embeddings_person_ix").on(t.personId),
  ],
);

export type SpeakerEmbedding = typeof speakerEmbeddings.$inferSelect;
export type NewSpeakerEmbedding = typeof speakerEmbeddings.$inferInsert;

// --- applications (issue 08) ---

export const APPLICATION_STATUS = [
  "interested",
  "applied",
  "referred",
  "screening",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUS)[number];

// The pipeline for roles you actually engage. `company_id` is denormalized off
// the role's company so cross-entity queries (companies + people + roles +
// applications) don't have to round-trip through roles. See ADR-0001.
export const applications = sqliteTable(
  "applications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    contactPersonId: integer("contact_person_id").references(() => people.id),
    status: text("status", { enum: APPLICATION_STATUS })
      .notNull()
      .default("interested"),
    nextAction: text("next_action"),
    nextActionDate: text("next_action_date"),
    appliedAt: integer("applied_at"),
    notes: text("notes"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("applications_role_ix").on(t.roleId),
    index("applications_company_ix").on(t.companyId),
    index("applications_status_ix").on(t.status),
  ],
);

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;

// --- app_meta (issue 11) ---
//
// A tiny key/value store for runtime state the daily routine needs — chiefly
// `last_refresh_at`, so "what's new since the last refresh" is reliable across
// headless runs (cron / GitHub Action / launchd) without inventing a later
// migration. Per ADR-0001: key TEXT pk, value TEXT, updated_at INTEGER.
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at"),
});

export type AppMeta = typeof appMeta.$inferSelect;
export type NewAppMeta = typeof appMeta.$inferInsert;
