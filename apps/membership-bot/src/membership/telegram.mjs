// Bot API transport for the membership feature only. It is never called directly by feature code:
// every write goes through the rule gate (gate.mjs), which hands it here only when a pre-approved
// rule covers it or the owner approved that single item. The allowlist is the whole of what the
// feature can do in Telegram; broadcast-style methods are not on it.
export const MEMBER_METHODS = new Set([
  'approveChatJoinRequest', 'declineChatJoinRequest', 'answerChatJoinRequestQuery', 'sendChatJoinRequestWebApp',
  'banChatMember', 'unbanChatMember', 'createChatInviteLink',
  'sendInvoice', 'createInvoiceLink', 'answerPreCheckoutQuery', 'refundStarPayment', 'editUserStarSubscription',
  'sendMessage', 'answerCallbackQuery',
]);
const TIMEOUT_MS = 8000; // pre_checkout and join-request queries must be answered within 10 s.

export function makeExec(env, fetchImpl = globalThis.fetch) {
  return async function exec(method, params) {
    if (!MEMBER_METHODS.has(method)) throw Error('method_not_allowed');
    if (!env.BOT_TOKEN) throw Error('bot_token_missing');
    const r = await fetchImpl(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(params),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const p = await r.json().catch(() => null);
    if (!p?.ok) { const e = Error('bot_api_error'); e.code = Number(p?.error_code) || r.status; throw e; }
    return p.result;
  };
}
