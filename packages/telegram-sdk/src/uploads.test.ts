import { describe, expect, it, vi } from "vitest";
import { DryRunTelegram, LiveTelegram } from "./client.js";
import { telegramRequestBody } from "./uploads.js";

describe("multipart Bot API uploads", () => {
  it("encodes nested album files, thumbnails, and scalar fields without mutating queued params", async () => {
    const input = { chat_id: 1, disable_notification: true, media: [{ type: "video", media: { filename: "clip.mp4", base64: "AQID" }, thumbnail: { filename: "thumb.jpg", base64: "BAUG", contentType: "image/jpeg" } }] };
    const copy = structuredClone(input);
    const { body, headers } = telegramRequestBody(input);
    expect(headers).toBeUndefined();
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get("chat_id")).toBe("1");
    expect(form.get("disable_notification")).toBe("true");
    expect(JSON.parse(String(form.get("media")))).toEqual([{ type: "video", media: "attach://harness_file_0", thumbnail: "attach://harness_file_1" }]);
    expect(Array.from(new Uint8Array(await (form.get("harness_file_0") as File).arrayBuffer()))).toEqual([1,2,3]);
    expect((form.get("harness_file_1") as File).type).toBe("image/jpeg");
    expect(input).toEqual(copy);
  });
  it("uses the mocked HTTP transport for multipart and JSON file_id/URL sends", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: true })));
    const client = new LiveTelegram({ allowNetwork: true, fetchImpl, endpoint: "https://telegram.invalid" });
    await client.call("test-token", "setChatPhoto", { chat_id: 1, photo: { filename: "photo.png", base64: "AQID" } });
    expect(fetchImpl.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
    for (const photo of ["test_file_id", "https://example.com/photo.jpg"]) {
      await client.call("test-token", "sendPhoto", { chat_id: 1, photo });
      expect(fetchImpl.mock.lastCall?.[1]?.body).toBe(JSON.stringify({ chat_id: 1, photo }));
    }
  });
  it("redacts upload content and provider/webhook secrets in dry-run debug records", async () => {
    const client = new DryRunTelegram();
    await client.call("test-token", "setWebhook", { url: "https://example.com", secret_token: "hook-private", certificate: { filename: "cert.pem", base64: "AQID" } });
    const text = JSON.stringify(client.calls);
    expect(text).not.toContain("hook-private");
    expect(text).not.toContain("AQID");
    expect(text).toContain("[redacted]");
  });
});
