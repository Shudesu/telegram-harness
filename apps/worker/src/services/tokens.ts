import { redactSecrets, validateTokenEnvName } from "@telegram-harness/shared";

export function resolveToken(env: Record<string, string | undefined>, tokenEnvName: string): string {
  const nameError = validateTokenEnvName(tokenEnvName);
  if (nameError) throw new Error(nameError);
  const value = env[tokenEnvName];
  if (!value) throw new Error(`missing_token_env:${tokenEnvName}`);
  return value;
}

export function redactError(error: unknown, secrets: readonly string[]): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message, secrets);
}
