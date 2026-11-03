import type { Repo } from "@telegram-harness/db";
import type { TelegramClient } from "@telegram-harness/telegram-sdk";

export interface Deps {
  repo: Repo;
  telegram: TelegramClient;
  env: Record<string, string | undefined>;
  now: () => Date;
}

export function nowIso(deps: Deps): string {
  return deps.now().toISOString();
}
