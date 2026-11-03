import { BOT_METHODS, BOT_SCHEMAS, BOT_TYPES, type BotMethod } from "./bot-api.generated.js";
import { isRecord, safeApiInput, validateSchema } from "./api-schema.js";
export * from "./bot-api.generated.js";

export function validateBotCall(method: unknown, params: unknown, mode?: "read" | "write"): string | null {
  if (typeof method !== "string" || !Object.hasOwn(BOT_METHODS, method)) return "unknown_bot_method";
  const name = method as BotMethod;
  if (BOT_METHODS[name].mode === "excluded") return "excluded_bot_method";
  if (mode && BOT_METHODS[name].mode !== mode) return "bot_method_mode_mismatch";
  if (!safeApiInput(params) || !validateSchema(BOT_SCHEMAS[name], params, BOT_TYPES)) return "invalid_bot_params";
  if (!validFiles(params)) return "invalid_upload";
  return null;
}

function validFiles(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  if (isRecord(value) && "base64" in value) {
    return typeof value.base64 === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64) && value.base64.length > 0 && value.base64.length <= 700_000 &&
      typeof value.filename === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value.filename) &&
      (value.contentType === undefined || typeof value.contentType === "string" && /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(value.contentType));
  }
  return Object.values(value).every(validFiles);
}
