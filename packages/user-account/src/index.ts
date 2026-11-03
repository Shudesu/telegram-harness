import { DisabledUserAccount, FailingUserAccount, LiveUserAccount } from "./client.js";
import type { UserAccountClient } from "./client.js";

export { DisabledUserAccount, DryRunUserAccount, FailingUserAccount, LiveUserAccount } from "./client.js";
export type { UserAccountClient, UserCall } from "./client.js";
export { EnvSecretStore, LOGIN_PHONE_ENV_NAME, LOGIN_SESSION_ENV_NAME, SESSION_ENV_NAME } from "./secrets.js";
export type { SecretStore } from "./secrets.js";
export { decodeSessionKey, decryptSession, encryptSession } from "./session-crypto.js";
export { USER_RATE_LIMITS } from "./limits.js";
export { assertPublicPayload, redactUserText } from "./redact.js";
export { buildBotFatherScript, extractBotToken } from "./botfather.js";
export { downloadPhoto } from "./photo.js";
export { floodWaitSeconds, withFloodWait } from "./flood.js";
export { ADMIN_RIGHTS_OFF, ADMIN_RIGHTS_ON, mapBroadcastStats, mapEntity, mapMessageViews } from "./mtproto.js";
export type { ChannelStats, ListedChat } from "./mtproto.js";

export function createUserAccountClient(options: {
  allowNetwork: boolean;
  apiId?: string;
  apiHash?: string;
}): UserAccountClient {
  if (!options.allowNetwork) return new DisabledUserAccount();
  const apiId = Number(options.apiId);
  const apiHash = options.apiHash ?? "";
  if (!Number.isInteger(apiId) || apiId <= 0 || !/^[a-f0-9]{32}$/i.test(apiHash)) {
    return new FailingUserAccount("missing_api_credentials");
  }
  return new LiveUserAccount(async (session) => {
    const { openGramJsSession } = await import("./gramjs.js");
    return openGramJsSession({ apiId, apiHash, session });
  });
}

export function localDryRunSessionKey(): string {
  return Buffer.alloc(32, 3).toString("base64url");
}
