import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  async headers() {
    return [{
      source: "/book/:organizationSlug/confirmation/:token",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    }];
  },  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;

