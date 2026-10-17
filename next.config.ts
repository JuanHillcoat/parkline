import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep AGENTS.md as the project's own conventions; `next dev` would otherwise append its own block.
  agentRules: false,
};

export default nextConfig;
