import { validatePhotoUrl } from "@telegram-harness/shared";

const MAX_BYTES = 5_000_000;

export async function downloadPhoto(url: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  if (validatePhotoUrl(url)) throw new Error("invalid_photo_url");
  const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("photo_download_failed");
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("image/")) throw new Error("photo_type_rejected");
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error("photo_too_large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) throw new Error("photo_too_large");
  return bytes;
}
