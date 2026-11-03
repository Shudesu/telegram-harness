import { describe, expect, it, vi } from "vitest";
import { DryRunTelegram, LiveTelegram, TelegramNetworkDisabledError } from "./client.js";

describe("LiveTelegram", () => {
  it("does not call fetch when network is disabled", async () => {
    const fetchImpl = vi.fn();
    const client = new LiveTelegram({ allowNetwork: false, fetchImpl });
    await expect(client.call("test-token", "sendMessage", { chat_id: "1", text: "hi" })).rejects.toBeInstanceOf(
      TelegramNetworkDisabledError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts JSON to the Bot API method and omits the token from errors", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 400,
      json: async () => ({ ok: false, error_code: 400, description: "bad request" }),
    }));
    const client = new LiveTelegram({
      allowNetwork: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      endpoint: "https://api.telegram.org",
    });
    await expect(client.call("test-token", "sendMessage", { chat_id: "@channel", text: "hi" })).rejects.toThrow(
      /telegram_sendMessage_failed:400:bad request/,
    );
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).toContain("\"text\":\"hi\"");
    try {
      await client.call("test-token", "sendMessage", { chat_id: "1", text: "x" });
    } catch (error) {
      expect(String(error)).not.toContain("test-token");
    }
  });
});

describe("DryRunTelegram", () => {
  it("records the method without retaining the token", async () => {
    const client = new DryRunTelegram();
    const result = await client.call<{ message_id: number }>("test-token", "sendMessage", {
      chat_id: "-1001",
      text: "draft",
    });
    expect(result.message_id).toBeGreaterThan(0);
    expect(client.calls).toEqual([{ method: "sendMessage", body: { chat_id: "-1001", text: "draft" } }]);
    expect(JSON.stringify(client.calls)).not.toContain("test-token");
  });
});
