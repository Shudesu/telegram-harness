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
