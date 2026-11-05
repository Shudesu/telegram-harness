#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TelegramHarnessClient } from "@telegram-harness/sdk";
import { executeTool, toolDefs } from "./tools.js";

const API_URL = process.env.TELEGRAM_HARNESS_API_URL ?? "http://localhost:8787";
const API_KEY = process.env.TELEGRAM_HARNESS_API_KEY ?? "";

export function createMcpServer(client = new TelegramHarnessClient(API_URL, API_KEY)): Server {
  const server = new Server({ name: "Telegram Harness", version: "0.2.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefs }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await executeTool(client, request.params.name, args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "tool_failed";
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }], isError: true };
    }
  });
  return server;
}

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (invokedDirectly) {
  const transport = new StdioServerTransport();
  createMcpServer()
    .connect(transport)
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "mcp_failed");
      process.exit(1);
    });
}
