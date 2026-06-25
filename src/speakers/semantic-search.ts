/**
 * Cosine similarity search over stored speaker embeddings. Pure and offline: it
 * ranks the stored vectors against a query vector you supply. Two entry points:
 *
 *  - searchByVector(repo, query, k) — rank all speakers against an external query
 *    vector (e.g. one you embedded from free text with the same Gemini model).
 *  - nearestToSpeaker(repo, externalId, k) — "find speakers like this one" using
 *    a vector already in the table; needs NO embedding API, so it works today.
 *
 * Vectors are stored as JSON arrays; we parse lazily and skip malformed rows.
 */
import type { SpeakerEmbeddingRepo } from "../db/speaker-embedding-repository";

export interface SpeakerMatch {
  externalId: string;
  name: string;
  company: string | null;
  role: string | null;
  personId: number | null;
  score: number;
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function parseVec(json: string): number[] | undefined {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) && v.every((x) => typeof x === "number") ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Rank every stored speaker against `query`, returning the top `k` by cosine. */
export function searchByVector(
  repo: SpeakerEmbeddingRepo,
  query: number[],
  k = 10,
): SpeakerMatch[] {
  const out: SpeakerMatch[] = [];
  for (const row of repo.list()) {
    const vec = parseVec(row.embedding);
    if (!vec) continue;
    out.push({
      externalId: row.externalId,
      name: row.name,
      company: row.company,
      role: row.role,
      personId: row.personId,
      score: cosine(query, vec),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, k);
}

/**
 * "Find speakers like this one" — uses the stored vector of `externalId` as the
 * query and excludes the seed itself. Works with no embedding API.
 */
export function nearestToSpeaker(
  repo: SpeakerEmbeddingRepo,
  externalId: string,
  k = 10,
): SpeakerMatch[] {
  const seed = repo.byExternalId(externalId);
  const vec = seed && parseVec(seed.embedding);
  if (!vec) return [];
  return searchByVector(repo, vec, k + 1).filter((m) => m.externalId !== externalId).slice(0, k);
}
