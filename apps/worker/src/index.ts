import { D1Repo, type D1Like } from "@telegram-harness/db";
import { createTelegramClient } from "@telegram-harness/telegram-sdk";
import { EnvSecretStore, createUserAccountClient } from "@telegram-harness/user-account";
import { createApp } from "./app.js";
import { executeDueAccountActions } from "./services/account-executor.js";
import { publishDue } from "./services/publisher.js";

export interface WorkerEnv {
  DB: D1Like;
  API_KEY?: string;
  TELEGRAM_ALLOW_NETWORK?: string;
  TELEGRAM_USER_ALLOW_NETWORK?: string;
  TELEGRAM_API_ID?: string;
  TELEGRAM_API_HASH?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  INTAKE_API_KEY?: string;
  [key: string]: unknown;
}

export default {
  fetch(request: Request, env: WorkerEnv): Response | Promise<Response> {
    return createApp(buildDeps(env)).fetch(request);
  },
  async scheduled(event: unknown, env: WorkerEnv, ctx: { waitUntil: (promise: Promise<unknown>) => void }): Promise<void> {
    void event;
    const deps = buildDeps(env);
    ctx.waitUntil(Promise.all([publishDue(deps), executeDueAccountActions(deps)]));
  },
};

function buildDeps(env: WorkerEnv) {
  const record = stringEnv(env);
  return {
    repo: new D1Repo(env.DB),
    telegram: createTelegramClient({ allowNetwork: env.TELEGRAM_ALLOW_NETWORK === "true" }),
    userAccount: createUserAccountClient({
      allowNetwork: env.TELEGRAM_USER_ALLOW_NETWORK === "true",
      apiId: env.TELEGRAM_API_ID,
      apiHash: env.TELEGRAM_API_HASH,
    }),
    secrets: new EnvSecretStore(record),
    env: record,
    now: () => new Date(),
  };
}

function stringEnv(env: WorkerEnv): Record<string, string | undefined> {
  const record: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") record[key] = value;
  }
  return record;
}
