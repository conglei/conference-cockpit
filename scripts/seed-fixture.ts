import { createDb } from "../src/db/client";
import { createCompanyRepo, type CompanyInput } from "../src/db/repository";

// A handful of real companies so the stack is demoable end-to-end.
// (Domain/LinkedIn are intentionally left null — they get populated by the
// resolver in issue 02; this fixture only proves the schema + UI.)
const fixtures: CompanyInput[] = [
  {
    slug: "giga",
    name: "Giga",
    description: "AI support agents for enterprises.",
    category: "AI",
    stage: "Series A",
    workType: "onsite",
    location: "San Francisco",
    websiteUrl: "https://startups.gallery/companies/gigaml",
    status: "new",
    source: "startups_gallery",
    sourceDetail: "san-francisco-startups.csv",
  },
  {
    slug: "ploy",
    name: "Ploy",
    description: "Turn your website into a growth engine.",
    category: "Design",
    stage: "Seed",
    workType: "onsite",
    location: "San Francisco",
    websiteUrl: "https://startups.gallery/companies/ploy-ai",
    status: "new",
    source: "startups_gallery",
    sourceDetail: "san-francisco-startups.csv",
  },
  {
    slug: "prosper-ai",
    name: "Prosper AI",
    category: "AI",
    stage: "Series A",
    latestRound: "Series A",
    latestAmount: "$30M",
    lastFundingDate: "2026-06-22",
    leadInvestor: "a16z",
    status: "interesting",
    source: "csv",
    sourceDetail: "startups_funding_2026.csv",
  },
  {
    slug: "isometric",
    name: "Isometric",
    category: "AI",
    stage: "Series A",
    latestRound: "Series A",
    latestAmount: "$40M",
    lastFundingDate: "2026-06-22",
    leadInvestor: "AVP",
    status: "enriched",
    source: "csv",
    sourceDetail: "startups_funding_2026.csv",
  },
];

const repo = createCompanyRepo(createDb());

let created = 0;
for (const f of fixtures) {
  if (!repo.getBySlug(f.slug)) {
    repo.create(f);
    created++;
  }
}
console.log(`✓ Seed complete — ${created} new, ${fixtures.length - created} already present`);
