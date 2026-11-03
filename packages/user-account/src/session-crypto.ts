const PREFIX = "v1";

export function decodeSessionKey(value: string | undefined): Uint8Array {
  if (!value) throw new Error("missing_session_encryption_key");
  const bytes = fromBase64Url(value);
  if (bytes.length !== 32) throw new Error("invalid_session_encryption_key");
  return bytes;
}

export async function encryptSession(plaintext: string, keyBytes: Uint8Array): Promise<string> {
  if (plaintext.length < 1 || plaintext.length > 100_000) throw new Error("invalid_session");
  const key = await crypto.subtle.importKey("raw", copyBytes(keyBytes), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  return `${PREFIX}.${toBase64Url(iv)}.${toBase64Url(cipher)}`;
}

export async function decryptSession(payload: string, keyBytes: Uint8Array): Promise<string> {
  const parts = payload.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) throw new Error("session_decrypt_failed");
  try {
    const iv = fromBase64Url(parts[1] ?? "");
    const cipher = fromBase64Url(parts[2] ?? "");
    const key = await crypto.subtle.importKey("raw", copyBytes(keyBytes), "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: copyBytes(iv) }, key, copyBytes(cipher));
    const text = new TextDecoder().decode(plain);
    if (!text || text.includes("\n") || text.length > 100_000) throw new Error("session_decrypt_failed");
    return text;
  } catch (error) {
    if (error instanceof Error && error.message === "session_decrypt_failed") throw error;
    throw new Error("session_decrypt_failed");
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  const copy = new Uint8Array(buffer);
  copy.set(bytes);
  return copy;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
