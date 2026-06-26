import type { Application, ApplicationStatus } from "../db/schema";
import type { ApplicationRepo } from "../db/applications-repository";
import { assertTransition } from "./transitions";

export type TrackResult = {
  application: Application;
  from: ApplicationStatus;
  to: ApplicationStatus;
};

/**
 * `track` — advance an application to a new status and record the next action.
 * This is the deterministic primitive the `track` skill drives. It validates
 * the transition against the lifecycle (transitions.ts) and persists through
 * the typed data layer; it does NOT decide *whether* to advance — that is the
 * skill's judgment.
 *
 * Throws if the application is missing or the transition is illegal.
 */
export async function track(
  repo: ApplicationRepo,
  id: number,
  to: ApplicationStatus,
  next?: { nextAction?: string | null; nextActionDate?: string | null },
): Promise<TrackResult> {
  const current = await repo.get(id);
  if (!current) throw new Error(`No application with id ${id}.`);

  const from = current.status;
  assertTransition(from, to);

  const updated = await repo.advance(id, to, next);
  if (!updated) throw new Error(`Failed to advance application ${id}.`);
  return { application: updated, from, to };
}

/**
 * Record/replace the next action on an application without changing its status
 * (e.g. "follow up Friday" while still `screening`). Persists through the data
 * layer; the *what/when* is the skill's call.
 */
export async function setNextAction(
  repo: ApplicationRepo,
  id: number,
  next: { nextAction?: string | null; nextActionDate?: string | null },
): Promise<Application> {
  const current = await repo.get(id);
  if (!current) throw new Error(`No application with id ${id}.`);
  const updated = await repo.update(id, next);
  if (!updated) throw new Error(`Failed to update application ${id}.`);
  return updated;
}
