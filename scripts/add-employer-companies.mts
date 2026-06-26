/**
 * Add the AIE speakers' notable employers as company rows (so they get company
 * pages + open-role discovery). Curated list with seeded domains for accurate
 * resolution. Idempotent + self-healing: run it AFTER enrich-companies and it
 * re-asserts the curated domain and clears firmographics for any company that
 * enrich mis-resolved to a same-name collision (e.g. Cognition→cognitionstudio).
 *
 *   pnpm tsx scripts/add-employer-companies.mts
 */
import { loadEnvFile } from "../src/onboarding/load-env";
loadEnvFile();
import { createDb } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const base = (d?: string | null) =>
  (d ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/^links\./, "").split(".")[0];

// name → canonical domain (curated). These are real AI/dev companies; banks,
// universities, consultancies, and "Self Employed" are intentionally excluded.
const LIST: [string, string][] = [
  ["Cognition", "cognition.ai"], ["Ollama", "ollama.com"], ["OpenRouter", "openrouter.ai"],
  ["Snorkel AI", "snorkel.ai"], ["Sarvam", "sarvam.ai"], ["PromptQL", "promptql.io"],
  ["Modular", "modular.com"], ["Nebius", "nebius.com"], ["Orkes", "orkes.io"],
  ["Gimlet Labs", "gimletlabs.ai"], ["Exo Labs", "exolabs.net"], ["Guardrails AI", "guardrailsai.com"],
  ["Cleric", "cleric.ai"], ["Inngest", "inngest.com"], ["Artificial Analysis", "artificialanalysis.ai"],
  ["Merge", "merge.dev"], ["Stigg", "stigg.io"], ["Dyna Robotics", "dyna.co"], ["Runlayer", "runlayer.com"],
];

const db = createDb();
const companies = createCompanyRepo(db);
let created = 0;
let healed = 0;
for (const [name, domain] of LIST) {
  const slug = slugify(name);
  const existing = await companies.getBySlug(slug);
  if (!existing) {
    await companies.create({ slug, name, domain, status: "new", source: "manual", sourceDetail: "aie_wf_2026 speaker employer" });
    created++;
  } else if (base(existing.domain) !== base(domain)) {
    // enrich attached a same-name collision — restore the right domain, drop bad firmographics.
    await companies.update(existing.id, { domain, description: null, linkedinCompanyId: null, sizeBand: null, status: "new" });
    healed++;
  }
}
console.log(`created ${created}, healed ${healed} (of ${LIST.length})`);
