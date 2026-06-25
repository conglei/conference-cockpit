import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it out of the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  // Pin the workspace root to this repo (a parent lockfile exists higher up).
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
