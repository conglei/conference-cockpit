import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = ".claude/skills";
const EXPECTED = ["plan-conference", "company-brief", "who-to-meet"];

function frontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^"|"$/g, "");
  }
  return out;
}

describe("conference skills are well-formed", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;

  it("each expected skill exists with a SKILL.md", () => {
    const present = readdirSync(SKILLS_DIR);
    for (const s of EXPECTED) {
      expect(present, `skill dir ${s}`).toContain(s);
      expect(existsSync(join(SKILLS_DIR, s, "SKILL.md")), `${s}/SKILL.md`).toBe(true);
    }
  });

  it("each SKILL.md has frontmatter name matching its dir + a non-trivial description", () => {
    for (const s of EXPECTED) {
      const fm = frontmatter(readFileSync(join(SKILLS_DIR, s, "SKILL.md"), "utf8"));
      expect(fm.name, `${s} name`).toBe(s);
      expect((fm.description ?? "").length, `${s} description`).toBeGreaterThan(40);
    }
  });

  it("every `pnpm <cmd>` a skill references is a real package.json script", () => {
    const referenced = new Set<string>();
    for (const s of EXPECTED) {
      const md = readFileSync(join(SKILLS_DIR, s, "SKILL.md"), "utf8");
      for (const m of md.matchAll(/pnpm ([a-z][a-z0-9:-]+)/g)) {
        // skip generic pnpm subcommands that aren't scripts
        if (["install", "exec", "test", "run", "dev"].includes(m[1])) continue;
        referenced.add(m[1]);
      }
    }
    for (const cmd of referenced) {
      expect(scripts[cmd], `package.json script "${cmd}" referenced by a skill`).toBeDefined();
    }
    // sanity: the core CLIs are actually referenced
    expect(referenced.has("conf-plan")).toBe(true);
    expect(referenced.has("conf-brief")).toBe(true);
  });
});
