import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build a self-contained Node.js server (dist/standalone/server.js) so the
  // app runs on Node hosts such as Hostinger.
  output: "standalone",
};

export default nextConfig;
