// Bank transfer adapter: one virtual account per order + deposit notification auto-reconciliation
// (GMO Aozora Net Bank "振込入金口座" style). Implements contract.mjs.
// UNVERIFIED: mock shape, confirm against GMO Aozora API docs before go-live — every path, request
// field, response field and the webhook signature header below is our own placeholder.
import {goodsGuard, safeEqual, hmacHex} from './contract.mjs';

const ID = 'bank_gmo';
const EXPIRY_DAYS = 3;

// UNVERIFIED: mock shape, confirm against GMO Aozora API docs before go-live
export const BANK_API = {
  issueVirtualAccount: '/virtual-accounts',
  signatureHeader: 'x-bank-signature',
};

const nowMs = deps => deps?.now?.() ?? Date.now();

async function api(deps, method, path, body, idempotencyKey) {
  const env = deps.env ?? {};
  const headers = {authorization: `Bearer ${env.BANK_API_TOKEN}`, 'content-type': 'application/json'};
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const res = await deps.fetch(`${String(env.BANK_API_BASE).replace(/\/$/, '')}${path}`, {method, headers, body: JSON.stringify(body)});
  if (!res.ok) throw Object.assign(Error(`${ID}_api_error`), {status: res.status});
  return res.json();
}

export const provider = {
  id: ID,
  supports: {subscription: false, partialRefund: true, goodsKinds: ['physical_service', 'physical_goods'], currencies: ['JPY']},
  configured: env => Boolean(env?.BANK_API_BASE && env?.BANK_API_TOKEN && env?.BANK_WEBHOOK_SECRET),

  async createCheckout(input, deps) {
    goodsGuard(ID, input.goodsKind);
    if (input.currency !== 'JPY') throw Error('currency_not_supported');
    if (input.recurring) throw Error('subscription_not_supported');
    const deadline = new Date(nowMs(deps) + EXPIRY_DAYS * 86400_000).toISOString();
    // UNVERIFIED: mock shape, confirm against GMO Aozora API docs before go-live
    const va = await api(deps, 'POST', BANK_API.issueVirtualAccount, {
      amount: input.amount, orderId: input.orderId, expiresAt: deadline,
    }, input.idempotencyKey);
    return {
      provider: ID, kind: 'bank_transfer', externalRef: va.virtualAccountId,
      instructions: {
        bankName: va.bankName, branch: va.branchName, accountType: va.accountType,
        accountNumber: va.accountNumber, accountName: va.accountName,
        amount: input.amount, deadline: va.expiresAt ?? deadline,
      },
    };
  },

  // Deposit notification. Only an exact-amount deposit into a known per-order account becomes
  // 'paid'; anything else goes to a human via deps.onReviewNeeded and emits nothing.
  async verifyWebhook(request, deps) {
    const raw = await request.text();
    const sig = request.headers.get(BANK_API.signatureHeader);
    const secret = deps.env?.BANK_WEBHOOK_SECRET;
    if (!secret || !sig || !safeEqual(sig.toLowerCase(), await hmacHex(secret, raw))) throw Error('bad_signature');
    // UNVERIFIED: mock shape, confirm against GMO Aozora API docs before go-live
    const {virtualAccountId, amount, depositId, depositedAt} = JSON.parse(raw);
    if (!depositId) throw Error('bad_payload');
    const exp = virtualAccountId ? await deps.lookupBankExpectation?.(virtualAccountId) : null;
    const review = async reason => { await deps.onReviewNeeded?.({reason, depositId}); return []; };
    if (!exp) return review('unknown_account');
    if (Number(amount) !== Number(exp.amount)) return review('amount_mismatch');
    const t = Date.parse(depositedAt);
    return [{
      id: `bank:${depositId}`, provider: ID, type: 'paid',
      tenantId: exp.tenantId, telegramUserId: exp.telegramUserId, orderId: exp.orderId,
      paymentRef: String(depositId), amount: Number(amount), currency: 'JPY',
      occurredAt: Math.floor((Number.isFinite(t) ? t : nowMs(deps)) / 1000),
    }];
  },

  // Bank refunds are a manual outgoing transfer done by staff; no API call is made here.
  async refund({paymentRef}) {
    return {refundRef: `manual:${paymentRef}`, status: 'pending', note: 'bank_refund_is_manual_transfer'};
  },

  async cancelSubscription() {
    throw Error('subscription_not_supported');
  },
};
