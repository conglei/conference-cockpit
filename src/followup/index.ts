/**
 * Conference follow-up (product-design.md §11 Phase 5) — "pure money": the
 * week-after flow of "here are the people you met, what you said you'd do,
 * drafts — send?". Built on the existing drafts-only `logOutreach` primitive.
 *
 * HARD CONSTRAINT (inherited): DRAFTS ONLY, NO SEND PATH. This module records
 * who you met and what to do next, and *generates draft text* — it never sends
 * anything. The user sends manually. Drafting copy is normally a judgment call
 * (the `draft-outreach` skill); `draftFollowup` here is a plain, clearly-a-draft
 * starting template, the follow-up sibling of the plan engine's opener.
 */
import type { PersonRepo } from "../db/people-repository";
import type { CompanyRepo } from "../db/repository";
import type { Person } from "../db/schema";

const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;

export interface LogMetInput {
  personId: number;
  /** A short reminder of what you talked about / agreed to. */
  note?: string;
  /** Next step, e.g. "send the repo link". Defaults to "send follow-up". */
  nextAction?: string;
  /** ISO YYYY-MM-DD for the next step. */
  nextActionDate?: string;
}

/**
 * Record that you met someone at the event. Sets outreach_status='met' and
 * stamps last_contacted_at (meeting in person IS a real touch). Never regresses
 * a person already further along the funnel (drafted/contacted/replied).
 */
export async function logMet(
  repos: { people: PersonRepo },
  input: LogMetInput,
  now: () => number = Date.now,
): Promise<Person> {
  const existing = await repos.people.get(input.personId);
  if (!existing) throw new Error(`logMet: no person with id ${input.personId}`);

  // Don't regress someone you've already drafted/contacted/replied with.
  const ALREADY_PAST_MET = new Set(["drafted", "contacted", "replied"]);
  const status = ALREADY_PAST_MET.has(existing.outreachStatus)
    ? existing.outreachStatus
    : "met";

  const note = input.note ? input.note.trim() : undefined;
  const person = await repos.people.update(input.personId, {
    outreachStatus: status,
    lastContactedAt: now(),
    nextAction: input.nextAction ?? existing.nextAction ?? "send follow-up",
    nextActionDate: input.nextActionDate ?? existing.nextActionDate ?? null,
    // Stash the meeting note in the markdown notes path? Keep it light: prepend
    // to next_action so it's visible in the queue without a new column.
    ...(note ? { nextAction: `${input.nextAction ?? "send follow-up"} — re: ${note}` } : {}),
  });
  if (!person) throw new Error(`logMet: failed to update person ${input.personId}`);
  return person;
}

/**
 * Save someone to your who-to-meet list (PREP phase). Sets
 * outreach_status='targeted' WITHOUT stamping last_contacted_at — you haven't
 * contacted them, you've flagged them to meet. Never regresses anyone already
 * met / further along. Pass `clear` to un-save (back to 'none').
 */
export async function logTarget(
  repos: { people: PersonRepo },
  input: { personId: number; note?: string; clear?: boolean },
): Promise<Person> {
  const existing = await repos.people.get(input.personId);
  if (!existing) throw new Error(`logTarget: no person with id ${input.personId}`);

  if (input.clear) {
    const cleared = await repos.people.update(input.personId, {
      outreachStatus: existing.outreachStatus === "targeted" ? "none" : existing.outreachStatus,
    });
    if (!cleared) throw new Error(`logTarget: failed to update person ${input.personId}`);
    return cleared;
  }

  // Only "none" can move up to "targeted"; never pull a met/contacted person back.
  if (existing.outreachStatus !== "none") return existing;
  const note = input.note ? input.note.trim() : undefined;
  const person = await repos.people.update(input.personId, {
    outreachStatus: "targeted",
    nextAction: note ? `meet at AIE — ${note}` : (existing.nextAction ?? "meet at AIE"),
  });
  if (!person) throw new Error(`logTarget: failed to update person ${input.personId}`);
  return person;
}

export interface FollowupItem {
  person: Person;
  companyName: string | null;
  /** Suggested draft the user can copy + rewrite (never sent). */
  draft: string;
}

/** Statuses that are still "open" in the funnel (action still owed) — incl. saved targets. */
const OPEN_FOLLOWUP = new Set(["targeted", "met", "drafted", "contacted"]);

/**
 * The follow-up queue: everyone you've met (or started contacting) who still
 * owes an action, newest-touched first, each with a draft suggestion.
 */
export async function followupQueue(
  repos: { people: PersonRepo; companies: CompanyRepo },
  opts: { profileSummary?: string } = {},
): Promise<FollowupItem[]> {
  const people = (await repos.people.list())
    .filter((p) => OPEN_FOLLOWUP.has(p.outreachStatus))
    .sort((a, b) => (b.lastContactedAt ?? 0) - (a.lastContactedAt ?? 0));
  return Promise.all(
    people.map(async (person) => {
      const companyName = person.companyId
        ? ((await repos.companies.get(person.companyId))?.name ?? null)
        : null;
      return {
        person,
        companyName,
        draft: draftFollowup({ person, companyName, profileSummary: opts.profileSummary }),
      };
    }),
  );
}

/** A plain, clearly-a-draft follow-up message. Draft only — never sent. */
export function draftFollowup(input: {
  person: Person;
  companyName?: string | null;
  profileSummary?: string;
}): string {
  const co = input.companyName ? ` and the work at ${input.companyName}` : "";
  return (
    `Hi ${firstName(input.person.name)} — great meeting you at AIE. ` +
    `Really enjoyed our chat${co}. ` +
    `Would love to keep the conversation going — are you around for a quick call next week?`
  );
}
