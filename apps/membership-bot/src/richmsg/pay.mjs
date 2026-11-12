// Pay buttons: a rich message can carry a button that starts a checkout for one catalog SKU.
//
// The button itself is only an inline callback button whose callback_data names the SKU and
// the payment method (`pay/<skuId>/<provider>`). Prices never travel in callback_data: the
// bot side re-reads the SKU from its own catalog when the press arrives, so a forged or stale
// button can at most ask for a checkout of a product that exists at its current price.
//
// Everything here is pure and dependency-free. The catalog is handed in by the caller.
import {LIMITS} from './spec.mjs';

export const PAY_PROVIDERS = ['telegram_stars', 'stripe', 'komoju', 'bank_gmo'];
export const PROVIDER_LABELS = {
  telegram_stars: 'Telegram Stars', stripe: 'クレジットカード（Stripe）',
  komoju: 'コンビニ・PayPay等（KOMOJU）', bank_gmo: '銀行振込（GMOあおぞら）',
};
export const GOODS_KINDS = ['digital', 'physical_service', 'physical_goods'];
export const GOODS_LABELS = {digital: 'デジタル商品・会員権', physical_service: '役務（対面・個別サービス）', physical_goods: '物販'};
export const CURRENCIES = ['XTR', 'JPY'];
export const SKU_ID = /^[A-Za-z0-9_-]{1,32}$/;
// Our own ceiling, not a documented Telegram/PSP figure: it only catches typos (an extra 0).
export const AMOUNT_MAX = 1_000_000;

const PAY_DATA = /^pay\/([A-Za-z0-9_-]{1,32})\/([a-z_]{1,32})$/;
const bytes = s => new TextEncoder().encode(s).length;

export const REASONS = {
  provider_disabled: '未設定のため無効',
  digital_requires_stars: 'デジタル商品はTelegram Starsのみ（Telegram Bot Developer Terms §6.2）',
  stars_only_digital: 'Starsはデジタル商品専用です',
  currency_mismatch: '商品の通貨とこの支払い方法が合いません',
  unknown_provider: '不明な支払い方法です',
};

export function payCallbackData(skuId, provider) {
  if (!SKU_ID.test(String(skuId ?? ''))) throw new Error('invalid_sku_id');
  if (!PAY_PROVIDERS.includes(provider)) throw new Error('invalid_provider');
  const data = `pay/${skuId}/${provider}`;
  if (bytes(data) > LIMITS.callbackDataBytes.value) throw new Error('callback_data_too_long');
  return data;
}

// Strict inverse of payCallbackData: anything that payCallbackData could not have produced is
// null, so the bot side never has to second-guess a press it routes to checkout.
export function parsePayCallback(data) {
  if (typeof data !== 'string' || bytes(data) > LIMITS.callbackDataBytes.value) return null;
  const m = PAY_DATA.exec(data);
  if (!m || !PAY_PROVIDERS.includes(m[2])) return null;
  return {skuId: m[1], provider: m[2]};
}

// 3000 → '3,000'. Done by hand so the label is identical on every runtime regardless of ICU.
export const groupDigits = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const formatPrice = sku => sku.currency === 'XTR' ? `⭐ ${groupDigits(sku.amount)} Stars` : `¥${groupDigits(sku.amount)}`;
export const defaultPayLabel = sku => sku.currency === 'XTR'
  ? `⭐ ${groupDigits(sku.amount)} Starsで支払う`
  : `💳 ¥${groupDigits(sku.amount)} を支払う`;

// Problems with a SKU definition itself, independent of how it is paid for.
export function skuProblems(sku) {
  const errors = [];
  if (!sku || typeof sku !== 'object') return ['sku_malformed'];
  if (!String(sku.title ?? '').trim()) errors.push('sku_title_required');
  if (!CURRENCIES.includes(sku.currency)) errors.push('sku_currency');
  if (!GOODS_KINDS.includes(sku.goodsKind)) errors.push('sku_goods_kind');
  if (!Number.isSafeInteger(sku.amount) || sku.amount < 1 || sku.amount > AMOUNT_MAX) errors.push('sku_amount');
  return errors;
}

const configuredSet = catalog => new Set((Array.isArray(catalog?.providers) ? catalog.providers : [])
  .filter(p => p && p.configured === true).map(p => p.id));
export const skuOf = (catalog, skuId) => {
  const skus = catalog?.skus;
  return skus && typeof skus === 'object' && Object.hasOwn(skus, skuId) ? skus[skuId] : null;
};

// Why `provider` cannot sell `sku`, as reason codes (empty = allowed). Order: configuration
// first, then the goods rule, then currency — the UI shows the first one.
export function providerProblems(catalog, sku, provider) {
  if (!PAY_PROVIDERS.includes(provider)) return ['unknown_provider'];
  const problems = [];
  if (!configuredSet(catalog).has(provider)) problems.push('provider_disabled');
  if (sku) {
    const stars = provider === 'telegram_stars';
    if (sku.goodsKind === 'digital' && !stars) problems.push('digital_requires_stars');
    if (GOODS_KINDS.includes(sku.goodsKind) && sku.goodsKind !== 'digital' && stars) problems.push('stars_only_digital');
    if ((sku.currency === 'XTR' && !stars) || (sku.currency === 'JPY' && stars)) problems.push('currency_mismatch');
  }
  return problems;
}

// The list the editor renders: every provider, each with whether it can be chosen and why not.
export function providerChoices(catalog, skuId) {
  const sku = skuOf(catalog, skuId);
  return PAY_PROVIDERS.map(id => {
    const problems = providerProblems(catalog, sku, id);
    return {id, label: PROVIDER_LABELS[id], enabled: problems.length === 0, problems,
      reason: problems.length ? REASONS[problems[0]] : null};
  });
}

// Validation used by compile(). Error codes are appended to the caller's `button_r_c` prefix.
export function payButtonProblems(button, catalog) {
  const skuId = String(button?.skuId ?? '');
  if (!SKU_ID.test(skuId)) return ['sku_id'];
  const sku = skuOf(catalog, skuId);
  if (!sku) return ['unknown_sku'];
  const own = skuProblems(sku);
  if (own.length) return own;
  if (!PAY_PROVIDERS.includes(button.provider)) return ['provider'];
  return providerProblems(catalog, sku, button.provider);
}

// The label actually sent: the owner's own text, or one that always states the price.
export function payLabel(button, catalog) {
  const own = String(button?.label ?? '').trim();
  if (own) return own;
  const sku = skuOf(catalog, button?.skuId);
  return sku && !skuProblems(sku).length ? defaultPayLabel(sku) : '';
}
