import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSecretFilePath, FileSecretStore } from "./file-secrets.js";
import { decryptSession, encryptSession } from "./session-crypto.js";

describe("session crypto", () => {
  it("round-trips a session and fails closed on the wrong key", async () => {
    const key = new Uint8Array(32).fill(4);
    const other = new Uint8Array(32).fill(5);
    const encrypted = await encryptSession("dry-run-session", key);
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(encrypted).not.toContain("dry-run-session");
    await expect(decryptSession(encrypted, key)).resolves.toBe("dry-run-session");
    await expect(decryptSession(encrypted, other)).rejects.toThrow("session_decrypt_failed");
  });

  it("rejects a secret file inside the repo outside .local", () => {
    expect(() => assertSecretFilePath("secrets.json")).toThrow("secret_path_rejected");
    const outside = join(mkdtempSync(join(tmpdir(), "tg-secrets-")), "secrets.json");
    expect(() => assertSecretFilePath(outside)).not.toThrow();
    const store = new FileSecretStore(outside, {});
    return store.put("TELEGRAM_USER_SESSION", "v1.cipher").then(async () => {
      await expect(store.get("TELEGRAM_USER_SESSION")).resolves.toBe("v1.cipher");
    });
  });
});
