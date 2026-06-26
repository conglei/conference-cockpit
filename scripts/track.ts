/**
 * CLI: `track` — the deterministic pipeline primitive (issue 08).
 *
 * The judgment (when to advance, what the next action is) lives in the `track`
 * skill — see .claude/skills/track/SKILL.md. This CLI only performs the
 * persistence + the lifecycle-validated status move.
 *
 *   pnpm track list [status]            # show the pipeline (optionally filtered)
 *   pnpm track advance <id> <status> ["next action" [next-action-date]]
 *   pnpm track next <id> "next action" [next-action-date]   # set next action only
 *   pnpm track leads                    # interesting + not-yet-contacted companies
 *
 * Statuses: interested · applied · referred · screening · interviewing · offer
 *           · rejected · withdrawn
 */
import { createDb, DB_URL } from "../src/db/client";
import { createApplicationRepo } from "../src/db/applications-repository";
import { track, setNextAction, isApplicationStatus } from "../src/track";

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const repo = createApplicationRepo(createDb(DB_URL));

  switch (cmd) {
    case "list": {
      const status = args[0];
      if (status && !isApplicationStatus(status))
        fail(`Unknown status "${status}".`);
      const rows = await repo.listWithContext(
        status && isApplicationStatus(status) ? { status } : undefined,
      );
      if (rows.length === 0) {
        console.log("Pipeline is empty.");
        return;
      }
      for (const r of rows) {
        const contact = r.contact ? ` · via ${r.contact.name}` : "";
        const next = r.application.nextAction
          ? ` → next: ${r.application.nextAction}` +
            (r.application.nextActionDate
              ? ` (${r.application.nextActionDate})`
              : "")
          : "";
        console.log(
          `#${r.application.id} [${r.application.status}] ${r.company.name} — ${r.role.title}${contact}${next}`,
        );
      }
      return;
    }

    case "advance": {
      const id = Number(args[0]);
      const to = args[1];
      if (!Number.isInteger(id)) fail("Usage: pnpm track advance <id> <status> …");
      if (!to || !isApplicationStatus(to)) fail(`Unknown status "${to}".`);
      const next =
        args.length > 2
          ? { nextAction: args[2] ?? null, nextActionDate: args[3] ?? null }
          : undefined;
      try {
        const res = await track(repo, id, to, next);
        console.log(`✓ #${id}: ${res.from} → ${res.to}`);
      } catch (err) {
        fail((err as Error).message);
      }
      return;
    }

    case "next": {
      const id = Number(args[0]);
      const action = args[1];
      if (!Number.isInteger(id) || !action)
        fail('Usage: pnpm track next <id> "next action" [date]');
      try {
        await setNextAction(repo, id, {
          nextAction: action,
          nextActionDate: args[2] ?? null,
        });
        console.log(`✓ #${id}: next action recorded`);
      } catch (err) {
        fail((err as Error).message);
      }
      return;
    }

    case "leads": {
      const leads = await repo.interestingNotContacted();
      if (leads.length === 0) {
        console.log("No interesting + not-yet-contacted companies right now.");
        return;
      }
      console.log(`${leads.length} interesting company(ies) not yet contacted:`);
      for (const { company, contacts } of leads) {
        const who = contacts
          .map((p) => `${p.name} (${p.relationship})`)
          .join(", ");
        console.log(`· ${company.name} [${company.status}] — reach: ${who}`);
      }
      return;
    }

    default:
      fail(
        "Usage: pnpm track <list|advance|next|leads> …\n" +
          "  list [status]\n" +
          '  advance <id> <status> ["next action" [date]]\n' +
          '  next <id> "next action" [date]\n' +
          "  leads",
      );
  }
}

await main();
