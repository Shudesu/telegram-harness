// Draft → the exact Bot API call that would be made. Pure: it builds and validates, and it
// never sends. The caller (the bot) performs the call it is handed by renderForSend().
import {LIMITS, TAGS} from './spec.mjs';
import {renderBlocks, visibleLength, urlProblem, BLOCK_KINDS} from './html.mjs';
import {payButtonProblems, payCallbackData, payLabel, REASONS} from './pay.mjs';
export {parsePayCallback} from './pay.mjs';

export const MEDIA_KINDS = ['none', 'animation', 'photo'];
export const BUTTON_KINDS = ['url', 'callback', 'pay'];
// The reference system's callback convention (§10 of the developer spec): a slash-separated
// path, so one handler can route by namespace instead of parsing ad-hoc strings.
export const CALLBACK_DATA = /^[A-Za-z0-9_:/-]{1,64}$/;

export function emptyDraft(over = {}) {
  return {
    id: over.id ?? null, title: over.title ?? '無題のリッチメッセージ', templateId: over.templateId ?? null,
    media: {kind:'none', url:'', note:''}, blocks: [], buttons: [],
    options: {protectContent:true, disableNotification:false}, ...over,
  };
}

const bytes = s => new TextEncoder().encode(s).length;

function buttonProblems(buttons, catalog) {
  const errors = [];
  if (!Array.isArray(buttons)) return ['buttons_malformed'];
  if (buttons.length > LIMITS.buttonRows.value) errors.push('too_many_button_rows');
  buttons.forEach((row, r) => {
    if (!Array.isArray(row) || row.length === 0) { errors.push(`row_${r}_malformed`); return; }
    if (row.length > LIMITS.buttonsPerRow.value) errors.push(`row_${r}_too_wide`);
    row.forEach((button, c) => {
      const where = `button_${r}_${c}`;
      if (!BUTTON_KINDS.includes(button?.kind)) { errors.push(`${where}_kind`); return; }
      // A pay button may leave its label empty: the default one always states the price.
      const label = button.kind === 'pay' ? payLabel(button, catalog) : String(button.label ?? '');
      if (button.kind === 'pay') {
        const problems = payButtonProblems(button, catalog);
        errors.push(...problems.map(p => `${where}_${p}`));
        if (problems.length) return;
      }
      if (!label.trim()) errors.push(`${where}_label_required`);
      if (label.length > LIMITS.buttonLabelChars.value) errors.push(`${where}_label_too_long`);
      if (button.kind === 'url') {
        const problem = urlProblem(button.url);
        if (problem) errors.push(`${where}_${problem}`);
      } else if (button.kind === 'callback') {
        if (!CALLBACK_DATA.test(button.data ?? '') || bytes(button.data) > LIMITS.callbackDataBytes.value) {
          errors.push(`${where}_callback_data`);
        // `pay/` is reserved for pay buttons: a hand-typed one would skip every catalog and
        // goods check above and still be routed to checkout by the bot.
        } else if (/^pay\//.test(button.data)) errors.push(`${where}_callback_reserved`);
      } else {
        try { payCallbackData(button.skuId, button.provider); }
        catch { errors.push(`${where}_callback_data`); }
      }
    });
  });
  return errors;
}

// `catalog` = {skus: {[skuId]: {title, amount, currency, goodsKind, recurring?}},
// providers: [{id, configured}]}. Only needed when the draft has pay buttons.
export function compile(draft, {chatId, catalog} = {}) {
  const errors = [], warnings = [];
  const media = draft?.media ?? {kind:'none'};
  // A draft read back from storage may be missing keys entirely. Missing is not malformed:
  // it has to come out as a validation result, never as a TypeError thrown at the caller.
  const buttons = Array.isArray(draft?.buttons) ? draft.buttons : [];
  const blocks = Array.isArray(draft?.blocks) ? draft.blocks : null;
  if (!MEDIA_KINDS.includes(media.kind)) errors.push('media_kind');
  if (media.kind !== 'none') {
    const problem = urlProblem(media.url);
    if (problem) errors.push(`media_${problem}`);
    // We never fetch the URL, so nothing here knows the file's size or type.
    warnings.push('media_not_fetched');
  }
  if (!blocks || blocks.length === 0) errors.push('blocks_required');
  let html = '';
  if (blocks) {
    blocks.forEach((block, i) => {
      if (!BLOCK_KINDS.includes(block?.kind)) errors.push(`block_${i}_kind`);
    });
    try { html = renderBlocks(blocks.filter(b => BLOCK_KINDS.includes(b?.kind))); }
    catch (error) { errors.push(`block_render_${error.message}`); }
  }
  errors.push(...buttonProblems(buttons, catalog));

  const asCaption = media.kind !== 'none';
  const limit = asCaption ? LIMITS.caption.value : LIMITS.text.value;
  const visible = visibleLength(html);
  // Dividers and blank lines are decoration. A message made only of them has nothing for the
  // recipient to read, so it is refused rather than sent as a row of dashes.
  const hasWords = (blocks ?? []).some(b =>
    !['divider', 'spacer'].includes(b?.kind) && String(b?.text ?? b?.href ?? '').trim().length > 0);
  if (!hasWords && !errors.includes('blocks_required')) errors.push('nothing_to_say');
  if (visible > limit) errors.push(asCaption ? 'caption_too_long' : 'text_too_long');
  // A long caption is the usual reason a GIF-led message has to become two messages.
  if (asCaption && visible > limit) warnings.push('split_media_and_text');
  if (visible > limit * 0.9 && visible <= limit) warnings.push('close_to_limit');
  if (!Number.isSafeInteger(chatId)) errors.push('chat_id_required');

  const stats = {visible, limit, remaining:limit - visible, htmlBytes:bytes(html), countedIn:LIMITS.countedIn.value,
    // The tag must end at the name: a bare `includes('<b')` also matches `<blockquote>`, and
    // the breakdown panel would claim bold in a message that only quotes.
    asCaption, tags:TAGS.filter(t => new RegExp(`<${t}[ >]`).test(html))};
  if (errors.length) return {ok:false, errors, warnings, stats, html, method:null, params:null};

  const text = {parse_mode:'HTML', ...(draft.options?.protectContent === false ? {} : {protect_content:true}),
    ...(draft.options?.disableNotification ? {disable_notification:true} : {}),
    ...(buttons.length ? {reply_markup:{inline_keyboard:buttons.map(row => row.map(b =>
      b.kind === 'url' ? {text:b.label, url:b.url}
      : b.kind === 'pay' ? {text:payLabel(b, catalog), callback_data:payCallbackData(b.skuId, b.provider)}
      : {text:b.label, callback_data:b.data}))}} : {})};
  const method = media.kind === 'animation' ? 'sendAnimation' : media.kind === 'photo' ? 'sendPhoto' : 'sendMessage';
  const params = asCaption
    ? {chat_id:chatId, [media.kind]:media.url, caption:html, ...text}
    : {chat_id:chatId, text:html, ...text};
  return {ok:true, errors, warnings, stats, html, method, params};
}

// The exact Bot API call for a draft, or a thrown Error whose `errors` lists every problem.
// Throwing (rather than returning ok:false) means a caller cannot forget to check and send
// a half-valid message.
export function renderForSend(draft, {chatId, catalog} = {}) {
  const compiled = compile(draft, {chatId, catalog});
  if (!compiled.ok) {
    const error = new Error(`richmsg_invalid: ${compiled.errors.join(',')}`);
    error.errors = compiled.errors;
    throw error;
  }
  return {method:compiled.method, params:compiled.params};
}

export const ERROR_TEXT = {
  blocks_required: '本文のブロックが1つもありません。',
  nothing_to_say: '表示される文字がありません（区切りや余白だけでは送れません）。',
  caption_too_long: `GIF・画像つきのキャプションは${LIMITS.caption.value}文字までです。超えた分は別メッセージに分けてください。`,
  text_too_long: `本文は${LIMITS.text.value}文字までです。`,
  media_url_required: 'メディアのURLを入れてください。',
  media_url_not_https: 'メディアURLは https のみ使えます。',
  media_url_malformed: 'メディアURLの形式が正しくありません。',
  media_url_has_credentials: 'URLにユーザー名・パスワードを含められません。',
  chat_id_required: '送信先が指定されていません。',
  too_many_button_rows: `ボタンの行は${LIMITS.buttonRows.value}行までにしています（自社の上限）。`,
};
export const WARNING_TEXT = {
  media_not_fetched: 'メディアURLは取得していません。存在・形式・容量は確認できていないため、実送信前に自分で確認してください。',
  split_media_and_text: 'キャプションが長すぎます。GIFだけを送って、本文を次のメッセージに分ける形にできます。',
  close_to_limit: '文字数の上限に近づいています。',
};
const PAY_ERROR_TEXT = {
  unknown_sku: '決済ボタンの商品がカタログにありません。',
  sku_id: '決済ボタンの商品が選ばれていません。',
  provider: '決済ボタンの支払い方法が選ばれていません。',
  provider_disabled: `決済ボタンの支払い方法は${REASONS.provider_disabled}です。`,
  digital_requires_stars: `${REASONS.digital_requires_stars}。`,
  stars_only_digital: `${REASONS.stars_only_digital}。`,
  currency_mismatch: `${REASONS.currency_mismatch}。`,
  sku_title_required: '商品名が空です（カタログで設定してください）。',
  sku_amount: '商品の金額が正しくありません（カタログで設定してください）。',
  sku_currency: '商品の通貨が正しくありません。', sku_goods_kind: '商品の種類が正しくありません。',
  callback_reserved: 'callback_data の pay/ は決済ボタン専用です。',
};
export const describe = (code, table) => table[code] ?? (() => {
  const m = /^button_(\d+)_(\d+)_(.+)$/.exec(code);
  if (!m) return code;
  const where = `${Number(m[1]) + 1}行目${Number(m[2]) + 1}番目のボタン：`;
  return PAY_ERROR_TEXT[m[3]] ? where + PAY_ERROR_TEXT[m[3]] : `ボタンの設定に問題があります（${code}）`;
})();
