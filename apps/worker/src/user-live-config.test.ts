import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { userLiveBind } from "./user-live-config.js";

describe("user-live bind", () => {
  it("defaults to IPv4 loopback and honors HOST and PORT", () => {
    expect(userLiveBind({})).toEqual({ hostname: "127.0.0.1", port: 8787 });
    expect(userLiveBind({ HOST: "  ", PORT: "" })).toEqual({ hostname: "127.0.0.1", port: 8787 });
    expect(userLiveBind({ HOST: "0.0.0.0", PORT: "9000" })).toEqual({ hostname: "0.0.0.0", port: 9000 });
    expect(() => userLiveBind({ PORT: "0" })).toThrow("invalid_port");
  });

  it("serves the sqlite repo on the configured hostname", () => {
    const source = readFileSync(new URL("./user-live-server.ts", import.meta.url), "utf8");
    expect(source).toContain("openNodeSqliteRepo");
    expect(source).toContain("hostname: bind.hostname");
    expect(source).not.toContain("MemoryRepo");
  });
});
