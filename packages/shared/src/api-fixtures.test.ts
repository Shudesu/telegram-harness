import { sample, userFixtures } from "./api-test-fixtures.js";
import { describe, expect, it } from "vitest";
import { BOT_SCHEMAS, BOT_METHODS, validateBotCall, validateUserOperation, USER_OPERATIONS } from "./index.js";

describe("reviewed API snapshot and validation", () => {
  it("covers all 185 official methods and explicitly fences session/token operations", () => {
    expect(Object.keys(BOT_METHODS)).toHaveLength(185);
    expect(Object.entries(BOT_METHODS).filter(([,v]) => v.mode === "excluded").map(([k]) => k).sort()).toEqual(["close", "getManagedBotToken", "logOut", "replaceManagedBotToken"]);
    expect(BOT_METHODS.getUpdates.mode).toBe("write");
    for (const [method, entry] of Object.entries(BOT_METHODS)) {
      expect(validateBotCall(method, sample(BOT_SCHEMAS[method as keyof typeof BOT_SCHEMAS]))).toBe(entry.mode === "excluded" ? "excluded_bot_method" : null);
    }
  });
  it("rejects unknown methods, malformed nested inputs, raw credentials, and upload paths", () => {
    expect(validateBotCall("constructor", {})).toBe("unknown_bot_method");
    expect(validateBotCall("sendMessage", { chat_id: 1, text: "hi" }, "read")).toBe("bot_method_mode_mismatch");
    for (const params of [{ chat_id: 1 }, { chat_id: [], text: "hi" }, { chat_id: 1, text: "hi", entities: [{ type: "bold" }] }, { chat_id: 1, text: "hi", arbitrary: true }]) expect(validateBotCall("sendMessage", params)).toBe("invalid_bot_params");
    expect(validateBotCall("setWebhook", { url: "https://example.com", secret_token: "plain-secret" })).toBe("invalid_bot_params");
    expect(validateBotCall("setWebhook", { url: "https://example.com", secret_token: { secretEnvName: "API_KEY" } })).toBe("invalid_bot_params");
    expect(validateBotCall("sendPhoto", { chat_id: 1, photo: { filename: "/tmp/private", base64: "AQID" } })).toBe("invalid_upload");
    expect(validateBotCall("sendPhoto", { chat_id: 1, photo: { path: "/tmp/private" } })).toBe("invalid_bot_params");
  });
  it("validates each owner operation and has no arbitrary RPC escape", () => {
    for (const [operation, params] of Object.entries(userFixtures)) expect(validateUserOperation(operation, params)).toBeNull();
    expect(Object.keys(userFixtures).sort()).toEqual(Object.keys(USER_OPERATIONS).sort());
    for (const name of ["auth.LogOut", "auth.ResetAuthorizations", "account.DeleteAccount", "account.UpdatePasswordSettings", "account.ChangePhone", "auth.SignUp", "invoke", "__proto__"]) expect(validateUserOperation(name, {})).toBe("unknown_user_operation");
    expect(validateUserOperation("send_message", { peer: "me", text: "hi" }, "read")).toBe("user_operation_mode_mismatch");
    expect(validateUserOperation("send_poll", { ...userFixtures.send_poll, quiz: true })).toBe("invalid_quiz_options");
    expect(validateUserOperation("send_reaction", { ...userFixtures.send_reaction, customEmojiId: "1" })).toBe("reaction_needs_one_type");
  });
});
