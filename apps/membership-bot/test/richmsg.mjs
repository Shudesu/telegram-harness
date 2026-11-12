// Rich messages with pay buttons. Pure modules only: no network, no Telegram, no DOM.
// Ported from 20261110/membership-implementation/tests/richmsg-{html,compose,editor}.test.mjs
// (the mock-send test is not ported: the Worker has no mock transport; renderForSend replaces it).
import assert from 'node:assert/strict';
import {escape, renderBlock, renderBlocks, visibleText, visibleLength, urlProblem, BLOCK_KINDS} from '../src/richmsg/html.mjs';
import {NAMED_ENTITIES, TAGS, DIVIDERS, UNSUPPORTED, unsupported, LIMITS} from '../src/richmsg/spec.mjs';
import {compile, emptyDraft, CALLBACK_DATA, renderForSend, parsePayCallback, describe, ERROR_TEXT} from '../src/richmsg/compose.mjs';
import {TEMPLATES, fromTemplate, templateById, DUMMY_GIF, TEMPLATE_PAY_SKU} from '../src/richmsg/templates.mjs';
import {initialRich, goRich, backRich, setField, addBlock, editBlock, removeBlock, moveBlock,
  addButton, editButton, removeButton, RICH_PAGES, OFFERED_BLOCKS, BLOCK_LABELS, richNext,
  addPayButton, openPayButton, choosePaySku, choosePayProvider, addSku, selectSku, editSku, removeSku,
  currentPayButton} from '../src/richmsg/rflow.mjs';
import {loadDrafts, saveDraft, duplicateDraft, deleteDraft, memoryStore, MAX_DRAFTS, KEY,
  loadCatalog, saveCatalog, CATALOG_KEY} from '../src/richmsg/drafts.mjs';
import {renderRich, esc, EDITOR_LABEL} from '../src/richmsg/rview.mjs';
import {payCallbackData, providerChoices, PAY_PROVIDERS, defaultPayLabel} from '../src/richmsg/pay.mjs';

const CHAT_A = -1009000000001; // synthetic TEST chat id
// Defined here on purpose: src/membership is written concurrently and is not imported.
const CATALOG = {
  skus: {
    member_monthly: {title:'会員グループ 月額', amount:500, currency:'XTR', goodsKind:'digital', recurring:true},
    seminar_seat: {title:'対面セミナー参加枠', amount:3000, currency:'JPY', goodsKind:'physical_service'},
    tshirt: {title:'Tシャツ', amount:12800, currency:'JPY', goodsKind:'physical_goods'},
    // Deliberately inconsistent rows, only reachable by hand-editing a catalog.
    odd_digital_jpy: {title:'変な行', amount:100, currency:'JPY', goodsKind:'digital'},
    odd_service_xtr: {title:'変な行2', amount:100, currency:'XTR', goodsKind:'physical_service'},
  },
  providers: [{id:'telegram_stars', configured:true}, {id:'stripe', configured:true},
    {id:'komoju', configured:false}, {id:'bank_gmo', configured:false}],
};
let n = 0; const failures = [];
function test(name, fn) {
  try { fn(); n++; } catch (error) { failures.push({name, error:String(error?.stack ?? error)}); }
}

// ---- ported: html ----

test('escaping uses only the four named entities Telegram supports', () => {
  assert.equal(escape('a & b < c > d "e"'), 'a &amp; b &lt; c &gt; d &quot;e&quot;');
  // &apos; is NOT a supported named entity, so an apostrophe must be left alone.
  assert.equal(escape("it's"), "it's");
  assert.ok(!escape(`'"&<>`).includes('&apos;'));
  assert.deepEqual(Object.keys(NAMED_ENTITIES), ['&', '<', '>', '"']);
});

test('text can never become markup', () => {
  const injected = renderBlock({kind:'text', text:'<b onclick="x">bold</b> & <script>alert(1)</script>'});
  assert.ok(!injected.includes('<b'));
  assert.ok(!injected.includes('<script'));
  assert.ok(injected.includes('&lt;script&gt;'));
  // Even inside a tag we do generate, the content is escaped.
  const quoted = renderBlock({kind:'quote', text:'</blockquote><b>out</b>'});
  assert.equal(quoted, '<blockquote>&lt;/blockquote&gt;&lt;b&gt;out&lt;/b&gt;</blockquote>');
});

test('each block renders to the tag subset we claim to use', () => {
  const cases = {
    heading: ['<b>見出し</b>', {text:'見出し'}],
    bold: ['<b>太</b>', {text:'太'}],
    italic: ['<i>斜</i>', {text:'斜'}],
    underline: ['<u>下</u>', {text:'下'}],
    strike: ['<s>消</s>', {text:'消'}],
    spoiler: ['<tg-spoiler>秘</tg-spoiler>', {text:'秘'}],
    code: ['<code>x</code>', {text:'x'}],
    pre: ['<pre>x</pre>', {text:'x'}],
    quote: ['<blockquote>引</blockquote>', {text:'引'}],
    quote_expandable: ['<blockquote expandable>引</blockquote>', {text:'引'}],
    text: ['本文', {text:'本文'}],
    spacer: ['', {}],
  };
  for (const [kind, [expected, extra]] of Object.entries(cases)) {
    assert.equal(renderBlock({kind, ...extra}), expected, kind);
  }
  assert.equal(renderBlock({kind:'list', text:'一\n二'}), '・一\n・二');
  assert.equal(renderBlock({kind:'numbered', text:'一\n二'}), '1. 一\n2. 二');
  assert.equal(renderBlock({kind:'divider', style:'dots'}), DIVIDERS.dots);
  assert.equal(renderBlock({kind:'divider'}), DIVIDERS.line); // default, never undefined
  // Only tags from the declared subset ever appear.
  const html = renderBlocks(Object.entries(cases).map(([kind, [, extra]]) => ({kind, ...extra})));
  for (const tag of html.match(/<\/?([a-z-]+)/g) ?? []) {
    assert.ok(TAGS.includes(tag.replace(/<\/?/, '')), `${tag} is outside the declared subset`);
  }
  assert.throws(() => renderBlock({kind:'marquee', text:'x'}), /invalid_block_kind/);
});

test('a link needs a usable https URL and escapes both parts', () => {
  assert.equal(renderBlock({kind:'link', text:'案内', href:'https://example.invalid/a?b=1&c=2'}),
    '<a href="https://example.invalid/a?b=1&amp;c=2">案内</a>');
  // No label falls back to the URL rather than rendering an empty tappable gap.
  assert.ok(renderBlock({kind:'link', href:'https://example.invalid/'}).includes('>https://example.invalid/<'));
  for (const [href, problem] of [['', 'url_required'], ['notaurl', 'url_malformed'],
    ['http://example.invalid/', 'url_not_https'], ['javascript:alert(1)', 'url_not_https'],
    ['https://u:p@example.invalid/', 'url_has_credentials'], ['https://x/', 'url_bad_host'],
    [`https://example.invalid/${'a'.repeat(2100)}`, 'url_too_long']]) {
    assert.equal(urlProblem(href), problem, href.slice(0, 30));
    assert.throws(() => renderBlock({kind:'link', text:'x', href}), new RegExp(problem));
  }
  assert.equal(urlProblem('data:text/html,<b>x</b>'), 'url_not_https');
});

test('the visible length counts what the reader sees, not the markup', () => {
  const html = renderBlocks([{kind:'heading', text:'見出し'}, {kind:'link', text:'リンク', href:'https://example.invalid/'}]);
  assert.ok(html.length > 30);
  assert.equal(visibleText(html), '見出し\nリンク');
  assert.equal(visibleLength(html), 7);
  // Escaped characters count once, as the single character they are.
  assert.equal(visibleLength(renderBlock({kind:'text', text:'a&b<c'})), 5);
  assert.equal(visibleText(renderBlock({kind:'text', text:'&amp;'})), '&amp;'); // not double-unescaped
  // An emoji is two UTF-16 code units, which is how Telegram counts offsets.
  assert.equal(visibleLength(renderBlock({kind:'text', text:'📌'})), 2);
});

test('the unsupported list names what we refuse to fake, with a reason', () => {
  for (const id of ['rich_html', 'send_widget', 'custom_emoji', 'heading_tag', 'divider_tag']) {
    const entry = unsupported(id);
    assert.ok(entry, id);
    assert.ok(entry.reason.length > 20, `${id} needs a real reason`);
  }
  assert.equal(unsupported('nope'), null);
  // Nothing in the emitted subset depends on an entitlement we could not verify.
  assert.ok(!TAGS.includes('tg-emoji'));
  assert.ok(UNSUPPORTED.some(u => u.id === 'custom_emoji'));
  assert.deepEqual(BLOCK_KINDS.filter(k => k.includes('emoji')), []);
});

// ---- ported: compose ----

const draft = (over = {}) => emptyDraft({blocks:[{kind:'text', text:'本文'}], ...over});
const gif = (over = {}) => draft({media:{kind:'animation', url:DUMMY_GIF, note:''}, ...over});

test('a text-only draft compiles to sendMessage with HTML and forward protection', () => {
  const compiled = compile(draft(), {chatId:CHAT_A});
  assert.equal(compiled.ok, true);
  assert.equal(compiled.method, 'sendMessage');
  assert.equal(compiled.params.parse_mode, 'HTML');
  assert.equal(compiled.params.text, '本文');
  assert.equal(compiled.params.protect_content, true);
  assert.equal(compiled.params.chat_id, CHAT_A);
  assert.equal(compiled.params.reply_markup, undefined); // no buttons, no empty keyboard
  assert.equal(compiled.stats.limit, LIMITS.text.value);
});

test('a GIF-led draft compiles to sendAnimation with the caption limit', () => {
  const compiled = compile(gif(), {chatId:CHAT_A});
  assert.equal(compiled.method, 'sendAnimation');
  assert.equal(compiled.params.animation, DUMMY_GIF);
  assert.equal(compiled.params.caption, '本文');
  assert.equal(compiled.params.text, undefined);
  assert.equal(compiled.stats.limit, LIMITS.caption.value);
  assert.equal(compiled.stats.asCaption, true);
  // We never fetch the URL, and the compile result says so rather than implying a check.
  assert.ok(compiled.warnings.includes('media_not_fetched'));
  assert.equal(compile(draft({media:{kind:'photo', url:DUMMY_GIF}}), {chatId:CHAT_A}).method, 'sendPhoto');
});

test('the caption limit is enforced on visible text, not on the markup', () => {
  const long = 'あ'.repeat(LIMITS.caption.value);
  assert.equal(compile(gif({blocks:[{kind:'text', text:long}]}), {chatId:CHAT_A}).ok, true);
  const over = compile(gif({blocks:[{kind:'text', text:long + 'あ'}]}), {chatId:CHAT_A});
  assert.equal(over.ok, false);
  assert.ok(over.errors.includes('caption_too_long'));
  assert.ok(over.warnings.includes('split_media_and_text'));
  // The same text is fine as a message, where the limit is 4096.
  assert.equal(compile(draft({blocks:[{kind:'text', text:long + 'あ'}]}), {chatId:CHAT_A}).ok, true);
  // Heavy markup does not count against the limit.
  const decorated = compile(gif({blocks:Array.from({length:50}, () => ({kind:'bold', text:'あ'.repeat(19)}))}), {chatId:CHAT_A});
  assert.ok(decorated.stats.htmlBytes > decorated.stats.visible);
  assert.equal(decorated.ok, true);
  assert.ok(decorated.warnings.includes('close_to_limit'));
});

test('an empty or decoration-only draft is refused', () => {
  assert.ok(compile(emptyDraft(), {chatId:CHAT_A}).errors.includes('blocks_required'));
  for (const blocks of [[{kind:'spacer'}, {kind:'spacer'}], [{kind:'divider', style:'line'}],
    [{kind:'text', text:'   '}, {kind:'divider'}]]) {
    assert.ok(compile(draft({blocks}), {chatId:CHAT_A}).errors.includes('nothing_to_say'), JSON.stringify(blocks));
  }
  // One real word plus decoration is fine.
  assert.equal(compile(draft({blocks:[{kind:'divider'}, {kind:'text', text:'本文'}]}), {chatId:CHAT_A}).ok, true);
  assert.equal(compile(draft(), {}).errors.includes('chat_id_required'), true);
});

test('buttons are validated row by row, with both kinds checked', () => {
  const ok = compile(draft({buttons:[[{kind:'url', label:'見る', url:'https://example.invalid/a'}],
    [{kind:'callback', label:'あとで', data:'richmsg/remind/later'}]]}), {chatId:CHAT_A});
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.params.reply_markup.inline_keyboard, [
    [{text:'見る', url:'https://example.invalid/a'}],
    [{text:'あとで', callback_data:'richmsg/remind/later'}],
  ]);
  const bad = compile(draft({buttons:[
    [{kind:'url', label:'', url:'http://example.invalid/'}],
    [{kind:'callback', label:'x', data:'a'.repeat(65)}],
    [{kind:'callback', label:'y', data:'has spaces'}],
    [{kind:'nonsense', label:'z'}],
    'not-a-row',
  ]}), {chatId:CHAT_A});
  assert.ok(bad.errors.includes('button_0_0_label_required'));
  assert.ok(bad.errors.includes('button_0_0_url_not_https'));
  assert.ok(bad.errors.includes('button_1_0_callback_data'));
  assert.ok(bad.errors.includes('button_2_0_callback_data'));
  assert.ok(bad.errors.includes('button_3_0_kind'));
  assert.ok(bad.errors.includes('row_4_malformed'));
  // Our own caps on shape.
  const wide = compile(draft({buttons:[Array.from({length:4}, () => ({kind:'callback', label:'a', data:'x/y'}))]}), {chatId:CHAT_A});
  assert.ok(wide.errors.includes('row_0_too_wide'));
  const tall = compile(draft({buttons:Array.from({length:9}, () => [{kind:'callback', label:'a', data:'x/y'}])}), {chatId:CHAT_A});
  assert.ok(tall.errors.includes('too_many_button_rows'));
  assert.ok(CALLBACK_DATA.test('richmsg/open/12'));
});

test('every shipped template compiles and reads as an unfinished draft', () => {
  for (const template of TEMPLATES) {
    const compiled = compile(template, {chatId:CHAT_A, catalog:CATALOG});
    assert.equal(compiled.ok, true, `${template.templateId}: ${compiled.errors.join(',')}`);
    assert.ok(compiled.stats.visible > 0, template.templateId);
    assert.ok(compiled.stats.visible <= compiled.stats.limit, template.templateId);
    // Dummy media is obviously non-resolving, and no third-party media host appears.
    if (template.media.kind !== 'none') assert.match(template.media.url, /^https:\/\/example\.invalid\//);
  }
  // Placeholders are visible as placeholders.
  assert.ok(TEMPLATES.some(t => JSON.stringify(t).includes('（ここに')));
  // A template is copied, never handed out by reference.
  const copy = fromTemplate('membership-open');
  copy.blocks[0].text = 'edited';
  assert.notEqual(templateById('membership-open').blocks[0].text, 'edited');
  assert.equal(fromTemplate('nope'), null);
});

// A draft can also arrive from this device's storage, written by an older version of the
// editor or edited by hand. Missing keys have to come back as a verdict, not as a throw.
test('a draft with keys missing is refused, not crashed on', () => {
  // Blocks are the only part a draft cannot do without; the rest may be absent.
  for (const sparse of [{title:'t', media:{kind:'none'}, blocks:[{kind:'text', text:'本文'}], options:{}},
    {blocks:[{kind:'text', text:'本文'}]}]) {
    const compiled = compile(sparse, {chatId:CHAT_A});
    assert.equal(compiled.ok, true);
    assert.equal(compiled.params.reply_markup, undefined); // no buttons key, no empty keyboard
    assert.equal(compiled.params.text, '本文');
  }
  for (const bad of [{}, {blocks:'x', buttons:'y'}, null]) {
    const compiled = compile(bad, {chatId:CHAT_A});
    assert.equal(compiled.ok, false);
    assert.ok(compiled.errors.length > 0);
  }
});

test('the tag breakdown names only the tags actually emitted', () => {
  // `<blockquote>` must not be read as `<b>`: the preview panel reports this list verbatim.
  const quoted = compile(draft({blocks:[{kind:'quote', text:'引用だけ'}]}), {chatId:CHAT_A});
  assert.deepEqual(quoted.stats.tags, ['blockquote']);
  const expandable = compile(draft({blocks:[{kind:'quote_expandable', text:'引用'}]}), {chatId:CHAT_A});
  assert.deepEqual(expandable.stats.tags, ['blockquote']);
  assert.deepEqual(compile(draft({blocks:[{kind:'bold', text:'太字'}]}), {chatId:CHAT_A}).stats.tags, ['b']);
  const linked = compile(draft({blocks:[{kind:'link', text:'見る', href:'https://example.invalid/a'}]}), {chatId:CHAT_A});
  assert.deepEqual(linked.stats.tags, ['a']);
  assert.deepEqual(compile(draft({blocks:[{kind:'text', text:'素の文'}]}), {chatId:CHAT_A}).stats.tags, []);
});

// ---- ported: editor ----

const NOW = Date.parse('2026-11-10T12:00:00+09:00');
const started = () => initialRich(fromTemplate('membership-open'));

test('the editor builds a draft block by block and keeps the order editable', () => {
  let state = initialRich();
  state = addBlock(state, 'heading');
  state = editBlock(state, 0, {text:'見出し'});
  state = addBlock(state, 'text');
  state = editBlock(state, 1, {text:'本文'});
  state = addBlock(state, 'divider');
  assert.deepEqual(state.draft.blocks.map(b => b.kind), ['heading', 'text', 'divider']);
  assert.equal(state.draft.blocks[2].style, 'line'); // a divider always has a style
  state = moveBlock(state, 2, -2);
  assert.deepEqual(state.draft.blocks.map(b => b.kind), ['divider', 'heading', 'text']);
  assert.equal(moveBlock(state, 0, -1), state); // out of range is a no-op, not a throw
  state = removeBlock(state, 0);
  assert.deepEqual(state.draft.blocks.map(b => b.kind), ['heading', 'text']);
  assert.equal(state.dirty, true);
  assert.throws(() => addBlock(state, 'marquee'), /invalid_block_kind/);
  assert.throws(() => removeBlock(state, 9), /no_such_block/);
  assert.throws(() => editBlock(state, 9, {text:'x'}), /no_such_block/);
});

test('editing never mutates the state it was handed', () => {
  const state = started();
  const before = structuredClone(state.draft);
  addBlock(state, 'text');
  editBlock(state, 0, {text:'changed'});
  setField(state, 'title', 'changed');
  removeBlock(state, 0);
  assert.deepEqual(state.draft, before);
});

test('media fields and the title are bounded and trimmed', () => {
  let state = initialRich();
  state = setField(state, 'title', 'あ'.repeat(200));
  assert.equal(state.draft.title.length, 80);
  state = setField(state, 'mediaKind', 'animation');
  state = setField(state, 'mediaUrl', `  ${DUMMY_GIF}  `);
  assert.equal(state.draft.media.url, DUMMY_GIF);
  // Dropping the media clears the URL, so a stale URL cannot be sent later.
  state = setField(state, 'mediaKind', 'none');
  assert.equal(state.draft.media.url, '');
  assert.throws(() => setField(state, 'nope', 1), /invalid_field/);
});

test('switching a button kind drops the other kind\'s field', () => {
  let state = initialRich();
  state = addButton(state);
  state = editButton(state, 0, 0, {label:'見る', url:'https://example.invalid/a'});
  state = editButton(state, 0, 0, {kind:'callback'});
  assert.equal(state.draft.buttons[0][0].url, undefined);
  assert.equal(state.draft.buttons[0][0].data, '');
  state = editButton(state, 0, 0, {data:'richmsg/x/1'});
  state = editButton(state, 0, 0, {kind:'url'});
  assert.equal(state.draft.buttons[0][0].data, undefined);
  // Adding to a row, then emptying it, removes the row itself.
  state = addButton(state, 0);
  assert.equal(state.draft.buttons[0].length, 2);
  state = removeButton(state, 0, 1);
  state = removeButton(state, 0, 0);
  assert.deepEqual(state.draft.buttons, []);
  assert.throws(() => removeButton(state, 0, 0), /no_such_button/);
});

test('drafts save, reload, duplicate and delete, all on this device', () => {
  const store = memoryStore();
  const first = saveDraft(store, emptyDraft({title:'一つ目', blocks:[{kind:'text', text:'a'}]}), NOW);
  assert.equal(first.ok, true);
  assert.equal(first.draft.id, 'draft-001');
  assert.equal(first.draft.updatedAt, NOW);
  // Saving the same draft again updates it instead of adding a row.
  const again = saveDraft(store, {...first.draft, title:'一つ目（改）'}, NOW + 1000);
  assert.equal(again.drafts.length, 1);
  assert.equal(again.draft.createdAt, NOW);
  assert.equal(again.draft.updatedAt, NOW + 1000);
  const copy = duplicateDraft(store, 'draft-001', NOW + 2000);
  assert.equal(copy.ok, true);
  assert.equal(copy.draft.id, 'draft-002');
  assert.match(copy.draft.title, /（複製）$/);
  // The copy is independent.
  saveDraft(store, {...copy.draft, blocks:[{kind:'text', text:'b'}]}, NOW + 3000);
  assert.equal(loadDrafts(store).find(d => d.id === 'draft-001').blocks[0].text, 'a');
  assert.equal(deleteDraft(store, 'draft-001').ok, true);
  assert.deepEqual(loadDrafts(store).map(d => d.id), ['draft-002']);
  assert.equal(deleteDraft(store, 'draft-001').error, 'not_found');
  assert.equal(duplicateDraft(store, 'nope', NOW).error, 'not_found');
});

test('storage that is broken or full degrades without losing the editor', () => {
  const corrupt = {getItem:() => '{not json', setItem:() => {}};
  assert.deepEqual(loadDrafts(corrupt), []);
  const notArray = {getItem:() => '{"a":1}', setItem:() => {}};
  assert.deepEqual(loadDrafts(notArray), []);
  const readOnly = {getItem:() => '[]', setItem:() => { throw new Error('QuotaExceededError'); }};
  assert.deepEqual(saveDraft(readOnly, emptyDraft(), NOW), {ok:false, error:'storage_unavailable', drafts:[]});
  // The cap is enforced instead of growing forever.
  const full = {getItem:() => JSON.stringify(Array.from({length:MAX_DRAFTS}, (_, i) => ({...emptyDraft(), id:`draft-${i}`}))), setItem:() => {}};
  assert.equal(saveDraft(full, emptyDraft(), NOW).error, 'too_many_drafts');
  assert.equal(KEY, 'richmsg.drafts.v1');
  // Rows the list and the preview would read straight into (`blocks.length`,
  // `buttons.flat()`) are skipped rather than allowed to take the screen down.
  const halfWritten = {getItem:() => JSON.stringify([
    {id:'draft-001', title:'古い形', blocks:[{kind:'text', text:'a'}]},
    {id:'draft-002', title:'壊れた形', blocks:'nope', buttons:'nope'},
    {...emptyDraft({title:'正しい形', blocks:[{kind:'text', text:'a'}]}), id:'draft-003'},
  ]), setItem:() => {}};
  assert.deepEqual(loadDrafts(halfWritten).map(d => d.id), ['draft-003']);
});

test('every editor screen renders and carries the TEST label', () => {
  const state = {...started(), saved:[{...emptyDraft({title:'保存済み', blocks:[{kind:'text', text:'a'}]}), id:'draft-001', updatedAt:NOW}]};
  for (const page of RICH_PAGES) {
    const html = renderRich({...state, page, selected:0});
    assert.ok(html.includes(esc(EDITOR_LABEL)), `${page} is missing the TEST label`);
    assert.ok(html.includes('<h1>'), page);
  }
  assert.throws(() => renderRich({...state, page:'nope'}), /invalid_page/);
  assert.deepEqual(goRich(state, 'editor').stack, ['templates']);
  assert.equal(backRich(goRich(state, 'editor')).page, 'templates');
  assert.throws(() => goRich(state, 'nope'), /invalid_page/);
});

test('the preview states that it is not a Telegram mock-up and shows the real figures', () => {
  const state = started();
  const html = renderRich({...state, page:'preview'});
  assert.ok(html.includes('Telegramの画面の再現ではありません'));
  assert.ok(html.includes('メソッド：sendAnimation'));
  assert.ok(html.includes('parse_mode：HTML'));
  const compiled = compile(state.draft, {chatId:CHAT_A});
  assert.ok(html.includes(`${compiled.stats.visible} / ${compiled.stats.limit}`));
  assert.ok(html.includes('UTF-16単位'));
  // The generated HTML is shown as text, escaped, not interpreted.
  assert.ok(html.includes('&lt;b&gt;'));
  // The media URL is printed, never loaded.
  assert.ok(html.includes(esc(DUMMY_GIF)));
  assert.ok(html.includes('外部通信なし'));
  assert.ok(!html.includes(`<img`));
  assert.ok(!html.includes(`src="${DUMMY_GIF}`));
});

test('the preview refuses to offer a mock send for a draft that cannot be sent', () => {
  const broken = {...initialRich(emptyDraft({blocks:[{kind:'link', text:'x', href:'http://example.invalid/'}]})), page:'preview'};
  const html = renderRich(broken);
  assert.match(html, /id="rmock" disabled/);
  assert.ok(html.includes('このままでは送れません'));
  const fine = renderRich({...started(), page:'preview'});
  assert.ok(!/id="rmock" disabled/.test(fine));
});

test('user text in a draft is escaped everywhere it is displayed', () => {
  const nasty = '<img src=x onerror=alert(1)>';
  const state = initialRich(emptyDraft({title:nasty, media:{kind:'animation', url:`https://example.invalid/${nasty}`},
    blocks:[{kind:'text', text:nasty}], buttons:[[{kind:'url', label:nasty, url:'https://example.invalid/a'}]]}));
  for (const page of ['editor', 'blocks', 'buttons', 'preview']) {
    const html = renderRich({...state, page, selected:0});
    assert.ok(!html.includes('<img src=x'), page);
    assert.ok(html.includes('&lt;img src=x'), page);
  }
});

test('the next-one-thing line follows the editor', () => {
  assert.equal(richNext(initialRich()).page, 'blocks');
  assert.equal(richNext(started()).page, 'preview'); // never saved, so review comes first
  const saved = {...started(), dirty:false, draft:{...started().draft, id:'draft-001'}};
  assert.equal(richNext(saved).page, 'drafts');
  assert.equal(richNext({...saved, dirty:true}).page, 'preview');
  for (const kind of OFFERED_BLOCKS) assert.ok(BLOCK_LABELS[kind], `${kind} needs a Japanese label`);
});

// ---- pay buttons ----
const payDraft = (button, over = {}) => emptyDraft({blocks:[{kind:'text', text:'本文'}], buttons:[[{kind:'pay', label:'', ...button}]], ...over});
const payErrors = (button, catalog = CATALOG) => compile(payDraft(button), {chatId:CHAT_A, catalog}).errors;

test('a Stars pay button compiles to a pay/ callback with a price-bearing default label', () => {
  const compiled = compile(payDraft({skuId:'member_monthly', provider:'telegram_stars'}), {chatId:CHAT_A, catalog:CATALOG});
  assert.equal(compiled.ok, true, compiled.errors.join(','));
  assert.deepEqual(compiled.params.reply_markup.inline_keyboard,
    [[{text:'⭐ 500 Starsで支払う', callback_data:'pay/member_monthly/telegram_stars'}]]);
});

test('a JPY pay button via Stripe compiles, label shows yen with grouping; own label wins', () => {
  const compiled = compile(payDraft({skuId:'seminar_seat', provider:'stripe'}), {chatId:CHAT_A, catalog:CATALOG});
  assert.equal(compiled.ok, true, compiled.errors.join(','));
  assert.deepEqual(compiled.params.reply_markup.inline_keyboard[0][0], {text:'💳 ¥3,000 を支払う', callback_data:'pay/seminar_seat/stripe'});
  assert.equal(defaultPayLabel(CATALOG.skus.tshirt), '💳 ¥12,800 を支払う');
  const own = compile(payDraft({skuId:'seminar_seat', provider:'stripe', label:'申し込む'}), {chatId:CHAT_A, catalog:CATALOG});
  assert.equal(own.params.reply_markup.inline_keyboard[0][0].text, '申し込む');
  // Pay buttons mix with the other kinds in one keyboard.
  const mixed = compile(emptyDraft({blocks:[{kind:'text', text:'本文'}], buttons:[
    [{kind:'pay', label:'', skuId:'member_monthly', provider:'telegram_stars'}, {kind:'url', label:'詳細', url:'https://example.invalid/a'}]]}),
  {chatId:CHAT_A, catalog:CATALOG});
  assert.equal(mixed.ok, true);
  assert.equal(mixed.params.reply_markup.inline_keyboard[0][1].url, 'https://example.invalid/a');
});

test('compile rejects unknown sku, disabled provider, goods-rule and currency violations', () => {
  assert.deepEqual(payErrors({skuId:'nope', provider:'telegram_stars'}), ['button_0_0_unknown_sku']);
  // No catalog at all behaves like an empty one.
  assert.deepEqual(compile(payDraft({skuId:'member_monthly', provider:'telegram_stars'}), {chatId:CHAT_A}).errors, ['button_0_0_unknown_sku']);
  assert.deepEqual(payErrors({skuId:'seminar_seat', provider:'komoju'}), ['button_0_0_provider_disabled']);
  // Digital goods (a membership) may only be sold for Stars — Telegram Bot Developer Terms §6.2.
  assert.ok(payErrors({skuId:'member_monthly', provider:'stripe'}).includes('button_0_0_digital_requires_stars'));
  assert.ok(payErrors({skuId:'seminar_seat', provider:'telegram_stars'}).includes('button_0_0_stars_only_digital'));
  assert.ok(payErrors({skuId:'tshirt', provider:'telegram_stars'}).includes('button_0_0_stars_only_digital'));
  // Currency mismatches, isolated from the goods rule by the hand-made inconsistent rows.
  assert.deepEqual(payErrors({skuId:'odd_digital_jpy', provider:'telegram_stars'}), ['button_0_0_currency_mismatch']);
  assert.deepEqual(payErrors({skuId:'odd_service_xtr', provider:'stripe'}), ['button_0_0_currency_mismatch']);
  // Shape errors.
  assert.deepEqual(payErrors({skuId:'has space', provider:'telegram_stars'}), ['button_0_0_sku_id']);
  assert.deepEqual(payErrors({skuId:'x'.repeat(33), provider:'telegram_stars'}), ['button_0_0_sku_id']);
  assert.deepEqual(payErrors({skuId:'member_monthly', provider:'paypal'}), ['button_0_0_provider']);
  assert.deepEqual(payErrors({skuId:'member_monthly', provider:''}), ['button_0_0_provider']);
  // A provider missing from the providers list is not configured.
  assert.deepEqual(payErrors({skuId:'member_monthly', provider:'telegram_stars'}, {skus:CATALOG.skus, providers:[]}),
    ['button_0_0_provider_disabled']);
  // A SKU with no price set is refused, not sent with a blank label.
  const unpriced = {skus:{x:{title:'x', amount:null, currency:'XTR', goodsKind:'digital'}}, providers:CATALOG.providers};
  assert.deepEqual(payErrors({skuId:'x', provider:'telegram_stars'}, unpriced), ['button_0_0_sku_amount']);
  // Prototype keys are not SKUs.
  assert.deepEqual(payErrors({skuId:'constructor', provider:'telegram_stars'}), ['button_0_0_unknown_sku']);
  // Errors are described in Japanese with the button position.
  assert.match(describe('button_0_0_digital_requires_stars', ERROR_TEXT), /1行目1番目.*Telegram Stars/);
});

test('a hand-typed pay/ callback on a plain callback button is refused', () => {
  const compiled = compile(emptyDraft({blocks:[{kind:'text', text:'本文'}],
    buttons:[[{kind:'callback', label:'買う', data:'pay/member_monthly/stripe'}]]}), {chatId:CHAT_A, catalog:CATALOG});
  assert.deepEqual(compiled.errors, ['button_0_0_callback_reserved']);
});

test('callback data round-trips through parsePayCallback, which is strict', () => {
  for (const provider of PAY_PROVIDERS) {
    const data = payCallbackData('A_b-9', provider);
    assert.ok(new TextEncoder().encode(data).length <= 64);
    assert.deepEqual(parsePayCallback(data), {skuId:'A_b-9', provider});
  }
  const longest = payCallbackData('x'.repeat(32), 'telegram_stars');
  assert.deepEqual(parsePayCallback(longest), {skuId:'x'.repeat(32), provider:'telegram_stars'});
  // The callback_data of a compiled message parses back to the button's sku/provider.
  const {params} = renderForSend(payDraft({skuId:'seminar_seat', provider:'stripe'}), {chatId:CHAT_A, catalog:CATALOG});
  assert.deepEqual(parsePayCallback(params.reply_markup.inline_keyboard[0][0].callback_data), {skuId:'seminar_seat', provider:'stripe'});
  for (const bad of [null, undefined, 42, '', 'pay', 'pay/', 'pay/x', 'pay//stripe', 'pay/x/paypal', 'pay/x/stripe/', 'pay/x/stripe/extra',
    'PAY/x/stripe', ' pay/x/stripe', 'pay/x/stripe ', 'pay/x y/stripe', 'pay/ｘ/stripe', `pay/${'x'.repeat(33)}/stripe`,
    'pay/x/Stripe', 'pay/x/stripe\n', 'richmsg/remind/later', 'pay/x/__proto__']) {
    assert.equal(parsePayCallback(bad), null, String(bad));
  }
  assert.throws(() => payCallbackData('bad id', 'stripe'), /invalid_sku_id/);
  assert.throws(() => payCallbackData('x', 'paypal'), /invalid_provider/);
});

test('renderForSend returns the exact Bot API call, or throws with every error', () => {
  const template = fromTemplate('membership-pay');
  const call = renderForSend(template, {chatId:CHAT_A, catalog:CATALOG});
  assert.deepEqual(Object.keys(call).sort(), ['method', 'params']);
  assert.equal(call.method, 'sendAnimation');
  assert.equal(call.params.chat_id, CHAT_A);
  assert.equal(call.params.animation, DUMMY_GIF);
  assert.equal(call.params.parse_mode, 'HTML');
  assert.ok(call.params.caption.includes('<b>会員グループに参加しませんか</b>'));
  assert.deepEqual(call.params.reply_markup, {inline_keyboard:[[{text:'⭐ 500 Starsで支払う', callback_data:'pay/member_monthly/telegram_stars'}]]});
  assert.equal(renderForSend(emptyDraft({blocks:[{kind:'text', text:'x'}]}), {chatId:CHAT_A}).method, 'sendMessage');
  assert.equal(renderForSend(emptyDraft({blocks:[{kind:'text', text:'x'}], media:{kind:'photo', url:DUMMY_GIF}}), {chatId:CHAT_A}).method, 'sendPhoto');
  try { renderForSend(template, {chatId:CHAT_A}); assert.fail('should throw'); }
  catch (error) { assert.deepEqual(error.errors, ['button_0_0_unknown_sku']); assert.match(error.message, /^richmsg_invalid/); }
});

test('the pay template exists, compiles against the catalog and keeps the price out of the copy', () => {
  const template = templateById('membership-pay');
  assert.equal(template.title, '会員募集（決済ボタン付き）');
  assert.equal(template.media.kind, 'animation');
  assert.match(template.media.url, /^https:\/\/example\.invalid\//);
  assert.ok(template.blocks.some(b => b.kind === 'heading') && template.blocks.some(b => b.kind === 'divider'));
  assert.deepEqual(template.buttons.flat().map(b => b.kind), ['pay']);
  assert.equal(template.buttons[0][0].skuId, TEMPLATE_PAY_SKU);
  assert.equal(compile(template, {chatId:CHAT_A, catalog:CATALOG}).ok, true);
  assert.ok(!JSON.stringify(template.blocks).includes('500')); // the price lives only on the SKU
});

test('editor: add a pay button, choose sku then provider, preview shows it', () => {
  let state = initialRich(emptyDraft({blocks:[{kind:'text', text:'本文'}]}), {catalog:CATALOG});
  state = addPayButton(state);
  assert.deepEqual(state.payTarget, {row:0, col:0});
  assert.deepEqual(currentPayButton(state), {kind:'pay', label:'', skuId:'', provider:''});
  state = goRich(state, 'pay');
  let html = renderRich(state);
  assert.ok(html.includes('data-rpaysku="seminar_seat"') && html.includes('data-rpaysku="member_monthly"'));
  assert.ok(html.includes('先に商品を選んでください'));
  assert.throws(() => choosePayProvider(state, 'stripe'), /choose_sku_first/);
  state = choosePaySku(state, 'seminar_seat');
  assert.equal(currentPayButton(state).provider, 'stripe'); // the only usable method is picked
  html = renderRich(state);
  assert.ok(html.includes('¥3,000'));
  assert.ok(html.includes('金額は商品カタログでのみ変更できます'));
  assert.ok(html.includes('💳 ¥3,000 を支払う')); // the label that will be sent
  // Change the label, then preview and compile.
  state = editButton(state, 0, 0, {label:'セミナーに申し込む'});
  const preview = renderRich(goRich(state, 'preview'));
  assert.ok(preview.includes('セミナーに申し込む') && preview.includes('クレジットカード（Stripe）'));
  assert.ok(!/id="rmock" disabled/.test(preview));
  assert.equal(compile(state.draft, {chatId:CHAT_A, catalog:state.catalog}).params.reply_markup.inline_keyboard[0][0].callback_data,
    'pay/seminar_seat/stripe');
  assert.throws(() => choosePaySku(state, 'nope'), /unknown_sku/);
  // A pay button added to an existing row becomes the target.
  const second = addPayButton(state, 0);
  assert.deepEqual(second.payTarget, {row:0, col:1});
  assert.deepEqual(openPayButton(second, 0, 0).payTarget, {row:0, col:0});
  assert.throws(() => openPayButton(addButton(state), 1, 0), /no_such_pay_button/);
  // Removing a button forgets the target, since positions shift.
  assert.equal(removeButton(second, 0, 0).payTarget, null);
  assert.ok(renderRich(goRich(removeButton(second, 0, 0), 'pay')).includes('編集する決済ボタンが選ばれていません'));
});

test('editor: unconfigured methods are shown disabled with 未設定のため無効 and cannot be chosen', () => {
  let state = goRich(addPayButton(initialRich(emptyDraft({blocks:[{kind:'text', text:'本文'}]}), {catalog:CATALOG})), 'pay');
  state = choosePaySku(state, 'tshirt');
  const html = renderRich(state);
  for (const id of ['komoju', 'bank_gmo']) {
    assert.match(html, new RegExp(`data-rpayprov="${id}"[^>]* disabled aria-disabled="true">[\\s\\S]*?未設定のため無効`));
    assert.throws(() => choosePayProvider(state, id), /provider_not_selectable/);
  }
  assert.match(html, /data-rpayprov="stripe" aria-pressed="true">/); // enabled and selected
  const choices = providerChoices(CATALOG, 'tshirt');
  assert.deepEqual(choices.filter(c => c.enabled).map(c => c.id), ['stripe']);
  assert.equal(choices.find(c => c.id === 'komoju').reason, '未設定のため無効');
});

test('editor: a digital product can only take Stars; switching product resets an invalid method', () => {
  let state = goRich(addPayButton(initialRich(emptyDraft({blocks:[{kind:'text', text:'本文'}]}), {catalog:CATALOG})), 'pay');
  state = choosePaySku(state, 'seminar_seat');
  assert.equal(currentPayButton(state).provider, 'stripe');
  state = choosePaySku(state, 'member_monthly');
  assert.equal(currentPayButton(state).provider, 'telegram_stars'); // stripe is not allowed for digital
  const html = renderRich(state);
  assert.ok(html.includes('Telegram Bot Developer Terms §6.2'));
  assert.match(html, /data-rpayprov="telegram_stars" aria-pressed="true">/);
  assert.match(html, /data-rpayprov="stripe"[^>]* disabled/);
  assert.throws(() => choosePayProvider(state, 'stripe'), /provider_not_selectable/);
  assert.deepEqual(providerChoices(CATALOG, 'member_monthly').filter(c => c.enabled).map(c => c.id), ['telegram_stars']);
  // Physical goods: Stars is disabled with its own reason.
  const stars = providerChoices(CATALOG, 'tshirt').find(c => c.id === 'telegram_stars');
  assert.equal(stars.enabled, false);
  assert.equal(stars.reason, 'Starsはデジタル商品専用です');
  // With Stars unconfigured, a digital product has nothing selectable and the method clears.
  const noStars = {...CATALOG, providers:CATALOG.providers.map(p => ({...p, configured:p.id === 'stripe'}))};
  let blocked = goRich(addPayButton(initialRich(emptyDraft({blocks:[{kind:'text', text:'本文'}]}), {catalog:noStars})), 'pay');
  blocked = choosePaySku(blocked, 'member_monthly');
  assert.equal(currentPayButton(blocked).provider, '');
  assert.ok(!/data-rpayprov="[a-z_]+" aria-pressed="(true|false)">/.test(renderRich(blocked))); // every method disabled
});

test('editor: the catalog step sets title, amount, currency and goods kind, and the button follows', () => {
  let state = initialRich(emptyDraft({blocks:[{kind:'text', text:'本文'}]}), {catalog:{skus:{}, providers:CATALOG.providers}});
  state = goRich(state, 'catalog');
  assert.ok(renderRich(state).includes('まだ商品がありません'));
  assert.throws(() => addSku(state, 'bad id'), /invalid_sku_id/);
  state = addSku(state, 'vip');
  assert.equal(state.skuSelected, 'vip');
  assert.throws(() => addSku(state, 'vip'), /sku_exists/);
  assert.ok(renderRich(state).includes('商品名を入れてください')); // a new SKU starts unfinished
  state = editSku(state, 'vip', {title:'VIP会員', amount:'1,500'});
  assert.equal(state.catalog.skus.vip.amount, 1500);
  for (const bad of ['0', '-1', '1.5', 'abc', '', '1000001']) assert.throws(() => editSku(state, 'vip', {amount:bad}), /invalid_amount/, bad);
  // Goods kind drives currency and vice versa, so the catalog stays sellable.
  state = editSku(state, 'vip', {goodsKind:'physical_service'});
  assert.equal(state.catalog.skus.vip.currency, 'JPY');
  state = editSku(state, 'vip', {currency:'XTR'});
  assert.equal(state.catalog.skus.vip.goodsKind, 'digital');
  assert.throws(() => editSku(state, 'vip', {currency:'USD'}), /invalid_currency/);
  assert.throws(() => editSku(state, 'vip', {goodsKind:'nft'}), /invalid_goods_kind/);
  assert.throws(() => editSku(state, 'nope', {title:'x'}), /unknown_sku/);
  assert.equal(state.catalogDirty, true);
  const html = renderRich(state);
  assert.ok(html.includes('data-rskugoods="digital" aria-pressed="true"') && html.includes('data-rskucur="XTR" aria-pressed="true"'));
  // Use it from a pay button; the price shown and sent comes from the SKU.
  state = choosePaySku(addPayButton(state), 'vip');
  assert.equal(compile(state.draft, {chatId:CHAT_A, catalog:state.catalog}).params.reply_markup.inline_keyboard[0][0].text, '⭐ 1,500 Starsで支払う');
  state = editSku(state, 'vip', {amount:2000});
  assert.equal(compile(state.draft, {chatId:CHAT_A, catalog:state.catalog}).params.reply_markup.inline_keyboard[0][0].text, '⭐ 2,000 Starsで支払う');
  // Switching the SKU to JPY leaves the Stars button invalid until the method is changed.
  state = editSku(state, 'vip', {goodsKind:'physical_service'});
  assert.ok(compile(state.draft, {chatId:CHAT_A, catalog:state.catalog}).errors.includes('button_0_0_stars_only_digital'));
  state = choosePayProvider(state, 'stripe');
  assert.equal(compile(state.draft, {chatId:CHAT_A, catalog:state.catalog}).ok, true);
  // A SKU in use cannot be deleted; an unused one can.
  assert.throws(() => removeSku(state, 'vip'), /sku_in_use/);
  state = addSku(state, 'spare');
  state = removeSku(state, 'spare');
  assert.equal(state.catalog.skus.spare, undefined);
  assert.equal(selectSku(state, 'vip').skuSelected, 'vip');
});

test('editing pay buttons and SKUs never mutates the state it was handed', () => {
  const state = goRich(addPayButton(initialRich(emptyDraft({blocks:[{kind:'text', text:'本文'}]}), {catalog:structuredClone(CATALOG)})), 'pay');
  const before = structuredClone({draft:state.draft, catalog:state.catalog});
  choosePayProvider(choosePaySku(state, 'tshirt'), 'stripe');
  editSku(state, 'tshirt', {amount:1});
  addSku(state, 'new_one');
  assert.deepEqual({draft:state.draft, catalog:state.catalog}, before);
});

test('switching a button to pay and back drops the other kinds\' fields', () => {
  let state = addButton(initialRich());
  state = editButton(state, 0, 0, {kind:'pay'});
  assert.deepEqual(state.draft.buttons[0][0], {kind:'pay', label:'', skuId:'', provider:''});
  assert.ok(renderRich(goRich(state, 'buttons')).includes('data-rpayedit="0-0"'));
  state = editButton(state, 0, 0, {kind:'callback'});
  assert.equal(state.draft.buttons[0][0].skuId, undefined);
  assert.equal(state.draft.buttons[0][0].provider, undefined);
});

test('the SKU catalog persists through the injected store without the provider settings', () => {
  const store = memoryStore();
  assert.equal(saveCatalog(store, CATALOG), true);
  const providers = [{id:'telegram_stars', configured:false}];
  const loaded = loadCatalog(store, providers);
  assert.deepEqual(loaded.skus, CATALOG.skus);
  assert.deepEqual(loaded.providers, providers); // never read back from storage
  assert.ok(!store.getItem(CATALOG_KEY).includes('configured'));
  assert.deepEqual(loadCatalog({getItem:() => '{oops', setItem() {}}), {skus:{}, providers:[]});
  assert.deepEqual(loadCatalog({getItem:() => '{"skus":[]}', setItem() {}}).skus, {});
  assert.equal(saveCatalog({getItem:() => null, setItem() { throw new Error('quota'); }}, CATALOG), false);
});

test('pay screens escape owner-entered text', () => {
  const nasty = '<img src=x onerror=alert(1)>';
  const catalog = {skus:{a:{title:nasty, amount:1, currency:'XTR', goodsKind:'digital'}}, providers:CATALOG.providers};
  let state = goRich(addPayButton(initialRich(emptyDraft({blocks:[{kind:'text', text:'本文'}]}), {catalog})), 'pay');
  state = editButton(choosePaySku(state, 'a'), 0, 0, {label:nasty});
  state = selectSku(state, 'a');
  for (const page of ['pay', 'catalog', 'buttons', 'preview']) {
    const html = renderRich({...state, page});
    assert.ok(!html.includes('<img src=x'), page);
  }
});

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f.name}\n${f.error}`);
  console.log(JSON.stringify({suite:'richmsg', passed:false, tests:n, failed:failures.map(f => f.name)}));
  process.exit(1);
}
console.log(JSON.stringify({suite:'richmsg', passed:true, tests:n}));
