import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryRepo } from "@telegram-harness/db";
import { DryRunTelegram } from "@telegram-harness/telegram-sdk";
import { EnvSecretStore } from "@telegram-harness/user-account";
import { FileSecretStore } from "@telegram-harness/user-account/file";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { resolveToken } from "./services/tokens.js";

const TOKEN = "test-token-value";

describe("token resolution", () => {
  it("reads the secret store before the environment", async () => {
    const stored = new EnvSecretStore({ TELEGRAM_BOT_TOKEN_MAIN: "from-store" });
    await expect(resolveToken({ TELEGRAM_BOT_TOKEN_MAIN: "from-env" }, "TELEGRAM_BOT_TOKEN_MAIN", stored)).resolves.toBe(
      "from-store",
    );
    await expect(resolveToken({ TELEGRAM_BOT_TOKEN_MAIN: "from-env" }, "TELEGRAM_BOT_TOKEN_MAIN", new EnvSecretStore({}))).resolves.toBe(
      "from-env",
    );
    await expect(resolveToken({}, "TELEGRAM_BOT_TOKEN_MAIN", new EnvSecretStore({}))).rejects.toThrow(
      "missing_token_env:TELEGRAM_BOT_TOKEN_MAIN",
    );
  });

  it("publishes a token saved in the secret store without putting it in env", async () => {
    const env: Record<string, string | undefined> = {
      API_KEY: "test-api-key",
      TELEGRAM_WEBHOOK_SECRET: "hook-secret",
    };
    const secrets = new FileSecretStore(join(mkdtempSync(join(tmpdir(), "tg-secrets-")), "secrets.json"), env);
    await secrets.put("TELEGRAM_BOT_TOKEN_MAIN", TOKEN);
    expect(env.TELEGRAM_BOT_TOKEN_MAIN).toBeUndefined();
    const telegram = new DryRunTelegram();
    const app = createApp({
      repo: new MemoryRepo(),
      telegram,
      env,
      secrets,
    });

    const botRes = await api(app, "/api/bots", {
      method: "POST",
      body: JSON.stringify({ name: "Main", tokenEnvName: "TELEGRAM_BOT_TOKEN_MAIN" }),
    });
    expect(botRes.status).toBe(201);
    const bot = (await botRes.json()) as { data: { id: string } };
    const channelRes = await api(app, "/api/channels", {
      method: "POST",
      body: JSON.stringify({ botId: bot.data.id, chatId: "@example_channel", title: "Example", kind: "channel" }),
    });
    const channel = (await channelRes.json()) as { data: { id: string } };
    const created = await api(app, "/api/drafts", {
      method: "POST",
      body: JSON.stringify({ channelId: channel.data.id, kind: "text", text: "hello channel" }),
    });
    const draft = (await created.json()) as { data: { id: string; status: string } };
    expect(draft.data.status).toBe("pending");
    expect(telegram.calls).toHaveLength(0);

    const approved = await api(app, `/api/drafts/${draft.data.id}/approve`, { method: "POST" });
    expect((await approved.json()) as { data: { status: string } }).toMatchObject({ data: { status: "scheduled" } });
    expect(telegram.calls).toHaveLength(0);

    const published = await api(app, "/api/publisher/run", { method: "POST" });
    const report = (await published.json()) as { data: { posted: string[] } };
    expect(report.data.posted).toEqual([draft.data.id]);
    expect(telegram.calls.map((call) => call.method)).toEqual(["sendMessage"]);
    const visible = JSON.stringify({ report, calls: telegram.calls, bot });
    expect(visible).not.toContain(TOKEN);
  });
});

async function api(app: ReturnType<typeof createApp>, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has("authorization")) headers.set("authorization", "Bearer test-api-key");
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers });
}
