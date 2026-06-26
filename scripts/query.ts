/**
 * CLI: the agent's scoped, READ-ONLY window into the conference graph (ADR-0005).
 * Returns compact, capped lists so the agent can narrow cheaply, then `get` for
 * detail on the few it shortlists. Opens the DB read-only — this command CANNOT
 * mutate data (write-back is `conf-followup`). Add --json for the agent.
 *
 *   pnpm query people   [--vertical X] [--company slug] [--speaking] [--q text] [--limit N] [--cursor N]
 *   pnpm query companies[--vertical X] [--hiring] [--q text] [--limit N]
 *   pnpm query roles    [--workType remote|hybrid|onsite] [--company slug] [--q text] [--limit N]
 *   pnpm query get <person|company|role> <id|slug>
 *   pnpm query verticals
 *   …append --json for machine output.
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createReadOnlyDb, DB_URL } from "../src/db/client";
import { createPersonRepo } from "../src/db/people-repository";
import { createCompanyRepo, createRoleRepo } from "../src/db/repository";
import { createTalkRepo } from "../src/db/talk-repository";
import {
  searchPeople,
  searchCompanies,
  searchRoles,
  getPerson,
  getCompany,
  getRole,
  listVerticals,
  type QueryRepos,
} from "../src/query";

loadEnvFile();

const argv = process.argv.slice(2);
const has = (name: string) => argv.includes(`--${name}`);
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const num = (s: string | undefined) => (s != null && Number.isFinite(Number(s)) ? Number(s) : undefined);
const json = has("json");

function out(result: unknown): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  // Compact human view — the agent uses --json; this is for a person sanity-check.
  console.log(JSON.stringify(result, null, 2));
}

async function main(): Promise<void> {
  const [cmd, sub, id] = argv.filter((a) => !a.startsWith("--"));
  const db = createReadOnlyDb(DB_URL); // read-only: this CLI cannot write.
  const repos: QueryRepos = {
    people: createPersonRepo(db),
    companies: createCompanyRepo(db),
    roles: createRoleRepo(db),
    talks: createTalkRepo(db),
  };
  const limit = num(flag("limit"));
  const cursor = num(flag("cursor"));

  switch (cmd) {
    case "people":
      return out(
        await searchPeople(repos, {
          q: flag("q"),
          vertical: flag("vertical"),
          company: flag("company"),
          speaking: has("speaking") ? true : undefined,
          limit,
          cursor,
        }),
      );
    case "companies":
      return out(
        await searchCompanies(repos, {
          q: flag("q"),
          vertical: flag("vertical"),
          hiring: has("hiring") ? true : undefined,
          limit,
          cursor,
        }),
      );
    case "roles":
      return out(
        await searchRoles(repos, {
          q: flag("q"),
          workType: flag("workType"),
          company: flag("company"),
          limit,
          cursor,
        }),
      );
    case "verticals":
      return out(await listVerticals(repos));
    case "get": {
      const key = id ?? "";
      const result =
        sub === "person"
          ? await getPerson(repos, Number.isFinite(Number(key)) ? Number(key) : key)
          : sub === "company"
            ? await getCompany(repos, key)
            : sub === "role"
              ? await getRole(repos, Number(key))
              : undefined;
      if (result === undefined) {
        console.error("Usage: pnpm query get <person|company|role> <id|slug>");
        process.exit(1);
      }
      if (result === null) {
        console.error(`No ${sub} found for "${key}".`);
        process.exit(1);
      }
      return out(result);
    }
    default:
      console.error(
        "Usage: pnpm query <people|companies|roles|verticals|get> [filters] [--json]\n" +
          "  e.g. pnpm query people --vertical 'AI in Healthcare' --speaking --json\n" +
          "       pnpm query get person ari-morcos --json",
      );
      process.exit(1);
  }
}

await main();
