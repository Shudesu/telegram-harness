// Every Telegram constraint this composer relies on, with how it was established in this
// session. Nothing here is asserted as "official" unless it was actually corroborated, and
// the composer refuses to emit anything whose rules could not be checked.
//
// How the checking went (2026-11-10, tools available: WebFetch/WebSearch):
//  - core.telegram.org/bots/api is one very large page and the fetch tool returned only its
//    opening sections. One fetch of #html-style came back listing a tag `<tg-blockquote>`
//    that does not exist in the API, so those fetch summaries are treated as UNRELIABLE and
//    are not used as evidence anywhere in this file.
//  - Searches restricted to core.telegram.org did corroborate the escaping rule, the
//    four supported named entities, the nested pre/code rule, and the 1-4096 / 0-1024
//    length limits. Those are marked `corroborated`.
//  - The changelog fetch indicated newer surfaces exist (Bot API 10.1 "Rich Messages",
//    10.4 `sendWidget` with HTML widgets, and a "Rich HTML"/`html` field with headings,
//    dividers, tables and collapsible blocks). Their authoritative definitions could NOT be
//    read, so this composer DOES NOT emit them. See UNSUPPORTED below.
export const EVIDENCE = {
  corroborated: 'search on core.telegram.org returned this wording; matches long-standing documented behaviour',
  prior_knowledge: 'long-standing documented behaviour, not re-read in this session',
  our_own_rule: 'our own conservative limit; no official figure was confirmed',
  unverified: 'could not be confirmed with the tools available in this session',
};

export const LIMITS = {
  // "1-4096 characters after entities parsing" / "0-1024 characters after entities parsing".
  // The count is of the VISIBLE text, after the HTML is parsed away — so markup is free but
  // the readable content is not.
  text: {value: 4096, evidence: 'corroborated', note: 'sendMessage text'},
  caption: {value: 1024, evidence: 'corroborated', note: 'media caption (sendAnimation/sendPhoto)'},
  // Entity offsets are documented in UTF-16 code units, so an emoji costs 2. Counting in
  // UTF-16 is the stricter reading and the one that cannot overshoot.
  countedIn: {value: 'utf16', evidence: 'prior_knowledge', note: 'entity offsets are UTF-16 code units'},
  callbackDataBytes: {value: 64, evidence: 'prior_knowledge', note: 'InlineKeyboardButton callback_data 1-64 bytes'},
  // Telegram documents no maximum row/button count, so this is ours, chosen to stay well
  // inside what clients lay out comfortably on a phone.
  buttonRows: {value: 8, evidence: 'our_own_rule'},
  buttonsPerRow: {value: 3, evidence: 'our_own_rule'},
  buttonLabelChars: {value: 32, evidence: 'our_own_rule', note: 'longer labels get truncated by clients'},
  urlChars: {value: 2048, evidence: 'our_own_rule'},
  mediaBytes: {value: null, evidence: 'unverified', note: 'a documented upload ceiling exists but was not confirmed; we never fetch the URL, so size is not checked'},
};

// The classic `parse_mode: "HTML"` subset this composer emits. Deliberately smaller than the
// full documented list: only tags that have been stable for years and need no entitlement.
export const TAGS = ['b', 'i', 'u', 's', 'tg-spoiler', 'a', 'code', 'pre', 'blockquote'];

// Named entities: only these four are supported, so `&apos;` must never be produced.
// An apostrophe needs no escaping in text content and is left as-is.
export const NAMED_ENTITIES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};

export const UNSUPPORTED = [
  {id:'rich_html', label:'Rich HTML（見出し・区切り線・表・折りたたみ等のタグ）', reason:
    '新しい書式が存在する手がかりは得たが、公式のタグ一覧と制限を本セッションで読み切れなかった。見出し・区切りは classic HTML の太字と記号行で代用する。'},
  {id:'send_widget', label:'sendWidget（HTMLウィジェット）', reason:
    'Bot API 10.4 で追加された旨の記述は見たが、パラメータ仕様を確認できなかったため使わない。'},
  {id:'custom_emoji', label:'カスタム絵文字（<tg-emoji>・Premium絵文字）', reason:
    '利用資格（Fragment で追加ユーザー名を購入したBotのみ、という条件）を本セッションで確認できなかった。標準Unicode絵文字だけを使う。'},
  {id:'heading_tag', label:'見出しタグ', reason:'classic HTML には見出しタグが無い。太字行で表現する。'},
  {id:'divider_tag', label:'区切り線タグ', reason:'classic HTML には区切りタグが無い。記号だけの行で表現する。'},
  {id:'list_tag', label:'<ul>/<ol>', reason:'classic HTML には対応が無い。行頭「・」「1.」で表現する。'},
];
export const unsupported = id => UNSUPPORTED.find(u => u.id === id) ?? null;

// Decorations that are plain Unicode: no Premium, no custom emoji, same on every client.
export const DIVIDERS = {
  line: '─────────────',
  dots: '• • • • • • • • • • •',
  wave: '〜〜〜〜〜〜〜〜〜〜〜',
  stars: '✦ ─────────── ✦',
};
export const ORNAMENTS = {bullet:'・', arrow:'▸', check:'✓', star:'✦', pin:'📌', bar:'▎'};
