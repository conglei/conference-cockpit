/**
 * Orchestrator for the people-first "who to meet" view (ADR-0004). This is the
 * single seam the home page (`src/app/page.tsx`) and the `who-to-meet` CLI both
 * consume: it loads the graph from the DB, prefetches talks once, derives the
 * vertical facet and the saved set, loads the user's taste + warm-path
 * background, and runs the pure `rankPeople` scorer. Callers stay thin — no
 * graph-building or ranking lives in the view or the CLI.
 *
 * The pure scoring stays in `who-to-meet.ts` (fully unit-testable over plain
 * data); this module adds the DB I/O and the per-request wiring that used to be
 * copy-pasted into each adapter. `deps` lets a test inject profile/background so
 * `planWhoToMeet` can run over a temp DB without reading `profile/*.md`.
 */
import { readFileSync } from "node:fs";
import type { DB } from "../db/client";
import { asList } from "../db/columns";
import { createPersonRepo } from "../db/people-repository";
import { createCompanyRepo } from "../db/repository";
import { createTalkRepo } from "../db/talk-repository";
import type { Company, Talk } from "../db/schema";
import { loadGoalProfile } from "./profile";
import type { GoalProfile, PlannedPerson } from "./types";
import {
  extractBackground,
  getObjective,
  rankPeople,
  type Objective,
  type PeopleGraph,
  type UserBackground,
} from "./who-to-meet";

export interface WhoToMeetQuery {
  /** Intent key → objective (e.g. "career-mover", "learner"). */
  intent?: string;
  /** Restrict to a single vertical (own talk track or focused-company match). */
  vertical?: string;
  /** Only people with a talk slot. */
  speakingOnly?: boolean;
  /** Only people already saved to the list (outreach_status === "targeted"). */
  savedOnly?: boolean;
  /** Page size for the ranked list (ignored under savedOnly, which ranks deep). */
  limit?: number;
}

export interface WhoToMeetView {
  /** Ranked + filtered people, ready to render. */
  people: PlannedPerson[];
  /** Employer lookup — a person's company is an attribute (links + chips). */
  companies: Map<number, Company>;
  /** People saved to the who-to-meet list (outreach_status === "targeted"). */
  savedIds: Set<number>;
  /** Distinct verticals across the graph, sorted — for the filter facet. */
  verticals: string[];
  /** Total people in the graph (for the "N people across M verticals" line). */
  totalPeople: number;
  /** The objective the Intent resolved to. */
  objective: Objective;
  /** The warm-path basis (parsed from the résumé) — for "vs N past employers". */
  background: UserBackground;
}

export const DEFAULT_WHO_TO_MEET_LIMIT = 30;

/** Read profile/resume.md if present (for warm paths); undefined when absent. */
function readResume(): string | undefined {
  try {
    return readFileSync("profile/resume.md", "utf8");
  } catch {
    return undefined;
  }
}

export async function planWhoToMeet(
  db: DB,
  q: WhoToMeetQuery = {},
  deps: { profile?: GoalProfile; background?: UserBackground; now?: Date } = {},
): Promise<WhoToMeetView> {
  const [allPeople, allCompanies, allTalks] = await Promise.all([
    createPersonRepo(db).list(),
    createCompanyRepo(db).list(),
    createTalkRepo(db).list(),
  ]);

  const companies = new Map(allCompanies.map((c) => [c.id, c]));

  // Prefetch talks once, indexed by speaker, so the (synchronous) graph callback
  // never hits the DB — the same pattern `loadGraph` uses for the plan engine.
  const talksBySpeakerId = new Map<number, Talk[]>();
  for (const t of allTalks) {
    if (t.speakerId == null) continue;
    const list = talksBySpeakerId.get(t.speakerId);
    if (list) list.push(t);
    else talksBySpeakerId.set(t.speakerId, [t]);
  }

  const graph: PeopleGraph = {
    people: allPeople,
    companyById: (id) => (id == null ? undefined : companies.get(id)),
    talksBySpeaker: (id) => talksBySpeakerId.get(id) ?? [],
  };

  const vset = new Set<string>();
  for (const c of allCompanies) for (const v of asList(c.verticals)) vset.add(v);
  const verticals = [...vset].sort();

  const savedIds = new Set(
    allPeople.filter((p) => p.outreachStatus === "targeted").map((p) => p.id),
  );

  const objective = getObjective(q.intent);
  const profile = deps.profile ?? loadGoalProfile();
  const background = deps.background ?? extractBackground(readResume());
  const now = deps.now ?? new Date();

  // savedOnly ranks deep enough that every saved person surfaces, then filters.
  const limit = q.savedOnly
    ? Math.max(allPeople.length, 1)
    : q.limit ?? DEFAULT_WHO_TO_MEET_LIMIT;
  const ranked = rankPeople(
    { graph, profile, background, now, objective },
    { limit, vertical: q.vertical, speakingOnly: q.speakingOnly },
  );
  const people = q.savedOnly ? ranked.filter((p) => savedIds.has(p.personId)) : ranked;

  return {
    people,
    companies,
    savedIds,
    verticals,
    totalPeople: allPeople.length,
    objective,
    background,
  };
}
