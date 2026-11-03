import type { Hono } from "hono";
import { BOT_METHODS, BOT_SCHEMAS, BOT_TYPES, USER_OPERATIONS, isRecord, publicSchema, validateBotCall, validateUserOperation, validateScheduledAt } from "@telegram-harness/shared";
import type { Deps } from "../deps.js";
import { nowIso } from "../deps.js";
import { dispatchBot, dispatchUser } from "../services/api-dispatch.js";

export function mountApiOperations(app: Hono, deps: Deps): void {
  app.get("/api/operations", (c) => {
    const provider = c.req.query("provider");
    const name = c.req.query("name");
    if (!provider && !name) return c.json({ success: true, data: { bot: BOT_METHODS, user: Object.fromEntries(Object.entries(USER_OPERATIONS).map(([k,v]) => [k, { mode: v.mode }])) } });
    if (provider === "bot" && name && Object.hasOwn(BOT_METHODS, name)) {
      const method = name as keyof typeof BOT_METHODS;
      return c.json({ success: true, data: { ...BOT_METHODS[method], schema: publicSchema(BOT_SCHEMAS[method], BOT_TYPES) } });
    }
    if (provider === "user" && name && Object.hasOwn(USER_OPERATIONS, name)) {
      const entry = USER_OPERATIONS[name as keyof typeof USER_OPERATIONS];
      return c.json({ success: true, data: { mode: entry.mode, schema: publicSchema(entry.schema) } });
    }
    return c.json({ success: false, error: "unknown_operation" }, 404);
  });
  for (const provider of ["bot", "user"] as const) {
    for (const mode of ["read", "write"] as const) {
      app.post(`/api/${provider}/${mode === "read" ? "read" : "requests"}`, async (c) => {
        let input: unknown;
        try {
          const text = await c.req.text();
          if (new TextEncoder().encode(text).byteLength > 1_000_000) return c.json({ success: false, error: "body_too_large" }, 413);
          input = JSON.parse(text);
        } catch { return c.json({ success: false, error: "invalid_json" }, 400); }
        if (!isRecord(input)) return c.json({ success: false, error: "invalid_body" }, 400);
        const keys = provider === "bot" ? ["botId", "method", "params"] : ["operation", "params"];
        if (mode === "write") keys.push("scheduledAt");
        if (Object.keys(input).some((key) => !keys.includes(key))) return c.json({ success: false, error: "unknown_request_field" }, 400);
        const error = provider === "bot" ? validateBotCall(input.method, input.params, mode) : validateUserOperation(input.operation, input.params, mode);
        if (error) return c.json({ success: false, error }, 400);
        if (provider === "bot" && (typeof input.botId !== "string" || !await deps.repo.getBot(input.botId))) return c.json({ success: false, error: "bot_not_found" }, 404);
        if (mode === "read") {
          try {
            const result = provider === "bot" ? await dispatchBot(deps, input, mode) : await dispatchUser(deps, input, mode);
            return c.json({ success: true, data: result });
          } catch { return c.json({ success: false, error: `${provider}_api_read_failed` }, 502); }
        }
        const scheduledAt = input.scheduledAt ?? null;
        if (scheduledAt !== null && (typeof scheduledAt !== "string" || validateScheduledAt(scheduledAt))) return c.json({ success: false, error: "invalid_scheduled_at" }, 400);
        const stamp = nowIso(deps);
        const { scheduledAt: _schedule, ...payload } = input;
        const action = {
          id: crypto.randomUUID(), action: provider === "bot" ? "bot_api_call" as const : "user_api_call" as const,
          status: "pending" as const, payload, summary: `${provider}: ${provider === "bot" ? input.method : input.operation}`,
          scheduledAt, approvedAt: null, error: null, result: null, createdAt: stamp, updatedAt: stamp,
        };
        await deps.repo.insertAccountAction(action);
        return c.json({ success: true, data: action }, 201);
      });
    }
  }
}
