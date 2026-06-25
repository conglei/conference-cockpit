/**
 * CLI: deterministic onboarding steps.
 *
 * This is the durable machinery the `onboard` skill drives. The conversational
 * interview itself is conducted by Claude (see .claude/skills/onboard/SKILL.md);
 * this CLI does the deterministic pieces:
 *
 *   1. Ingest a résumé into profile/resume.md (from --resume <path> or stdin).
 *   2. Scaffold profile/preferences.md and profile/narrative.md (kept if they
 *      already exist) for the interview to fill in.
 *   3. Ensure the SQLite DB exists / is migrated (idempotent).
 *   4. Print the env-check readout of active provider tiers + what to set next.
 *
 * Onboarding deliberately does NOT import/seed CSV data — that is a separate
 * explicit step (issue 02 / source-companies).
 *
 * Usage:
 *   pnpm onboard --resume path/to/resume.txt
 *   cat resume.txt | pnpm onboard --resume -
 *   pnpm onboard            # scaffold + ensure-db + env-check, no résumé
 */
import { readFileSync } from "node:fs";
import { detectProviderTiers, formatEnvCheck } from "../src/onboarding/env-check";
import { resolveEnv } from "../src/onboarding/env-file";
import { ensureDb } from "../src/onboarding/ensure-db";
import {
  ingestResume,
  ingestResumeFromPath,
  scaffoldProfileDocs,
} from "../src/onboarding/profile";
import { DB_URL } from "../src/db/client";

function getArg(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : undefined;
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  console.log("Onboarding — Conference Compass\n");

  // 1. Résumé ingest (optional; skip if no input given).
  const resumeArg = getArg("resume");
  if (resumeArg === "-") {
    const text = readStdin();
    if (text.trim().length === 0) {
      console.log("· résumé: stdin was empty — skipped.");
    } else {
      const path = ingestResume(text);
      console.log(`· résumé: wrote ${path} from stdin.`);
    }
  } else if (resumeArg) {
    const path = ingestResumeFromPath(resumeArg);
    console.log(`· résumé: wrote ${path} from ${resumeArg}.`);
  } else {
    console.log(
      "· résumé: no --resume given — paste it conversationally and the skill will ingest it.",
    );
  }

  // 2. Scaffold preferences/narrative for the interview to fill in.
  const docs = scaffoldProfileDocs();
  for (const [name, r] of Object.entries(docs)) {
    console.log(
      `· ${name}: ${r.created ? `scaffolded ${r.path}` : `${r.path} already exists — kept`}.`,
    );
  }

  // 3. Ensure the DB exists / is migrated (idempotent). No CSV seeding here.
  ensureDb();
  console.log(`· database: migrated/ensured at ${DB_URL}.`);

  // 4. Env-check readout.
  console.log("");
  const env = resolveEnv(process.env, process.env.ENV_FILE ?? ".env.local");
  console.log(formatEnvCheck(detectProviderTiers(env)));

  console.log(
    "\nNext: run the `onboard` skill to fill in preferences.md + narrative.md from a quick interview,",
  );
  console.log(
    "then `/plan-conference` (or `pnpm conf-plan`). The AIE 2026 demo is already seeded — importing a",
  );
  console.log(
    "different conference is a separate, optional step (see the README's \"Bring your own conference\").",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
