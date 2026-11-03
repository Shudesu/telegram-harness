import { serve } from "@hono/node-server";
import { openNodeSqliteRepo, resolveSqlitePath } from "@telegram-harness/db/sqlite";
import { DisabledTelegram, LiveTelegram } from "@telegram-harness/telegram-sdk";
import { EnvSecretStore, createUserAccountClient, localDryRunSessionKey } from "@telegram-harness/user-account";
import { FileSecretStore } from "@telegram-harness/user-account/file";
import { createApp } from "./app.js";
import { userLiveBind } from "./user-live-config.js";

if (process.env.TELEGRAM_USER_ALLOW_NETWORK !== "true") {
  console.error("user-live-server refuses to start unless TELEGRAM_USER_ALLOW_NETWORK=true");
  process.exit(1);
}
if (process.env.TELEGRAM_SESSION_ENCRYPTION_KEY === localDryRunSessionKey()) {
  console.error("user-live-server refuses the dry-run encryption key");
  process.exit(1);
}

const env: Record<string, string | undefined> = { ...process.env };
const database = openNodeSqliteRepo(resolveSqlitePath(process.env));
const allowBotApi = process.env.TELEGRAM_ALLOW_NETWORK === "true";

const app = createApp({
  repo: database.repo,
  telegram: allowBotApi ? new LiveTelegram({ allowNetwork: true }) : new DisabledTelegram(),
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

const bind = userLiveBind(process.env);
serve({ fetch: app.fetch, hostname: bind.hostname, port: bind.port }, () => {
  console.error(`telegram-harness user-live listening on ${bind.hostname}:${bind.port}`);
});
