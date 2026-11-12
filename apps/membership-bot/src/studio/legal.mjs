// /terms and /paysupport: required for a bot that sells with Telegram Stars. Seller details are
// placeholders (準備中) until the owner fills them in; every other line is the actual policy the
// payment code implements (Stars only, full refunds through refundStarPayment, renewals stoppable
// in Telegram).
import {APP_PLANS, SALON, billingLabel} from './plans.mjs';

const esc = s => String(s).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
const TBD = '準備中';

// [label, value] rows of the 特定商取引法に基づく表記; shared by /terms and the Mini App.
export const TOKUSHO = [
  ['販売事業者', TBD],
  ['運営統括責任者', TBD],
  ['所在地', `${TBD}（ご請求があれば遅滞なく開示します）`],
  ['電話番号', `${TBD}（ご請求があれば遅滞なく開示します）`],
  ['お問い合わせ', 'このBotで /paysupport'],
  ['販売価格', APP_PLANS.map(p => `${p.name} ⭐${p.stars}（${billingLabel(p)}）`).join('／')],
  ['商品代金以外の必要料金', 'Starsの購入時に Telegram・各ストアが定める手数料等'],
  ['支払方法', 'Telegram Stars（Telegram公式の支払い画面）'],
  ['支払時期', 'お申し込み時に決済。自動更新プランは30日ごとに自動で決済'],
  ['提供時期', '決済完了後、ただちに会員資格を付与'],
  ['解約', '自動更新は Telegram の 設定 → Telegram Stars → サブスクリプション からいつでも停止でき、次回以降は請求されません。残り期間は最後まで利用できます'],
  ['返品・返金', 'デジタルサービスの性質上、お客様都合の返金はお受けしていません。二重決済・サービスを提供できなかった場合など当方に原因があるときは、確認のうえ Stars で全額返金します'],
];

export const TERMS_POINTS = [
  '会員資格はお申し込みいただいたご本人のみが利用できます（譲渡・共有不可）。',
  '会員向けコンテンツの転載・再配布、他の会員への迷惑行為を禁止します。',
  '内容は予告なく変更・終了する場合があります。終了時は未経過分を返金します。',
  '本サービスの利用で生じた損害について、当方の故意または重過失による場合を除き責任を負いません。',
  '本サービスの購入に関するお問い合わせに Telegram のサポートは対応できません。/paysupport からご連絡ください。',
];

export function termsText() {
  return [`📄 <b>${esc(SALON)} 利用規約（要約）</b>`, ...TERMS_POINTS.map(t => `• ${esc(t)}`), '',
    '🧾 <b>特定商取引法に基づく表記</b>', ...TOKUSHO.map(([k, v]) => `<b>${esc(k)}</b>：${esc(v)}`), '',
    '<i>お申し込みをもって本規約に同意したものとみなします。販売者情報は準備が整いしだい掲載します。</i>'].join('\n');
}

const STATE = {awaiting_payment: '未払い', awaiting_approval: '確認中', paid: '支払い済み', refunded: '返金済み', expired_order: '期限切れ'};
const ymd = ms => { const d = new Date(ms + 9 * 3600000); return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };

// `orders`: this user's own most recent orders ({id, title, amount, state, at}), newest first.
export function paysupportText(orders = []) {
  const mine = orders.filter(o => o.state === 'paid' || o.state === 'refunded').slice(0, 5);
  return [`🛟 <b>お支払いサポート</b>（${esc(SALON)}）`,
    '決済・返金・会員資格についてのお問い合わせ窓口です。',
    '',
    '<b>お問い合わせ方法</b>',
    '• このチャットで <code>/paysupport 内容</code> と送ると窓口に届きます（例：<code>/paysupport 二重に支払いました</code>）。受付番号をお返しし、担当者が確認します。',
    `• メール窓口：${TBD}`,
    '• お問い合わせの際は、下の<b>注文番号</b>とお支払い日を添えてください。',
    '• 二重決済・会員資格が反映されない場合は、確認のうえ Stars で全額返金します。',
    '• 自動更新の停止：Telegram の 設定 → Telegram Stars → サブスクリプション',
    '',
    mine.length ? '<b>あなたのご注文</b>' : '<i>このアカウントのお支払い履歴はまだありません。</i>',
    ...mine.map(o => `• <code>${esc(o.id)}</code> ${esc(o.title)} ⭐${o.amount} ${ymd(o.at)} ${STATE[o.state] ?? ''}`),
    '',
    'Telegram のサポートは本サービスの購入に関するお問い合わせに対応できません。利用規約・特商法表記は /terms'].join('\n');
}
