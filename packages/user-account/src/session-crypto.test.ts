import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

  it("persists only session, login, and bot-token keys it stored", async () => {
    const outside = join(mkdtempSync(join(tmpdir(), "tg-secrets-")), "secrets.json");
    writeFileSync(
      outside,
      JSON.stringify({
        PATH: "/usr/bin",
        HOME: "/tmp/not-a-home",
        TELEGRAM_API_HASH: "not-a-real-hash",
        TELEGRAM_USER_SESSION: "v1.kept",
      }),
      { mode: 0o644 },
    );
    const store = new FileSecretStore(outside, {
      PATH: "/usr/bin",
      HOME: "/tmp/not-a-home",
      TELEGRAM_API_HASH: "not-a-real-hash",
      TELEGRAM_BOT_TOKEN_MAIN: "from-env",
    });
    await store.put("TELEGRAM_USER_LOGIN_SESSION", "v1.login-cipher");
    await store.put("TELEGRAM_BOT_TOKEN_NEWS", "test-token-value");
    await store.put("OTHER_SECRET_NAME", "should-not-persist");
    const saved = JSON.parse(readFileSync(outside, "utf8")) as Record<string, string>;
    expect(saved).toEqual({
      TELEGRAM_USER_SESSION: "v1.kept",
      TELEGRAM_USER_LOGIN_SESSION: "v1.login-cipher",
      TELEGRAM_BOT_TOKEN_NEWS: "test-token-value",
    });
    expect(JSON.stringify(saved)).not.toContain("/usr/bin");
    expect(JSON.stringify(saved)).not.toContain("TELEGRAM_API_HASH");
    expect(JSON.stringify(saved)).not.toContain("from-env");
    expect((statSync(outside).mode & 0o777) === 0o600).toBe(true);
    const reloaded = new FileSecretStore(outside, {});
    await expect(reloaded.get("TELEGRAM_USER_SESSION")).resolves.toBe("v1.kept");
    await expect(reloaded.get("TELEGRAM_BOT_TOKEN_NEWS")).resolves.toBe("test-token-value");
    await expect(reloaded.get("PATH")).resolves.toBeUndefined();
    await expect(store.get("TELEGRAM_BOT_TOKEN_MAIN")).resolves.toBe("from-env");
  });
});
