import { D1Repo, type D1Like } from "@telegram-harness/db";
import { createTelegramClient } from "@telegram-harness/telegram-sdk";
import { createApp } from "./app.js";
import { publishDue } from "./services/publisher.js";

export interface WorkerEnv {
  DB: D1Like;
  API_KEY?: string;
  TELEGRAM_ALLOW_NETWORK?: string;
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
    ctx.waitUntil(publishDue(buildDeps(env)));
  },
};

function buildDeps(env: WorkerEnv) {
  return {
    repo: new D1Repo(env.DB),
    telegram: createTelegramClient({ allowNetwork: env.TELEGRAM_ALLOW_NETWORK === "true" }),
    env: stringEnv(env),
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
