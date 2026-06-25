import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CompanyRepo } from "../db/repository";
import type { PersonRepo } from "../db/people-repository";
import type { Company, Person } from "../db/schema";
import type { CostMeter } from "../providers/cost";
import type {
  Employee,
  EnrichmentProvider,
  Profile,
  WebSearchResult,
} from "../providers/types";
import { webSearchFounders } from "./founder-web-search";
import { renderCompanyDeepDive, renderPersonDeepDive } from "./markdown";
import { looksLikeOrgNoise } from "./person-name";

/** A title looks like a founder/key-person if it mentions any of these. */
const FOUNDER_TITLE_RE =
  /\b(founder|co-?founder|ceo|cto|chief|president)\b/i;

/**
 * Decide whether a rostered employee counts as a founder/key person worth a
 * `people` row + deep-dive. This is a *judgment* about messy real-world titles,
 * not a mechanical primitive (ADR-0002): the default below is a thin,
 * title-string heuristic, but the `enrich-company` skill (or any caller) can
 * inject its own classifier — e.g. one that reads the LinkedIn headline, knows
 * "Founding Engineer" is not a founder, or treats a specific person as key
 * regardless of title. Keep the seam; override the decision, don't fork the code.
 */
export type FounderClassifier = (employee: Employee) => boolean;

/** Default classifier: title-string match against {@link FOUNDER_TITLE_RE}. */
export const defaultFounderClassifier: FounderClassifier = (e) =>
  Boolean(e.title && FOUNDER_TITLE_RE.test(e.title));

export interface EnrichCompanyOptions {
  /**
   * Base directory deep-dive markdown is written under. Defaults to the repo
   * root (so files land in `companies/<slug>.md`, `people/<slug>.md`). Tests
   * point this at a temp dir.
   */
  baseDir?: string;
  /**
   * Optional second provider used for the supplementary web/funding search
   * (typically a SearchApiProvider). Defaults to the primary provider.
   */
  searchProvider?: EnrichmentProvider;
  /** Max employees to roster when discovering founders. */
  employeeLimit?: number;
  /**
   * Override the founder/key-person decision. Defaults to a title-string
   * heuristic ({@link defaultFounderClassifier}); the `enrich-company` skill
   * supplies a smarter judgment at runtime when the titles are messy.
   */
  isFounder?: FounderClassifier;
  /**
   * Cost meter shared with the providers. When supplied, this run's billable
   * spend (the delta over the meter while enriching this company) is persisted
   * to `companies.enrichment_cost` and returned in the result.
   */
  meter?: CostMeter;
  /** Max concurrent profile fetches (HarvestAPI paid tier allows 5). */
  concurrency?: number;
}

export interface EnrichedPerson {
  person: Person;
  notesPath: string;
}

export interface EnrichCompanyResult {
  company: Company;
  people: EnrichedPerson[];
  deepDivePath: string;
  /** USD spent enriching this company (0 when no meter was supplied). */
  costUsd: number;
  /** Non-fatal diagnostics (e.g. a provider tier that degraded gracefully). */
  notes: string[];
}

/**
 * Deep-dive a company AND its founders/key people in one pass, then persist
 * everything through the typed data layer:
 *
 *  1. Roster the company's people via the provider (`getEmployees`), classify
 *     founders/key people by title, and fetch each one's profile (`getProfile`).
 *  2. Supplement with web/funding context (`search`).
 *  3. Write `companies/<slug>.md` and a `people/<slug>.md` per founder.
 *  4. Upsert `people` rows linked to the company, set `notes_path` on each and
 *     `deep_dive_path` on the company.
 *  5. Advance the company `new → enriched`.
 *
 * Provider is injected so tests run offline against `FakeProvider`.
 */
export async function enrichCompany(
  deps: { companies: CompanyRepo; people: PersonRepo; provider: EnrichmentProvider },
  companyId: number,
  opts: EnrichCompanyOptions = {},
): Promise<EnrichCompanyResult> {
  const { companies, people, provider } = deps;
  const baseDir = opts.baseDir ?? process.cwd();
  const searchProvider = opts.searchProvider ?? provider;
  const notes: string[] = [];

  const company = companies.get(companyId);
  if (!company) {
    throw new Error(`enrichCompany: no company with id ${companyId}`);
  }

  const isFounder = opts.isFounder ?? defaultFounderClassifier;
  const costBefore = opts.meter?.totalUsd() ?? 0;

  // 1. Roster founder candidates (a cheap, profile-free triage) and the
  //    supplementary web/funding context, concurrently.
  const [roster, webContext] = await Promise.all([
    rosterEmployees(provider, company, opts.employeeLimit, notes),
    webSearch(searchProvider, company, notes),
  ]);

  // 2. Resolve each candidate with ONE profile fetch — which doubles as the
  //    verification (does their profile list this company id?) and the rich
  //    data we store. Runs concurrently up to the provider's allowed lanes.
  //    DB writes happen afterwards, sequentially, to avoid slug races.
  const resolved = (
    await mapLimit(roster, opts.concurrency ?? 5, (emp) =>
      resolveFounder(provider, company, emp, isFounder, notes),
    )
  ).filter((r): r is ResolvedFounder => r !== undefined);

  const enriched: EnrichedPerson[] = [];
  const usedSlugs = new Set<string>();
  const seenNames = new Set<string>();
  for (const r of resolved) {
    // Dedupe the same person surfaced under two LinkedIn URLs in one pass.
    const key = r.emp.name.trim().toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    enriched.push(persistFounder(people, company, r, baseDir, usedSlugs));
  }

  // 2b. WEB-SEARCH recovery rung (ADR-0003 §2): the normal roster yielded ZERO
  //     founders. Triggered, not always-on — only fires here, when a separate
  //     search provider is available. Recovered people are persisted as founder
  //     rows (name + title, no LinkedIn URL) through the same path.
  if (enriched.length === 0 && opts.searchProvider) {
    const recovered = await webSearchFounders(searchProvider, company, notes);
    if (recovered.length > 0) {
      notes.push(
        `using web-search founder fallback for "${company.name}" (roster was empty).`,
      );
    }
    for (const f of recovered) {
      const key = f.name.trim().toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      const emp: Employee = { name: f.name, title: f.title };
      enriched.push(
        persistFounder(people, company, { emp, title: f.title, raw: undefined }, baseDir, usedSlugs),
      );
    }
  }

  // Prune stale founders so re-enrichment is idempotent: drop founder rows for
  // this company that this (corrected) pass no longer surfaces. Only untouched,
  // never-contacted enrichment rows are removed — anything the user has engaged
  // (outreach status / last contacted) or that's referenced elsewhere is kept.
  pruneStaleFounders(people, company.id, new Set(enriched.map((e) => e.person.id)), notes);

  // 3. Company deep-dive (references the founders we just resolved).
  const deepDivePath = join(baseDir, "companies", `${company.slug}.md`);
  const companyMd = renderCompanyDeepDive({
    company,
    founders: enriched.map((e) => ({
      name: e.person.name,
      title: e.person.title ?? undefined,
      linkedinUrl: e.person.linkedinUrl ?? undefined,
    })),
    webContext,
  });
  writeFile(deepDivePath, companyMd);

  // 4. Persist company: deep_dive_path, this run's cost, advance new → enriched.
  const costUsd = Math.round(((opts.meter?.totalUsd() ?? 0) - costBefore) * 1e6) / 1e6;
  const updated = companies.update(companyId, {
    deepDivePath,
    enrichmentCost: costUsd,
    status: company.status === "new" ? "enriched" : company.status,
  });

  return {
    company: updated ?? company,
    people: enriched,
    deepDivePath,
    costUsd,
    notes,
  };
}

/** A candidate confirmed to be a founder/key person, with the data to persist. */
interface ResolvedFounder {
  emp: Employee;
  title: string | undefined;
  raw: unknown;
}

/**
 * One profile fetch per candidate that serves three purposes at once: confirm
 * (does the profile list this company id as a current employer?), read the real
 * title there, and capture the rich payload to store. Confirmed candidates (the
 * roster already matched the company in their headline) are kept even if the
 * fetch fails; unconfirmed ones are dropped unless the profile verifies.
 */
async function resolveFounder(
  provider: EnrichmentProvider,
  company: Company,
  emp: Employee,
  isFounder: FounderClassifier,
  notes: string[],
): Promise<ResolvedFounder | undefined> {
  let profile: Profile | undefined;
  // Fetch the profile when we have EITHER a LinkedIn URL (harvest's key) or a
  // provider-side id (Apollo's `people/match` key, which reveals a masked roster
  // entry's full name + LinkedIn URL). Apollo can only reveal by id, so pass it.
  if (emp.linkedinUrl || emp.providerId) {
    try {
      profile = await provider.getProfile({
        linkedinUrl: emp.linkedinUrl ?? "",
        providerId: emp.providerId,
      });
    } catch (err) {
      notes.push(`[${provider.name}] getProfile failed for ${emp.name}: ${String(err)}`);
    }
  }

  // Find this person's current position AT this company (the verification).
  // `companyId` is only present for providers that support id-verification
  // (HarvestAPI); for those, we ALWAYS require the match — it's free, since the
  // profile was fetched for storage anyway, and it catches false "confirmations"
  // from generic company-name tokens (e.g. "humans" matching "Humans&").
  const canVerify = Boolean(emp.companyId);
  const here =
    canVerify && profile?.currentCompanies
      ? profile.currentCompanies.find((c) => c.companyId === emp.companyId)
      : undefined;

  // Provider-agnostic noise guard (issue #32): drop CLEAR non-persons — org/role
  // strings the roster mis-classified as people (e.g. "Information Security",
  // "Co Founder", "Chief Information") — before they reach persist. Lighter than
  // the web-search rung's strict name check so legitimate mononyms / non-Western
  // names survive (the roster is higher-precision). Covers Apollo + any future
  // provider, since every resolved founder funnels through here.
  const dropAsNoise = (name: string): boolean => {
    if (!looksLikeOrgNoise(name, company.name)) return false;
    notes.push(
      `dropped roster entry "${name}" for "${company.name}" as org/role noise ` +
        `(not a person).`,
    );
    return true;
  };

  if (profile) {
    // We have the profile: require the id match when the provider supports it.
    if (canVerify && !here) return undefined;
  } else {
    // No profile (fetch failed or no URL): trust only an already-confirmed
    // headline; an unconfirmed candidate can't be verified, so drop it.
    if (canVerify && !emp.confirmed) return undefined;
    if (dropAsNoise(emp.name)) return undefined;
    return { emp, title: emp.title, raw: undefined };
  }

  const title = here?.title ?? profile.title ?? emp.title;
  if (!isFounder({ ...emp, title })) return undefined;

  // Prefer the profile's revealed identity over the roster's: an Apollo masked
  // entry like "Charles Pa***r" (no LinkedIn) becomes the full name + LinkedIn
  // URL that `people/match` returned, so the persisted founder is contactable.
  const revealed = revealEmployee(emp, profile);
  if (dropAsNoise(revealed.name)) return undefined;

  return { emp: revealed, title, raw: profile.raw ?? profile };
}

/** A roster name still masked by the provider (e.g. Apollo's `Charles Pa***r`). */
const MASKED_NAME_RE = /[*]/;

/**
 * Overlay a fetched profile's fuller identity onto a roster {@link Employee}:
 * take the profile's `name`/`linkedinUrl` when they add information. A real
 * profile name replaces a masked roster name (`Charles Pa***r` → `Charles
 * Packer`) or any shorter/equal placeholder; a profile URL fills a missing one.
 * The roster value is kept when the profile has nothing better.
 */
function revealEmployee(emp: Employee, profile: Profile): Employee {
  const candidate = profile.name?.trim();
  const profileNameIsReal = Boolean(candidate) && candidate !== "Unknown";
  const preferProfileName =
    profileNameIsReal &&
    (MASKED_NAME_RE.test(emp.name) || candidate!.length >= emp.name.length);
  return {
    ...emp,
    name: preferProfileName ? candidate! : emp.name,
    linkedinUrl: emp.linkedinUrl ?? profile.linkedinUrl,
  };
}

/**
 * Remove founder rows for a company that the latest enrichment pass did not
 * surface — keeping re-enrichment idempotent after a roster/logic fix. Safety
 * rails: only `relationship = "founder"` rows are eligible; any person the user
 * has engaged (non-`none` outreach status or a recorded contact) is preserved,
 * and a delete that the DB rejects (e.g. an application references the row) is
 * swallowed with a note rather than aborting the run.
 */
function pruneStaleFounders(
  people: PersonRepo,
  companyId: number,
  keptIds: Set<number>,
  notes: string[],
): void {
  for (const p of people.listByCompany(companyId)) {
    if (p.relationship !== "founder" || keptIds.has(p.id)) continue;
    if (p.outreachStatus !== "none" || p.lastContactedAt) continue;
    try {
      people.remove(p.id);
    } catch (err) {
      notes.push(`could not prune stale founder ${p.name} (#${p.id}): ${String(err)}`);
    }
  }
}

/** Bounded-concurrency async map preserving input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function rosterEmployees(
  provider: EnrichmentProvider,
  company: Company,
  limit: number | undefined,
  notes: string[],
): Promise<Employee[]> {
  // Roster on EITHER identity: LinkedIn-keyed providers (HarvestAPI) use the
  // company LinkedIn URL; domain-keyed providers (Apollo) use the domain. Need
  // at least one (ADR-0003 made domain the primary anchor).
  if (!company.linkedinUrl && !company.domain) {
    notes.push(
      `company #${company.id} has no linkedin_url or domain; cannot roster employees (run resolve first).`,
    );
    return [];
  }
  try {
    return await provider.getEmployees({
      companyLinkedinUrl: company.linkedinUrl ?? "",
      domain: company.domain ?? undefined,
      limit: limit ?? 25,
    });
  } catch (err) {
    notes.push(`[${provider.name}] getEmployees failed: ${String(err)}`);
    return [];
  }
}

async function webSearch(
  provider: EnrichmentProvider,
  company: Company,
  notes: string[],
): Promise<WebSearchResult[]> {
  try {
    const results = await provider.search({
      q: `${company.name} funding`,
      engine: "web",
      limit: 5,
    });
    // search() can return web OR job results; keep only the web shape.
    return results.filter((r): r is WebSearchResult => "link" in r);
  } catch (err) {
    notes.push(`[${provider.name}] web search failed: ${String(err)}`);
    return [];
  }
}

/** Persist one resolved founder: upsert the row + write the deep-dive markdown. */
function persistFounder(
  people: PersonRepo,
  company: Company,
  resolved: ResolvedFounder,
  baseDir: string,
  usedSlugs: Set<string>,
): EnrichedPerson {
  const { emp, title, raw } = resolved;

  // Upsert by LinkedIn URL (its natural identity); fall back to a fresh row.
  const existing = emp.linkedinUrl ? people.getByLinkedinUrl(emp.linkedinUrl) : undefined;

  const slug = existing?.slug ?? uniqueSlug(emp.name, usedSlugs, people);
  usedSlugs.add(slug);
  const notesPath = join(baseDir, "people", `${slug}.md`);

  let person: Person;
  if (existing) {
    person =
      people.update(existing.id, {
        title: title ?? existing.title,
        companyId: existing.companyId ?? company.id,
        enrichmentBlob: raw !== undefined ? JSON.stringify(raw) : existing.enrichmentBlob,
        notesPath,
      }) ?? existing;
  } else {
    person = people.create({
      slug,
      name: emp.name,
      companyId: company.id,
      relationship: "founder",
      title: title ?? null,
      linkedinUrl: emp.linkedinUrl ?? null,
      enrichmentBlob: raw !== undefined ? JSON.stringify(raw) : null,
      notesPath,
    });
  }

  const md = renderPersonDeepDive({ person, company, raw });
  writeFile(notesPath, md);

  return { person, notesPath };
}

function uniqueSlug(name: string, used: Set<string>, repo: PersonRepo): string {
  const base = slugify(name) || "person";
  let candidate = base;
  let n = 2;
  while (used.has(candidate) || repo.getBySlug(candidate)) {
    candidate = `${base}-${n++}`;
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

function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}
