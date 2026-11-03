import { validateBotCall, validateUserOperation, isRecord, redactSecrets, type BotMethod, type JsonValue, type UserOperation } from "@telegram-harness/shared";
import type { Deps } from "../deps.js";
import { resolveToken } from "./tokens.js";
import { openSession, persistSession } from "./user-session.js";
import { consumeUserRate } from "./user-rate.js";

/** Defense in depth: the publisher revalidates persisted payloads before any call. */
export async function dispatchBot(deps: Deps, input: Record<string, unknown>, mode: "read" | "write"): Promise<Record<string, unknown>> {
  const error = validateBotCall(input.method, input.params, mode);
  if (error) throw new Error(error);
  if (typeof input.botId !== "string") throw new Error("invalid_bot_id");
  const bot = await deps.repo.getBot(input.botId);
  if (!bot) throw new Error("bot_not_found");
  if (deps.telegram.mode === "disabled") throw new Error("network_disabled");
  const secrets: string[] = [];
  try {
    const token = await resolveToken(deps.env, bot.tokenEnvName, deps.secrets);
    secrets.push(token);
    const params = await resolveReferences(input.params, deps, secrets) as Record<string, unknown>;
    const result = await deps.telegram.call<unknown>(token, input.method as BotMethod, params);
    return { result: publicApiResult(result, secrets), dryRun: deps.telegram.mode === "dry-run" };
  } catch {
    // Telegram errors can echo credentials, URLs, invoice data, and file bodies.
    throw new Error("bot_api_call_failed");
  }
}

async function resolveReferences(value: unknown, deps: Deps, secrets: string[]): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((v) => resolveReferences(v, deps, secrets)));
  if (!isRecord(value)) return value;
  if (typeof value.secretEnvName === "string") {
    const secret = await deps.secrets.get(value.secretEnvName) ?? deps.env[value.secretEnvName];
    if (!secret) throw new Error("missing_secret_reference");
    secrets.push(secret);
    return secret;
  }
  return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, v]) => [key, await resolveReferences(v, deps, secrets)])));
}

export async function dispatchUser(deps: Deps, input: Record<string, unknown>, mode: "read" | "write"): Promise<Record<string, unknown>> {
  const error = validateUserOperation(input.operation, input.params, mode);
  if (error) throw new Error(error);
  if (mode === "read") await consumeUserRate(deps, "read");
  const session = await openSession(deps);
  try {
    const result = await deps.userAccount.executeOperation(session, input.operation as UserOperation, input.params as never);
    return { result: publicApiResult(result, [session]), dryRun: deps.userAccount.mode === "dry-run" };
  } finally {
    const next = deps.userAccount.takeSessionUpdate();
    if (next) await persistSession(deps, next);
  }
}

const PRIVATE_KEYS = new Set(["session", "token", "password", "apiHash", "api_hash", "accessHash", "access_hash", "phone", "phoneCode", "phoneCodeHash", "authKey", "secret_token", "provider_token", "fileReference", "file_reference"]);
export function publicApiResult(value: unknown, secrets: string[] = [], depth = 0): JsonValue {
  if (depth > 35) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return redactSecrets(value, secrets);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => publicApiResult(v, secrets, depth + 1));
  if (typeof value === "object") {
    // GramJS big-integer values use their decimal representation, not internal limbs.
    if ("toJSNumber" in value && typeof value.toString === "function") return value.toString();
    return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_KEYS.has(key) && !key.startsWith("_")).map(([key, v]) => [key, publicApiResult(v, secrets, depth + 1)]));
  }
  return null;
}
