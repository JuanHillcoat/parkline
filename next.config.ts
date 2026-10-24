import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep AGENTS.md as the project's own conventions; `next dev` would otherwise append its own block.
  agentRules: false,
  // The image upload (up to 500 KB, plus form fields) must reach the server action so a too-large file gets its typed message.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;
