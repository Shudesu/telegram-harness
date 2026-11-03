/** Inline uploads only: never opens a local path or fetches a caller-supplied URL. */
export function telegramRequestBody(body: Record<string, unknown>): { body: string | FormData; headers?: Record<string, string> } {
  const form = new FormData();
  let count = 0;
  function replace(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(replace);
    const record = value as Record<string, unknown>;
    if (typeof record.base64 === "string" && typeof record.filename === "string") {
      const binary = atob(record.base64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const name = `harness_file_${count++}`;
      form.append(name, new Blob([bytes], { type: typeof record.contentType === "string" ? record.contentType : "application/octet-stream" }), record.filename);
      return `attach://${name}`;
    }
    return Object.fromEntries(Object.entries(record).map(([key, v]) => [key, replace(v)]));
  }
  const replaced = replace(body) as Record<string, unknown>;
  if (count === 0) return { body: JSON.stringify(body), headers: { "content-type": "application/json" } };
  for (const [key, value] of Object.entries(replaced)) {
    if (value === undefined) continue;
    form.append(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return { body: form };
}

export function safeCallBody(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(safeCallBody);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, ["secret_token", "provider_token", "base64"].includes(key) ? "[redacted]" : safeCallBody(child)]));
}
