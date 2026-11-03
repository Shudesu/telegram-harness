import {
  LOGIN_PHONE_ENV_NAME,
  LOGIN_SESSION_ENV_NAME,
  SESSION_ENV_NAME,
  decodeSessionKey,
  decryptSession,
  encryptSession,
} from "@telegram-harness/user-account";
import type { Deps } from "../deps.js";

const KEY_ENV = "TELEGRAM_SESSION_ENCRYPTION_KEY";

export async function openSession(deps: Deps): Promise<string> {
  const encrypted = await deps.secrets.get(SESSION_ENV_NAME);
  if (!encrypted) throw new Error("user_not_logged_in");
  return decryptSession(encrypted, decodeSessionKey(deps.env[KEY_ENV]));
}

export async function persistSession(deps: Deps, plaintext: string): Promise<void> {
  const encrypted = await encryptSession(plaintext, decodeSessionKey(deps.env[KEY_ENV]));
  await deps.secrets.put(SESSION_ENV_NAME, encrypted);
}

export async function saveLoginSecret(deps: Deps, name: string, plaintext: string): Promise<void> {
  const encrypted = await encryptSession(plaintext, decodeSessionKey(deps.env[KEY_ENV]));
  await deps.secrets.put(name, encrypted);
}

export async function readLoginSecret(deps: Deps, name: string): Promise<string> {
  const encrypted = await deps.secrets.get(name);
  if (!encrypted) throw new Error("login_not_started");
  return decryptSession(encrypted, decodeSessionKey(deps.env[KEY_ENV]));
}

export async function clearLoginSecrets(deps: Deps): Promise<void> {
  await deps.secrets.delete(LOGIN_SESSION_ENV_NAME);
  await deps.secrets.delete(LOGIN_PHONE_ENV_NAME);
}

export function collectSecretValues(deps: Deps, extra: readonly string[] = []): string[] {
  const values = [deps.env.TELEGRAM_API_HASH, deps.env[KEY_ENV], ...extra];
  return values.filter((value): value is string => typeof value === "string" && value.length >= 4);
}

export { LOGIN_PHONE_ENV_NAME, LOGIN_SESSION_ENV_NAME, SESSION_ENV_NAME };
