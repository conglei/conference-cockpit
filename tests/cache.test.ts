import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResponseCache, cacheKey } from "../src/providers/cache";
import { ApolloProvider } from "../src/providers/apollo";
import { CostMeter } from "../src/providers/cost";

/** A fetch stub that returns the same JSON body and counts how often it's hit. */
function countingFetch(body: unknown): { fetchImpl: typeof fetch; calls: () => number } {
  let n = 0;
  const fetchImpl = (async () => {
    n += 1;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => n };
}

describe("ResponseCache", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "api-cache-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips set → get", async () => {
    const cache = new ResponseCache({ dbPath: join(dir, "c.db") });
    const key = cacheKey("apollo", "GET", "https://api.apollo.io/x?b=2&a=1");
    expect(await cache.get(key)).toBeUndefined();
    await cache.set(key, { provider: "apollo", request: key, response: '{"ok":true}', status: 200 });
    expect(await cache.get(key)).toEqual({ response: '{"ok":true}', status: 200 });
  });

  it("keys identically regardless of query-param order", () => {
    const a = cacheKey("apollo", "GET", "https://x.test/p?b=2&a=1");
    const b = cacheKey("apollo", "GET", "https://x.test/p?a=1&b=2");
    expect(a).toBe(b);
  });

  it("works in-memory (:memory:) without touching disk", async () => {
    const cache = new ResponseCache({ dbPath: ":memory:" });
    const key = cacheKey("apollo", "GET", "https://x.test/p");
    await cache.set(key, { provider: "apollo", request: key, response: "{}", status: 200 });
    expect((await cache.get(key))?.status).toBe(200);
  });

  it("off mode: get always undefined, set is a no-op", async () => {
    const cache = new ResponseCache({ dbPath: join(dir, "off.db"), off: true });
    const key = cacheKey("apollo", "GET", "https://x.test/p");
    await cache.set(key, { provider: "apollo", request: key, response: "{}", status: 200 });
    expect(await cache.get(key)).toBeUndefined();
  });

  // A second identical provider request is served from cache: fetch runs ONCE,
  // the cached body comes back, and the cache hit adds NO meter cost.
  it("a second identical Apollo request hits cache (fetch once, no extra cost)", async () => {
    const cache = new ResponseCache({ dbPath: join(dir, "p.db") });
    const meter = new CostMeter();
    const { fetchImpl, calls } = countingFetch({
      organization: { primary_domain: "acme.com", short_description: "Rockets." },
    });
    const p = new ApolloProvider({ apiKey: "k", fetchImpl, meter, cache });

    const r1 = await p.resolveCompany({ name: "Acme", domain: "acme.com" });
    expect(r1.domain).toBe("acme.com");
    expect(calls()).toBe(1);
    expect(meter.summary().counts.apollo).toBe(1);

    const r2 = await p.resolveCompany({ name: "Acme", domain: "acme.com" });
    expect(r2.domain).toBe("acme.com");
    // No second fetch and no second meter charge — the cache hit is free.
    expect(calls()).toBe(1);
    expect(meter.summary().counts.apollo).toBe(1);
  });

  // With the cache OFF, both identical requests hit the network (and both bill).
  it("API_CACHE=off bypasses the cache (fetch called both times)", async () => {
    const cache = new ResponseCache({ dbPath: join(dir, "noop.db"), off: true });
    const meter = new CostMeter();
    const { fetchImpl, calls } = countingFetch({
      organization: { primary_domain: "acme.com" },
    });
    const p = new ApolloProvider({ apiKey: "k", fetchImpl, meter, cache });

    await p.resolveCompany({ name: "Acme", domain: "acme.com" });
    await p.resolveCompany({ name: "Acme", domain: "acme.com" });
    expect(calls()).toBe(2);
    expect(meter.summary().counts.apollo).toBe(2);
  });
});
