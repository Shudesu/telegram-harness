// Pre-approved automation rules (00-summary §1-4).
//
// Every Bot API write the membership feature wants to make is a *request* to this gate. If the owner
// has approved a rule that covers (condition, method, chat), it runs at once — join requests and
// pre_checkout_query must be answered within 10 seconds, which no human queue can do. Anything else
// is parked as a pending approval, exactly like the harness's draft → approve → publish path, and
// only runs when the owner approves that one item. Both outcomes are written to the audit log.
//
// The rule catalogue is fixed in code: an owner can enable, scope (to chats) and disable a preset,
// but cannot invent a new condition or widen the methods a preset may call.
export const PRESETS = {
  join_approve_paid: {
    title: 'Stars支払い済み（本人確認済み）の会員→会員グループ参加を承認',
    conditions: ['paid_member_verified'],
    methods: ['approveChatJoinRequest', 'answerChatJoinRequestQuery'],
  },
  join_decline: {
    title: '未払い・本人確認の不正解/時間切れ→参加申請を却下',
    conditions: ['not_entitled', 'verification_failed', 'verification_timeout'],
    methods: ['declineChatJoinRequest', 'answerChatJoinRequestQuery'],
  },
  join_verify: {
    title: '参加申請者に本人確認（ボタン＋質問）を出す',
    conditions: ['join_verification'],
    methods: ['sendChatJoinRequestWebApp', 'sendMessage', 'answerCallbackQuery'],
  },
  expire_remove: {
    title: '期限切れ・返金・解約→会員グループから退出（ban→unban）',
    conditions: ['entitlement_ended'],
    methods: ['banChatMember', 'unbanChatMember'],
  },
  checkout: {
    title: '本人が押した決済ボタンに請求書/決済URLを返し、支払い前確認に応答',
    conditions: ['buyer_requested', 'order_valid', 'order_invalid'],
    methods: ['sendInvoice', 'createInvoiceLink', 'answerPreCheckoutQuery', 'answerCallbackQuery', 'sendMessage'],
  },
  member_notice: {
    title: '会員本人への通知（購入完了・承認・期限切れ）',
    conditions: ['member_notice'],
    methods: ['sendMessage'],
  },
};

const pad = n => String(n).padStart(12, '0');

// hooks.prepare(approval) → params to run with (e.g. a fresh until_date); hooks.after(approval, outcome)
// resumes the workflow the approved write belonged to.
export function makeGate({store, exec, now = () => Date.now(), hooks = {}}) {
  async function nextId(kind) {
    const key = `seq:${kind}`;
    const n = ((await store.get(key)) ?? 0) + 1;
    await store.put(key, n);
    return n;
  }

  async function audit(entry) {
    const seq = await nextId('audit');
    const row = {seq, at: now(), ...entry};
    await store.put(`audit:${pad(seq)}`, row);
    return row;
  }

  async function listRules() { return store.list('rule:'); }

  async function matchingRule(req) {
    for (const r of await listRules()) {
      if (!r.enabled) continue;
      if (!r.conditions.includes(req.condition) || !r.methods.includes(req.method)) continue;
      if (r.chats.length && !r.chats.includes(req.chatId)) continue;
      return r;
    }
    return null;
  }

  async function run(req, via) {
    try {
      const result = await exec(req.method, req.params);
      await audit({kind: 'executed', via, method: req.method, condition: req.condition, chatId: req.chatId ?? null,
        reason: req.reason ?? null, target: req.target ?? null, ok: true});
      return {status: 'executed', result};
    } catch (err) {
      await audit({kind: 'executed', via, method: req.method, condition: req.condition, chatId: req.chatId ?? null,
        reason: req.reason ?? null, target: req.target ?? null, ok: false, error: String(err?.message ?? err)});
      return {status: 'failed', error: String(err?.message ?? err), code: err?.code};
    }
  }

  return {
    audit,
    async addRule(preset, {chats = [], by = 'owner'} = {}) {
      const p = PRESETS[preset];
      if (!p) throw Error('unknown_preset');
      if (!Array.isArray(chats) || !chats.every(Number.isSafeInteger)) throw Error('bad_chats');
      const id = `r${await nextId('rule')}`;
      const rule = {id, preset, title: p.title, conditions: [...p.conditions], methods: [...p.methods], chats: [...chats],
        enabled: true, approvedBy: by, approvedAt: now(), disabledAt: null};
      await store.put(`rule:${id}`, rule);
      await audit({kind: 'rule_added', ruleId: id, preset, by});
      return rule;
    },
    listRules,
    async disableRule(id, {by = 'owner'} = {}) {
      const rule = await store.get(`rule:${id}`);
      if (!rule) throw Error('unknown_rule');
      if (rule.enabled) { rule.enabled = false; rule.disabledAt = now(); await store.put(`rule:${id}`, rule); }
      await audit({kind: 'rule_disabled', ruleId: id, by});
      return rule;
    },
    // req = {method, params, condition, chatId?, reason?, target?}
    // queueOnly: never look for a covering rule — the write is parked for the owner whatever rules
    // are enabled (used by the MCP endpoint, which may only ever queue).
    async request(req, {queueOnly = false} = {}) {
      const rule = queueOnly ? null : await matchingRule(req);
      if (rule) return {...(await run(req, `rule:${rule.id}`)), ruleId: rule.id};
      const id = `a${await nextId('approval')}`;
      await store.put(`approval:${id}`, {id, state: 'pending', at: now(), ...req});
      await audit({kind: 'queued', approvalId: id, method: req.method, condition: req.condition,
        chatId: req.chatId ?? null, reason: req.reason ?? null, target: req.target ?? null, ...(queueOnly ? {via: 'mcp'} : {})});
      return {status: 'pending_approval', approvalId: id};
    },
    async listApprovals(state = 'pending') {
      return (await store.list('approval:')).filter(a => !state || a.state === state);
    },
    async decide(id, approve, {by = 'owner'} = {}) {
      const a = await store.get(`approval:${id}`);
      if (!a) throw Error('unknown_approval');
      if (a.state !== 'pending') throw Error('already_decided');
      a.state = approve ? 'approved' : 'rejected';
      a.decidedBy = by; a.decidedAt = now();
      await store.put(`approval:${id}`, a);
      if (!approve) { await audit({kind: 'rejected', approvalId: id, method: a.method, by}); return {status: 'rejected'}; }
      // The world may have moved on since this was queued (repurchase, refund): prepare() re-checks
      // and returns null to skip a write that is no longer right.
      const params = hooks.prepare ? await hooks.prepare(a) : a.params;
      if (params === null) {
        a.outcome = 'stale';
        await store.put(`approval:${id}`, a);
        await audit({kind: 'stale_skipped', approvalId: id, method: a.method, by});
        if (hooks.after) await hooks.after(a, {status: 'stale'});
        return {status: 'stale'};
      }
      const out = await run({...a, params}, `approval:${id}`);
      a.outcome = out.status;
      await store.put(`approval:${id}`, a);
      if (hooks.after) await hooks.after(a, out);
      return out;
    },
    async auditLog() { return store.list('audit:'); },
  };
}
