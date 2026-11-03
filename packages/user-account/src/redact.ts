export function redactUserText(message: string, secrets: readonly string[] = []): string {
  let out = message;
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    out = out.split(secret).join("[redacted]");
  }
  out = out.replace(/\d{6,12}:[A-Za-z0-9_-]{20,}/g, "[redacted-token]");
  out = out.replace(/\+\d{8,15}/g, "[redacted-phone]");
  out = out.replace(/v1\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted-session]");
  return out;
}

const BANNED_RESPONSE_KEYS = new Set([
  "session",
  "token",
  "password",
  "phone",
  "phoneCode",
  "phoneCodeHash",
  "apiHash",
  "api_hash",
  "accessHash",
  "access_hash",
  "code",
]);

export function assertPublicPayload(value: unknown): void {
  const stack: unknown[] = [value];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (BANNED_RESPONSE_KEYS.has(key)) throw new Error("response_contained_secret_field");
      if (typeof child === "string" && /\d{6,12}:[A-Za-z0-9_-]{20,}/.test(child)) {
        throw new Error("response_contained_token");
      }
      if (child && typeof child === "object") stack.push(child);
    }
  }
}
