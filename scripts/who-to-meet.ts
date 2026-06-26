/**
 * CLI: people-first who-to-meet (ADR-0004). Ranks the *people* worth meeting
 * across the whole conference — not gated by a company top-N — with each
 * person's why-meet, warm path, talk slot, and a draft opener.
 *
 *   pnpm who-to-meet                       # top 12 overall, by taste
 *   pnpm who-to-meet --vertical Healthcare # only people in a vertical
 *   pnpm who-to-meet --speaking            # only people with a talk slot
 *   pnpm who-to-meet --limit 20
 *   pnpm who-to-meet --json
 *
 * Ranks against profile/preferences.md (taste) + profile/resume.md (warm paths).
 */
import { readFileSync } from "node:fs";
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createPersonRepo } from "../src/db/people-repository";
import { createCompanyRepo } from "../src/db/repository";
import { createTalkRepo } from "../src/db/talk-repository";
import type { Talk } from "../src/db/schema";
import { loadGoalProfile } from "../src/plan/profile";
import {
  extractBackground,
  getObjective,
  rankPeople,
  type PeopleGraph,
} from "../src/plan/who-to-meet";

loadEnvFile();

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const speakingOnly = args.includes("--speaking");

  let limit = 12;
  const l = args.indexOf("--limit");
  if (l !== -1) limit = Number(args[l + 1]) || 12;

  let vertical: string | undefined;
  const v = args.indexOf("--vertical");
  if (v !== -1) vertical = args[v + 1];

  const iFlag = args.indexOf("--intent");
  const objective = getObjective(iFlag !== -1 ? args[iFlag + 1] : undefined);

  const db = createDb(DB_URL);
  const people = createPersonRepo(db);
  const companies = createCompanyRepo(db);
  const talks = createTalkRepo(db);

  const byId = new Map((await companies.list()).map((c) => [c.id, c]));
  // Pre-fetch talks once and group by speaker so the sync `talksBySpeaker`
  // callback (the ranker is synchronous) reads from an in-memory map.
  const talksBySpeakerId = new Map<number, Talk[]>();
  for (const t of await talks.list()) {
    if (t.speakerId == null) continue;
    const list = talksBySpeakerId.get(t.speakerId);
    if (list) list.push(t);
    else talksBySpeakerId.set(t.speakerId, [t]);
  }
  const graph: PeopleGraph = {
    people: await people.list(),
    companyById: (id) => (id == null ? undefined : byId.get(id)),
    talksBySpeaker: (id) => talksBySpeakerId.get(id) ?? [],
  };

  const profile = loadGoalProfile();
  const background = extractBackground(readIfPresent("profile/resume.md"));

  const ranked = rankPeople(
    { graph, profile, background, now: new Date(), objective },
    { limit, vertical, speakingOnly },
  );

  if (json) {
    console.log(JSON.stringify(ranked, null, 2));
    return;
  }

  const scope = vertical ? ` in "${vertical}"` : "";
  console.log(
    `Who to meet${scope} [${objective.label}] — top ${ranked.length} of ${graph.people.length} people` +
      (background.employers.length ? ` (warm paths vs ${background.employers.length} past employers)` : ""),
  );
  console.log("");
  for (const p of ranked) {
    console.log(`${p.rank}. ${p.name}  [${p.score.toFixed(2)}]`);
    console.log(`   ${p.headline ?? "—"}${p.currentCompany ? ` · ${p.currentCompany}` : ""}`);
    console.log(`   why: ${p.whyLine}`);
    if (p.talk) {
      console.log(
        `   talk: "${p.talk.title}" — ${[p.talk.day, p.talk.time, p.talk.room].filter(Boolean).join(", ")}`,
      );
    }
    if (p.warmPath.shared.length) console.log(`   warm: ${p.warmPath.shared.join("; ")}`);
    console.log("");
  }
}

await main();
