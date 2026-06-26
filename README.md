# Conference Compass

**Tell me _who_ to meet at a conference — when, why, and how to open the
conversation — by asking your AI assistant.**

A 500-person AI conference hands you a flat list of 488 speakers and a schedule
grid. Compass turns that into a **ranked list of the specific people worth your
time**: each one with a *sourced* why-meet line, their pedigree, a warm path in,
their talk slot (when and where to catch them), a match score, and a draft
opener — in the time it takes to ask.

> **The atom is the Person.** You don't meet a company; you meet someone in a
> room. Compass ranks people directly — company is an *attribute* you filter and
> group by, never the headline.

It's **open source**, **agent-native** (a set of Claude Code skills over a small
engine, not a walled app), and **forkable for any conference**. Built on a real
dataset: AI Engineer World's Fair 2026 — ~297 companies with funding + founders,
~488 speakers with bios + photos, ~552 talks, ~2,373 open roles.

The people-first pivot is recorded in
[ADR-0004](docs/adr/0004-people-first-atom-and-scratchpad-intent.md); the domain
vocabulary (Person · Intent · Plan · Warm path · Watchlist) lives in
[`CONTEXT.md`](CONTEXT.md).

---

## The 60-second demo

```
You → Claude Code:  "Who should I meet at AIE 2026, and why?"
```

Claude runs the `who-to-meet` skill:

```
Who to meet [Career Mover] — top 12 of 488 people

 1. Andrew Dai  [0.90]
    Co-founder @ Elorian AI | ex-DeepMind · Elorian AI
    why: Ex-DeepMind · PhD / research · Founder/exec
    talk: "The Best Models Still Reason Like Toddlers" — Day 2, 1:55pm-2:15pm, Track 2

 2. Ari Morcos  [0.90]
    CEO and Co-founder at DatologyAI | ex-FAIR, DeepMind · DatologyAI
    why: Ex-DeepMind · PhD / research · Founder/exec
    talk: "Data curation for model training" — Day 2, 10:45am-11:05am, Track 9
```

(Add a résumé via `onboard` and each line grows a **warm path** — shared
employer or school, a possible referral.)

…or open the web view (`pnpm dev` → [localhost:3000](http://localhost:3000)).
The home page **is "Who to meet"** — a people-first ranked list. Each card shows
the person's name, their company (as an attribute), a why-meet line, pedigree, a
warm path, their talk slot, a match score, and a draft opener. Filter by
**Intent**, **Vertical**, **Speaking-only**, and **★ Saved** (people you've saved
via the agent — `conf-followup target` — carry a ★). Drill into any person or
company for a sourced brief (verdict → evidence → who/when → opener → raw notes
collapsed).

**Explore** the underlying graph from the nav (these are secondary to the
people-first home):

- **Sessions** — the agenda browser, with a live *happening now* marker.
- **Companies** — a firmographic directory you filter by what they do, who's
  hiring, and where.
- **Roles** — open roles, newest first.

---

## Why it's built this way

Three ideas do the work:

### 1. Trustworthy enrichment is the hard part — so provenance is a feature
Anyone can scrape a speaker list. The value is the **enrichment that survives
contact with reality**: resolving the *right* company (we repaired dozens of
wrong-identity matches — `Buster` → Dave & Buster's, `Day` → the LDS Church),
deduping, funding + founder backgrounds, and **freshness**. So every claim can
render *where it came from* and *how stale it is*, and a thin signal is **labeled
and ranked low** — never dressed up. See
[`src/provenance`](src/provenance/index.ts).

### 2. Your taste is a markdown file your agent reads
Ranking is driven by a plain-English, version-controllable goal profile —
[`profile/preferences.md`](profile/) (weights + hard criteria) plus a
one-paragraph "who I am". No hidden embedding. Fork it, diff it, share it. The
[`onboard`](.claude/skills/onboard/SKILL.md) skill writes it from your résumé +
goals. It's **optional**: out of the box the engine ranks neutrally from public
facts; onboarding makes the ranking *yours*. `profile/` is gitignored and never
committed.

### 3. One shared people graph, ranked by your Intent
A single conference knowledge graph (people ↔ companies ↔ talks ↔ openings),
ranked by your **Intent** — an *objective over people*. The same engine, pointed
at a different objective, surfaces different people: **Career Mover** prizes the
founder-bar pedigree, while **Learner** prizes on-topic depth and reachability
(you learn by attending the talk) — so a clinician-founder who'd rank low for a
job hunt rises to the top for learning a space. Company is a *feature* of the
score, not a gate. See
[`src/plan/who-to-meet.ts`](src/plan/who-to-meet.ts) and
[ADR-0004](docs/adr/0004-people-first-atom-and-scratchpad-intent.md).

---

## Run it — three ways

Three configurations, and they compose. Start local; point at a cloud DB when you
want Claude Code (local *or* in the cloud) and the web to share data; deploy the
web app for a public URL.

1. **[Local](#1-local-no-keys-no-cloud)** — your laptop, a SQLite file, no keys.
2. **[Shared cloud DB](#2-shared-cloud-db-turso)** — the agent + the web on one Turso DB.
3. **[Deploy online](#3-deploy-the-web-app-online)** — a public URL, optionally password-protected.

### 1. Local (no keys, no cloud)

```bash
pnpm install
pnpm db:migrate            # create the schema (default DB: a local libSQL file at data/conference.db)
pnpm seed-demo             # load the full AIE 2026 dataset from the committed snapshot
pnpm dev                   # the web view at localhost:3000
```

That's the whole setup — **no API keys, no enrichment, no external services.**
From here you drive it in **Claude Code**: start with the **`onboard`** skill (so
the ranking reflects your taste), then **`who-to-meet`** — see [the skills](#use-it-from-claude-code) below.

> **The data is already in the repo.** The committed snapshot
> ([`seed/demo-snapshot.json`](seed/)) is the *complete* conference graph — all
> **~297 companies**, **~488 speakers** (with bios + photos), **~552 talks**, and
> **~2,373 open roles**. `pnpm seed-demo` loads every bit of it into a local
> libSQL/SQLite DB in seconds. You do **not** run any enrichment to use the demo.

**On the data layout:** the working databases (`data/*.db`) are **gitignored**,
not committed — `seed-demo` rebuilds `data/conference.db` from the snapshot, so a
clone stays small and the demo is fully reproducible offline. The snapshot is
*clean*: public firmographics, profiles, agenda, and jobs only — **no taste
scores and no personal data**. The ranking is computed by the engine (neutral by
default; your [`profile/preferences.md`](profile/) re-ranks it to your taste).

### Use it from Claude Code

You drive everything by talking to **Claude Code** — the agent invokes these
skills (judgment in the runbook; the mechanics are internal — see
[ADR-0002](docs/adr/0002-skills-vs-clis.md)). **Start with `onboard`.**

| Skill | What it does |
| --- | --- |
| [`onboard`](.claude/skills/onboard/SKILL.md) | **start here** — capture your résumé + goals so the ranking is *yours* |
| [`score-companies`](.claude/skills/score-companies/SKILL.md) | apply your taste — judge company scores from your preferences + each company's founder/funding signal, turning neutral ranking into yours |
| [`who-to-meet`](.claude/skills/who-to-meet/SKILL.md) | the people-first hit list — who to meet, when, why, with a draft opener |
| [`company-brief`](.claude/skills/company-brief/SKILL.md) | one company, deep + sourced (who to meet there, with talk slots) |
| [`draft-outreach`](.claude/skills/draft-outreach/SKILL.md) | personalize a copy-ready draft (never sends) |
| [`met-log`](.claude/skills/met-log/SKILL.md) | log who you met, advance the funnel (met → contacted → replied) |
| [`plan-conference`](.claude/skills/plan-conference/SKILL.md) | a company *grouping view* over the ranked people |

**Make it yours.** Out of the box the ranking is *neutral* (public facts).
Personalizing is two skills: **`onboard`** interviews you and writes your taste to
[`profile/preferences.md`](profile/) (+ `narrative.md`, `resume.md`); then
**`score-companies`** applies it — the agent judges each company against your
preferences and persists the scores, which flips ranking from neutral to yours
(and, because the person scorer folds in company taste, personalizes
**who-to-meet** too). No code, no keys; `profile/` is gitignored and never committed.

### Why the agent talks to the DB directly (and the caveat)

We deliberately **did not** put an MCP server in front of the data. For this
workload MCP added protocol overhead without earning it — and, more importantly,
it's worse for **context management**: round-tripping rows through a tool boundary
bloats the agent's context fast. So the agent reads the graph directly, through a
**scoped, read-only** layer (not MCP, not raw SQL —
[ADR-0005](docs/adr/0005-agent-query-cli.md)): compact, capped reads that *cannot*
mutate data, with writes confined to narrow verbs (save to your list, log an
encounter) and **no send path** — drafts only.

The honest trade-off: this **exposes the database to the agent**. It's not the
most locked-down design. We keep it safe-by-default (read-only handle, projected
+ capped reads, no general write/delete surface), but if you point this at
sensitive or private data, **use it at your own risk**.

### 2. Shared cloud DB (Turso)

libSQL means the same code runs against a local file *or* a **Turso** cloud DB.
Point **Claude Code (local or in the cloud)** and the deployed web app at one DB
and changes show up everywhere on refresh.

```bash
turso db create aie-2026
turso db tokens create aie-2026            # a read-write token (for seeding / agent writes)
```

Put both in `.env.local`, then seed once — the CLIs honor `DATABASE_URL`:

```bash
# .env.local
DATABASE_URL=libsql://<your-db>.turso.io
TURSO_AUTH_TOKEN=<token>
# then:  pnpm db:migrate && pnpm seed-demo   # now targets Turso, not the local file
```

For **Claude Code in the cloud**, set the same two vars in that environment and
allowlist `*.turso.io` for egress. The agent edits the graph; your `pnpm dev`
(and the deployed site) reflect it on refresh. Give the *public* web app a
**read-only** token (below); use read-write only where you seed or let the agent write.

### 3. Deploy the web app online

The web app is **server-rendered** — every data page is `force-dynamic` and reads
Turso at request time — so deploy it as a **Node web service, not a static site**.
Two things make this simple: the build needs **no secrets** (dynamic pages render
per-request, never at build), and the app only ever **reads** the DB (saving and
met-logging happen through the agent), so it runs on a **read-only** Turso token.
There is no separate API service — the Next.js server *is* the backend.

**Render (Blueprint).** A [`render.yaml`](render.yaml) is included.

1. Create a read-only DB token: `turso db tokens create <your-db> --read-only`.
2. Render Dashboard → **New → Blueprint** → pick this repo. It provisions a Node
   web service (`pnpm build` → `pnpm start`); pick a region near your DB
   (e.g. **Oregon** for `aws-us-west-2`).
3. Set the runtime env vars (marked `sync: false`, entered in the dashboard,
   never committed): `DATABASE_URL` = `libsql://<your-db>.turso.io` and
   `TURSO_AUTH_TOKEN` = the **read-only** token.

**Any Node host works** — it's a stock Next.js app. Vercel is zero-config (import
the repo, set the same env vars); Fly.io / Railway / a container run `pnpm build`
then `pnpm start`.

#### Keep it private (optional)

A solo deployment is **public by default**. To require a login, set
**`SITE_PASSWORD`** (and optionally `SITE_USER`, default `admin`) in the host's
env: an opt-in HTTP Basic Auth gate ([`src/middleware.ts`](src/middleware.ts))
then challenges every request before any page renders. Leave it unset and the site
is open. It protects the **web UI only** — the agent reads the DB directly, not
through the app — so always serve over HTTPS (Render/Vercel do). For more than a
shared password, front it with Cloudflare Access or your host's own auth.

---

## Data & provenance

The base — companies, speakers, and the schedule — comes from the public **AI
Engineer World's Fair 2026** program. On top of that, an enrichment pass fills in
**public professional data only**:

- **Companies** — firmographics + funding + founders (via Apollo).
- **People** — LinkedIn-style public profile (work history, education, headline, bio).
- **Open roles** — per company, **except job listings for the largest employers**
  (e.g. Google) — those were skipped this round.

It's a **point-in-time snapshot**: every enriched field carries a `source · as of`
chip, and a thin/unverifiable signal is labeled, not dressed up. No private data,
no scraping behind logins.

**Removal / opt-out.** Everything here is public, but if you're an individual in
this dataset and would like to be removed, please **open a GitHub issue** on this
repo (or contact the maintainer) — we'll take you out promptly.

## Hard rules

- **Drafts only — no send path.** The system records what happened and writes
  drafts; *you* send. There is deliberately no email/LinkedIn/API send anywhere.
- **Public professional data only**, with freshness and provenance on every claim.
- **Never manufacture urgency.** Fit leads; a "why now" clause appears only when
  it's genuinely sourced.

## Stack

Next.js · TypeScript · SQLite/libSQL + Drizzle · vitest. The engine is plain
functions over a typed data layer; the app and the skills are thin adapters over
it.

```bash
pnpm test                  # the full suite (~386 tests across 50 files)
pnpm exec tsc --noEmit
```

MIT. Built in public.
