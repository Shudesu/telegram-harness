import { describe, expect, it } from "vitest";
import { isLocalUiRequest } from "./local-ui-policy";
describe("local UI boundary", () => {
  it("fails closed unless explicitly enabled and Host is loopback", () => {
    for (const host of ["localhost", "127.0.0.1:13005", "[::1]:3005"])
      expect(isLocalUiRequest("true", host)).toBe(true);
    for (const host of [
      null,
      "untrusted.example",
      "localhost.attacker.test",
      "localhost@attacker.test",
      "127.0.0.1.evil:3005",
      "localhost:abc",
    ])
      expect(isLocalUiRequest("true", host)).toBe(false);
    for (const enabled of [undefined, "false", "1"])
      expect(isLocalUiRequest(enabled, "localhost")).toBe(false);
  });
});
