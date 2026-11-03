import { describe, expect, it, vi } from "vitest";
import { TelegramHarnessClient } from "@telegram-harness/sdk";
import { executeTool, toolDefs } from "./tools.js";

describe("MCP tools", () => {
  it("has no tool that sends without the approval names", () => {
    const names = toolDefs.map((tool) => tool.name);
    expect(names).toContain("approve_draft");
    expect(names).toContain("create_draft");
    expect(names).not.toContain("send_message");
    expect(names).not.toContain("sendMessage");
    expect(names.some((name) => name.startsWith("send_"))).toBe(false);
    expect(names).not.toContain("create_channel");
    expect(names).toContain("request_create_channel");
    expect(names).toContain("approve_account_action");
    for (const forbidden of ["mass_dm", "scrape_members", "invite_users", "export_session", "create_accounts"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("approve_account_action only posts to the approval route", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { status: "scheduled" } }), { status: 200 }));
    const client = new TelegramHarnessClient("http://harness.local", "test-api-key", fetchImpl as typeof fetch);
    await executeTool(client, "approve_account_action", { actionId: "action-1" });
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toBe("http://harness.local/api/account/actions/action-1/approve");
    expect(url).not.toContain("api.telegram.org");
  });

  it("request_create_channel queues an action and does not call Telegram", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { status: "pending" } }), { status: 201 }));
    const client = new TelegramHarnessClient("http://harness.local", "test-api-key", fetchImpl as typeof fetch);
    await executeTool(client, "request_create_channel", { title: "News" });
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toBe("http://harness.local/api/account/actions");
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain("create_channel");
    expect(url).not.toContain("api.telegram.org");
  });

  it("approve_draft calls the approve route and not a Bot API method", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { status: "scheduled" } }), { status: 200 }));
    const client = new TelegramHarnessClient("http://harness.local", "test-api-key", fetchImpl as typeof fetch);
    await executeTool(client, "approve_draft", { draftId: "draft-1" });
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toBe("http://harness.local/api/drafts/draft-1/approve");
    expect(url).not.toContain("api.telegram.org");
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ authorization: "Bearer test-api-key" });
  });
});

const newRoutes = [
  ["list_api_operations", {}, "/api/operations", "GET"],
  ["get_api_operation", { provider: "bot", name: "sendPoll" }, "/api/operations?provider=bot&name=sendPoll", "GET"],
  ["read_bot_api", { botId: "bot-1", method: "getMe", params: {} }, "/api/bot/read", "POST"],
  ["request_bot_api", { botId: "bot-1", method: "sendMessage", params: { chat_id: 1, text: "hi" } }, "/api/bot/requests", "POST"],
  ["read_user_api", { operation: "profile", params: {} }, "/api/user/read", "POST"],
  ["request_user_api", { operation: "send_message", params: { peer: "me", text: "hi" } }, "/api/user/requests", "POST"],
  ["cancel_account_action", { actionId: "action-1" }, "/api/account/actions/action-1/cancel", "POST"],
  ["get_account_action", { actionId: "action-1" }, "/api/account/actions/action-1", "GET"],
] as const;
describe("generic API MCP tools", () => {
  it.each(newRoutes)("%s has a schema and routes only to the harness", async (name, args, path, method) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} })));
    const client = new TelegramHarnessClient("http://harness.local", "test-api-key", fetchImpl as typeof fetch);
    await executeTool(client, name, args);
    expect(toolDefs.find((tool) => tool.name === name)).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toMatchObject([`http://harness.local${path}`, { method }]);
    if (name.startsWith("request_") || name.startsWith("read_")) expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual(args);
  });
  it("exposes getUpdates only in the approval-required schema and never exposes excluded methods", () => {
    const read = toolDefs.find((t) => t.name === "read_bot_api")!.inputSchema.properties.method as { enum: string[] };
    const write = toolDefs.find((t) => t.name === "request_bot_api")!.inputSchema.properties.method as { enum: string[] };
    expect(read.enum).not.toContain("getUpdates");
    expect(write.enum).toContain("getUpdates");
    for (const method of ["logOut", "close", "getManagedBotToken", "replaceManagedBotToken"]) {
      expect(read.enum).not.toContain(method); expect(write.enum).not.toContain(method);
    }
  });
});

it("includes method-specific argument shapes and resolvable refs in MCP schemas", () => {
  const tool = toolDefs.find((t) => t.name === "request_bot_api")!;
  const schema = tool.inputSchema;
  const variants = schema.oneOf as { properties: { method: { const: string }; params: { required: string[] } } }[];
  expect(variants.find((v) => v.properties.method.const === "sendMessage")?.properties.params.required).toContain("text");
  expect(variants.find((v) => v.properties.method.const === "sendPoll")?.properties.params.required).toContain("options");
  for (const match of JSON.stringify(schema).matchAll(/"\$ref":"#\/\$defs\/([^"]+)"/g)) expect(schema.$defs).toHaveProperty(match[1]);
});
