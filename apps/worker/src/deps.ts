import type { Repo } from "@telegram-harness/db";
import type { SecretStore, UserAccountClient } from "@telegram-harness/user-account";
import type { TelegramClient } from "@telegram-harness/telegram-sdk";

export interface Deps {
  repo: Repo;
  telegram: TelegramClient;
  userAccount: UserAccountClient;
  secrets: SecretStore;
  env: Record<string, string | undefined>;
  now: () => Date;
}

export function nowIso(deps: Deps): string {
  return deps.now().toISOString();
}
