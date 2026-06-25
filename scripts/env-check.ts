/**
 * CLI: report which provider tiers are active and what to set to unlock more.
 * Reads process.env overlaid on .env.local (without mutating process.env).
 *
 *   pnpm env:check
 */
import { detectProviderTiers, formatEnvCheck } from "../src/onboarding/env-check";
import { resolveEnv } from "../src/onboarding/env-file";

const ENV_FILE = process.env.ENV_FILE ?? ".env.local";

const env = resolveEnv(process.env, ENV_FILE);
const result = detectProviderTiers(env);
console.log(formatEnvCheck(result));

// Non-zero exit if nothing is configured, so scripts can detect a bare setup.
process.exitCode = result.activeCount === 0 ? 1 : 0;
