import { USER_RATE_LIMITS } from "./limits.js";

export function floodWaitSeconds(error: unknown): number | null {
  if (error && typeof error === "object" && "seconds" in error) {
    const seconds = (error as { seconds?: unknown }).seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) return Math.floor(seconds);
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const match = message.match(/FLOOD_WAIT_(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}

export function rpcErrorName(error: unknown): string {
  if (error && typeof error === "object" && "errorMessage" in error) {
    const name = (error as { errorMessage?: unknown }).errorMessage;
    if (typeof name === "string" && name.length > 0) return name;
  }
  if (error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message)) return error.message;
  const seconds = floodWaitSeconds(error);
  if (seconds !== null) return `FLOOD_WAIT_${seconds}`;
  return "";
}

export function publicMtprotoError(error: unknown): Error {
  const seconds = floodWaitSeconds(error);
  if (seconds !== null) return new Error(`flood_wait:${Math.max(0, seconds)}`);
  const name = rpcErrorName(error);
  if (
    name === "PHONE_CODE_INVALID" ||
    name === "PHONE_CODE_EXPIRED" ||
    name === "PHONE_NUMBER_INVALID" ||
    name === "PHONE_NUMBER_BANNED" ||
    name === "PASSWORD_HASH_INVALID" ||
    name === "SESSION_PASSWORD_NEEDED"
  ) {
    return new Error(name);
  }
  if (error instanceof Error && /^(signup_refused|botfather_|dm_target_rejected|mtproto_failed|user_network_disabled|missing_api_credentials)/.test(error.message)) {
    return error;
  }
  return new Error("mtproto_failed");
}

export async function withFloodWait<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  options?: { retry?: boolean },
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const seconds = floodWaitSeconds(error);
    if (seconds === null) throw publicMtprotoError(error);
    const retry = options?.retry !== false;
    if (!retry || seconds > USER_RATE_LIMITS.floodWaitRetryMaxSeconds) {
      throw new Error(`flood_wait:${Math.max(0, seconds)}`);
    }
    await sleep(Math.max(0, seconds) * 1000);
    try {
      return await fn();
    } catch (retryError) {
      throw publicMtprotoError(retryError);
    }
  }
}
