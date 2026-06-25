# ADR 0003 — Domain-first enrichment & hybrid taste ranking

Status: Accepted
Date: 2026-06-24

## Context

The first full enrichment + scoring run over the funnel (~352 companies) exposed
systemic failure modes that no amount of downstream polish can fix, because they
originate at the top of the pipeline:

- **Wrong-company identity.** Identity was resolved by feeding a company **name**
  into a LinkedIn search and trusting the top hit. For common/ambiguous names
  this silently resolves the wrong entity — "Paradigm" → Paradigm-the-VC,
  `/dev/agents` → an unrelated "aistaff" — and we then confidently enrich the
  *wrong* founders and score them.
- **Silent zero-founder.** ~85 / 352 enriched companies came back with **0
  founders**, indistinguishable from "this company has no founders." The roster
  step depends on a correct LinkedIn company id; when identity is wrong or thin,
  it returns nothing and the failure is invisible.
- **Fabricated scores.** The taste scorer emitted confident sub-scores
  (`founder_quality = 0.4`, `investor_quality = 0.45`) for companies where we had
  **no** founder or investor data — a guess dressed as a judgment.
- **Coarse keyword judgment.** Domain fit, founder pedigree, and investor tier
  were all hand-maintained keyword lists. They misfire ("rowspace" matched the
  "space" single-modality keyword; AI-cybersecurity scored as core-AI) and the
  tables are load-bearing for real decisions.

Root cause: **identity is the linchpin and it was being guessed by name.** Every
downstream signal (founders, investors, scores) inherits a wrong or empty
identity. The fix is to anchor identity on the **domain** — which is far less
ambiguous than a name — and to make the system **fail loudly** (flag, don't
guess) when it can't resolve. Per ADR-0001 identity is already `domain OR
linkedin_url`; we were simply not establishing the domain. Per ADR-0002 judgment
belongs in the skill, not a CLI heuristic; the keyword rubric violated that for
scoring.

We also surveyed the provider market (Proxycurl is defunct as of 2025; Coresignal
$49/mo, PDL $98/mo, Crunchbase $99/mo, Apollo connected). Decision: stay on the
**already-connected, near-free base (Apollo + HarvestAPI)** and treat richer paid
sources as optional switches, because a correct **domain** makes any provider
resolve cleanly — the provider is secondary to the anchor.

## Decision

### 1. Domain-first identity resolution (the linchpin)

Establish the domain **before** any LinkedIn/founder lookup, and corroborate.

1. **Acquire the domain by crawling the source aggregator page** (startups.gallery
   is a Framer SPA): fetch **raw HTML** (not a markdown-converting fetcher, which
   strips it), extract external links, **denylist** known non-company hosts
   (framer, social, news, careers, form embeds), and **frequency-rank** — the
   company domain wins decisively over noise. Validated: recovers
   `paradigmai.com`, `sdsa.ai`, `0.email` for the three worst failures.
   - The aggregator URL is a **transient resolution input, not a stored field.**
     We crawl it to derive the real **domain + website** and persist *those*; the
     aggregator URL itself is never written to the DB. At import the CSV row still
     carries the URL, so resolution can crawl it inline; for already-imported rows
     a one-off recovery re-reads the source CSV transiently. (Sources without an
     aggregator page fall back to web-search for the domain.)
2. **Resolve identity by domain.** `domain → Apollo organizations_enrich(domain)`
   for firmographics + LinkedIn URL.
3. **Corroborate.** Accept the LinkedIn/identity only if the resolved company's
   `website` apex-domain **equals** the crawled domain. This gate is what rejects
   Paradigm-the-VC and `aistaff`.
4. **Fail loud.** If nothing corroborates, mark the company **`unresolved`** and
   surface it in a queue — never silently take a best guess.

### 2. Providers & the recovery ladder

Providers are layered cheapest→richest behind the domain anchor:

- **Identity / firmographics:** Apollo `organizations_enrich(domain)` (1 credit;
  free if not found).
- **Founders:** Apollo people-search (free) by resolved org id → HarvestAPI for
  the deep per-founder profile (experience/education the scorer uses).
- **Investors / funding:** the funding CSV (refreshed) + Apollo funding fields.
- **Optional upgrade:** Coresignal ($49/mo) returns founders + lead investors +
  funding + founder-count in one domain-keyed call — a single config switch, not
  a dependency.

**Recovery ladder for a thin/empty result** (applied in order, escalating):

1. aggregator-crawl → domain (free, auto)
2. domain → Apollo / HarvestAPI → founders (auto)
3. web-search for founders — **triggered only when the roster is empty/thin**
   (the domain gate already kills the wrong-company case, so an always-on
   cross-check is redundant cost)
4. **no founder signal → alert the user.** They fill it in manually, or trigger a
   **Claude-in-Chrome browser pass** that opens the company's team/about page or
   LinkedIn and extracts founders. Human-in-the-loop, on-demand — not blanket.

### 3. Hybrid taste ranking (judgment where it matters)

Per ADR-0002, genuine judgment is the skill; but per-company LLM judgment over
hundreds of companies every re-score is too slow/expensive. Resolve with a
**tier-gated hybrid**:

- **Rubric triages all** companies (cheap, deterministic) — purely to sort into
  tiers. The keyword tables stay, but stop being load-bearing for decisions.
- **LLM deep-reviews the shortlist** — the top tier, gated on **rank ∩ coverage**
  (a company must have real founder/investor signal to be worth a verdict).
- **LLM output** per shortlisted company: the 5 sub-scores **plus a structured
  verdict** — thesis, **concerns / risks**, **what to verify before outreach**,
  and a **confidence**. Every row is tagged **`scored_by` = `rubric` | `llm`** so
  triage vs. deep-reviewed is always visible.

**Missing data is first-class, never fabricated:**

- A sub-score with no underlying data is **NULL**, not a number, and the
  rationale says **`⚠ no founder data` / `⚠ no investor data`** explicitly.
- `overall` is the weighted average over the **present** axes, then **discounted
  for missing co-dominant coverage** (one missing → ×0.8, both → ×0.6) so a
  company we can't actually evaluate can't outrank a fully-vetted one.
- A **thin-but-promising** company (ranks high, missing a co-dominant axis) is
  **not** scored hollow and **not** handed to the LLM to conclude "unknown" — it
  is routed to the **re-enrich / recovery queue** (§2) to *get* the data, then
  re-enters review.

**The ranking learns (suggest, don't apply):** the funnel already captures
revealed preference (`interesting` / `contacted` / `passed`). Periodically the
LLM contrasts kept vs. passed companies and **proposes** concrete
`preferences.md` edits ("you keep passing AI-cybersecurity despite high scores →
down-weight"). The user **accepts** edits; `preferences.md` stays the editable
source of truth — nothing changes silently.

## Consequences

- Identity errors become **visible** (`unresolved` queue) instead of silent wrong
  enrichments; the ~85 zero-founder cases become recoverable work items.
- The domain anchor makes the provider choice a **swappable** detail; we ship on
  the near-free Apollo+HarvestAPI base with no new subscription.
- Scores stop lying: missing data reads as missing, and deep judgment is spent
  only where bets are made (~50 companies), not fabricated across hundreds.
- New coupling: the importer must persist the aggregator URL, and resolution gains
  a network crawl step. Sources without an aggregator page (e.g. a name-only
  funding feed) fall back to web-search for the domain.
- Cost attribution must move to a **per-company meter** — the parallel scaler
  shared one meter across concurrent companies, inflating per-company numbers
  (the grand total stayed correct).

## Implementation roadmap (prioritized)

Highest-leverage first; each is independently shippable.

1. **Aggregator-domain crawler** — a function that takes an aggregator URL and
   returns the company's real domain + website (raw HTML, denylist,
   frequency-rank). Transient; nothing stored. (The unit that everything below
   builds on.)
2. **Domain-first resolver** — crawl the aggregator URL (from the import row, or
   a CSV re-read for existing rows) → domain → Apollo-corroborate
   (`website == domain`) → persist domain + website → else `unresolved`. Add an
   `unresolved` status + queue. (Root fix; recovers most of the 85.)
3. **Apollo provider** — wire `organizations_enrich` + people-search behind the
   existing `EnrichmentProvider` seam; HarvestAPI stays for deep profiles.
4. **Recovery ladder** — web-search-for-founders (triggered) + the user-alert /
   browser-recovery rung for the residual.
5. **Per-company cost meter fix** — isolate the meter per company so persisted
   `enrichment_cost` is accurate under parallelism.
6. **Hybrid scorer, committed** — promote the rubric out of `.scratch`; add the
   LLM deep-review pass (rank ∩ coverage) emitting sub-scores + verdict; make
   NULL sub-scores + confidence-discount + `scored_by` first-class (schema + UI
   badges + filter).
7. **Feedback loop** — mine funnel actions → propose `preferences.md` edits.

## References

- ADR-0001 — data model & identity (`domain OR linkedin_url`).
- ADR-0002 — skills vs CLIs: judgment lives in the skill, not a CLI heuristic.
- Session findings (2026-06-24): domain recovery validated on Paradigm / dev-agents
  / Mail0; Apollo by-name hits the same disambiguation wall (domain is the fix);
  Coresignal $49/mo schema carries founders+investors+funding by domain.
