import { serve } from "@hono/node-server";
import { openNodeSqliteRepo } from "@telegram-harness/db/sqlite";
import { DryRunTelegram } from "@telegram-harness/telegram-sdk";
import { DryRunUserAccount, EnvSecretStore, localDryRunSessionKey } from "@telegram-harness/user-account";
import { FileSecretStore } from "@telegram-harness/user-account/file";
import { createApp } from "./app.js";

if (process.env.TELEGRAM_ALLOW_NETWORK === "true") {
  console.error("node-server refuses TELEGRAM_ALLOW_NETWORK=true");
  process.exit(1);
}
if (process.env.TELEGRAM_USER_ALLOW_NETWORK === "true") {
  console.error("node-server refuses TELEGRAM_USER_ALLOW_NETWORK=true");
  process.exit(1);
}

const env: Record<string, string | undefined> = {
  API_KEY: process.env.API_KEY ?? "dev-local-api-key",
  INTAKE_API_KEY: process.env.INTAKE_API_KEY,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET ?? "dev-webhook-secret",
  TELEGRAM_ALLOW_NETWORK: "false",
  TELEGRAM_USER_ALLOW_NETWORK: "false",
  TELEGRAM_BOT_TOKEN_MAIN: process.env.TELEGRAM_BOT_TOKEN_MAIN ?? "local-dry-run-token",
  TELEGRAM_SESSION_ENCRYPTION_KEY: process.env.TELEGRAM_SESSION_ENCRYPTION_KEY ?? localDryRunSessionKey(),
};

const secretPath = process.env.TELEGRAM_SECRET_STORE_PATH;
const database = openNodeSqliteRepo(process.env.TELEGRAM_CRM_DB_PATH ?? ".local/crm-dry-run.sqlite");
const app = createApp({
  repo: database.repo,
  telegram: new DryRunTelegram(),
  userAccount: new DryRunUserAccount(),
  secrets: secretPath ? new FileSecretStore(secretPath, env) : new EnvSecretStore(env),
  env,
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.error(`telegram-harness worker listening on ${port} (dry-run, no Bot API calls)`);
});
