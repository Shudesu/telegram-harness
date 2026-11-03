export type TelegramMode = "live" | "dry-run" | "disabled";

export interface TelegramCall {
  method: string;
  body: Record<string, unknown>;
}

export interface TelegramClient {
  readonly mode: TelegramMode;
  readonly calls: readonly TelegramCall[];
  call<T>(token: string, method: string, body: Record<string, unknown>): Promise<T>;
}

export class TelegramNetworkDisabledError extends Error {
  constructor() {
    super("network_disabled");
    this.name = "TelegramNetworkDisabledError";
  }
}

const TOKEN_CHARS = /^[A-Za-z0-9:_-]+$/;
const METHOD_CHARS = /^[A-Za-z][A-Za-z0-9_]{0,64}$/;

export class DisabledTelegram implements TelegramClient {
  readonly mode = "disabled" as const;
  readonly calls: TelegramCall[] = [];

  async call<T>(_token: string, _method: string, _body: Record<string, unknown>): Promise<T> {
    throw new TelegramNetworkDisabledError();
  }
}

export class DryRunTelegram implements TelegramClient {
  readonly mode = "dry-run" as const;
  readonly calls: TelegramCall[] = [];
  private sequence = 1000;

  async call<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
    assertMethod(method);
    if (!token) throw new Error("missing_token");
    this.calls.push({ method, body: structuredClone(body) });
    return fakeResult(method, body, () => {
      this.sequence += 1;
      return this.sequence;
    }) as T;
  }
}

export class LiveTelegram implements TelegramClient {
  readonly mode = "live" as const;
  readonly calls: TelegramCall[] = [];

  constructor(
    private readonly options: {
      allowNetwork: boolean;
      fetchImpl?: typeof fetch;
      endpoint?: string;
    },
  ) {}

  async call<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
    assertMethod(method);
    if (!this.options.allowNetwork) throw new TelegramNetworkDisabledError();
    if (!TOKEN_CHARS.test(token)) throw new Error("invalid_token_characters");
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const endpoint = this.options.endpoint ?? "https://api.telegram.org";
    const response = await fetchImpl(`${endpoint}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let payload: { ok?: boolean; result?: T; description?: string; error_code?: number };
    try {
      payload = (await response.json()) as { ok?: boolean; result?: T; description?: string; error_code?: number };
    } catch {
      throw new Error(`telegram_${method}_invalid_json`);
    }
    if (!payload.ok) {
      const description = payload.description ?? "request_failed";
      throw new Error(`telegram_${method}_failed:${payload.error_code ?? response.status}:${description}`);
    }
    return payload.result as T;
  }
}

export function createTelegramClient(options: { allowNetwork: boolean; fetchImpl?: typeof fetch }): TelegramClient {
  if (options.allowNetwork) return new LiveTelegram(options);
  return new DisabledTelegram();
}

function assertMethod(method: string): void {
  if (!METHOD_CHARS.test(method)) throw new Error("invalid_method");
}

function fakeResult(method: string, body: Record<string, unknown>, nextId: () => number): unknown {
  if (method === "sendMediaGroup") {
    const media = Array.isArray(body.media) ? body.media : [];
    return media.map(() => ({ message_id: nextId(), chat: { id: body.chat_id } }));
  }
  if (method === "getMe") return { id: 1, is_bot: true, username: "harness_dry_run_bot", first_name: "dry-run" };
  if (method === "getChatMemberCount") return 0;
  if (method === "getChat") {
    return { id: body.chat_id, type: "channel", title: "dry-run" };
  }
  if (method === "deleteMessage" || method === "deleteMessages") return true;
  if (method === "editMessageReplyMarkup" || method === "editMessageText" || method === "editMessageCaption") {
    return { message_id: body.message_id, chat: { id: body.chat_id } };
  }
  return { message_id: nextId(), chat: { id: body.chat_id } };
}
