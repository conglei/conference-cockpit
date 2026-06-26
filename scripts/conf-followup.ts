/**
 * CLI: conference follow-up — the executor behind the `met-log` and
 * `draft-outreach` skills. DRAFTS ONLY: this never sends; it records who you met
 * and prints drafts for you to send manually.
 *
 *   pnpm conf-followup list                       # the follow-up queue + drafts
 *   pnpm conf-followup met <personId> [--note ".."] [--next ".."]
 *   pnpm conf-followup draft <personId>           # print a draft (never sent)
 *   pnpm conf-followup log <personId> <contacted|replied|bounced>
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createPersonRepo } from "../src/db/people-repository";
import { createCompanyRepo } from "../src/db/repository";
import { logMet, logTarget, followupQueue, draftFollowup } from "../src/followup";
import {
  logOutreach,
  LOGGABLE_OUTREACH_STATUSES,
  type LoggableOutreachStatus,
} from "../src/outreach/log-outreach";
import { loadGoalProfile } from "../src/plan";

loadEnvFile();

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const [cmd, idArg, statusArg] = process.argv.slice(2);
  const db = createDb(DB_URL);
  const people = createPersonRepo(db);
  const companies = createCompanyRepo(db);
  const summary = loadGoalProfile().summary;

  if (cmd === "list" || !cmd) {
    const queue = await followupQueue({ people, companies }, { profileSummary: summary });
    if (!queue.length) {
      console.log("Follow-up queue is empty. Log who you met: pnpm conf-followup met <personId>");
      return;
    }
    console.log(`\nFollow-up queue — ${queue.length} ${queue.length === 1 ? "person" : "people"}\n`);
    for (const it of queue) {
      console.log(
        `[${it.person.outreachStatus}] ${it.person.name}` +
          (it.companyName ? ` · ${it.companyName}` : "") +
          (it.person.nextAction ? `  → ${it.person.nextAction}` : ""),
      );
      console.log(`   draft: ${it.draft}`);
      console.log(`   (id ${it.person.id})\n`);
    }
    console.log("Drafts are starting points — rewrite + send manually. Nothing is sent for you.");
    return;
  }

  // `target` / `untarget` accept one or more ids (save a whole hit-list at once).
  if (cmd === "target" || cmd === "untarget") {
    const ids = process.argv.slice(3).map(Number).filter(Number.isFinite);
    if (!ids.length) {
      console.error(`Need at least one <personId>. e.g. pnpm conf-followup ${cmd} 1123 1211`);
      process.exit(1);
    }
    const clear = cmd === "untarget";
    for (const pid of ids) {
      const person = await logTarget({ people }, { personId: pid, note: flag("note"), clear });
      console.log(`${clear ? "Unsaved" : "Saved"}: ${person.name} (status=${person.outreachStatus})`);
    }
    return;
  }

  const id = Number(idArg);
  if (!Number.isFinite(id)) {
    console.error("Need a numeric <personId>.");
    process.exit(1);
  }

  if (cmd === "met") {
    const person = await logMet({ people }, { personId: id, note: flag("note"), nextAction: flag("next") });
    console.log(`Logged: met ${person.name} (status=${person.outreachStatus}, next="${person.nextAction}")`);
    return;
  }

  if (cmd === "draft") {
    const person = await people.get(id);
    if (!person) {
      console.error(`No person with id ${id}.`);
      process.exit(1);
    }
    const companyName = person.companyId ? ((await companies.get(person.companyId))?.name ?? null) : null;
    console.log(draftFollowup({ person, companyName, profileSummary: summary }));
    console.log("\n(draft only — send it yourself)");
    return;
  }

  if (cmd === "log") {
    if (!LOGGABLE_OUTREACH_STATUSES.includes(statusArg as LoggableOutreachStatus)) {
      console.error(`status must be one of: ${LOGGABLE_OUTREACH_STATUSES.join(", ")}`);
      process.exit(1);
    }
    const { person } = await logOutreach({ people }, { personId: id, status: statusArg as LoggableOutreachStatus });
    console.log(`Logged: ${person.name} → ${person.outreachStatus}`);
    return;
  }

  console.error(`Unknown command "${cmd}". Use: list | target | untarget | met | draft | log`);
  process.exit(1);
}

await main();
