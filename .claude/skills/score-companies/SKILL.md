---
name: score-companies
description: "Generate the user's TASTE scores for companies — read their preferences + each company's founder/funding/domain signal, judge the five sub-scores, and persist them so plan-conference and who-to-meet rank to THEIR taste instead of the neutral default. Use after onboarding, when someone says 'rank by my taste / score the companies / why isn't it personalized', or when the graph has no scores yet (everything is ranking neutral)."
---

# Skill: `score-companies`

The **taste producer**. The ranking engines (`plan-conference`, `who-to-meet`)
read persisted company scores; without them everything ranks **neutral** (public
facts only). This skill is what fills them in — and it is **judgment**, so it is
YOUR job (the agent), not a CLI. You read the user's taste and each company's
signal, decide the scores, and pipe them to a thin persistence CLI.

> The CLI never judges taste. It computes `overall` from the user's weights and
> writes the row. The *taste call* — what a good founder/investor/fit looks like
> for THIS user — is yours. (ADR-0002 / ADR-0005.)

## When to use
- Right after `onboard` (preferences are set but no scores exist yet).
- The user asks to "rank by my taste", "score the companies", or "why is the plan
  neutral / not personalized?".
- `pnpm query companies --json` shows companies but the plan is ranking neutral
  (a clean DB ships with **no** scores by design).

## When NOT to use
- No `profile/preferences.md` yet → run `onboard` first (there's no taste to apply).
- The user just wants to browse the neutral graph → don't score; neutral is fine.

## How to run it

1. **Confirm taste exists.** Read [`profile/preferences.md`](../../../profile/)
   (weights + hard pre-filters) and `profile/narrative.md` (who they are / what
   they want). These define what each sub-score *means for this user*.

2. **Pick the scope — cheap first.** You usually don't need all ~297 companies.
   Score the ones that matter: a vertical, who's hiring, or the plan's candidates.
   ```bash
   pnpm query companies --hiring --json            # or --vertical "AI in Healthcare"
   ```

3. **Read each company's signal** (founders, funding, lead investor, industry,
   verticals, description):
   ```bash
   pnpm query get company <slug> --json
   ```

4. **Judge the five sub-scores** ∈ [0,1] (or `null` for *no data* — never a
   fabricated 0), plus a one-line `rationale` and an optional structured
   `verdict`. Weigh them against `preferences.md`:

   | Axis | What you're judging |
   | --- | --- |
   | `founder_quality` | founders' track record — prior exits, top-lab / big-tech, repeat founder. **`null` if no founder data.** |
   | `investor_quality` | caliber of the lead investor / cap table. **`null` if no funding data.** |
   | `domain_fit` | match to the user's target domains/verticals |
   | `stage_fit` | match to the user's preferred stage |
   | `size_fit` | match to the user's preferred company size (this cockpit favors smaller) |

   `founder_quality` and `investor_quality` are **co-dominant** (the engine
   discounts a company you can't actually evaluate). Honor the user's weights:
   if they down-weight an axis, let it matter less in your rationale.

5. **Persist** — emit a JSON array and pipe it in (do NOT compute `overall`; the
   CLI derives it from the user's weights so weighting stays consistent):
   ```bash
   echo '[
     {"slug":"resolve-ai","founder_quality":0.9,"investor_quality":0.85,
      "domain_fit":0.7,"stage_fit":0.6,"size_fit":0.8,
      "rationale":"Repeat observability founders (Sysdig); strong Series A; on-target domain.",
      "verdict":{"thesis":"…","concerns":["…"],"whatToVerify":["…"],"confidence":0.8}}
   ]' | pnpm score apply -
   ```
   Omit an axis (or pass `null`) when there's no data for it. Unknown slugs are
   reported and skipped, not fatal.

6. **Hand off.** Now `/plan-conference` ranks companies by taste, and
   `/who-to-meet` lifts the **people at high-taste companies** too (the person
   scorer already folds in company taste as a signal) — so scoring companies also
   personalizes who-to-meet. Tell the user to re-run whichever they want.

## What it does NOT do
- **No `overall` math, no persistence logic in chat** — `pnpm score apply` owns
  that. You supply judgment; it supplies consistency.
- **No fabrication.** A sub-score with no underlying data is `null`, not a guess.
- **Public professional data only**, consistent with the rest of the toolkit.
- The deterministic `pnpm score --fake` is an **offline test double** (hashes row
  signal), not real taste — never present its output as the user's scoring.

## Implementation map

| Step | Code | CLI |
| --- | --- | --- |
| Read taste (weights + prefilters) | [`src/scoring/weights.ts`](../../../src/scoring/weights.ts) (`loadPreferences`) | reads `profile/preferences.md` |
| Read company signal | [`src/query`](../../../src/query/index.ts) | `pnpm query get company <slug> --json` |
| Persist judged scores | [`src/scoring/apply.ts`](../../../src/scoring/apply.ts) (`applyScores`) | `pnpm score apply -` |
| Offline rubric double | [`src/scoring/scorer.ts`](../../../src/scoring/scorer.ts) (`FakeScorer`) | `pnpm score --fake [slug]` |
