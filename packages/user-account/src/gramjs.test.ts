import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { GRAMJS_CLIENT_OPTIONS } from "./gramjs.js";

const require = createRequire(import.meta.url);

describe("GramJS client options", () => {
  it("sends one attempt and does not ask the library to retry or sleep", () => {
    const library = readFileSync(require.resolve("telegram/client/users.js"), "utf8");
    const source = readFileSync(new URL("./gramjs.ts", import.meta.url), "utf8");
    expect(library).toContain("for (attempt = 0; attempt < client._requestRetries; attempt++)");
    expect(GRAMJS_CLIENT_OPTIONS.requestRetries).toBe(1);
    expect(GRAMJS_CLIENT_OPTIONS.requestRetries).toBeGreaterThan(0);
    expect(GRAMJS_CLIENT_OPTIONS.floodSleepThreshold).toBe(0);
    expect(GRAMJS_CLIENT_OPTIONS.autoReconnect).toBe(false);
    expect(source).toContain("...GRAMJS_CLIENT_OPTIONS");
    expect(source).not.toMatch(/requestRetries:\s*0\b/);
    expect(source).toMatch(/floodSleepThreshold\s*=\s*0/);
  });
});
