import { describe, expect, it } from "vitest";
import { validateAccountRequest, validatePhone } from "./account.js";

describe("account request validation", () => {
  it("rejects bulk fields and keeps a single channel create", () => {
    expect(validatePhone("+12025550123")).toBeNull();
    expect(validatePhone("12025550123")).toBe("invalid_phone");
    const rejected = validateAccountRequest({ action: "add_admin", ownedChatId: id(), users: ["a"] });
    expect(rejected).toEqual({ error: "bulk_or_secret_field_rejected" });
    const created = validateAccountRequest({ action: "create_channel", title: "News", about: "hello" });
    expect(created).toMatchObject({ action: "create_channel", payload: { title: "News", about: "hello" } });
  });

  it("requires a bot username to end in bot and a token env name", () => {
    const bad = validateAccountRequest({
      action: "botfather_create_bot",
      displayName: "Harness",
      username: "news_channel",
      tokenEnvName: "TELEGRAM_BOT_TOKEN_NEWS",
    });
    expect(bad).toEqual({ error: "username_must_end_with_bot" });
    const good = validateAccountRequest({
      action: "botfather_create_bot",
      displayName: "Harness",
      username: "harness_example_bot",
      tokenEnvName: "TELEGRAM_BOT_TOKEN_NEWS",
    });
    expect(good).toMatchObject({
      payload: { username: "harness_example_bot", tokenEnvName: "TELEGRAM_BOT_TOKEN_NEWS" },
    });
    expect(JSON.stringify(good)).not.toMatch(/\d{6,}:/);
  });
});

function id(): string {
  return "11111111-1111-1111-1111-111111111111";
}
