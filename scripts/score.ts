/**
 * CLI: run the hybrid taste scorer over the companies in the DB.
 *
 *   pnpm score                 # pre-filter + score every company
 *   pnpm score <slug>          # score a single company by slug
 *
 * What this CLI does (deterministic primitives only):
 *   1. loads weights + hard pre-filter criteria from profile/preferences.md;
 *   2. pre-filters rows (stage / location / work_type / category / size-band);
 *   3. scores survivors via an injected `Scorer` and persists sub-scores +
 *      overall + one-line rationale + scored_at through the typed data layer.
 *
 * What it does NOT do: it does not itself make the taste judgment. The real,
 * LLM-driven scoring lives in the `score-companies` SKILL
 * (.claude/skills/score-companies/SKILL.md) — the skill is the `Scorer` for a real
 * run. This CLI defaults to the deterministic `FakeScorer` so it is runnable
 * offline; pass `--fake` explicitly to be loud about it. See ADR-0002.
 */
import { readFileSync } from "node:fs";
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import {
  FakeScorer,
  loadPreferences,
  scoreCompanies,
  sortByScore,
} from "../src/scoring";

// tsx does not auto-load .env.local; do it before any env-dependent work.
loadEnvFile();

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

async function main() {
  const slug = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : undefined;
  const repo = createCompanyRepo(createDb());

  const { weights, prefilter: criteria, text: preferences } = loadPreferences();
  const narrative = readOptional("profile/narrative.md");

  const all = await repo.list();
  const targets = slug ? all.filter((c) => c.slug === slug) : all;
  if (slug && targets.length === 0) {
    console.error(`No company with slug "${slug}".`);
    process.exit(1);
  }

  // The real Scorer is the LLM skill; this CLI uses the deterministic FakeScorer
  // so it runs offline. A real scoring pass is driven by `score-companies` (skill).
  const scorer = new FakeScorer();
  console.log(
    `Scoring ${targets.length} company(ies) with scorer "${scorer.name}" ` +
      `(weights: founder=${weights.founder_quality} investor=${weights.investor_quality} ` +
      `domain=${weights.domain_fit} stage=${weights.stage_fit} size=${weights.size_fit})…`,
  );

  const { scored, dropped } = await scoreCompanies(targets, {
    repo,
    scorer,
    weights,
    criteria,
    preferences,
    narrative,
  });

  for (const d of dropped) {
    console.log(`· dropped ${d.company.name} (#${d.company.id}) — ${d.axis}: ${d.reason}`);
  }

  const ranked = sortByScore(
    scored.map((s) => s.company),
    "overall",
  );
  for (const c of ranked) {
    console.log(
      `✓ ${c.name} (#${c.id}) overall=${c.scoreOverall} — ${c.scoreRationale ?? ""}`,
    );
  }

  console.log(`Done — scored ${scored.length}, dropped ${dropped.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
