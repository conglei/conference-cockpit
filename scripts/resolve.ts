/**
 * CLI: resolve canonical identity (domain + linkedin_url) for companies.
 *
 *   pnpm resolve            # resolve all companies missing domain or linkedin
 *   pnpm resolve <slug>     # resolve a single company by slug
 *
 * Provider selection is config, not code: set ENRICHMENT_PROVIDER=fake|harvest|searchapi
 * in .env.local (defaults to fake). When the chosen provider lacks a key, the
 * step degrades gracefully and prints exactly what to configure.
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { createProvider, resolveCompany, SearchApiProvider } from "../src/providers";

// tsx does not auto-load .env.local; do it before any provider is constructed.
loadEnvFile();

async function main() {
  const arg = process.argv[2];
  const repo = createCompanyRepo(createDb(DB_URL));
  const provider = createProvider();

  // Web-search fallback tier: only wire a real SearchAPI when its key exists,
  // and skip it if the primary provider already IS searchapi (no double call).
  const searchProvider =
    provider.name !== "searchapi" && process.env.SEARCHAPI_KEY
      ? new SearchApiProvider()
      : undefined;

  const targets = arg
    ? [repo.getBySlug(arg)].filter((c): c is NonNullable<typeof c> => Boolean(c))
    : repo.list().filter((c) => !c.domain || !c.linkedinUrl);

  if (arg && targets.length === 0) {
    console.error(`No company with slug "${arg}".`);
    process.exit(1);
  }

  console.log(
    `Resolving ${targets.length} company(ies) via provider "${provider.name}"` +
      (searchProvider ? " + web-search fallback" : "") +
      "…",
  );

  let resolved = 0;
  for (const c of targets) {
    const r = await resolveCompany(repo, c.id, provider, { searchProvider });
    if (r.resolved) resolved++;
    const id = `${c.name} (#${c.id})`;
    if (r.resolved) {
      console.log(`✓ ${id} → domain=${r.company.domain ?? "—"} linkedin=${r.company.linkedinUrl ?? "—"} [${r.via}]`);
    } else {
      console.log(`· ${id} unresolved [${r.via}]`);
    }
    for (const n of r.notes) console.log(`    ⚠ ${n}`);
  }

  console.log(`Done — ${resolved}/${targets.length} resolved.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
