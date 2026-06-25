# Conference Compass

**Turn a conference's flat directory into a goal-ranked, sourced plan — who to
meet, why, and how to open it — driven by your AI assistant.**

A 500-person AI conference hands you a flat list of 488 speakers and a schedule
grid. Compass turns that into a **ranked ~8-company plan**: each target with a
*sourced* fit thesis, who to meet (speakers, with their talk slot), the open
roles, and a draft opener — in the time it takes to ask.

> **488 names → 8 sourced targets, by asking your agent.**

It's **open source**, **agent-native** (a set of Claude Code skills over a small
engine, not a walled app), and **forkable for any conference**. Built on a real
dataset: AI Engineer World's Fair 2026 — 297 companies with funding + founders,
488 speakers with 552 talks, 2,373 openings.

---

## The 60-second demo

```
You → Claude Code:  "Who should I meet at AIE 2026, and why?"
```

Claude runs the `plan-conference` skill → `pnpm conf-plan`:

```
Career Mover plan — 8 of 22 ranked companies

1. Resolve AI  (88)  resolve.ai
   Elite founders + strong cap table + on-target domain · 18 open roles · raised Series A (5mo ago)
     • Why (taste): Spiros Xanthos prior founder (Sysdig/Omnition observability)…  [taste review · as of today]
     • Funding: Series A, $125M · $160M total                                       [Apollo · as of 5mo ago]
     • Open roles: 18 open (e.g. Staff+ Backend Engineer)                           [Apollo · as of 1mo ago]
   Who to meet:
     - Justin Smith, Founding Product Engineer (🎤 speaking) — Day 4, 2:25pm, Track 8
   Opener: Hi Justin — planning to catch your talk … would love to say hi after.
```

…or open the web view (`pnpm dev` → [localhost:3000](http://localhost:3000)) — a
single narrative page that opens on the **488 → 8** contrast, shows how the plan
came from *one question to your agent*, then the 8 cards with every claim wearing
a `source · as of` chip (toggle the sources off to see what a scraper leaves you).
Drill into any company or person for a sourced brief; **Explore** the underlying
graph (Companies, Roles) from the nav.

---

## Why it's built this way

Three ideas do the work:

### 1. Trustworthy enrichment is the hard part — so provenance is a feature
Anyone can scrape a speaker list. The value is the **enrichment that survives
contact with reality**: resolving the *right* company (we repaired dozens of
wrong-identity matches — `Buster` → Dave & Buster's, `Day` → the LDS Church),
deduping, funding + founder backgrounds, and **freshness**. So every field can
render *where it came from* and *how stale it is*, and a thin signal is **labeled
and ranked low** — never dressed up. See [`src/provenance`](src/provenance/index.ts).

### 2. Your taste is a markdown file your agent reads
The ranking is driven by a plain-English, version-controllable goal profile —
[`profile/preferences.md`](profile/) (weights + hard criteria) + a one-paragraph
"who I am". No hidden embedding. Fork it, diff it, share it.

### 3. One graph, pluggable lenses
A shared conference knowledge graph (people ↔ companies ↔ talks ↔ openings) with
a pluggable [`Lens`](src/plan/types.ts) that re-ranks **and re-shapes** it for one
goal. The MVP ships **Career Mover** (job-seeker, company-first) deeply; the seam
is documented so a second lens (e.g. a people-first Recruiter) is a drop-in
scorer. The lens decides even the output *shape*, not just the sort.

The full design narrative — 8 rounds of self-critique — is in
[`docs/product-design.md`](docs/product-design.md).

---

## Quickstart — clone and run in under a minute

```bash
pnpm install
pnpm db:migrate            # create the schema (writes data/conference.db)
pnpm seed-demo             # load the full AIE 2026 dataset from the committed snapshot
pnpm dev                   # the web view at localhost:3000
# or, in the terminal:
pnpm conf-plan             # the ranked plan      ·  pnpm who-to-meet  # the people hit-list
```

That's the whole setup. **No API keys. No enrichment. No external services.**

> **The data is already in the repo.** The committed snapshot
> ([`seed/demo-snapshot.json`](seed/)) is the *complete* conference graph — all
> **297 companies**, **488 speakers** (with bios + photos), **552 talks**, and
> **2,373 open roles**. `pnpm seed-demo` loads every bit of it into a local
> SQLite DB in seconds. You do **not** run any enrichment to use the demo — that
> pipeline is only for [bringing your own conference](#bring-your-own-conference-optional).

**On the data layout:** the working databases (`data/*.db`) are **gitignored**,
not committed — `seed-demo` rebuilds `data/conference.db` from the snapshot, so a
clone stays small and the demo is fully reproducible offline. The snapshot is
*clean*: public firmographics, profiles, agenda, and jobs only — no taste scores
and no personal data. The plan's ranking is computed by the engine (neutral by
default; your [`profile/preferences.md`](profile/) re-ranks it to your taste).

### Use it from Claude Code

The agent surface is five skills (judgment in the runbook, mechanics in CLIs —
see [ADR-0002](docs/adr/0002-skills-vs-clis.md)):

| Skill | What it does | CLI |
| --- | --- | --- |
| `plan-conference` | the ranked company plan (company-first) | `pnpm conf-plan` |
| `who-to-meet` | a people-first hit list, ranked directly | `pnpm who-to-meet` |
| `company-brief` | one company, deep + sourced | `pnpm conf-brief <slug>` |
| `met-log` | log who you met, track outcomes | `pnpm conf-followup` |
| `draft-outreach` | personalize a draft (never sends) | `pnpm conf-brief <slug>` |

### Bring your own conference (optional)

> Everything below is **only** for pointing Compass at a *different* conference.
> To run the AIE 2026 demo you can skip this entirely — the data is already
> seeded.

The schema is conference-agnostic. Ingest a new event by importing its companies
([`source-companies`](.claude/skills/)) and its agenda
([`pnpm ingest-talks <agenda.json>`](scripts/ingest-talks.ts), shaped like
[`seed/aie-wf-2026.json`](seed/)), then enrich + score with the existing skills.

#### Enrich for search & query

The conference graph is sharpened by a few idempotent passes (safe to re-run).
These need API keys (`cp .env.example .env.local`) and are **not** required for
the demo:

```bash
pnpm backfill-from-cache   # replay cached Apollo org-enrich into companies
                           # (industry, keywords, location, founded, headcount) — zero API spend
pnpm ingest-speakers       # speaker bios + photos onto people rows
pnpm enrich-people         # deep per-person LinkedIn profile (work history, education,
                           # headline, about) — ~$0.0064/person, cached on re-run
pnpm roll-up-verticals     # company.verticals from speakers' talk tracks (e.g. "AI in Healthcare")
pnpm ingest-embeddings     # per-speaker vectors for semantic search
pnpm similar-speakers "<name>"   # "find speakers like this one" (offline, no embedding API)
```

`pnpm backfill-from-cache`/`ingest-speakers`/`ingest-embeddings` default to the
live AIE feeds but accept a local snapshot path; nothing is overwritten with a
blank, so re-running only fills gaps.

---

## Hard rules

- **Drafts only — no send path.** The system records what happened and writes
  drafts; *you* send. There is deliberately no email/LinkedIn/API send anywhere.
- **Public professional data only**, with freshness and provenance on every claim.
- **Never manufacture urgency.** Fit leads; a "why now" clause appears only when
  it's genuinely sourced.

## Stack

Next.js · TypeScript · SQLite + Drizzle · vitest. The engine is plain functions
over a typed data layer; the app and the skills are thin adapters over it.

```bash
pnpm test         # 330+ tests
pnpm exec tsc --noEmit
```

MIT. Built in public.
