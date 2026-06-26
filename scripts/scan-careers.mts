/**
 * One-off: for each remaining real-target company, fetch the HOMEPAGE and pull the
 * careers/jobs link out of the markup (nav/footer) — far more reliable than guessing
 * /careers. Classifies empty (no link) vs has-careers (with the real URL).
 */
import { loadEnvFile } from "../src/onboarding/load-env";
loadEnvFile();
import { createClient } from "@libsql/client";
import { writeFileSync } from "node:fs";

const db = createClient({ url: "file:data/conference.db" });
const targets = (
  await db.execute(`
  select c.name,c.slug,c.domain,c.website_url
  from companies c
  where c.id not in (select company_id from roles where source in ('ats','manual'))
    and coalesce(c.size_band,'') != 'large' and c.domain is not null
  order by c.name`)
).rows as { name: string; slug: string; domain: string | null; website_url: string | null }[];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function fetchText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
    return res.ok ? await res.text() : "";
  } catch {
    return "";
  }
}

/** Pull href candidates that look like a careers/jobs destination from homepage HTML. */
function careersLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  // <a href="...">…careers/jobs…</a>  OR href that contains careers/jobs/an ATS host
  for (const m of html.matchAll(/href=["']([^"']+)["'][^>]*>([^<]{0,40})</gi)) {
    const href = m[1];
    const text = (m[2] || "").toLowerCase();
    const h = href.toLowerCase();
    const isAts = /(ashbyhq\.com|greenhouse\.io|lever\.co|workable\.com|notion\.site|\.workable\.com|join\.com|teamtailor)/.test(h);
    if (
      isAts ||
      /\b(careers?|jobs|join-us|join_us|hiring|work-with-us|open-roles|openings)\b/.test(h) ||
      /\b(careers?|jobs|hiring|join us|open roles|we'?re hiring)\b/.test(text)
    ) {
      try {
        out.add(new URL(href, base).href);
      } catch {
        /* skip bad href */
      }
    }
  }
  return [...out].filter((u) => !/mailto:|linkedin\.com|twitter\.com|x\.com|facebook|instagram/.test(u)).slice(0, 5);
}

const results: { slug: string; name: string; homepage: string; links: string[] }[] = [];
let idx = 0;
async function worker() {
  while (idx < targets.length) {
    const c = targets[idx++];
    const host = (c.domain ?? c.website_url ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const homepage = `https://${host}`;
    const html = (await fetchText(homepage)) || (await fetchText(`https://www.${host}`));
    const links = html ? careersLinks(html, homepage) : [];
    results.push({ slug: c.slug, name: c.name, homepage, links });
    console.log(`${links.length ? "✓" : "·"} ${c.name.padEnd(24)} ${links.length ? links.join("  ") : "(no careers link in homepage)"}`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

writeFileSync("data/careers-found.json", JSON.stringify({ results }, null, 2));
const withLink = results.filter((r) => r.links.length).length;
console.log(`\n${withLink}/${targets.length} homepages expose a careers/jobs link → data/careers-found.json`);
