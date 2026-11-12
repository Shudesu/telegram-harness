// Bot profile setup: name / descriptions / command list / menu button / avatar. Modes:
//   node scripts/profile.mjs backup   → reads the current name/description/short/commands/menu button into before.json
//   node scripts/profile.mjs apply    → setMyName / setMyDescription / setMyShortDescription / setMyCommands (default=ja, en),
//                                       setChatMenuButton (web_app 「💳 決済・会員」), setMyProfilePhoto (avatar.jpg if present)
//   node scripts/profile.mjs verify   → reads everything back and compares with what apply sets
//   node scripts/profile.mjs restore  → puts before.json back (name/descriptions/commands/menu button; the photo stays)
// The allowlist is the point: this script cannot send a message to anybody. The token is read from
// the BOT_TOKEN environment variable and never printed. WORKER_ORIGIN is your deployed Worker's origin.
import fs from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const ORIGIN = process.env.WORKER_ORIGIN ?? 'https://teleharness-bot.<your-subdomain>.workers.dev';
const ALLOWED = new Set(['getMe', 'getMyName', 'getMyDescription', 'getMyShortDescription', 'getMyCommands', 'getChatMenuButton',
  'setMyName', 'setMyDescription', 'setMyShortDescription', 'setMyCommands', 'setChatMenuButton', 'setMyProfilePhoto']);

export const PROFILE = {
  name: {'': 'Teleharness｜予約・会員デモ', en: 'Teleharness — Booking & Members Demo'},
  short: {
    '': '📅予約・💳会員・🎨配信・🤖自動応答をチャットの中で体験できるデモBot。/start でガイド開始',
    en: 'Try booking, memberships, rich messages and auto-replies right inside the chat. Tap /start for the tour.',
  },
  description: {
    '': '✨ Telegram だけで店舗の予約・会員・配信が回るデモBotです。\n\n📅 予約はカードの中で完結（業態→メニュー→スタッフ→日時→確認）\n💳 会員プランと Stars 決済（テスト表示・実請求なし）\n🎨 リッチメッセージ／🤖 自動応答／🛠 自分のBotを1タップ作成\n\n「開始」を押すと 6 ステップのガイドが始まります。\n※デモ：実予約・実請求・外部送信はありません。',
    en: '✨ A demo bot that runs bookings, memberships and messaging for a shop entirely inside Telegram.\n\n📅 Booking completes inside one card (business → menu → staff → time → confirm)\n💳 Membership plans with Stars (test only, no real charge)\n🎨 Rich messages / 🤖 auto-replies / 🛠 create your own bot in one tap\n\nPress Start for a 6-step guided tour.\nDemo only: no real bookings, charges or outside messages.',
  },
  commands: {
    '': [['start', '🎓 ガイドを開始'], ['book', '📅 予約（ウィジェット）'], ['widgets', '✨ ウィジェット一覧'], ['pay', '💳 会員・決済'],
      ['plans', '💎 会員プラン一覧'], ['tour', '🎓 ガイドの続き'], ['newbot', '🤖 自分のBotを作る'],
      ['terms', '📜 利用規約・特商法表記'], ['paysupport', '🧾 支払いのお問い合わせ'], ['help', 'ℹ️ 使い方'], ['stop', '🛑 停止']],
    en: [['start', '🎓 Start the tour'], ['book', '📅 Book (widget)'], ['widgets', '✨ Widget gallery'], ['pay', '💳 Membership & payment'],
      ['plans', '💎 Membership plans'], ['tour', '🎓 Continue the tour'], ['newbot', '🤖 Create your own bot'],
      ['terms', '📜 Terms & legal notice'], ['paysupport', '🧾 Payment support'], ['help', 'ℹ️ Help'], ['stop', '🛑 Stop']],
  },
  menu: {type: 'web_app', text: '💳 決済・会員', web_app: {url: `${ORIGIN}/app/`}},
};
const LANGS = ['', 'en'];

function token() {
  const t = process.env.BOT_TOKEN;
  if (!t) throw Error('BOT_TOKEN is not set');
  return t;
}
const TOKEN = token();
async function call(method, body = {}, file) {
  if (!ALLOWED.has(method)) throw Error(`method_not_allowed:${method}`);
  const init = {method: 'POST', signal: AbortSignal.timeout(30000)};
  if (file) {
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    form.set(file.field, new Blob([fs.readFileSync(file.path)], {type: 'image/jpeg'}), 'avatar.jpg');
    init.body = form;
  } else { init.headers = {'content-type': 'application/json'}; init.body = JSON.stringify(body); }
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, init);
  const p = await r.json();
  if (!p.ok) throw Error(`${method}: ${p.error_code} ${String(p.description).replaceAll(TOKEN, '<redacted>')}`);
  return p.result;
}

async function read() {
  const out = {name: {}, short: {}, description: {}, commands: {}};
  for (const l of LANGS) {
    out.name[l] = (await call('getMyName', {language_code: l})).name;
    out.short[l] = (await call('getMyShortDescription', {language_code: l})).short_description;
    out.description[l] = (await call('getMyDescription', {language_code: l})).description;
    out.commands[l] = (await call('getMyCommands', l ? {language_code: l} : {})).map(c => [c.command, c.description]);
  }
  out.menu = await call('getChatMenuButton', {});
  return out;
}
const sameMenu = (a, b) => a.type === b.type && a.text === b.text && a.web_app?.url === b.web_app?.url;

const mode = process.argv[2];
if (mode === 'backup') {
  const f = `${HERE}before.json`;
  if (fs.existsSync(f)) throw Error('before.json exists; not overwriting the first backup');
  fs.writeFileSync(f, JSON.stringify(await read(), null, 1));
  console.log('backup written');
} else if (mode === 'apply' || mode === 'restore') {
  const P = mode === 'apply' ? PROFILE : JSON.parse(fs.readFileSync(`${HERE}before.json`, 'utf8'));
  for (const l of LANGS) {
    const lc = l ? {language_code: l} : {};
    await call('setMyName', {name: P.name[l] ?? '', ...lc});
    await call('setMyShortDescription', {short_description: P.short[l] ?? '', ...lc});
    await call('setMyDescription', {description: P.description[l] ?? '', ...lc});
    await call('setMyCommands', {commands: (P.commands[l] ?? []).map(([command, description]) => ({command, description})), ...lc});
  }
  await call('setChatMenuButton', {menu_button: P.menu});
  if (mode === 'apply' && fs.existsSync(`${HERE}avatar.jpg`)) await call('setMyProfilePhoto', {photo: {type: 'static', photo: 'attach://avatar'}}, {field: 'avatar', path: `${HERE}avatar.jpg`});
  console.log(`${mode} done`);
} else if (mode === 'verify') {
  const now = await read(), bad = [];
  for (const l of LANGS) {
    if (now.name[l] !== PROFILE.name[l]) bad.push(`name[${l}]`);
    if (now.short[l] !== PROFILE.short[l]) bad.push(`short[${l}]`);
    if (now.description[l] !== PROFILE.description[l]) bad.push(`description[${l}]`);
    if (JSON.stringify(now.commands[l]) !== JSON.stringify(PROFILE.commands[l])) bad.push(`commands[${l}]`);
  }
  if (!sameMenu(now.menu, PROFILE.menu)) bad.push('menu');
  const me = await call('getMe');
  console.log(JSON.stringify({verified: bad.length === 0, mismatches: bad, username: me.username, menu: now.menu.type + ':' + now.menu.text,
    commands: Object.fromEntries(LANGS.map(l => [l || 'default', now.commands[l].length]))}));
  process.exit(bad.length ? 1 : 0);
} else {
  console.error('usage: backup | apply | verify | restore'); process.exit(2);
}
