# Demo script (≈60 seconds)

The shareable artifact. Goal: land **"488 names → 8 sourced targets, by asking
your agent"** in one take. Record terminal + browser side by side.

## Setup (once)

```bash
pnpm install && pnpm db:migrate && pnpm seed-demo
pnpm dev    # leave running for the web shot
```

## Beat sheet

**0:00 — the problem (5s).** Show the raw directory: the `/plan` page's
right-hand column, 488 names scrolling. Voiceover: *"Every AI conference hands
you this — 488 names, no priorities."*

**0:05 — the ask (10s).** Switch to Claude Code. Type:

> Who should I meet at AI Engineer World's Fair 2026, and why?

Claude invokes the `plan-conference` skill → `pnpm conf-plan`.

**0:15 — the payoff (25s).** The ranked plan prints. Scroll the top 3 slowly:
- Point at a **why-line** — *"fit first: elite founders, on-target, hiring."*
- Point at a **provenance chip** — *"every claim is sourced and dated — Apollo,
  as of 5 months ago. Thin signals get flagged, not hidden."*
- Point at **who to meet** — *"and it knows who's speaking, and when."*

**0:40 — the web view (12s).** Cut to [localhost:3000](http://localhost:3000): the
home page opens on the 488 → 8 contrast, then the plan as cards with source chips
on every line. Toggle **Sources off** to show what a scraper leaves you, then
click **Copy opener**. Voiceover: *"Draft openers you'll rewrite — it never sends
anything for you."*

**0:52 — the kicker (8s).** Voiceover over the README: *"Open source, runs from
your AI assistant as a few Claude Code skills, and forkable for any conference.
The hard part — trustworthy enrichment — is the whole point."*

## Things to make sure are on screen

- A **provenance chip** (the trust spine, visible).
- A **🎤 speaking** line with a talk time (the talks payoff).
- The **488 vs 8** contrast, literally side by side.
- The **Copy opener** button (draft-only, no send).
