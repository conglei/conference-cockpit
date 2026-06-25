/**
 * Referrer discovery & who-next (issue 06). Turns the people data into a
 * network-building loop:
 *   - a pluggable `ConnectionSource` yields the user's 1st-degree graph;
 *   - `ingestConnections` lands it in `people` (network_contact, degree 1);
 *   - `crossReferenceCompany` flags who works at a target company (warm intro);
 *   - `whoNext` ranks contactable referrers by fit × connection-strength.
 * The judgment lives in the SKILL (.claude/skills/find-referrers/SKILL.md); these
 * are the deterministic primitives.
 */
export type { Connection, ConnectionSource } from "./connection-source";
export { LinkedinCsvSource, stripLinkedinPreamble } from "./linkedin-csv-source";
export {
  ingestConnections,
  ingestOne,
  type IngestOutcome,
  type IngestResult,
} from "./ingest";
export {
  crossReferenceCompany,
  type CrossReferenceOptions,
  type CrossReferenceResult,
} from "./cross-reference";
export {
  whoNext,
  connectionStrength,
  type WhoNextEntry,
} from "./who-next";
