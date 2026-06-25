/**
 * Mirror the active filter/sort into the URL *shallowly* — `window.history`
 * only, no Next router navigation, so there is no server round-trip. Deep links
 * still work because the server pages read the same params from `searchParams`
 * and seed the client component's initial state.
 *
 * `params` values that are empty/undefined are dropped so the URL stays clean
 * (e.g. `status=all` and a default sort don't clutter the query string).
 */
export function replaceQuery(params: Record<string, string | undefined>): void {
  if (typeof window === "undefined") return;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const str = qs.toString();
  const url = str ? `${window.location.pathname}?${str}` : window.location.pathname;
  window.history.replaceState(window.history.state, "", url);
}
