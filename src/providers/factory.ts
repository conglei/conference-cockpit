import { ApolloProvider } from "./apollo";
import type { CostMeter } from "./cost";
import { FakeProvider } from "./fake";
import { HarvestProvider } from "./harvest";
import { SearchApiProvider } from "./searchapi";
import { ProviderConfigError, type EnrichmentProvider } from "./types";

export const PROVIDER_KINDS = ["fake", "harvest", "searchapi", "apollo"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** The env var that selects the active provider (config, not code). */
export const PROVIDER_ENV = "ENRICHMENT_PROVIDER";

function isProviderKind(v: string): v is ProviderKind {
  return (PROVIDER_KINDS as readonly string[]).includes(v);
}

/**
 * Build the active EnrichmentProvider from configuration. Selection is a config
 * change (the `ENRICHMENT_PROVIDER` env var), never a code change — this is the
 * one place that maps a kind string to an adapter. Tests dependency-inject a
 * `FakeProvider` directly instead of going through here.
 *
 * Defaults to `fake` so nothing in the pipeline requires network/keys unless
 * the user explicitly opts into a real provider.
 */
export function createProvider(
  kind: string | undefined = process.env[PROVIDER_ENV],
  opts: { meter?: CostMeter } = {},
): EnrichmentProvider {
  const k = (kind ?? "fake").trim().toLowerCase();
  if (!isProviderKind(k)) {
    throw new ProviderConfigError(
      `Unknown ${PROVIDER_ENV}="${kind}". Valid values: ${PROVIDER_KINDS.join(", ")}.`,
    );
  }
  switch (k) {
    case "fake":
      return new FakeProvider();
    case "harvest":
      return new HarvestProvider({ meter: opts.meter });
    case "searchapi":
      return new SearchApiProvider({ meter: opts.meter });
    case "apollo":
      return new ApolloProvider({ meter: opts.meter });
  }
}
