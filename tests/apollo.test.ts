import { describe, it, expect } from "vitest";
import { ApolloProvider } from "../src/providers/apollo";
import { ProviderConfigError } from "../src/providers/types";
import { CostMeter } from "../src/providers/cost";

/** A fetch stub that returns the same JSON body for any request. */
function okJson(body: unknown): typeof fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

/** A fetch stub that routes by URL to a body. */
function router(route: (url: string) => unknown): typeof fetch {
  return (async (input: string) =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => route(String(input)),
    }) as unknown as Response) as unknown as typeof fetch;
}

describe("ApolloProvider (domain-first identity + roster)", () => {
  it("names APOLLO_KEY when unconfigured", async () => {
    const p = new ApolloProvider({ apiKey: undefined });
    await expect(p.resolveCompany({ name: "Acme", domain: "acme.com" })).rejects.toThrow(
      ProviderConfigError,
    );
  });

  // org-enrich keys on the company DOMAIN and maps firmographics + LinkedIn.
  it("resolveCompany maps an org-enrich payload by domain", async () => {
    const p = new ApolloProvider({
      apiKey: "k",
      fetchImpl: okJson({
        organization: {
          name: "Acme",
          website_url: "https://www.acme.com",
          linkedin_url: "https://www.linkedin.com/company/acme",
          primary_domain: "acme.com",
          estimated_num_employees: 12,
          short_description: "Rockets.",
        },
      }),
    });
    const r = await p.resolveCompany({ name: "Acme", domain: "acme.com" });
    expect(r.domain).toBe("acme.com");
    expect(r.linkedinUrl).toBe("https://www.linkedin.com/company/acme");
    expect(r.description).toBe("Rockets.");
    expect(r.sizeBand).toBe("tiny");
    expect(r.via).toBe("apollo");
  });

  // org-enrich also carries funding: round name, the most-recent funding_event
  // (amount/lead investor/date), and the cumulative total.
  it("resolveCompany parses funding from an org-enrich payload", async () => {
    const p = new ApolloProvider({
      apiKey: "k",
      fetchImpl: okJson({
        organization: {
          primary_domain: "acme.com",
          latest_funding_stage: "Series F",
          latest_funding_round_date: "2024-03-01T00:00:00.000Z",
          total_funding_printed: "2.1B",
          funding_events: [
            {
              date: "2021-09-15T00:00:00.000Z",
              type: "Series D",
              amount: "500M",
              currency: "$",
              investors: "Old Capital",
            },
            // The most recent event (max date) is the one that should win.
            {
              date: "2024-03-01T00:00:00.000Z",
              type: "Series F",
              amount: "1.5B",
              currency: "$",
              investors: "Acme Ventures, Big Fund",
            },
          ],
        },
      }),
    });
    const r = await p.resolveCompany({ name: "Acme", domain: "acme.com" });
    expect(r.latestRound).toBe("Series F");
    expect(r.latestAmount).toBe("$1.5B");
    expect(r.leadInvestor).toBe("Acme Ventures, Big Fund");
    expect(r.lastFundingDate).toBe("2024-03-01");
    expect(r.fundingTotal).toBe("$2.1B");
  });

  // Missing funding → the funding fields are simply absent (defensive).
  it("resolveCompany leaves funding undefined when the org has none", async () => {
    const p = new ApolloProvider({
      apiKey: "k",
      fetchImpl: okJson({ organization: { primary_domain: "acme.com" } }),
    });
    const r = await p.resolveCompany({ name: "Acme", domain: "acme.com" });
    expect(r.latestRound).toBeUndefined();
    expect(r.latestAmount).toBeUndefined();
    expect(r.leadInvestor).toBeUndefined();
    expect(r.lastFundingDate).toBeUndefined();
    expect(r.fundingTotal).toBeUndefined();
  });

  // No domain (and no website to derive one from) → empty resolution, no call.
  it("resolveCompany returns an empty resolution when no domain is known", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return { ok: true, status: 200, statusText: "OK", json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const p = new ApolloProvider({ apiKey: "k", fetchImpl });
    const r = await p.resolveCompany({ name: "Acme" });
    expect(r).toEqual({ via: "apollo" });
    expect(calls).toBe(0);
  });

  // people-search rosters founders by domain, mapped to Employee[].
  it("getEmployees maps a people-search payload to founders by domain", async () => {
    const p = new ApolloProvider({
      apiKey: "k",
      fetchImpl: okJson({
        people: [
          {
            name: "Fay Founder",
            first_name: "Fay",
            last_name: "Founder",
            title: "Co-Founder & CEO",
            linkedin_url: "https://www.linkedin.com/in/fay",
            city: "San Francisco",
            state: "California",
            country: "United States",
          },
          {
            first_name: "Cary",
            last_name: "CTO",
            title: "CTO",
            linkedin_url: "https://www.linkedin.com/in/cary",
          },
        ],
      }),
    });
    const employees = await p.getEmployees({
      companyLinkedinUrl: "https://www.linkedin.com/company/acme",
      domain: "acme.com",
    });
    expect(employees.map((e) => e.name)).toEqual(["Fay Founder", "Cary CTO"]);
    const fay = employees[0];
    expect(fay.linkedinUrl).toBe("https://www.linkedin.com/in/fay");
    expect(fay.title).toBe("Co-Founder & CEO");
    expect(fay.location).toBe("San Francisco, California, United States");
    // Name falls back to first + last when `name` is absent.
    expect(employees[1].name).toBe("Cary CTO");
  });

  // Each roster entry carries Apollo's masked-search person id as providerId —
  // the only key that reveals the full name + LinkedIn via getProfile.
  it("getEmployees carries the Apollo person id as providerId", async () => {
    const p = new ApolloProvider({
      apiKey: "k",
      fetchImpl: okJson({
        people: [
          { first_name: "Charles", last_name_obfuscated: "Pa***r", title: "CEO", id: "abc123" },
          { first_name: "Nora", last_name_obfuscated: "N***", title: "CTO" },
        ],
      }),
    });
    const employees = await p.getEmployees({
      companyLinkedinUrl: "https://www.linkedin.com/company/acme",
      domain: "acme.com",
    });
    expect(employees[0].providerId).toBe("abc123");
    // No id on the payload → no providerId.
    expect(employees[1].providerId).toBeUndefined();
  });

  // No domain → no roster, no call.
  it("getEmployees returns [] without a domain", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return { ok: true, status: 200, statusText: "OK", json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const p = new ApolloProvider({ apiKey: "k", fetchImpl });
    const employees = await p.getEmployees({
      companyLinkedinUrl: "https://www.linkedin.com/company/acme",
    });
    expect(employees).toEqual([]);
    expect(calls).toBe(0);
  });

  // With a providerId, getProfile hits people/match and reveals the full,
  // unmasked name + LinkedIn URL the search masked.
  it("getProfile reveals full name + LinkedIn via people/match by providerId", async () => {
    let matchBody: unknown;
    const fetchImpl = (async (input: string, init: RequestInit) => {
      matchBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          person: {
            name: "Charles Packer",
            linkedin_url: "http://www.linkedin.com/in/charles-packer",
            title: "Co-Founder & CEO",
            city: "San Francisco",
            state: "California",
            country: "United States",
            organization: { name: "Letta" },
          },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const meter = new CostMeter();
    const p = new ApolloProvider({ apiKey: "k", fetchImpl, meter });

    const profile = await p.getProfile({ linkedinUrl: "", providerId: "abc123" });
    expect(matchBody).toEqual({ id: "abc123" });
    expect(profile.name).toBe("Charles Packer");
    expect(profile.linkedinUrl).toBe("http://www.linkedin.com/in/charles-packer");
    expect(profile.title).toBe("Co-Founder & CEO");
    expect(profile.company).toBe("Letta");
    expect(profile.location).toBe("San Francisco, California, United States");
    // The match call is billed.
    expect(meter.summary().counts.apollo).toBe(1);
  });

  // Without a providerId (and Apollo can't deep-fetch by LinkedIn URL), keep
  // degrading via ProviderConfigError — that rung is the harvest provider's.
  it("getProfile throws ProviderConfigError without a providerId", async () => {
    const p = new ApolloProvider({ apiKey: "k" });
    await expect(p.getProfile({ linkedinUrl: "https://www.linkedin.com/in/fay" })).rejects.toThrow(
      ProviderConfigError,
    );
  });

  it("search throws ProviderConfigError", async () => {
    const p = new ApolloProvider({ apiKey: "k" });
    await expect(p.search({ q: "x", engine: "web" })).rejects.toThrow(ProviderConfigError);
  });

  // Each successful Apollo call is metered under the `apollo` kind.
  it("records apollo calls in the cost meter", async () => {
    const meter = new CostMeter();
    const fetchImpl = router((url) =>
      url.includes("/organizations/enrich")
        ? { organization: { primary_domain: "acme.com" } }
        : { people: [] },
    );
    const p = new ApolloProvider({ apiKey: "k", fetchImpl, meter });
    await p.resolveCompany({ name: "Acme", domain: "acme.com" });
    await p.getEmployees({ companyLinkedinUrl: "x", domain: "acme.com" });
    const s = meter.summary();
    expect(s.counts.apollo).toBe(2);
    expect(s.totalUsd).toBeCloseTo(0.02, 6);
  });
});
