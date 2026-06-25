// Default the response cache OFF for the whole suite so no test touches the real
// shared cache file (`data/api-cache.db`) or carries state between tests. Tests
// that exercise the cache construct their own ResponseCache with an explicit
// path (tmp file or ":memory:") instead of relying on the env-configured one.
process.env.API_CACHE = "off";
