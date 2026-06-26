/**
 * CLI: build the conference plan — the §11 "aha" (488 names → ~8 sourced
 * target companies, in under a minute). The deterministic executor behind the
 * `plan-conference` skill.
 *
 *   pnpm conf-plan                 # Career Mover, top 8, human-readable
 *   pnpm conf-plan --limit 12      # more targets
 *   pnpm conf-plan --json          # structured plan (every claim has provenance)
 *   pnpm conf-plan --lens career-mover
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import {
  buildPlan,
  loadGraph,
  loadGoalProfile,
  getLens,
  DEFAULT_PLAN_LIMIT,
} from "../src/plan";
import { formatChip } from "../src/provenance";

loadEnvFile();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const lensKey = arg("lens") ?? "career-mover";
  const limit = Number(arg("limit") ?? DEFAULT_PLAN_LIMIT);
  const lens = getLens(lensKey);
  if (!lens) {
    console.error(`Unknown lens "${lensKey}". Available: career-mover`);
    process.exit(1);
  }

  const db = createDb(DB_URL);
  const plan = buildPlan({
    lens,
    profile: loadGoalProfile(),
    graph: await loadGraph(db),
    limit,
  });

  if (hasFlag("json")) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const now = new Date(plan.generatedAt);
  console.log(
    `\n${lens.label} plan — ${plan.companies.length} of ${plan.consideredCompanies} ranked companies\n`,
  );
  for (const c of plan.companies) {
    console.log(`${c.rank}. ${c.name}  (${(c.score * 100).toFixed(0)})  ${c.domain ?? ""}`);
    console.log(`   ${c.whyLine}`);
    for (const claim of c.claims) {
      console.log(`     • ${claim.label}: ${claim.text}  [${formatChip(claim.provenance, now)}]`);
    }
    if (c.whoToMeet.length) {
      console.log(`   Who to meet:`);
      for (const p of c.whoToMeet) {
        const tag = p.speaking ? "🎤 speaking" : "attending";
        const slot = p.talk
          ? ` — ${[p.talk.day, p.talk.time, p.talk.room].filter(Boolean).join(", ")}`
          : "";
        console.log(`     - ${p.name}${p.title ? `, ${p.title}` : ""} (${tag})${slot}`);
      }
    }
    if (c.openRoles.length) {
      console.log(`   Open roles: ${c.openRoles.map((r) => r.title).slice(0, 4).join(" · ")}`);
    }
    console.log(`   Opener: ${c.opener}`);
    console.log();
  }
}

await main();
