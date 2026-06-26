/**
 * CLI: persist taste scores, plus an offline rubric triage.
 *
 *   pnpm score apply [file]   # persist agent-judged scores — a JSON array on
 *                             #   stdin (or a file): [{slug, founder_quality,
 *                             #   investor_quality, domain_fit, stage_fit,
 *                             #   size_fit, rationale, verdict?}]. Axes are 0–1
 *                             #   or null/omitted for "no data".
 *   pnpm score --fake [slug]  # deterministic rubric triage (offline test double)
 *
 * Real taste judgment is the AGENT's job — the `score-companies` skill reasons
 * over preferences.md + the company/founder/funding signal and EMITS the JSON
 * that `score apply` persists. This CLI never judges taste itself; it computes
 * `overall` from the user's weights (so weighting stays consistent) and writes
 * through the typed data layer. See ADR-0002 / ADR-0005.
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
  applyScores,
  type AppliedScoreInput,
} from "../src/scoring";

// tsx does not auto-load .env.local; do it before any env-dependent work.
loadEnvFile();

function readInput(arg: string | undefined): string {
  if (!arg || arg === "-") {
    try {
      return readFileSync(0, "utf8"); // stdin
    } catch {
      return "";
    }
  }
  return readFileSync(arg, "utf8");
}

/** The real path: persist the agent's judged scores from JSON. */
async function applyMode(fileArg: string | undefined): Promise<void> {
  const raw = readInput(fileArg).trim();
  if (!raw) {
    console.error(
      "score apply: no JSON given. Pipe an array on stdin or pass a file, e.g.\n" +
        `  echo '[{"slug":"acme","founder_quality":0.8,"rationale":"…"}]' | pnpm score apply -`,
    );
    process.exit(1);
  }
  let items: AppliedScoreInput[];
  try {
    const parsed = JSON.parse(raw);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    console.error(`score apply: invalid JSON — ${(e as Error).message}`);
    process.exit(1);
  }

  const repo = createCompanyRepo(createDb());
  const { weights } = loadPreferences();
  const { applied, notFound } = await applyScores(repo, items, weights);

  for (const a of applied) console.log(`✓ ${a.slug} — overall ${a.overall.toFixed(3)}`);
  for (const s of notFound) console.error(`· no company with slug "${s}" — skipped`);
  console.log(
    `Applied ${applied.length} score(s)${notFound.length ? `, ${notFound.length} not found` : ""}.`,
  );
  if (notFound.length && applied.length === 0) process.exit(1);
}

/** Offline double: deterministic rubric over the row signal (NOT taste judgment). */
async function fakeMode(slug: string | undefined): Promise<void> {
  const repo = createCompanyRepo(createDb());
  const { weights, prefilter: criteria, text: preferences } = loadPreferences();
  const all = await repo.list();
  const targets = slug ? all.filter((c) => c.slug === slug) : all;
  if (slug && targets.length === 0) {
    console.error(`No company with slug "${slug}".`);
    process.exit(1);
  }
  console.log(
    `[--fake] deterministic rubric over ${targets.length} company(ies) — ` +
      `NOT real taste judgment (that is the score-companies skill + 'score apply').`,
  );
  const { scored, dropped } = await scoreCompanies(targets, {
    repo,
    scorer: new FakeScorer(),
    weights,
    criteria,
    preferences,
  });
  for (const d of dropped) console.log(`· dropped ${d.company.name} — ${d.axis}: ${d.reason}`);
  for (const c of sortByScore(scored.map((s) => s.company), "overall")) {
    console.log(`✓ ${c.name} overall=${c.scoreOverall} — ${c.scoreRationale ?? ""}`);
  }
  console.log(`Done — scored ${scored.length}, dropped ${dropped.length}.`);
}

function usage(): never {
  console.error(
    "Usage:\n" +
      "  pnpm score apply [file]   persist agent-judged scores (JSON array via stdin or file)\n" +
      "  pnpm score --fake [slug]  deterministic rubric triage (offline test double)\n\n" +
      "Real taste scoring is the `score-companies` skill — it emits the JSON for `score apply`.",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "apply") return applyMode(args[1]);
  if (args.includes("--fake")) return fakeMode(args.find((a) => !a.startsWith("-")));
  usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
