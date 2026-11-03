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
