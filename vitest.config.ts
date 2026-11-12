// Unit tests for the studio's geometry and data logic (pnpm test).
// Kept separate from vite.config.ts so tests do not load the Cloudflare /
// vinext build plugins.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
