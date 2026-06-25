/**
 * CLI: outreach logging (issue 09). A THIN deterministic primitive — it records
 * an outreach attempt's outcome on a person (and optionally a linked
 * application). It does NOT generate any message text and has NO send path.
 *
 * Drafting the message is judgment and lives in the `reach-out` SKILL
 * (.claude/skills/reach-out/SKILL.md): the agent/human reasons over
 * profile/narrative.md + the target's deep-dive, chooses register, writes the
 * draft, the USER sends it manually via Claude-in-Chrome — and only THEN calls
 * this to log what happened. There is deliberately no email/LinkedIn send here.
 *
 *   # Log that you drafted a note to a person (slug or numeric id)
 *   pnpm reach-out log --person ada-lovelace --status drafted \
 *     --next "send via Claude-in-Chrome" --next-date 2026-06-24
 *
 *   # Log that you actually sent it (stamps last_contacted_at)
 *   pnpm reach-out log --person 42 --status contacted \
 *     --next "follow up if no reply" --next-date 2026-06-30
 *
 *   # Also carry the linked application's next-action forward
 *   pnpm reach-out log --person 42 --status contacted --application 7 \
 *     --next "await intro" --next-date 2026-06-30
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createPersonRepo } from "../src/db/people-repository";
import { createApplicationRepo } from "../src/db/applications-repository";
import { logOutreach, LOGGABLE_OUTREACH_STATUSES } from "../src/outreach";
import type { LoggableOutreachStatus } from "../src/outreach";

// tsx does not auto-load .env.local; do it before any env-dependent work.
loadEnvFile();

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

function usage(): never {
  console.error(
    [
      "Usage: pnpm reach-out log --person <slug|id> --status <status> \\",
      "         [--next <text>] [--next-date <YYYY-MM-DD>] [--application <id>]",
      "",
      `  --status one of: ${LOGGABLE_OUTREACH_STATUSES.join(" | ")}`,
      "",
      "Logs the OUTCOME of an outreach attempt. It never sends anything —",
      "drafting + sending is the reach-out SKILL + Claude-in-Chrome.",
    ].join("\n"),
  );
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] !== "log") usage();

  const db = createDb(DB_URL);
  const people = createPersonRepo(db);
  const applications = createApplicationRepo(db);

  const personRef = flag(args, "person");
  const statusRaw = flag(args, "status");
  if (!personRef || !statusRaw) usage();

  if (!LOGGABLE_OUTREACH_STATUSES.includes(statusRaw as LoggableOutreachStatus)) {
    console.error(
      `Invalid --status "${statusRaw}". Expected one of: ` +
        LOGGABLE_OUTREACH_STATUSES.join(" | "),
    );
    process.exit(1);
  }
  const status = statusRaw as LoggableOutreachStatus;

  // Resolve person by numeric id or slug.
  const person = /^\d+$/.test(personRef)
    ? people.get(Number(personRef))
    : people.getBySlug(personRef);
  if (!person) {
    console.error(`No person matching "${personRef}".`);
    process.exit(1);
  }

  const applicationRaw = flag(args, "application");
  const applicationId = applicationRaw ? Number(applicationRaw) : undefined;

  const result = logOutreach(
    { people, applications },
    {
      personId: person.id,
      status,
      // Only pass next-action keys when supplied, so omitting them leaves the
      // stored values untouched (the primitive treats "key present" as intent).
      ...(flag(args, "next") !== undefined ? { nextAction: flag(args, "next") } : {}),
      ...(flag(args, "next-date") !== undefined
        ? { nextActionDate: flag(args, "next-date") }
        : {}),
      ...(applicationId !== undefined ? { applicationId } : {}),
    },
  );

  console.log(
    `Logged outreach → ${result.person.name} (#${result.person.id}): ` +
      `status=${result.person.outreachStatus}` +
      (result.person.nextAction ? `, next="${result.person.nextAction}"` : "") +
      (result.person.nextActionDate ? ` by ${result.person.nextActionDate}` : "") +
      (result.person.lastContactedAt
        ? `, last_contacted=${new Date(result.person.lastContactedAt).toISOString()}`
        : ""),
  );
  if (result.application) {
    console.log(
      `  ↳ application #${result.application.id}: ` +
        `status=${result.application.status}` +
        (result.application.nextAction
          ? `, next="${result.application.nextAction}"`
          : ""),
    );
  }
}

main();
