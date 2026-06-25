# Conference Compass — Product Design

> A goal-driven intelligence + action layer for tech conferences. Built on the
> enriched dataset we already have (companies + funding + founders, speakers +
> talks, openings). This doc is developed in **rounds**: each round states a
> design decision, then challenges it, then revises — converging on a concrete,
> opinionated design.

---

## Design objectives (two, weighed together)

This project optimizes for **two goals at once**, and every decision is weighed
against both:

1. **Utility for conference *attendees*** — working AI engineers, builders, indie
   hackers, job-seekers, early founders, students. (NOT primarily senior leaders.)
2. **The builder's influence** — it's **open source, built in public**, to earn
   reputation in the AI-eng community. So *technical sophistication, clean/forkable
   architecture, agent-native design, and a relatable, shareable story* are
   first-class drivers, not polish.

These mostly **align** — the most respected OSS projects are genuinely useful *and*
exceptionally built. The one trap to avoid: chasing "impressive" with complexity
that doesn't serve a real, relatable user pain. Sophistication must serve the pain.

## 0. The exercise

We have a rich, enriched picture of a conference (AI Engineer World's Fair 2026):
297 companies with funding/firmographics, 488 speakers with talks, 2,373 openings
with descriptions. The original build served ONE user (a job-seeking founding
engineer) and his taste. The question now: **who is this a product for, what are
they actually trying to do at a conference, and how do we help them do it?**

---

## 1. Who attends an AI conference, and what is their REAL goal?

Surface activity (attend talks, walk the expo, network, side events) hides very
different underlying goals:

| Persona | Surface | **Real goal (the win condition)** | Time horizon |
|---|---|---|---|
| **Career Mover** (job-seeker / open) | talks + booths + parties | Meet the few companies/people who could be my next role — ideally warm | months (conf = 1 touchpoint) |
| **Founder** | everything, frantically | Raise (meet the right investors) · Hire (meet engineers) · Sell/partner (meet buyers) · Track rivals | weeks–months |
| **Investor / Scout** | booths + side dinners | Source — find companies/founders worth a meeting, esp. raising or pre-buzz | continuous |
| **Builder / Practitioner** (not moving) | talks, hallway | Learn (best talks) · find tools · meet peers/collaborators | the event |
| **Seller / BD / DevRel** | booths, badge scans | Find ICP-fit accounts + the decision-maker to talk to | quarters |

> **Target (per Round 7):** the **attendee** side — Career Mover, Builder, and
> early-Founder. The senior Founder/Investor/Seller rows are *edge* personas (and
> the source of Daniel's recruiter lens), not the center.

**The shared pain (all personas):** *time scarcity + overload + no goal-conditioned
prioritization.* 500 speakers, 300 companies, 50 side events, 2 days. You can
meaningfully engage ~20–40 entities. The official app gives you a **flat directory
and a schedule grid** — zero personalization. So people wander, miss the handful
who'd actually matter, suffer FOMO, and do post-hoc "who did I even meet" cleanup.

**The core Job-To-Be-Done:**
> *"Given my goal and my 2 days, tell me exactly who to meet, what to attend, and
> how to approach them — and help me act on it during and after the event."*

This is precisely what our data uniquely enables and the official directory can't:
we've turned the conference's entities into something you can **rank and filter by
a personal goal**, with the context to act.

---

## 2. Design rounds

### Round 1 — Decision: build the **job-seeker companion**
It's the validated use case, the data fit is perfect, and AI confs are full of
job-seekers. Ship "your personalized who-to-meet-for-a-job plan."

**Challenge:** Too narrow and too *soft*. "Find a job" is a months-long, diffuse
goal; a 2-day conference is one weak touchpoint. Retention is terrible (used 2
days/year). Willingness to pay is low. We'd be optimizing the closest-to-what-we-
built thing, not the sharpest pain. **Reject as the framing; keep as a persona.**

### Round 2 — Decision: build for the **JTBD, not a persona**
The real product is *goal-conditioned prioritization of a high-density event.*
That JTBD spans every persona — so build a generic "rank the conference for your
goal" engine.

**Challenge:** "Generic for everyone" = bland for everyone. Each persona ranks by
different signals (job-seeker: company-fit + who-can-refer; investor: stage +
founder pedigree + who's raising; seller: ICP + decision-maker). A single ranking
can't serve all. And a horizontal tool has no wedge. **Need a beachhead AND a way
to express different goals over the same data.**

### Round 3 — Decision: **shared enriched graph + goal "lenses"**, beachhead = Career Mover
Architecture: one enriched graph of {companies, people, talks, openings, edges}.
A user picks a **lens** (Job hunt / Hire / Raise / Sell / Learn) that re-ranks and
re-shapes everything for their win condition. Launch the **Career Mover** lens
first (validated, richest data fit), then Founder (hire/raise) and Scout.

**Challenge #1 — episodic value:** even perfect, it's used 2 days/year. Weak
business. → **Reframe:** the conference is the *acquisition moment* ("going to AIE?
get your plan in 5 min"), not the whole product. The retained product is a
**year-round ecosystem radar** keyed to your goal, where conferences are
high-density bursts. The relationships and targets persist after the event.

**Challenge #2 — is the data defensible?** Anyone can scrape a speaker list. → The
moat isn't the list; it's the **enrichment + goal-ranking + action context**
(funding, founder pedigree, the openings, the "why meet them" + opener), and the
**post-event relationship memory**. The official app and Swapcard/Grip do
logistics + matchmaking-by-tags, not goal-ranked intelligence with outreach
context.

### Round 4 — Decision: MVP = **Rank → Brief → Plan** (defer heavy "Act")
Smallest thing delivering the "aha" (a personalized, ranked, actionable plan in
5 minutes): (1) state your goal, (2) get a ranked shortlist of companies/people/
talks, (3) per target a context **brief** + a one-line "why them," (4) a simple
**plan** (top N to meet, talks to attend). Defer: automated outreach, live
booth-location maps, mutual-connection graphs.

**Challenge:** Without "Act," is it just a prettier directory? The wedge is the
**plan + the opener**, not just a list. Keep a *lightweight* act layer in MVP: a
copy-ready intro/opener per target + "they're speaking at <talk/time>" so the user
can actually go do it. But the deep act features (CRM, auto-DM, intro-paths) are
v2. **Revise MVP to include the opener + talk-anchored plan; defer automation.**

### Round 5 — Decision: validate before generalizing
Resist building a multi-conference ingestion pipeline now. Prove the value on ONE
conference (AIE 2026, which we have) with the Career Mover lens, with ~10 target
users.

**Challenge — risks to retire first:**
- *Goal cold-start:* can a user express their goal fast enough to get value? → a
  3-question onboarding + a resume/LinkedIn paste (we did this) must produce a
  good ranking in <5 min. **Riskiest assumption — test first.**
- *Data freshness / correctness:* mis-identified companies and stale jobs (we hit
  both) erode trust instantly. The "wrong founder / closed job" problem is
  existential for a *product*. → enrichment quality + provenance is a feature.
- *Generalization:* other conferences expose speakers/sponsors/agenda differently
  (we relied on a JSON + a sponsor page). Ingestion is a real cost; defer but
  design the schema to be conference-agnostic.
- *Privacy:* we're enriching real people from scraped data. For a product, surface
  only public professional info, honor opt-outs, and frame it as "research you'd do
  manually, faster." **Hard constraint, not an afterthought.**

### Round 6 — Decision pressure-tested against a simulated target user
We interviewed a fictional senior AI leader (**Daniel Reyes**, Series-A CTO,
hiring hard, attends ~5 AI confs/year) — a Founder-lens user. His answers
overturned or sharpened several decisions:

- **People > companies > talks, decisively.** "The room is for people; I can
  watch talks on YouTube." Talks drop near the bottom; the product's spine is a
  ranked *people* list, with companies as context.
- **The recruiting ranking is "recruitability + timing," not pedigree.** His #1
  signal is *a company in quiet trouble* (layoffs / down round / sunset /
  acqui-hire) — "that person is doing the math on their equity now; best hire I'll
  make all year; the window is **weeks**." Plus: left-a-strong-company-recently,
  went-quiet-after-a-strong-run, 18+ months somewhere shaky, infra/applied-ML-to-
  prod backgrounds, "builds on the side / has opinions." → *"Give me the 15 names
  where the timing is right, ranked, with the one fact that makes each urgent."*
  **Crucially this is the inverse of the Career Mover's "elite founders" ranking —
  same engine, opposite scoring. Validates the lens model concretely.**
- **Intel = the delta, not the map.** "I carry the landscape in my head; I need
  what *changed* since last quarter" — pivots (a wall they hit), raises, deaths,
  a big-lab release that vaporizes a startup. Served as a ~5-company analyst brief
  with provenance, not a 40-page report.
- **Flow priority: Prep ≫ Follow-up > Live.** Prep (night before) is ~80% of the
  value — intent + time + nothing to act on. Follow-up ("the 9 you met, what you
  said you'd do, draft, send?") is "pure money left on the table." Live should be
  *near-invisible* — a buzz when a target is nearby, or "who is this in front of
  me, in 2 seconds" — never a screen you stare at.
- **Dual-use resolves toward the ASSISTANT.** "Prep and follow-up — I'll just ask
  my assistant, where my context already lives (CRM, the attendee list). I will
  **not** install one more conference app that's a worse version of the schedule."
  Live → "a whisper in my ear, not a screen."
- **Trust is existential, not a polish item.** Verifiable specificity + sources +
  data-freshness; *say "thin signal" and rank it low rather than dress it up.* One
  hallucinated founder or one stale job → "I'm out, permanently"; a mass-blast
  opener → dead. (We lived exactly this with the wrong-identity / closed-job bugs.)

### Round 7 — Recenter on the *attendee*, and weigh the builder's reputation goal

Two corrections that move the design:

**A. The user is an attendee, not a senior leader.** Demote Daniel (Series-A CTO)
to one edge data-point. Recenter on the typical AIE attendee — working engineers,
builders, indie hackers, job-seekers, early founders, students. Their goals
re-balance, and notably **talks/learning come back up**:
- *Learn* — which talks/workshops are worth my slot (for an attendee, this is a
  primary reason they came; "watch it on YouTube" was a senior's luxury).
- *Network with peers* — meet other builders, collaborators, make friends.
- *Career* — find a job / next thing / companies hiring (many are open).
- *Discover* — tools / companies / projects worth checking out.
- *Be seen* — meet interesting people, grow my own profile.
→ The spine stays "a personalized plan," but for attendees it spans **people
(peers + companies-hiring) + a curated agenda (talks) + tools to discover.** The
recruiter "timing" ranking becomes ONE lens, not the default.

**B. The builder optimizes for reputation, too** (open source, in public). This is
a first-class driver, weighed in every call. It pushes toward:
- **Agent-native via skills** (works *with* Claude Code) — on-trend, impressive, and matches
  "useful with Claude." (Reinforces Round 6's assistant-first.)
- **Clean engine + adapters, forkable** — the thing other devs star and fork.
- **Generality** — works for *any* conference, not just AIE. A one-conference hack
  is less respected (and less reusable) than a general "conference-intelligence
  engine." → raises generalization from "defer" to "design for it now, ship
  validated on AIE first."
- **Enrichment + provenance as the technical centerpiece** — the genuinely hard
  work we already did (wrong-identity repair, dedup, freshness, multi-source) is a
  great, credible story. Make it clean, documented, the heart of the README.
- **An elegant conceptual core** — a *conference knowledge graph* + pluggable
  *lens* scorers + an *agentic enrichment* pipeline. Nameable ideas travel.
- **A relatable, shareable demo** — everyone at the conf feels the overwhelm:
  "point it at a conference → your personalized plan, through your AI assistant."

**Where the two objectives trade off:** resist gold-plating. Generality and an
"impressive" architecture must still earn their place by serving the attendee's
real pain — overwhelm at a 500-person event.

**Converged (v3). See §3–§9 — reflects Rounds 6 (assistant-first/trust) + 7
(attendee-centered, reputation-weighed). The biggest net effects of v3: talks
re-enter the spine for attendees; generality is now in-scope by design; and the
enrichment-provenance pipeline + lens engine are elevated as the showcase.**

---

### Round 8 — Grilled with the *real* attendee/builder (LOCKED, v3-final)

Rounds 1–7 leaned on a *simulated* persona (Daniel). Round 8 replaces simulation
with the actual target user *and* builder (Conglei), via a one-question-at-a-time
grilling. Seven decisions, each confirmed:

1. **Surface — assistant-first architecture + one beautiful showcase surface.**
   The product *is* the engine + **Claude Code skills (+ their CLIs)** the assistant drives; build **one**
   polished web view as the demo/marketing, not the product. The killer demo is
   **"watch Claude build my conference plan live,"** not a static page. *The engine
   is the project; the app is the trailer.*
2. **Lenses — ship ONE deeply, seam for the rest.** Build **Career Mover** only
   (the builder can dogfood it against real AIE data); make the `Lens` seam clean
   and documented so a second lens is a visible config+scorer drop-in. **Reject**
   the earlier "two lenses to prove the model" — a lens running on signals we don't
   have (Recruiter's layoff/down-round feeds) is a shallow demo that *erodes*
   credibility. The visible *abstraction* is the reputation play, not two mediocre
   rankings.
3. **Output unit — company-first, people-nested.** The plan is **~8 ranked
   companies**, each with *why now* (fit thesis) + *who to meet* (speaking?
   degree?) + *opener*. People are ranked as the **warm path into a target
   company**, not as the top-level list. (The "15 people" framing was the
   Recruiter's mental model; for a job-seeker the **company** is the unit of
   decision — and it maps cleanly onto the existing schema where companies are the
   spine.) The Recruiter lens later *flips* this to people-first — the lens decides
   even the output *shape*, not just the sort.
4. **Talks — metadata, not a pillar (for this lens).** A job-seeker picks rooms by
   *who's on stage / in the crowd*, never by topic. Talks appear only as **"where/
   when to catch your target"** + **"target-dense rooms."** Keep talks first-class
   in the *data model* (the Builder lens ranks them later — seam pays off again),
   but build **no learning-agenda ranker** in the MVP.
5. **The "why" line — lead with FIT, timing as honest garnish.** Headline =
   the fit thesis (*"Ex-DeepMind founders, agents infra, Seed, 2 founding-eng roles
   open"*); append a timing signal **only where we genuinely have one** (recent
   raise, fresh `posted_at`), freshness-stamped. **Never manufacture urgency** —
   faking "why now" is the exact trust violation (§8 risk #2) that would sink both
   the product and the reputation.
6. **Goal cold-start — reuse `preferences.md` + `narrative.md` as the canonical,
   portable goal profile.** A human-readable, forkable, version-controllable
   markdown file the engine consumes — *not* a hidden form/embedding. Three ways in
   (point at existing file · résumé→interview · cold 3–4 questions), one artifact.
   "Your taste as a markdown file your agent reads" is itself a tidy, shareable
   idea and is *honest* about how the ranking is driven.
7. **Demo deliverable — one 60-second recording + matching README hero.** Hero
   contrast: **488 raw attendee names → 8 sourced target companies, by asking your
   agent, in under a minute**, side-by-side. Three reputation pillars made explicit
   in the build plan: (a) **agent-native** (Claude Code *skills*, not a walled app);
   (b) **the enrichment/provenance spine** as the README centerpiece (wrong-identity
   repair, multi-source, freshness — the rare credible part); (c) **taste-as-markdown
   + the lens seam** as two nameable ideas that travel.

**This is v3-final. §3 and §7 below are updated to match; §11 is the build plan.**

---

## 3. The product (converged v2)

**Conference Compass** — an **assistant-native, open-source** layer that turns a
conference's flat directory into a **ranked, people-first plan**: who to meet, the
one fact that makes each urgent, and how to open it — driven mostly by *asking your
AI assistant, where your context already lives* (résumé/ICP, attendee list, CRM),
with a thin app only for the *live* "who's nearby / who is this in front of me."
Useful standalone **and** as *skills* an agent (Claude Code) drives — same engine, two
adapters.

- **Spine (attendee-centered):** a personalized plan = **people** (peers +
  companies-hiring + interesting builders) **+ a curated agenda** (the talks/
  workshops worth *your* slot) **+ tools/companies to discover.** (Talks are a core
  attendee job — only the senior *recruiter* lens demotes them.)
  - **For the MVP lens (Career Mover), the spine is realized company-first:** the
    plan is **~8 ranked companies**, people nested as the warm path in, talks as
    *where/when to catch a target* — not a learning agenda (Round 8 §3–4).
- **Lenses — same engine, different scoring** (Round 6 proved Recruiter and
  Career Mover rank by *opposite* signals over the same graph):
  - *Recruiter* → recruitability + **timing** (company in trouble / recent
    departure / gone-quiet-after-strong-run) + builder quality.
  - *Career Mover* → company fit + **elite founders** + open roles.
  - *Scout* → stage + founder pedigree + raise-timing.
  - *Builder* → topic/tool relevance.
- **Primary surface = the assistant** for Prep + Follow-up; a *near-invisible* app
  mode for Live. Explicit anti-goal: **not "one more conference app."**
- **Non-negotiable = trust:** every claim verifiable, sourced, freshness-stamped;
  "thin signal → say so and rank low"; never hallucinate, never mass-blast.

---

## 4. Core user journey — organized by flow (Prep ≫ Follow-up > Live)

**0. Set goal once (≤5 min, assistant).** Pick a lens + paste your context
(résumé/ICP, "who we've already talked to"). → a portable goal profile.

**1. PREP — the spine, ~80% of the value (assistant, night before).**
Ask: *"who should I meet at <conf> and why?"* → a ranked **~15 people**, each with
**the one urgent fact** (timing/fit signal), what their company does + what
*changed* recently, where/when to find them (talk slot / booth), and a *plain*
copy-ready opener you'll rewrite. Plus a ~5-company "what changed since I last
looked" intel brief. Every line sourced + freshness-stamped; thin signals labeled.

**2. LIVE — near-invisible (thin app / glance).**
Two jobs only: a **buzz when someone on your list is nearby**, and **reverse
lookup** — "who is this in front of me, why do I care," in 2 seconds. Nothing that
makes you stare at a screen.

**3. FOLLOW-UP — pure money (assistant, week after).**
*"Here are the 9 you met, what you said you'd do, drafts — send?"* Logs outcomes
(met → reply → call → hire/deal). The relationships persist into your next event.

---

## 5. Scenarios

- **S1 — Career Mover (Conglei).** "Founding-eng/MTS, agents/applied-AI, elite
  founders only." Compass surfaces Tasklet, Humans&, Composio (founder-bar + open
  roles), shows Dhruv Batra (Yutori) and Sara Hooker (Adaption) are *speaking*, and
  hands him an opener + their talk times. He walks in with a 12-person hit list
  instead of 488 names.
- **S2 — Founder hiring.** "Series A, need staff infra eng." Compass ranks
  *speakers/attendees* by who's a strong eng at a company unlikely to counter-bid,
  flags the ML-infra talk crowd, drafts a "saw your talk" opener.
- **S3 — Scout.** "Seed/Series A, elite founders, agents/data." Compass ranks
  companies by founder pedigree + recency of raise + pre-buzz, flags who's
  *speaking* (warm approach), and who *just* raised (skip) vs *about to* (target).
- **S4 — Builder.** "Just here to learn agents + find tools." Compass ranks talks
  by topic relevance and the expo by tool category, skips the jobs/funding lens
  entirely.

The same graph, four different rankings — that's the lens model earning its keep.

---

## 6. Feature set → goal mapping

| Capability | Career Mover | Founder | Scout | Builder |
|---|---|---|---|---|
| Goal/taste onboarding | role + taste | hiring bar / raise stage | thesis | topics |
| Company ranking | fit + openings | talent density | stage + founder + raise-timing | tool relevance |
| People ranking | founders/HMs to meet | hireable engineers | founders raising | peers/speakers |
| Talk/agenda ranking | relevant + target-speakers | recruiting-crowd talks | hot-company talks | topic relevance |
| Per-target brief | funding+founder+roles+opener | candidate background | cap table + traction | speaker bio |
| Plan (schedule-aware) | ✓ | ✓ | ✓ | ✓ (talks) |
| Outreach draft | ✓ | ✓ | ✓ | optional |
| Post-event memory / CRM | ✓ | ✓ | ✓ | light |

---

## 7. MVP scope (build on AIE 2026 data we have)

Shape: **engine + Claude Code skills (wrapping CLIs) the assistant calls**, a tiny web view for Live.

Shape locked in Round 8: **one lens deep (Career Mover), company-first output,
assistant-first via Claude Code skills, one polished web view as the demo.**

**In:**
- **Ingested + enriched graph** (we have it): people ↔ companies ↔ talks ↔
  openings, with funding + founders + job descriptions, **provenance + freshness on
  every field.** (This + its repair story is the README centerpiece — Round 8 §7.)
- **PREP tool — `plan(profile)` (Career Mover lens only)** → **~8 ranked
  companies**, each with a **fit-led why-line** (founders + domain + stage + open
  roles; timing appended *only where sourced*), **who to meet** (nested people —
  speaking? connection degree?), and a **plain copy-ready opener.** Talks surface
  as "where/when to catch your target," not an agenda.
- **`Lens` seam** — Career Mover is the only populated lens, but the seam is clean
  + documented so a second lens (Recruiter, people-first) is a config+scorer
  drop-in. The seam *is* the reputation artifact, not a second shallow lens.
- **Goal profile = `preferences.md` + `narrative.md`** — the portable, forkable
  markdown taste file the engine consumes (Round 8 §6).
- **FOLLOW-UP tool** — met-log + draft-and-send + outcome tracking.
- **Trust surface** — every claim carries source + "as of" date; thin signals are
  labeled, not dressed up.

**The single "aha":** ask your assistant once → a **ranked 8-company plan with a
sourced fit-thesis + who-to-meet + openers**, in under a minute — vs the 488-name
flat list (the side-by-side demo hero, Round 8 §7).

**Out (v2+):** second/Recruiter lens + its *timing signals* at full depth (layoffs/
down-round/OSS-gone-quiet feeds) · a people-first output shape · a learning-agenda
talk ranker (Builder lens) · multi-conference ingestion · live proximity/booth maps
· auto-DM · deep CRM sync · Scout lens.

---

## 8. Top risks (retire in order)
1. **Goal cold-start** — can users express a goal fast enough for a good ranking?
   (test with 10 users)
2. **Enrichment correctness** — wrong company/founder/closed-job destroys trust;
   provenance + freshness is a feature, not plumbing.
3. **Generalization cost** — conference ingestion varies; design schema
   conference-agnostic, defer the pipeline.
4. **Privacy** — public professional data only, opt-outs, "faster than manual
   research" framing.

## 9. Open design questions (open source — no business/moat questions)
- **Lens representation:** is a lens a config of weights + signal-toggles, or does
  it need lens-specific *enrichers* (the Recruiter's layoff/OSS-gone-quiet feeds
  don't exist for Career Mover)? (Lean: shared graph + pluggable per-lens scorers
  *and* enrichers.)
- **Live form factor:** thin web view, or push/wearable "buzz when nearby"? Proximity
  needs attendee location we don't have — is reverse-lookup (scan/search a name)
  enough for v1? (Lean: yes — defer proximity.)
- **Generalization:** how conference-agnostic must the ingest be now? (Lean: model
  is conference-scoped from the start; ingest stays a per-conference adapter.)
- **CRM / "who I already know":** how to let the assistant cross-reference the
  user's existing contacts to dedupe targets + prioritize warm — without us storing
  it? (Lean: user supplies it at query time; we don't hold it.)
- **Privacy:** public professional data only, opt-out path, "research you'd do by
  hand, faster" framing — a hard constraint, codified in the enrichment layer.

## 10. Next validation round — DONE (Round 8)
~~Interview a contrasting persona…~~ **Resolved.** Instead of another *simulated*
persona, Round 8 grilled the **real** target user + builder (Conglei) — the most
authentic instance of both the Career Mover *and* the open-source builder. The
seven decisions (Round 8 §1–7) confirm assistant-first + reject "another app",
and settle the lens model, output shape, and demo. **Architecture is settled →
build (§11).** Post-MVP validation: put the §11 demo in front of ~10 real AIE
attendees and retire §8 risk #1 (goal cold-start) with their reactions.

---

## 11. Build plan (v3-final → shippable on AIE 2026 data)

Sequenced to get to the **demo hero (488 → 8, sourced, via the assistant)** on the
shortest path, then harden. Each phase ends at something demoable.

**Asset audit (what already exists in this repo):** `conference.db` enriched graph
(companies + people + roles, funding, founders, job descriptions); `api-cache.db`;
the Drizzle schema (§ `src/db/schema.ts`); the Next.js app; the hybrid scoring
rubric (founder/investor co-dominant) ported from job-search. **Gaps:** talk
slots/times as data; a provenance/freshness field convention; the company-first
`plan()` engine; the agent-facing skills + CLIs; the showcase web view; the follow-up tool.

### Phase 0 — Provenance foundation (retire risk #2 first)
The trust spine must exist before ranking, or every later claim is unsourced.
- Add a **field-provenance convention**: each enriched field carries `{value,
  source, asOf}` (a sidecar `provenance` JSON blob on companies/people, or a
  `field_provenance` table). Backfill from the `source`/`sourceDetail`/cache we
  already have.
- A `freshness(asOf)` helper + "thin signal → label + rank low" rule, used by both
  the engine and the UI. *Exit:* any field in the DB can render a source chip + "as
  of" date.

### Phase 1 — Talks as data (close the only real data gap)
- Add a **`talks` table** (title, speaker→`people.id`, slot time, room, track) +
  re-ingest the AIE 2026 agenda (speakers already imported as `people` with
  `sourceDetail='aie_wf_2026'`; attach their talk slots). Talks stay first-class in
  the model even though the MVP lens only uses them as metadata. *Exit:* "who's
  speaking when/where" is queryable.

### Phase 2 — The engine: `plan(profile)` (Career Mover, company-first)
- **`Lens` interface** (documented seam): `scoreCompany`, `scorePerson`,
  `shapeOutput` — Career Mover is the one implementation; README shows how a second
  drops in.
- **CareerMover scorer** = the ported rubric (founder + investor co-dominant +
  domain/stage/size fit) over the enriched graph, producing the **fit-led
  why-line**; append a timing token only where `posted_at`/funding-date genuinely
  supports it.
- **`plan(profile)`** assembles **~8 ranked companies**, each with: why-line
  (sourced), nested **who-to-meet** (people at that company, speaking flag +
  connection degree), opener stub, and talk-slot logistics. Consumes
  `preferences.md` + `narrative.md` as the goal profile. *Exit:* one CLI call →
  the 8-company plan as structured JSON, every claim carrying provenance.

### Phase 3 — Assistant-native surface (SKILLS, not MCP) — the reputation core
**Decision (Round 8 amendment):** the agent surface is **Claude Code skills**
(`.claude/skills/<name>/SKILL.md` runbooks wrapping deterministic CLIs), *not* a
bespoke MCP server. This matches the project's own ADR-0002 split (skills = the
judgment/runbook layer, CLIs = mechanical primitives), is more efficient for the
user (invoke `/plan-conference` directly in Claude Code), and is a stronger,
more forkable reputation story than a one-off server — "a set of
conference-intelligence skills your agent runs."
- **Skills + their CLIs:** `plan-conference` (→ `pnpm conf-plan`), `company-brief`
  (→ `pnpm conf-brief`), `who-to-meet`, plus the Phase-5 follow-up skills
  (`met-log`, `draft-outreach`). Each SKILL.md carries frontmatter for Claude Code
  discovery + a runbook; the CLI is the thin executor. Same engine, agent adapter.
- *Exit:* in Claude Code, `/plan-conference` (or "who should I meet at AIE 2026 and
  why?") → the 8-company plan, live. **This is the demo.**

### Phase 4 — The one beautiful web view (the trailer)
- A single polished page rendering the same `plan()` output: 8 company cards, fit
  thesis, who-to-meet, **source chips + freshness** on every claim, opener
  copy-button. Plus the **488-name raw list side-by-side** for the hero contrast.
- *Exit:* the screenshot/recording that goes in the README hero.

### Phase 5 — Follow-up tool (pure money, closes the loop)
- `met_log` (met → reply → call → outcome) + `draft_outreach` (draft only, never
  auto-send) + outcome tracking persisted on `applications`/`people`. *Exit:* the
  week-after "here are the 9 you met, drafts — send?" flow works.

### Phase 6 — Package for reputation (the influence goal)
- README centered on the **enrichment/provenance story** (wrong-identity repair,
  multi-source, freshness) + the **taste-as-markdown** + **lens-seam** ideas; the
  60-sec recording; "fork this for *your* conference" quickstart; the
  conference-agnostic schema noted (generality designed-in, shipped on AIE).
- *Exit:* public repo + demo, ready to share.

**Critical path to first demo:** Phase 0 → 1 → 2 → 3. Phases 4–6 harden and
package. Generality (multi-conference ingest) stays **designed-for but deferred** —
the schema is conference-agnostic; only AIE is populated for v1.
