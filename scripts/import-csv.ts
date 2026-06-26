/**
 * CLI: import a company CSV through a SUPPLIED column mapping.
 *
 *   pnpm import-csv <file.csv> [--map <map.ts|map.json>] [--source-detail <name>]
 *
 * The mapping is the adaptation seam. The `source-companies` skill inspects the
 * CSV's headers and a few sample rows, reasons about each column, and writes a
 * one-off `{ from, transform }` mapping for that file's quirks, then runs this.
 * This CLI carries NO heuristic header dictionary: with no `--map` it applies
 * only the identity passthrough (header already equals a canonical field name).
 *
 * A `.ts` map module exports a `ColumnMap` as `default` or named `map`/`columnMap`
 * (so transforms can split cells, derive domains, normalize vocab, …). A `.json`
 * map supports the string-rule form only (header → field copy).
 *
 * Provider selection is config, not code: ENRICHMENT_PROVIDER=fake|harvest|searchapi
 * (defaults to fake). Resolution degrades gracefully when a key is missing.
 */
import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { createDb } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { createProvider, SearchApiProvider } from "../src/providers";
import { parseCsv } from "../src/import/csv";
import { identityMap, type ColumnMap } from "../src/import/mapping";
import { importCsv } from "../src/import/import";

interface Args {
  csvPath?: string;
  mapPath?: string;
  sourceDetail?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--map") args.mapPath = argv[++i];
    else if (a === "--source-detail") args.sourceDetail = argv[++i];
    else if (!a.startsWith("--") && !args.csvPath) args.csvPath = a;
  }
  return args;
}

async function loadMap(mapPath: string): Promise<ColumnMap> {
  if (mapPath.endsWith(".json")) {
    const raw = JSON.parse(await readFile(mapPath, "utf8"));
    return raw as ColumnMap; // JSON maps use the string-rule form only
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

async function main() {
  const { csvPath, mapPath, sourceDetail } = parseArgs(process.argv.slice(2));
  if (!csvPath) {
    console.error(
      "Usage: pnpm import-csv <file.csv> [--map <map.ts|map.json>] [--source-detail <name>]",
    );
    process.exit(1);
  }

  const csvText = await readFile(csvPath, "utf8");

  let map: ColumnMap;
  if (mapPath) {
    map = await loadMap(mapPath);
  } else {
    // No mapping supplied: identity passthrough only (no heuristic guessing).
    const { headers } = parseCsv(csvText);
    map = identityMap(headers);
    console.log(
      `No --map given; using identity passthrough for headers that already match ` +
        `canonical fields: ${Object.keys(map).join(", ") || "(none)"}.`,
    );
  }

  const repo = createCompanyRepo(createDb());
  const provider = createProvider();
  const searchProvider =
    provider.name !== "searchapi" && process.env.SEARCHAPI_KEY
      ? new SearchApiProvider()
      : undefined;

  console.log(
    `Importing "${csvPath}" via provider "${provider.name}"` +
      (searchProvider ? " + web-search fallback" : "") +
      "…",
  );

  const result = await importCsv(repo, provider, csvText, map, {
    sourceDetail: sourceDetail ?? basename(csvPath),
    resolve: { searchProvider },
  });

  for (const o of result.outcomes) {
    if (o.kind === "inserted") {
      console.log(
        `✓ ${o.company.name} (#${o.company.id}) → domain=${o.company.domain ?? "—"} ` +
          `linkedin=${o.company.linkedinUrl ?? "—"}`,
      );
    } else if (o.kind === "duplicate") {
      console.log(
        `· ${o.company.name} — duplicate of #${o.matched.id} (${o.matched.name}); skipped`,
      );
    } else {
      console.log(`· skipped — ${o.reason}`);
    }
  }

  console.log(
    `Done — ${result.inserted} inserted, ${result.duplicates} duplicate, ${result.skipped} skipped.`,
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
