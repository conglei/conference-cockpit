/**
 * Find LinkedIn URLs for people we don't have one for, via HarvestAPI
 * profile-search (by name, disambiguated by their company), then set
 * `linkedin_url` so `enrich-people` can pull their profile.
 *
 *   pnpm tsx scripts/find-linkedin.mts [--dry-run] [--limit N]
 *
 * Conservative matching to avoid wrong people: only accept a result whose name
 * matches exactly; when several share the name, prefer the one whose headline
 * mentions the person's company, else the top-ranked. Idempotent (skips people
 * who already have a url).
 */
import { loadEnvFile } from "../src/onboarding/load-env";
loadEnvFile();
import { createDb } from "../src/db/client";
import { createPersonRepo } from "../src/db/people-repository";

const KEY = process.env.HARVESTAPI_KEY;
if (!KEY) {
  console.error("HARVESTAPI_KEY missing");
  process.exit(1);
}
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const limArg = args.indexOf("--limit");
const limit = limArg >= 0 ? Number(args[limArg + 1]) : undefined;

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

type SearchEl = { name?: string; position?: string; linkedinUrl?: string; publicIdentifier?: string };

async function search(name: string): Promise<SearchEl[]> {
  const url = `https://api.harvest-api.com/linkedin/profile-search?search=${encodeURIComponent(name)}`;
  try {
    const res = await fetch(url, { headers: { "X-API-Key": KEY as string } });
    if (!res.ok) return [];
    const data = (await res.json()) as { elements?: SearchEl[] };
    return data.elements ?? [];
  } catch {
    return [];
  }
}

const db = createDb();
const people = createPersonRepo(db);
let targets = (await people.list()).filter((p) => !p.linkedinUrl && !p.workHistory);
if (limit) targets = targets.slice(0, limit);
console.log(`Searching LinkedIn for ${targets.length} people…`);

let found = 0;
let missed = 0;
const tally: string[] = [];

let idx = 0;
async function worker() {
  while (idx < targets.length) {
    const p = targets[idx++];
    const els = await search(p.name);
    const nameHits = els.filter((e) => norm(e.name) === norm(p.name));
    const co = norm(p.currentCompany);
    let pick: SearchEl | undefined;
    if (nameHits.length === 1) pick = nameHits[0];
    else if (nameHits.length > 1)
      pick = (co && nameHits.find((e) => norm(e.position).includes(co))) || nameHits[0];

    const url =
      pick?.linkedinUrl ??
      (pick?.publicIdentifier ? `https://www.linkedin.com/in/${pick.publicIdentifier}` : undefined);
    if (url) {
      found++;
      tally.push(`✓ ${p.name} → ${url.replace("https://www.linkedin.com/in/", "")}`);
      if (!dry) await people.update(p.id, { linkedinUrl: url });
    } else {
      missed++;
      tally.push(`· ${p.name} → (no confident match, ${els.length} results)`);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

console.log(tally.slice(0, 60).join("\n"));
console.log(`\n${dry ? "[dry-run] " : ""}Found ${found}, missed ${missed}, of ${targets.length}.`);
