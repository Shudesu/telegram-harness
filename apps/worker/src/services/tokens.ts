import { redactSecrets, validateTokenEnvName } from "@telegram-harness/shared";
import type { SecretStore } from "@telegram-harness/user-account";

export async function resolveToken(
  env: Record<string, string | undefined>,
  tokenEnvName: string,
  secrets: SecretStore,
): Promise<string> {
  const nameError = validateTokenEnvName(tokenEnvName);
  if (nameError) throw new Error(nameError);
  const stored = await secrets.get(tokenEnvName);
  if (stored) return stored;
  const value = env[tokenEnvName];
  if (!value) throw new Error(`missing_token_env:${tokenEnvName}`);
  return value;
}

export function redactError(error: unknown, secrets: readonly string[]): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message, secrets);
}
