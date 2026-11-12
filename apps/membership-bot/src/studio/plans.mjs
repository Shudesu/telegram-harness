// The member plans sold in this bot (Telegram Stars, digital goods). One source of truth for the
// Mini App plan list, the plan-comparison widget, the member card and the owner's catalogue
// registration (/admin/membership/plan_set). The SKU the Mini App checks out is `app-<id>`; its
// price at Telegram is always the registered SKU's amount, never what a page displays.
//
// Benefits are a launch draft written for the owner to edit before announcing the salon.
export const SALON = 'AIエージェント実践ラボ';
export const PERIOD_DAYS = 30;

export const APP_PLANS = [
  {id: 'light', name: 'ライト', stars: 250, recurring: false, tag: 'お試し',
    desc: 'まずは1か月。毎週のAIエージェント最新動向を、要点だけ押さえたい方へ。',
    f: ['週刊AIエージェント・ニュース解説（毎週月曜）', '実践プロンプト＆テンプレート集の閲覧', '会員限定Q&Aアーカイブの閲覧']},
  {id: 'standard', name: 'スタンダード', stars: 500, recurring: true, tag: '人気',
    desc: '学びながら手を動かしたい方へ。勉強会と個別質問で、自分の業務に落とし込めます。',
    f: ['ライトの全特典', '月2回のオンライン勉強会（録画アーカイブ付き）', '質問フォームでの個別回答（月3件まで）']},
  {id: 'premium', name: 'プレミアム', stars: 1500, recurring: true, tag: '',
    desc: '本気で業務に組み込む方へ。少人数ハンズオンと優先サポートで導入まで伴走します。',
    f: ['スタンダードの全特典', '月1回の少人数ハンズオン（定員10名）', 'Bot・自動化ワークフローの設定テンプレ配布と優先サポート']},
];

export const skuOf = id => `app-${id}`;
export const planById = id => APP_PLANS.find(p => p.id === id) ?? null;
export const billingLabel = p => p.recurring ? `${PERIOD_DAYS}日ごと自動更新` : `${PERIOD_DAYS}日間・1回払い`;

// The catalogue records the owner registers. No member group yet (chats: []): a purchase grants the
// membership and the member card; group links are added later with the same call.
export function planSetPayloads({chats = [], links = {}} = {}) {
  return APP_PLANS.map(p => ({plan: {
    id: p.id, title: `${SALON} ${p.name}`, description: `${p.desc}（${billingLabel(p)}）`, goodsKind: 'digital',
    chats, links, listed: true,
    skus: [{id: skuOf(p.id), title: `${p.name}プラン（${PERIOD_DAYS}日）`, amount: p.stars, currency: 'XTR', days: PERIOD_DAYS, recurring: p.recurring}],
  }}));
}
