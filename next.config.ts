import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @libsql/client is a native module; keep it out of the server bundle.
  serverExternalPackages: ["@libsql/client"],
  // Pin the workspace root to this repo (a parent lockfile exists higher up).
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
