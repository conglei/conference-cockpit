/**
 * Per-person DEEP profile enrichment — work history, education, headline, about,
 * location — fetched from the provider's LinkedIn profile endpoint and persisted
 * to the dedicated `people` columns (+ the raw element in `linkedin_profile`).
 *
 * This is the people analogue of {@link enrichCompanyInfo}: ONE `getProfile`
 * call per person keyed by their LinkedIn URL, persist the flattened fields,
 * stamp `profileEnrichedAt`. A person with no LinkedIn URL is skipped with a
 * note (the profile endpoint needs one). Provider is injected so tests run
 * offline against the FakeProvider, and a graceful provider failure becomes a
 * note rather than aborting a batch.
 */
import type { PersonRepo } from "../db/people-repository";
import type { Person } from "../db/schema";
import { CostMeter } from "../providers/cost";
import { ProviderConfigError, type EnrichmentProvider, type Profile } from "../providers/types";

export interface EnrichPersonResult {
  person: Person;
  costUsd: number;
  notes: string[];
}

export interface EnrichPersonOptions {
  meter?: CostMeter;
}

export async function enrichPerson(
  deps: { people: PersonRepo; provider: EnrichmentProvider },
  personId: number,
  opts: EnrichPersonOptions = {},
): Promise<EnrichPersonResult> {
  const { people, provider } = deps;
  const notes: string[] = [];

  const person = people.get(personId);
  if (!person) throw new Error(`enrichPerson: no person with id ${personId}`);

  const costBefore = opts.meter?.totalUsd() ?? 0;

  if (!person.linkedinUrl) {
    notes.push("no linkedin_url — cannot fetch a deep profile");
    return finish(person);
  }

  let profile: Profile;
  try {
    profile = await provider.getProfile({ linkedinUrl: person.linkedinUrl });
  } catch (err) {
    if (err instanceof ProviderConfigError) notes.push(`[${provider.name}] ${err.message}`);
    else notes.push(`[${provider.name}] unexpected error: ${String(err)}`);
    return finish(person);
  }

  const patch = profileToPatch(profile);
  if (Object.keys(patch).length > 0) {
    const updated = people.update(personId, patch);
    if (updated) Object.assign(person, updated);
  }

  return finish(person);

  function finish(p: Person): EnrichPersonResult {
    const costUsd = Math.round(((opts.meter?.totalUsd() ?? 0) - costBefore) * 1e6) / 1e6;
    return { person: p, costUsd, notes };
  }
}

/** Flatten a provider Profile into the dedicated people columns + raw blob. */
export function profileToPatch(profile: Profile): {
  headline?: string;
  location?: string;
  about?: string;
  currentCompany?: string;
  workHistory?: string;
  education?: string;
  linkedinProfile?: string;
  profileEnrichedAt?: number;
} {
  const el = (profile.raw ?? {}) as Record<string, unknown>;
  const patch: ReturnType<typeof profileToPatch> = {};

  const headline = asString(el.headline) ?? profile.title;
  if (headline) patch.headline = headline;
  if (profile.location) patch.location = profile.location;
  const about = asString(el.about);
  if (about) patch.about = about;
  if (profile.company) patch.currentCompany = profile.company;

  const work = workHistoryFrom(el);
  if (work) patch.workHistory = work;
  const edu = educationFrom(el);
  if (edu) patch.education = edu;

  // Always keep the raw element + a freshness stamp when we got a real payload.
  if (profile.raw !== undefined) {
    patch.linkedinProfile = JSON.stringify(el);
    patch.profileEnrichedAt = Date.now();
  }
  return patch;
}

/** JSON array of {company,title,start,end} from the LinkedIn `experience[]`. */
function workHistoryFrom(el: Record<string, unknown>): string | undefined {
  const exp = Array.isArray(el.experience) ? (el.experience as Record<string, unknown>[]) : [];
  const out = exp
    .map((e) => ({
      company: asString(e.companyName),
      title: asString(e.position),
      start: dateText(e.startDate),
      end: dateText(e.endDate),
    }))
    .filter((e) => e.company || e.title);
  return out.length > 0 ? JSON.stringify(out) : undefined;
}

/** JSON array of {school,degree,field} from the LinkedIn `education[]`. */
function educationFrom(el: Record<string, unknown>): string | undefined {
  const ed = Array.isArray(el.education) ? (el.education as Record<string, unknown>[]) : [];
  const out = ed
    .map((e) => ({
      school: asString(e.schoolName),
      degree: asString(e.degree),
      field: asString(e.fieldOfStudy),
    }))
    .filter((e) => e.school);
  return out.length > 0 ? JSON.stringify(out) : undefined;
}

/** LinkedIn dates are {year?, text?}; prefer the human text ("2026", "Present"). */
function dateText(v: unknown): string | undefined {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return asString(o.text) ?? (typeof o.year === "number" ? String(o.year) : undefined);
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// --- batch ---

export interface EnrichPeopleDeps {
  people: PersonRepo;
  makeProvider: (meter: CostMeter) => EnrichmentProvider;
}

export interface EnrichPeopleOptions {
  concurrency?: number;
  onResult?: (result: EnrichPersonResult) => void;
}

export interface EnrichPeopleResult {
  results: EnrichPersonResult[];
  totalUsd: number;
}

/**
 * Deep-enrich many people CONCURRENTLY with accurate per-person cost — each gets
 * its own meter + provider. A per-person failure is caught and skipped (the
 * batch never aborts); results preserve input order over the survivors.
 */
export async function enrichPeople(
  personIds: number[],
  deps: EnrichPeopleDeps,
  opts: EnrichPeopleOptions = {},
): Promise<EnrichPeopleResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  const slots = new Array<EnrichPersonResult | undefined>(personIds.length);
  let totalUsd = 0;
  let next = 0;

  const runOne = async (index: number): Promise<void> => {
    const meter = new CostMeter();
    const provider = deps.makeProvider(meter);
    try {
      const result = await enrichPerson({ people: deps.people, provider }, personIds[index], {
        meter,
      });
      slots[index] = result;
      totalUsd += meter.totalUsd();
      opts.onResult?.(result);
    } catch {
      // Tolerate a single person's failure: skip it, keep the batch going.
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, personIds.length) }, async () => {
    while (next < personIds.length) {
      const i = next++;
      await runOne(i);
    }
  });
  await Promise.all(workers);

  return {
    results: slots.filter((r): r is EnrichPersonResult => r !== undefined),
    totalUsd: Math.round(totalUsd * 1e6) / 1e6,
  };
}
