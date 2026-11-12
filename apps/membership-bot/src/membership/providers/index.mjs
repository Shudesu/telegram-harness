// Provider registry + the single entry point for starting a checkout.
import {goodsGuard} from './contract.mjs';
import {provider as telegram_stars} from './stars.mjs';
import {provider as stripe} from './stripe.mjs';
import {provider as komoju} from './komoju.mjs';
import {provider as bank_gmo} from './bank.mjs';

export const PROVIDERS = {telegram_stars, stripe, komoju, bank_gmo};

const LABELS = {
  telegram_stars: 'Telegram Stars',
  stripe: 'Stripe Connect',
  komoju: 'KOMOJU（コンビニ・PayPay等）',
  bank_gmo: '銀行振込（バーチャル口座・自動消込）',
};

export function providerStatus(env) {
  return Object.entries(PROVIDERS).map(([id, p]) => {
    const configured = Boolean(p.configured(env ?? {}));
    return {id, label: LABELS[id], configured, enabled: configured, reason: configured ? null : '未設定（APIキーなし）のため無効'};
  });
}

export async function startCheckout(providerId, input, deps) {
  // Bot Developer Terms §6.2 guard runs first, whatever else is wrong with the request.
  goodsGuard(providerId, input?.goodsKind);
  const p = Object.hasOwn(PROVIDERS, providerId) ? PROVIDERS[providerId] : null;
  if (!p || !p.configured(deps?.env ?? {})) throw Error('provider_not_configured');
  return p.createCheckout(input, deps);
}
