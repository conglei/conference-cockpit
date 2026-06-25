import { describe, it, expect } from "vitest";
import { crawlCompanyDomain, domainFromHtml } from "../src/providers/aggregator";

// A stand-in for a Framer aggregator page: the company's own domain appears many
// times (header/footer/CTAs), amid denylisted framework/social/news/form hosts.
function aggregatorHtml(companyDomain: string): string {
  const company = Array.from({ length: 6 }, () => `<a href="https://www.${companyDomain}/">x</a>`).join("");
  const noise = [
    `<link href="https://framerusercontent.com/styles.css">`,
    `<script src="https://events.framer.com/track"></script>`,
    `<a href="https://www.linkedin.com/company/acme">li</a>`,
    `<a href="https://jobs.ashbyhq.com/acme">jobs</a>`,
    `<a href="https://www.finsmes.com/2026/06/acme-raises">press</a>`,
    `<a href="https://tally.so/r/abc">form</a>`,
    `<a href="https://startups.gallery/companies/acme">self</a>`,
  ].join("");
  return `<!doctype html><html><body>${noise}${company}</body></html>`;
}

describe("aggregator domain crawler", () => {
  it("frequency-ranks the company domain over denylisted noise", () => {
    // The helper page also embeds a jobs.ashbyhq.com link, so the now-additive
    // recruitingUrl rides along — the domain/website extraction is unchanged.
    expect(domainFromHtml(aggregatorHtml("paradigmai.com"))).toEqual({
      domain: "paradigmai.com",
      websiteUrl: "https://paradigmai.com",
      recruitingUrl: "https://jobs.ashbyhq.com/acme",
    });
  });

  it("strips www and lower-cases to an apex domain", () => {
    const r = domainFromHtml(`<a href="https://WWW.SDSA.AI/">a</a><a href="https://sdsa.ai/x">b</a>`);
    expect(r?.domain).toBe("sdsa.ai");
  });

  it("returns undefined when only denylisted hosts are present", () => {
    const html = `<a href="https://www.linkedin.com/company/x">li</a><a href="https://framer.com">f</a>`;
    expect(domainFromHtml(html)).toBeUndefined();
  });

  it("returns undefined below the confidence bar (1x noise, no clear winner)", () => {
    // Mirrors the real Giga page: only one-off, non-company domains → don't guess.
    const html = `<a href="https://tally.so/r/a">f</a><a href="https://gonzija.com/x">n</a><a href="https://example.com">e</a>`;
    expect(domainFromHtml(html)).toBeUndefined();
  });

  it("extracts a known ATS link (jobs.ashbyhq.com) as the recruiting URL", () => {
    // aggregatorHtml already embeds a https://jobs.ashbyhq.com/<company> link.
    expect(domainFromHtml(aggregatorHtml("acme.com"))).toMatchObject({
      domain: "acme.com",
      recruitingUrl: "https://jobs.ashbyhq.com/acme",
    });
  });

  it("extracts a careers.<domain> subdomain link as the recruiting URL", () => {
    const company = Array.from({ length: 4 }, () => `<a href="https://acme.com/">x</a>`).join("");
    const html = `${company}<a href="https://careers.acme.com/openings">careers</a>`;
    expect(domainFromHtml(html)).toMatchObject({
      domain: "acme.com",
      recruitingUrl: "https://careers.acme.com/openings",
    });
  });

  it("leaves recruitingUrl undefined when only the domain + social links are present", () => {
    const company = Array.from({ length: 4 }, () => `<a href="https://acme.com/">x</a>`).join("");
    const html = `<a href="https://www.linkedin.com/company/acme">li</a><a href="https://twitter.com/acme">tw</a>${company}`;
    const r = domainFromHtml(html);
    expect(r?.domain).toBe("acme.com");
    expect(r?.recruitingUrl).toBeUndefined();
  });

  it("crawlCompanyDomain reads the page via injected fetch", async () => {
    const fetchImpl = (async () =>
      ({ ok: true, status: 200, text: async () => aggregatorHtml("0.email") }) as unknown as Response) as unknown as typeof fetch;
    const r = await crawlCompanyDomain("https://startups.gallery/companies/mail0", fetchImpl);
    expect(r).toEqual({
      domain: "0.email",
      websiteUrl: "https://0.email",
      recruitingUrl: "https://jobs.ashbyhq.com/acme",
    });
  });

  it("crawlCompanyDomain returns undefined on a non-OK response", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 404, text: async () => "" }) as unknown as Response) as unknown as typeof fetch;
    expect(await crawlCompanyDomain("https://startups.gallery/companies/x", fetchImpl)).toBeUndefined();
  });

  it("crawlCompanyDomain retries transient failures and recovers the domain", async () => {
    // Fails twice (a network throw, then a 500), then serves good HTML on the
    // third try — exactly the throttle/block pattern that silently dropped 111
    // of 116 companies in the real recovery run.
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("ECONNRESET");
      if (calls === 2) return { ok: false, status: 500, statusText: "Server Error", text: async () => "" } as unknown as Response;
      return { ok: true, status: 200, text: async () => aggregatorHtml("paradigmai.com") } as unknown as Response;
    }) as unknown as typeof fetch;
    const r = await crawlCompanyDomain("https://startups.gallery/companies/paradigm", fetchImpl, {
      retry: { retries: 3, minTimeout: 1, factor: 1 },
    });
    expect(r).toEqual({
      domain: "paradigmai.com",
      websiteUrl: "https://paradigmai.com",
      recruitingUrl: "https://jobs.ashbyhq.com/acme",
    });
    expect(calls).toBe(3);
  });

  it("crawlCompanyDomain does NOT retry a 200 page with no company domain", async () => {
    // A clean 200 whose page has no extractable company domain is a real
    // 'unresolved', not transient — fetch must be called exactly once.
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => `<a href="https://www.linkedin.com/company/x">li</a>` } as unknown as Response;
    }) as unknown as typeof fetch;
    const r = await crawlCompanyDomain("https://startups.gallery/companies/empty", fetchImpl, {
      retry: { retries: 3, minTimeout: 1, factor: 1 },
    });
    expect(r).toBeUndefined();
    expect(calls).toBe(1);
  });
});
