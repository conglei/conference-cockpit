/**
 * Load the portable goal profile the plan engine consumes (Round 8 §6): the
 * forkable, plain-English taste files — `profile/preferences.md` (weights +
 * hard criteria) and, when present, `profile/resume.md` / `profile/narrative.md`
 * (a one-paragraph "who I am" that seeds openers). Missing files degrade to
 * sensible defaults — the engine never throws on a fresh checkout.
 */
import { readFileSync } from "node:fs";
import { loadPreferences } from "../scoring";
import type { GoalProfile } from "./types";

function readIfPresent(path: string): string | undefined {
  try {
    const t = readFileSync(path, "utf8").trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

/** First non-empty, non-heading paragraph — a compact "who I am" for openers. */
function firstParagraph(md: string | undefined): string | undefined {
  if (!md) return undefined;
  for (const block of md.split(/\n\s*\n/)) {
    const line = block.trim();
    if (!line || line.startsWith("#") || line.startsWith("---")) continue;
    return line.replace(/\s+/g, " ").slice(0, 400);
  }
  return undefined;
}

export function loadGoalProfile(opts?: {
  preferencesPath?: string;
  summaryPaths?: string[];
}): GoalProfile {
  const prefs = loadPreferences(opts?.preferencesPath);
  const summaryPaths = opts?.summaryPaths ?? [
    "profile/narrative.md",
    "profile/resume.md",
  ];
  let summary: string | undefined;
  for (const p of summaryPaths) {
    summary = firstParagraph(readIfPresent(p));
    if (summary) break;
  }
  return { weights: prefs.weights, prefilter: prefs.prefilter, summary };
}
