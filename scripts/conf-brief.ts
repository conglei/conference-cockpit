/**
 * CLI: a single company's sourced conference brief — the executor behind the
 * `company-brief` skill. Reuses the plan engine's lens shaping for one company.
 *
 *   pnpm conf-brief sierra            # brief for the company with slug "sierra"
 *   pnpm conf-brief sierra --json     # structured (every claim has provenance)
 *   pnpm conf-brief --lens career-mover resolve-ai
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { loadGraph, loadGoalProfile, getLens } from "../src/plan";
import { formatChip } from "../src/provenance";

loadEnvFile();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function main() {
  const slug = process.argv.slice(2).find((a) => !a.startsWith("--") && process.argv[process.argv.indexOf(a) - 1] !== "--lens");
  if (!slug) {
    console.error("Usage: pnpm conf-brief <company-slug> [--json] [--lens career-mover]");
    process.exit(1);
  }
  const lens = getLens(arg("lens") ?? "career-mover")!;
  const db = createDb(DB_URL);
  const company = createCompanyRepo(db).getBySlug(slug);
  if (!company) {
    console.error(`No company with slug "${slug}".`);
    process.exit(1);
  }

  const graph = loadGraph(db);
  const profile = loadGoalProfile();
  const now = new Date();
  const score = lens.scoreCompany(company, { profile, graph, now });
  const brief = lens.buildPlanned(company, score, 1, { profile, graph, now });

  if (hasFlag("json")) {
    console.log(JSON.stringify(brief, null, 2));
    return;
  }

  console.log(`\n${brief.name}  (${(brief.score * 100).toFixed(0)})  ${brief.domain ?? ""}`);
  console.log(`${brief.whyLine}\n`);
  for (const claim of brief.claims) {
    console.log(`• ${claim.label}: ${claim.text}  [${formatChip(claim.provenance, now)}]`);
  }
  if (brief.whoToMeet.length) {
    console.log(`\nWho to meet:`);
    for (const p of brief.whoToMeet) {
      const tag = p.speaking ? "🎤 speaking" : "attending";
      const slot = p.talk ? ` — ${[p.talk.day, p.talk.time, p.talk.room].filter(Boolean).join(", ")}` : "";
      console.log(`  - ${p.name}${p.title ? `, ${p.title}` : ""} (${tag})${slot}  [${formatChip(p.provenance, now)}]`);
    }
  }
  if (brief.talkLogistics.length) {
    console.log(`\nTalks:`);
    for (const t of brief.talkLogistics) console.log(`  - ${t}`);
  }
  if (brief.openRoles.length) {
    console.log(`\nOpen roles (${brief.openRoles.length}):`);
    for (const r of brief.openRoles) console.log(`  - ${r.title}${r.url ? `  ${r.url}` : ""}`);
  }
  console.log(`\nDraft opener:\n  ${brief.opener}\n`);
}

main();
