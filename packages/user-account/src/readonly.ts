import { Api } from "telegram";
import { openGramJsSession } from "./gramjs.js";
import { mtprotoListOwn } from "./mtproto.js";

// Deliberately narrow adapter. No login, send, history sync, session persistence
// or account mutation. Access hashes and phone numbers never leave this layer.
export async function readOnlyAccountSnapshot(options: { apiId: number; apiHash: string; session: string }) {
  const opened = await openGramJsSession(options);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = async () => {
      const users = await opened.socket.invoke(new Api.users.GetUsers({ id: [new Api.InputUserSelf()] })) as Array<{ id: unknown; firstName?: string; username?: string; bot?: boolean }>;
      const me = users[0];
      if (!me || me.bot || !/^\d{1,30}$/.test(String(me.id))) throw new Error("client_identity_required");
      const chats = await mtprotoListOwn(opened.socket, 100);
      return {
        source: "live-mtproto" as const,
        checkedAt: new Date().toISOString(),
        account: { id: String(me.id), name: me.firstName ?? "", username: me.username ?? null },
        chats: chats.map(({ accessHash: _accessHash, ...chat }) => chat),
        scope: "owner/admin groups and channels within first 100 dialogs; no message history sync",
        readOnly: true as const,
      };
    };
    return await Promise.race([read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("read_timeout")), 20000);
    })]);
  } finally { clearTimeout(timer); await opened.close(); }
}
