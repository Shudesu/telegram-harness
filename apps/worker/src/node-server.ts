import { serve } from "@hono/node-server";
import { MemoryRepo } from "@telegram-harness/db";
import { DryRunTelegram } from "@telegram-harness/telegram-sdk";
import { createApp } from "./app.js";

if (process.env.TELEGRAM_ALLOW_NETWORK === "true") {
  console.error("node-server refuses TELEGRAM_ALLOW_NETWORK=true");
  process.exit(1);
}

const env: Record<string, string | undefined> = {
  API_KEY: process.env.API_KEY ?? "dev-local-api-key",
  INTAKE_API_KEY: process.env.INTAKE_API_KEY,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET ?? "dev-webhook-secret",
  TELEGRAM_ALLOW_NETWORK: "false",
  TELEGRAM_BOT_TOKEN_MAIN: process.env.TELEGRAM_BOT_TOKEN_MAIN ?? "local-dry-run-token",
};

const app = createApp({
  repo: new MemoryRepo(),
  telegram: new DryRunTelegram(),
  env,
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.error(`telegram-harness worker listening on ${port} (dry-run, no Bot API calls)`);
});
