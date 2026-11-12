// Views for the rich-message editor, including the preview.
//
// The preview is deliberately NOT a mock-up of a Telegram chat: no bubble, no avatar, no
// other party's interface. It is our own card that shows exactly three things — the media
// slot, the decorated text as the allowed tag subset renders it, and the buttons — plus the
// technical panel (method, parse_mode, character count against the real limit). Copying
// another product's chat chrome would make a preview people trust more than it deserves.
import {compile, describe, ERROR_TEXT, WARNING_TEXT} from './compose.mjs';
import {TEMPLATES} from './templates.mjs';
import {LIMITS, UNSUPPORTED, DIVIDERS} from './spec.mjs';
import {OFFERED_BLOCKS, BLOCK_LABELS, richNext, dividerStyles, currentPayButton} from './rflow.mjs';
import {PROVIDER_LABELS, GOODS_KINDS, GOODS_LABELS, CURRENCIES, AMOUNT_MAX, skuOf, skuProblems,
  providerChoices, payLabel, formatPrice, groupDigits} from './pay.mjs';

// Local copies so this module stays self-contained inside the Worker (the original imported
// them from the Mini App's view module).
export const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const EDITOR_LABEL = '編集・プレビュー専用：この画面からは送信も請求もしません';
const badge = () => `<p class="trust">${esc(EDITOR_LABEL)}</p>`;
const PREVIEW_CHAT = -1009000000001; // a TEST chat id, so the preview compiles like a real call
export const hint = state => `<p class="next">次の1手 <b>${esc(richNext(state).label)}</b></p>`;

// Our own rendering of the allowed subset. Mirrors html.mjs one-for-one so the preview
// cannot show something the composer would not send.
function previewBlock(block) {
  const text = esc(block.text ?? '');
  switch (block.kind) {
    case 'divider': return `<p class="rm-divider">${esc(DIVIDERS[block.style] ?? DIVIDERS.line)}</p>`;
    case 'spacer': return '<p class="rm-spacer">&nbsp;</p>';
    case 'heading': case 'bold': return `<p><b>${text}</b></p>`;
    case 'italic': return `<p><i>${text}</i></p>`;
    case 'underline': return `<p><u>${text}</u></p>`;
    case 'strike': return `<p><s>${text}</s></p>`;
    case 'spoiler': return `<p><span class="rm-spoiler">${text}</span></p>`;
    case 'code': return `<p><code>${text}</code></p>`;
    case 'quote': return `<blockquote class="rm-quote">${text}</blockquote>`;
    case 'quote_expandable': return `<blockquote class="rm-quote">${text}<span class="rm-more">（折りたたみ）</span></blockquote>`;
    case 'list': return `<ul class="rm-list">${(block.text ?? '').split('\n').filter(Boolean).map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
    case 'numbered': return `<ol class="rm-list">${(block.text ?? '').split('\n').filter(Boolean).map(l => `<li>${esc(l)}</li>`).join('')}</ol>`;
    case 'link': return `<p><span class="rm-link">${esc(block.text || block.href || '')}</span> <span class="rm-url">${esc(block.href ?? '')}</span></p>`;
    default: return `<p>${text}</p>`;
  }
}

function templatesView(state) {
  return `<h1>リッチメッセージ</h1>${badge()}
  <p class="intro">GIFや画像を先頭に置き、装飾した本文とボタンを付けたメッセージを作ります。<b>この画面からは送信しません</b>。送信はBotが renderForSend() の結果で行います。</p>
  <h2>テンプレートから始める</h2>
  <div class="options">${TEMPLATES.map(t =>
    `<button class="option" data-rtemplate="${esc(t.templateId)}"><strong>${esc(t.title)}</strong>
      <span>${esc(t.media.kind === 'none' ? '文字のみ' : t.media.kind === 'animation' ? 'GIF（animation）つき' : '画像つき')}・ブロック${t.blocks.length}個・ボタン${t.buttons.flat().length}個</span></button>`).join('')}</div>
  <button data-rpage="editor">白紙から作る</button>
  <h2>いまは使わない書式</h2>
  <ul class="rails-off">${UNSUPPORTED.map(u => `<li><strong>${esc(u.label)}</strong><span>${esc(u.reason)}</span></li>`).join('')}</ul>
  ${hint(state)}<nav class="navigation" aria-label="画面操作"><button data-rpage="drafts">保存した下書き</button></nav>`;
}

function editorView(state) {
  const d = state.draft;
  return `<h1>メッセージを編集</h1>${badge()}
  <label class="rm-field"><span>タイトル（管理用・送信されません）</span>
    <input id="rtitle" type="text" value="${esc(d.title)}" maxlength="80"></label>
  <h2>先頭のメディア</h2>
  <div class="options">${[['none', '付けない'], ['animation', 'GIF / animation'], ['photo', '画像']].map(([kind, label]) =>
    `<button class="option" data-rmedia="${kind}" aria-pressed="${d.media.kind === kind}"><strong>${esc(label)}</strong></button>`).join('')}</div>
  ${d.media.kind === 'none' ? '' : `<label class="rm-field"><span>メディアURL（https のみ・この画面では取得しません）</span>
    <input id="rmediaurl" type="url" value="${esc(d.media.url)}" placeholder="https://example.invalid/placeholder.gif"></label>
    <p class="intro">${esc(WARNING_TEXT.media_not_fetched)}</p>`}
  <h2>本文</h2>
  ${d.blocks.length ? `<ol class="rm-blocks">${d.blocks.map((block, i) =>
    `<li><strong>${esc(BLOCK_LABELS[block.kind] ?? block.kind)}</strong>
      <span class="rm-excerpt">${esc((block.text ?? DIVIDERS[block.style] ?? '').slice(0, 40) || '（空）')}</span>
      <span class="rm-rowactions"><button data-rup="${i}" aria-label="上へ">↑</button><button data-rdown="${i}" aria-label="下へ">↓</button>
      <button data-redit="${i}">編集</button><button class="danger" data-rdel="${i}">削除</button></span></li>`).join('')}</ol>`
    : '<p class="intro">まだブロックがありません。</p>'}
  <button data-rpage="blocks">ブロックを足す</button>
  <h2>ボタン</h2>
  <p class="intro">1行${LIMITS.buttonsPerRow.value}個まで・${LIMITS.buttonRows.value}行までにしています（自社の上限）。</p>
  <button data-rpage="buttons">ボタンを編集（${d.buttons.flat().length}個）</button>
  <button data-rpage="catalog">決済する商品（カタログ・${Object.keys(state.catalog?.skus ?? {}).length}件）</button>
  ${hint(state)}<nav class="navigation" aria-label="画面操作"><button class="primary" data-rpage="preview">プレビュー</button>
  <button id="rsave">保存</button><button data-rpage="templates">テンプレート</button></nav>`;
}

function blocksView(state) {
  const selected = state.selected !== null ? state.draft.blocks[state.selected] : null;
  return `<h1>ブロック</h1>${badge()}
  <div class="options">${OFFERED_BLOCKS.map(kind =>
    `<button class="option" data-radd="${kind}"><strong>${esc(BLOCK_LABELS[kind])}</strong></button>`).join('')}</div>
  ${selected ? `<h2>${esc(BLOCK_LABELS[selected.kind] ?? selected.kind)}</h2>
    ${selected.kind === 'divider'
      ? `<div class="options">${dividerStyles().map(style =>
          `<button class="option" data-rstyle="${esc(style)}" aria-pressed="${selected.style === style}"><strong>${esc(DIVIDERS[style])}</strong></button>`).join('')}</div>`
      : selected.kind === 'spacer' ? '<p class="intro">空行です。設定はありません。</p>'
      : `<label class="rm-field"><span>文字（改行で項目を分けられます）</span>
          <textarea id="rtext" rows="4">${esc(selected.text ?? '')}</textarea></label>
         ${selected.kind === 'link' ? `<label class="rm-field"><span>リンク先（https のみ）</span>
          <input id="rhref" type="url" value="${esc(selected.href ?? '')}"></label>` : ''}`}`
    : '<p class="intro">上から種類を選ぶと、ここで中身を入れられます。</p>'}
  <nav class="navigation" aria-label="画面操作"><button data-rpage="editor">編集画面へ戻る</button></nav>`;
}

function paySummary(state, button, r, c) {
  const sku = skuOf(state.catalog, button.skuId);
  return `<p class="rm-paysummary">商品：${esc(sku ? `${sku.title || button.skuId}（${skuProblems(sku).length ? '金額未設定' : formatPrice(sku)}）` : '未選択')}
    ／支払い方法：${esc(PROVIDER_LABELS[button.provider] ?? '未選択')}</p>
    <button data-rpayedit="${r}-${c}">決済の設定を開く</button>`;
}

function buttonsView(state) {
  const rows = state.draft.buttons;
  return `<h1>ボタン</h1>${badge()}
  ${rows.length ? rows.map((row, r) => `<div class="rm-buttonrow"><p class="eyebrow">${r + 1}行目</p>
    ${row.map((button, c) => `<div class="rm-button">
      <label class="rm-field"><span>表示名（${LIMITS.buttonLabelChars.value}文字まで）</span>
        <input data-rlabel="${r}-${c}" type="text" value="${esc(button.label ?? '')}" maxlength="${LIMITS.buttonLabelChars.value}"></label>
      <div class="options"><button class="option" data-rkind="${r}-${c}-url" aria-pressed="${button.kind === 'url'}"><strong>リンク</strong></button>
        <button class="option" data-rkind="${r}-${c}-callback" aria-pressed="${button.kind === 'callback'}"><strong>Bot内の動作</strong></button>
        <button class="option" data-rkind="${r}-${c}-pay" aria-pressed="${button.kind === 'pay'}"><strong>決済</strong></button></div>
      ${button.kind === 'url'
        ? `<label class="rm-field"><span>URL（https のみ）</span><input data-rurl="${r}-${c}" type="url" value="${esc(button.url ?? '')}"></label>`
        : button.kind === 'pay' ? paySummary(state, button, r, c)
        : `<label class="rm-field"><span>callback_data（${LIMITS.callbackDataBytes.value}バイトまで・例 richmsg/open/1。pay/ は決済ボタン専用）</span>
            <input data-rdata="${r}-${c}" type="text" value="${esc(button.data ?? '')}"></label>`}
      <button class="danger" data-rbdel="${r}-${c}">このボタンを削除</button></div>`).join('')}
    ${row.length < LIMITS.buttonsPerRow.value ? `<button data-rbadd="${r}">この行に足す</button>` : ''}</div>`).join('')
    : '<p class="intro">ボタンはありません。</p>'}
  ${rows.length < LIMITS.buttonRows.value ? '<button data-rbadd="new">行を足す</button> <button data-rpayadd="new">決済ボタンを足す</button>' : `<p class="panel">${esc(ERROR_TEXT.too_many_button_rows)}</p>`}
  <nav class="navigation" aria-label="画面操作"><button data-rpage="editor">編集画面へ戻る</button></nav>`;
}

function previewView(state) {
  const d = state.draft, compiled = compile(d, {chatId:PREVIEW_CHAT, catalog:state.catalog});
  const counted = `${compiled.stats.visible} / ${compiled.stats.limit} 文字（UTF-16単位。絵文字は2）`;
  return `<h1>プレビュー</h1>${badge()}
  <p class="intro">これは<b>Telegramの画面の再現ではありません</b>。送信される内容そのものを、この画面の様式で並べたものです。実際の見た目は端末とクライアントで変わります。</p>
  <div class="rm-preview">
    ${d.media.kind === 'none' ? '' : `<div class="rm-media"><strong>${esc(d.media.kind === 'animation' ? 'GIF / animation' : '画像')}</strong>
      <span class="rm-url">${esc(d.media.url || '（URL未設定）')}</span>
      <span class="rm-note">この画面では取得・表示しません（外部通信なし）。</span></div>`}
    <div class="rm-body">${d.blocks.map(previewBlock).join('')}</div>
    ${d.buttons.length ? `<div class="rm-keys">${d.buttons.map(row =>
      `<div class="rm-keyrow">${row.map(b => b.kind === 'pay'
        ? `<span class="rm-key rm-paykey">${esc(payLabel(b, state.catalog) || '（決済：未設定）')}<small>${esc(`決済：${PROVIDER_LABELS[b.provider] ?? '支払い方法未選択'}・商品 ${b.skuId || '未選択'}`)}</small></span>`
        : `<span class="rm-key">${esc(b.label || '（表示名なし）')}<small>${esc(b.kind === 'url' ? (b.url || 'URL未設定') : `callback: ${b.data || '未設定'}`)}</small></span>`).join('')}</div>`).join('')}</div>` : ''}
  </div>
  <h2>送信内容の内訳</h2>
  <div class="panel summary">${esc([`メソッド：${compiled.method ?? '（未確定）'}`, `parse_mode：HTML`,
    `文字数：${counted}`, `HTMLのバイト数：${compiled.stats.htmlBytes}`,
    `使うタグ：${compiled.stats.tags.join(' ') || 'なし'}`,
    `保護付き転送禁止：${d.options.protectContent === false ? 'いいえ' : 'はい'}`].join('\n'))}</div>
  ${compiled.errors.length ? `<div class="panel warn" role="alert"><strong>このままでは送れません</strong>
    <ul>${compiled.errors.map(code => `<li>${esc(describe(code, ERROR_TEXT))}</li>`).join('')}</ul></div>` : ''}
  ${compiled.warnings.length ? `<div class="panel"><strong>確認</strong>
    <ul>${compiled.warnings.map(code => `<li>${esc(describe(code, WARNING_TEXT))}</li>`).join('')}</ul></div>` : ''}
  <h2>生成されるHTML</h2>
  <pre class="rm-html">${esc(compiled.html)}</pre>
  ${state.sent ? `<p class="panel">モック送信しました（${esc(state.sent.method)}・実送信ではありません）。</p>` : ''}
  <nav class="navigation" aria-label="画面操作">
    <button class="primary" id="rmock"${compiled.ok ? '' : ' disabled'}>モックに送ってみる（実送信なし）</button>
    <button id="rsave">保存</button><button data-rpage="editor">編集に戻る</button></nav>`;
}

function draftsView(state) {
  const saved = state.saved ?? [];
  return `<h1>保存した下書き</h1>${badge()}
  <p class="intro">保存先はこの端末の中だけです（外部には出ません）。${saved.length} / 50 件。</p>
  ${state.error ? `<p class="panel warn" role="alert">${esc(describe(state.error, {too_many_drafts:'下書きが上限に達しています。古いものを削除してください。', storage_unavailable:'この端末では保存できませんでした（容量またはプライベートモード）。編集は続けられます。', not_found:'その下書きは見つかりませんでした。'}))}</p>` : ''}
  ${saved.length ? `<div class="options">${saved.map(d =>
    `<div class="option"><strong>${esc(d.title)}</strong>
      <span>ブロック${d.blocks.length}個・ボタン${d.buttons.flat().length}個・更新 ${esc(new Date(d.updatedAt).toISOString().slice(0, 16).replace('T', ' '))}</span>
      <span class="rm-rowactions"><button data-ropen="${esc(d.id)}">開く</button><button data-rdup="${esc(d.id)}">複製</button>
      <button class="danger" data-rddel="${esc(d.id)}">削除</button></span></div>`).join('')}</div>`
    : '<p class="intro">まだ保存した下書きはありません。</p>'}
  <nav class="navigation" aria-label="画面操作"><button data-rpage="templates">テンプレート</button><button data-rpage="editor">いまの編集に戻る</button></nav>`;
}

// One pay button: product (from the catalog) → payment method → label. The amount is shown,
// never typed here: it is edited on the SKU, so every button selling it stays in step.
function payView(state) {
  const button = currentPayButton(state);
  if (!button) return `<h1>決済ボタン</h1>${badge()}
  <p class="intro">編集する決済ボタンが選ばれていません。ボタン画面から「決済ボタンを足す」か「決済の設定を開く」を押してください。</p>
  <nav class="navigation" aria-label="画面操作"><button data-rpage="buttons">ボタン画面へ</button></nav>`;
  const skus = Object.entries(state.catalog?.skus ?? {});
  const sku = skuOf(state.catalog, button.skuId);
  const choices = providerChoices(state.catalog, button.skuId);
  const {row, col} = state.payTarget;
  const label = payLabel(button, state.catalog);
  return `<h1>決済ボタン</h1>${badge()}
  <p class="intro">${row + 1}行目${col + 1}番目のボタン。押されると、この商品の決済画面（Starsの請求書または外部の決済ページ）へ進みます。</p>
  <h2>1. 商品を選ぶ</h2>
  ${skus.length ? `<div class="options">${skus.map(([id, s]) => {
    const broken = skuProblems(s).length > 0;
    return `<button class="option" data-rpaysku="${esc(id)}" aria-pressed="${button.skuId === id}"><strong>${esc(s.title || id)}</strong>
      <span>${esc(broken ? '金額などが未設定' : `${formatPrice(s)}・${GOODS_LABELS[s.goodsKind]}${s.recurring ? '・継続課金' : ''}`)}</span></button>`;
  }).join('')}</div>` : '<p class="intro">カタログに商品がありません。</p>'}
  <button data-rpage="catalog">商品を追加・編集する（金額はここで変えます）</button>
  ${sku ? `<p class="panel">金額：<b>${esc(skuProblems(sku).length ? '未設定' : formatPrice(sku))}</b>（金額は商品カタログでのみ変更できます）</p>` : ''}
  <h2>2. 支払い方法を選ぶ</h2>
  ${sku ? `${sku.goodsKind === 'digital' ? `<p class="intro">デジタル商品・会員権はTelegram Starsでのみ販売できます（Telegram Bot Developer Terms §6.2）。</p>` : ''}
    <div class="options">${choices.map(c => `<button class="option" data-rpayprov="${esc(c.id)}" aria-pressed="${button.provider === c.id}"${c.enabled ? '' : ' disabled aria-disabled="true"'}>
      <strong>${esc(c.label)}</strong>${c.enabled ? '' : `<span class="rm-reason">${esc(c.reason)}</span>`}</button>`).join('')}</div>`
    : '<p class="intro">先に商品を選んでください。</p>'}
  <h2>3. 表示名</h2>
  <label class="rm-field"><span>空欄なら金額入りの表示名を使います（${LIMITS.buttonLabelChars.value}文字まで）</span>
    <input data-rlabel="${row}-${col}" type="text" value="${esc(button.label ?? '')}" placeholder="${esc(label)}" maxlength="${LIMITS.buttonLabelChars.value}"></label>
  <p class="intro">送られる表示名：<b>${esc(label || '（商品を選ぶと決まります）')}</b></p>
  <nav class="navigation" aria-label="画面操作"><button data-rpage="buttons">ボタン画面へ戻る</button><button class="primary" data-rpage="preview">プレビュー</button></nav>`;
}

const CURRENCY_LABELS = {XTR:'Telegram Stars（XTR）', JPY:'日本円（JPY）'};
function catalogView(state) {
  const skus = Object.entries(state.catalog?.skus ?? {});
  const id = state.skuSelected, sku = id ? skuOf(state.catalog, id) : null;
  const problems = sku ? skuProblems(sku) : [];
  const PROBLEM_TEXT = {sku_title_required:'商品名を入れてください。', sku_amount:`金額は1〜${groupDigits(AMOUNT_MAX)}の整数で入れてください。`,
    sku_currency:'通貨を選んでください。', sku_goods_kind:'商品の種類を選んでください。'};
  return `<h1>商品カタログ</h1>${badge()}
  <p class="intro">決済ボタンで売る商品です。金額はここでだけ変えられ、その商品を使うすべての決済ボタンに反映されます。</p>
  ${skus.length ? `<div class="options">${skus.map(([sid, s]) =>
    `<button class="option" data-rskusel="${esc(sid)}" aria-pressed="${sid === id}"><strong>${esc(s.title || sid)}</strong>
      <span>${esc(sid)}・${esc(skuProblems(s).length ? '未完成' : formatPrice(s))}</span></button>`).join('')}</div>` : '<p class="intro">まだ商品がありません。</p>'}
  <label class="rm-field"><span>新しい商品ID（英数字・_・- で32文字まで）</span><input id="rskunew" type="text" maxlength="32" pattern="[A-Za-z0-9_-]{1,32}"></label>
  <button id="rskuadd">商品を追加</button>
  ${sku ? `<h2>${esc(id)}</h2>
    <label class="rm-field"><span>商品名</span><input id="rskutitle" type="text" maxlength="64" value="${esc(sku.title ?? '')}"></label>
    <label class="rm-field"><span>金額（${esc(sku.currency === 'XTR' ? 'Stars' : '円')}・整数）</span>
      <input id="rskuamount" type="text" inputmode="numeric" value="${esc(sku.amount ?? '')}"></label>
    <p class="eyebrow">商品の種類</p>
    <div class="options">${GOODS_KINDS.map(g => `<button class="option" data-rskugoods="${g}" aria-pressed="${sku.goodsKind === g}"><strong>${esc(GOODS_LABELS[g])}</strong></button>`).join('')}</div>
    <p class="eyebrow">通貨</p>
    <div class="options">${CURRENCIES.map(c => `<button class="option" data-rskucur="${c}" aria-pressed="${sku.currency === c}"><strong>${esc(CURRENCY_LABELS[c])}</strong></button>`).join('')}</div>
    <p class="intro">デジタル商品・会員権は Stars（XTR）、役務・物販は日本円になります。片方を変えるともう片方も合わせて切り替わります。</p>
    ${problems.length ? `<div class="panel warn" role="alert"><ul>${problems.map(p => `<li>${esc(PROBLEM_TEXT[p] ?? p)}</li>`).join('')}</ul></div>` : ''}
    <button class="danger" data-rskudel="${esc(id)}">この商品を削除</button>` : ''}
  ${state.error ? `<p class="panel warn" role="alert">${esc(describe(state.error, CATALOG_ERRORS))}</p>` : ''}
  <nav class="navigation" aria-label="画面操作"><button data-rpage="pay">決済ボタンへ戻る</button><button data-rpage="editor">編集画面へ</button></nav>`;
}
export const CATALOG_ERRORS = {invalid_sku_id:'商品IDは英数字・_・- で32文字までです。', sku_exists:'同じIDの商品がすでにあります。',
  invalid_amount:`金額は1〜${groupDigits(AMOUNT_MAX)}の整数で入れてください。`, sku_in_use:'この商品を使っている決済ボタンがあるため削除できません。',
  provider_not_selectable:'その支払い方法はこの商品には使えません。', unknown_sku:'その商品はカタログにありません。'};

const RICH_VIEWS = {templates:templatesView, editor:editorView, blocks:blocksView,
  buttons:buttonsView, pay:payView, catalog:catalogView, preview:previewView, drafts:draftsView};

export function renderRich(state) {
  const view = RICH_VIEWS[state.page];
  if (!view) throw new Error('invalid_page');
  return view(state);
}
export {previewBlock};
