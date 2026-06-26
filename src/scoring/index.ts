/**
 * The hybrid taste-scoring module (issue 05). Two stages with a hard boundary:
 *   1. deterministic pre-filter (`prefilter`) — pure logic over company rows.
 *   2. LLM taste-scorer behind the `Scorer` seam — the real one is the
 *      `score-companies` SKILL (judgment); `FakeScorer` is the offline double.
 * Weights + pre-filter criteria are read in plain language from `preferences.md`.
 */
export {
  prefilter,
  prefilterOne,
  type PrefilterCriteria,
  type PrefilterDrop,
  type PrefilterResult,
} from "./prefilter";

export {
  FakeScorer,
  type Scorer,
  type ScoreContext,
  type ScoreResult,
  type ScoredBy,
  type ScoreVerdict,
  type SubScores,
} from "./scorer";

export {
  DEFAULT_WEIGHTS,
  parseWeights,
  parsePrefilter,
  combineOverall,
  loadPreferences,
  PREFERENCES_PATH,
  type ScoreWeights,
  type ParsedPreferences,
} from "./weights";

export {
  scoreCompanies,
  toScorePatch,
  type ScoreRunDeps,
  type ScoreRunResult,
  type ScoredCompany,
} from "./score-run";

export {
  applyScores,
  buildScoreResult,
  type AppliedScoreInput,
  type ApplyScoresResult,
} from "./apply";

export {
  // Generic, taste-neutral fact extractors (reusable by any persona):
  pastEmployers,
  educationSummary,
  isFounderTitle,
  // Career Mover pedigree heuristic (ONE persona's taste; used by who-to-meet):
  founderPedigree,
  type Pedigree,
} from "./pedigree";

export {
  buildScoringContext,
  type ScoringContextCompany,
  type ScoringContextOptions,
  type ScoringContextRepos,
} from "./scoring-context";

export {
  SCORE_AXES,
  isScoreAxis,
  scoreValue,
  sortByScore,
  type ScoreAxis,
} from "./sort";

export {
  selectShortlist,
  hasCoverage,
  DEFAULT_SHORTLIST_LIMIT,
  type ShortlistOptions,
} from "./shortlist";

export {
  persistVerdict,
  type PersistVerdictOptions,
} from "./persist-verdict";
