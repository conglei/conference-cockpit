/**
 * Env-check: inspect the environment for provider credentials and report
 * which provider tiers are ACTIVE, plus exactly which env var(s) to set to
 * unlock the inactive ones.
 *
 * The detection logic is a pure function (env object -> structured statuses)
 * so it is trivially unit-testable. A thin formatter renders the readout.
 *
 * Providers (see PRD "Providers"):
 *   - HarvestAPI   — LinkedIn company/person profiles + company employees
 *   - SearchAPI    — Google web search + Google Jobs (powers find-jobs)
 */

export interface ProviderTier {
  /** Stable id for the tier. */
  id: "harvestapi" | "searchapi";
  /** Human-readable name. */
  name: string;
  /** One-line description of what this tier unlocks. */
  unlocks: string;
  /** Whether the tier is active (its env var is set & non-empty). */
  active: boolean;
  /** The env var name(s) that activate this tier. */
  envVars: string[];
  /**
   * When inactive, the precise instruction for what to set.
   * Undefined when active.
   */
  hint?: string;
}

export interface EnvCheckResult {
  tiers: ProviderTier[];
  /** How many tiers are currently active. */
  activeCount: number;
}

/** An env-like map. `process.env` satisfies this. */
export type EnvLike = Record<string, string | undefined>;

/** A var counts as set only if present and not blank/whitespace. */
function isSet(env: EnvLike, key: string): boolean {
  const v = env[key];
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Pure tier-detection. Feed it any env object; get back structured statuses.
 * No I/O, no side effects.
 */
export function detectProviderTiers(env: EnvLike): EnvCheckResult {
  const tiers: ProviderTier[] = [
    buildTier({
      id: "harvestapi",
      name: "HarvestAPI",
      unlocks: "LinkedIn company/person profiles and company-employee rosters",
      envVars: ["HARVESTAPI_KEY"],
      env,
    }),
    buildTier({
      id: "searchapi",
      name: "SearchAPI (searchapi.io)",
      unlocks: "Google web search (LinkedIn-URL resolution, funding/founder background) and Google Jobs",
      envVars: ["SEARCHAPI_KEY"],
      env,
    }),
  ];

  return {
    tiers,
    activeCount: tiers.filter((t) => t.active).length,
  };
}

function buildTier(args: {
  id: ProviderTier["id"];
  name: string;
  unlocks: string;
  envVars: string[];
  env: EnvLike;
}): ProviderTier {
  const { id, name, unlocks, envVars, env } = args;
  const missing = envVars.filter((k) => !isSet(env, k));
  const active = missing.length === 0;
  return {
    id,
    name,
    unlocks,
    envVars,
    active,
    hint: active
      ? undefined
      : `Set ${missing.join(" and ")} in .env.local to unlock ${name}.`,
  };
}

/**
 * Thin formatter: renders the structured result as a human-readable readout.
 */
export function formatEnvCheck(result: EnvCheckResult): string {
  const lines: string[] = [];
  lines.push("Provider tiers");
  lines.push("==============");
  lines.push(
    `${result.activeCount} of ${result.tiers.length} provider tier(s) active.`,
  );
  lines.push("");

  for (const tier of result.tiers) {
    const mark = tier.active ? "[active] " : "[inactive]";
    lines.push(`${mark} ${tier.name}`);
    lines.push(`    unlocks: ${tier.unlocks}`);
    if (tier.active) {
      lines.push(`    env: ${tier.envVars.join(", ")} set`);
    } else {
      lines.push(`    to enable: ${tier.hint}`);
    }
    lines.push("");
  }

  if (result.activeCount === result.tiers.length) {
    lines.push("All provider tiers configured.");
  } else {
    lines.push(
      "Add the missing keys to .env.local (kept out of git) and re-run onboarding to unlock more capability.",
    );
  }

  return lines.join("\n");
}
