import type { AccountAction, BotMethodParams, BotReadMethod, BotWriteMethod, JsonValue, UserOperationParams, UserReadOperation, UserWriteOperation } from "@telegram-harness/shared";
export { BOT_METHODS, USER_OPERATIONS, BOT_SCHEMAS, BOT_TYPES, publicSchema } from "@telegram-harness/shared";
export type { BotMethod, BotMethodParams, BotReadMethod, BotWriteMethod, UserOperation, UserOperationParams, UserReadOperation, UserWriteOperation } from "@telegram-harness/shared";
export interface ApiOperationResult { result: JsonValue; dryRun: boolean }

export interface HarnessResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  idempotent?: boolean;
}

export class TelegramHarnessClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  readBotApi<M extends BotReadMethod>(botId: string, method: M, params: BotMethodParams[M]): Promise<HarnessResponse<ApiOperationResult>> {
    return this.post("/api/bot/read", { botId, method, params });
  }
  requestBotApi<M extends BotWriteMethod>(botId: string, method: M, params: BotMethodParams[M], scheduledAt?: string): Promise<HarnessResponse<AccountAction>> {
    return this.post("/api/bot/requests", { botId, method, params, scheduledAt });
  }
  readUserApi<M extends UserReadOperation>(operation: M, params: UserOperationParams[M]): Promise<HarnessResponse<ApiOperationResult>> {
    return this.post("/api/user/read", { operation, params });
  }
  requestUserApi<M extends UserWriteOperation>(operation: M, params: UserOperationParams[M], scheduledAt?: string): Promise<HarnessResponse<AccountAction>> {
    return this.post("/api/user/requests", { operation, params, scheduledAt });
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Telegram Harness API ${method} ${path}: ${response.status} ${text}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
}
