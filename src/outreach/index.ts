/**
 * Outreach logging (issue 09). The DETERMINISTIC primitive that records an
 * outreach attempt onto a person (and optionally a linked application) so the
 * network becomes a queryable funnel.
 *
 * Drafting the message — choosing register, grounding it in the user's
 * narrative + the target's deep-dive — is JUDGMENT and lives in the SKILL
 * (.claude/skills/reach-out/SKILL.md), not here. There is NO send path anywhere
 * in this slice: the user sends manually via Claude-in-Chrome.
 */
export {
  logOutreach,
  LOGGABLE_OUTREACH_STATUSES,
  type LoggableOutreachStatus,
  type LogOutreachInput,
  type LogOutreachResult,
} from "./log-outreach";
