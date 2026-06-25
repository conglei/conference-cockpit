/**
 * CLI: `pnpm refresh` — the mechanical, NO-LLM half of the daily loop.
 *
 *   pnpm refresh                                   # run all configured sources
 *   pnpm refresh --csv list.csv [--map map.ts]     # add a CSV source
 *   pnpm refresh --gallery records.json            # add a startups.gallery source (fixture/export)
 *
 * For each source: fetch → dedupe (canonical identity) → insert as `new` →
 * resolve LinkedIn/domain. Then stamps `last_refresh_at` in `app_meta`. No LLM,
 * no prompts, no judgment — built to run headless on a schedule (cron / GitHub
 * Action / launchd). The agentic morning half (score/enrich/digest) lives in the
 * `daily` skill (.claude/skills/daily/SKILL.md), which calls this first.
 *
 * Sources are pluggable: the startups.gallery adapter takes an injected fetcher.
 * Live scraping is out of scope here, so this CLI feeds it from a saved JSON
 * export (`--gallery`); production can wire a real HTTP fetcher into
 * `StartupsGallerySource` without changing the pipeline. CSV import remains the
 * `import-csv` CLI's job; `--csv` here lets a CSV ride the same batch refresh.
 *
 * Provider selection is config, not code: ENRICHMENT_PROVIDER=fake|harvest|searchapi
 * (defaults to fake). Resolution degrades gracefully when a key is missing.
 */
import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { createAppMetaRepo } from "../src/db/app-meta-repository";
import { createProvider, SearchApiProvider } from "../src/providers";

// tsx does not auto-load .env.local; do it before any provider is constructed.
loadEnvFile();
import type { ColumnMap } from "../src/import/mapping";
import {
  CsvSource,
  StartupsGallerySource,
  refresh,
  type CompanySource,
} from "../src/sources";
import type { StartupsGalleryRecord } from "../src/sources";

interface Args {
  csv: { path: string; mapPath?: string }[];
  gallery: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { csv: [], gallery: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv") {
      const path = argv[++i];
      let mapPath: string | undefined;
      if (argv[i + 1] === "--map") {
        i++;
        mapPath = argv[++i];
      }
      args.csv.push({ path, mapPath });
    } else if (a === "--gallery") {
      args.gallery.push(argv[++i]);
    }
  }
  return args;
}

async function loadMap(mapPath: string): Promise<ColumnMap> {
  if (mapPath.endsWith(".json")) {
    return JSON.parse(await readFile(mapPath, "utf8")) as ColumnMap;
  }
  const mod = await import(pathToFileURL(resolvePath(mapPath)).href);
  const map = mod.default ?? mod.map ?? mod.columnMap;
  if (!map) {
    throw new Error(
      `Map module ${mapPath} must export a ColumnMap as default, "map", or "columnMap".`,
    );
  }
  return map as ColumnMap;
}

async function buildSources(args: Args): Promise<CompanySource[]> {
  const sources: CompanySource[] = [];

  for (const c of args.csv) {
    const csvText = await readFile(c.path, "utf8");
    const map = c.mapPath ? await loadMap(c.mapPath) : undefined;
    sources.push(new CsvSource({ csvText, map, name: basename(c.path) }));
  }

  for (const g of args.gallery) {
    const records = JSON.parse(await readFile(g, "utf8")) as StartupsGalleryRecord[];
    sources.push(new StartupsGallerySource({ fetcher: async () => records }));
  }

  return sources;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = await buildSources(args);

  if (sources.length === 0) {
    console.error(
      "No sources configured. Pass --csv <file.csv> [--map <map>] and/or " +
        "--gallery <records.json>.\n" +
        "(Live startups.gallery scraping is out of scope; feed a saved export.)",
    );
    process.exit(1);
  }

  const db = createDb(DB_URL);
  const companies = createCompanyRepo(db);
  const appMeta = createAppMetaRepo(db);
  const provider = createProvider();
  const searchProvider =
    provider.name !== "searchapi" && process.env.SEARCHAPI_KEY
      ? new SearchApiProvider()
      : undefined;

  console.log(
    `Refreshing ${sources.length} source(s) via provider "${provider.name}"` +
      (searchProvider ? " + web-search fallback" : "") +
      "…",
  );

  const r = await refresh(
    { companies, appMeta, provider },
    sources,
    { resolve: { searchProvider } },
  );

  for (const s of r.sources) {
    console.log(
      `\n[${s.source}] fetched ${s.fetched} — ` +
        `${s.result.inserted} inserted, ${s.result.duplicates} duplicate, ` +
        `${s.result.skipped} skipped`,
    );
    for (const o of s.result.outcomes) {
      if (o.kind === "inserted") {
        console.log(
          `  ✓ ${o.company.name} (#${o.company.id}) → ` +
            `domain=${o.company.domain ?? "—"} linkedin=${o.company.linkedinUrl ?? "—"}`,
        );
      } else if (o.kind === "duplicate") {
        console.log(`  · ${o.company.name} — duplicate of #${o.matched.id}; skipped`);
      }
    }
    for (const n of s.notes) console.log(`  ⚠ ${n}`);
  }

  console.log(
    `\nDone — ${r.inserted} inserted, ${r.duplicates} duplicate, ${r.skipped} skipped ` +
      `across ${r.sources.length} source(s). last_refresh_at=${r.refreshedAt}.`,
  );
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
