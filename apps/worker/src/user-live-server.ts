import { serve } from "@hono/node-server";
import { MemoryRepo } from "@telegram-harness/db";
import { DisabledTelegram, LiveTelegram } from "@telegram-harness/telegram-sdk";
import { EnvSecretStore, createUserAccountClient, localDryRunSessionKey } from "@telegram-harness/user-account";
import { FileSecretStore } from "@telegram-harness/user-account/file";
import { createApp } from "./app.js";

if (process.env.TELEGRAM_USER_ALLOW_NETWORK !== "true") {
  console.error("user-live-server refuses to start unless TELEGRAM_USER_ALLOW_NETWORK=true");
  process.exit(1);
}
if (process.env.TELEGRAM_SESSION_ENCRYPTION_KEY === localDryRunSessionKey()) {
  console.error("user-live-server refuses the dry-run encryption key");
  process.exit(1);
}

const env: Record<string, string | undefined> = { ...process.env };

const app = createApp({
  repo: new MemoryRepo(),
  telegram: process.env.TELEGRAM_ALLOW_NETWORK === "true" ? new LiveTelegram({ allowNetwork: true }) : new DisabledTelegram(),
  userAccount: createUserAccountClient({
    allowNetwork: true,
    apiId: process.env.TELEGRAM_API_ID,
    apiHash: process.env.TELEGRAM_API_HASH,
  }),
  secrets: process.env.TELEGRAM_SECRET_STORE_PATH
    ? new FileSecretStore(process.env.TELEGRAM_SECRET_STORE_PATH, env)
    : new EnvSecretStore(env),
  env,
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.error(`telegram-harness user-live listening on ${port}`);
});
