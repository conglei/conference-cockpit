---
name: draft-outreach
description: "Draft a personalized conference follow-up or intro message for a specific person — grounded in their company, their talk, and your goal — as a copy-ready draft the user sends themselves. Never sends. Use when the user wants help writing outreach."
---

# Skill: `draft-outreach`

Write the message; **the user sends it.** This skill drafts a personalized
opener or follow-up grounded in real graph data (the person's company, their
talk, the fit thesis, your `profile/narrative.md` voice) — and stops at the
draft. There is deliberately **no send path** in the system.

## The judgment (this is the skill)

A good draft is specific and short. Don't ship the generic template — use it as a
floor and raise it:

1. **Anchor on something real.** Their talk title + slot, their company's recent
   raise, the exact role you'd want — pull these from `pnpm conf-brief <slug>`
   (the brief carries who-to-meet, talks, funding, all sourced).
2. **Lead with why them, not why you.** One concrete reason their work matters to
   you.
3. **Match the user's voice.** Read `profile/narrative.md` / `profile/resume.md`
   for register; don't sound like a recruiter.
4. **One ask, easy to say yes to** (a 15-min chat, a pointer), never a wall of
   text.

## Starting point (CLI)

```bash
pnpm conf-brief <slug>              # context: talk slot, funding, roles, a base opener
pnpm conf-followup draft <personId> # a base follow-up draft (post-meeting)
```

These print a plain base draft. **Rewrite it** with the specifics above before
handing it to the user.

## Hard rule

- **Draft only — never send.** Present the final text for the user to copy. If
  asked to send, decline and explain they send it themselves. Don't mass-generate
  identical messages.

## Implementation map

| Step | Code | CLI |
| --- | --- | --- |
| Base opener (per company) | `src/plan/career-mover.ts` (`buildOpener`) | `pnpm conf-brief <slug>` |
| Base follow-up (post-meet) | `src/followup/index.ts` (`draftFollowup`) | `pnpm conf-followup draft` |
