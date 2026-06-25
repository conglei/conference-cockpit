import type { PersonRepo, PersonPatch } from "../db/people-repository";
import type {
  ApplicationRepo,
  ApplicationPatch,
} from "../db/applications-repository";
import type { OutreachStatus, Person, Application } from "../db/schema";

/**
 * Outreach logging (issue 09) — the DETERMINISTIC primitive.
 *
 * This module does NOT generate any message text. Drafting an outreach note is
 * judgment and lives in the `reach-out` SKILL (.claude/skills/reach-out/SKILL.md),
 * which reasons over the user's `profile/narrative.md` + the target's deep-dive
 * and chooses register. Once the human has a draft, this primitive records the
 * *outcome* on the typed data layer so network activity becomes a queryable
 * funnel (people.outreach_status / next_action / next_action_date /
 * last_contacted_at, and optionally the linked applications row).
 *
 * Hard constraint — DRAFTS ONLY, NO SEND PATH. There is deliberately no email /
 * LinkedIn / API send anywhere in this slice. The user sends manually via
 * Claude-in-Chrome; the system only ever persists what happened. Logging an
 * attempt is the closest this code comes to "sending" — and it touches the DB,
 * never the network.
 */

/** Outreach lifecycle states this primitive is allowed to record. */
export const LOGGABLE_OUTREACH_STATUSES = [
  "drafted",
  "contacted",
  "replied",
  "bounced",
] as const satisfies readonly OutreachStatus[];

export type LoggableOutreachStatus = (typeof LOGGABLE_OUTREACH_STATUSES)[number];

export interface LogOutreachInput {
  /** The person the outreach was aimed at. */
  personId: number;
  /** New outreach lifecycle state for that person. */
  status: LoggableOutreachStatus;
  /**
   * The human-readable next step (e.g. "follow up if no reply in 5d"). Passing
   * `null` clears it; omitting it leaves the existing value untouched.
   */
  nextAction?: string | null;
  /** ISO date (YYYY-MM-DD) for the next action; `null` clears, omit leaves. */
  nextActionDate?: string | null;
  /**
   * Optional linked application to advance in lockstep. When the contact is the
   * referrer/contact on an application, recording a `contacted`/`replied`
   * outreach can also carry the application's next action forward.
   */
  applicationId?: number;
  /**
   * Epoch millis to stamp as `last_contacted_at`. Defaults to `Date.now()` when
   * the status reflects an actual touch (`contacted`/`replied`/`bounced`); for a
   * pure `drafted` log it stays untouched, since nothing has been sent yet.
   * Pass an explicit value (incl. for `drafted`) to override, or `null` to skip.
   */
  contactedAt?: number | null;
}

export interface LogOutreachResult {
  person: Person;
  application: Application | null;
}

/**
 * A status reflects an *actual touch* (the user sent something, or got a reply /
 * bounce) when it is anything other than `drafted`. `drafted` means a message
 * was prepared but NOT yet sent, so it must not stamp `last_contacted_at`.
 */
function isTouch(status: LoggableOutreachStatus): boolean {
  return status !== "drafted";
}

/**
 * Record an outreach attempt onto the person row (and optionally the linked
 * application), all through the typed data layer — no raw SQL, no network.
 *
 * @throws if the person (or named application) doesn't exist, so a mis-logged
 *         attempt fails loudly rather than silently writing nothing.
 */
export function logOutreach(
  repos: { people: PersonRepo; applications?: ApplicationRepo },
  input: LogOutreachInput,
  now: () => number = Date.now,
): LogOutreachResult {
  const existing = repos.people.get(input.personId);
  if (!existing) {
    throw new Error(`logOutreach: no person with id ${input.personId}`);
  }

  const patch: PersonPatch = { outreachStatus: input.status };
  if ("nextAction" in input) patch.nextAction = input.nextAction ?? null;
  if ("nextActionDate" in input)
    patch.nextActionDate = input.nextActionDate ?? null;

  // last_contacted_at: explicit override wins; otherwise stamp only on a real
  // touch. `drafted` never stamps it (nothing has been sent).
  if ("contactedAt" in input) {
    patch.lastContactedAt = input.contactedAt ?? null;
  } else if (isTouch(input.status)) {
    patch.lastContactedAt = now();
  }

  const person = repos.people.update(input.personId, patch);
  if (!person) {
    // update() only returns undefined if the row vanished between get + update.
    throw new Error(`logOutreach: failed to update person ${input.personId}`);
  }

  let application: Application | null = null;
  if (input.applicationId !== undefined) {
    if (!repos.applications) {
      throw new Error(
        "logOutreach: applicationId given but no applications repo provided",
      );
    }
    const appExisting = repos.applications.get(input.applicationId);
    if (!appExisting) {
      throw new Error(
        `logOutreach: no application with id ${input.applicationId}`,
      );
    }
    const appPatch: ApplicationPatch = {};
    if ("nextAction" in input) appPatch.nextAction = input.nextAction ?? null;
    if ("nextActionDate" in input)
      appPatch.nextActionDate = input.nextActionDate ?? null;
    application =
      repos.applications.update(input.applicationId, appPatch) ?? null;
  }

  return { person, application };
}
