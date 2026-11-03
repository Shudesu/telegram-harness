import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./scripts/test-offline.ts"],
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
  },
});
