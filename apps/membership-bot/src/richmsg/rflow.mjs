// Pure state machine for the rich-message editor. Same shape as the other two sections:
// no DOM, no storage, no sending — those are injected by src/richmsg/rsection.mjs.
import {emptyDraft} from './compose.mjs';
import {BLOCK_KINDS} from './html.mjs';
import {DIVIDERS} from './spec.mjs';
import {SKU_ID, CURRENCIES, GOODS_KINDS, AMOUNT_MAX, skuOf, providerChoices} from './pay.mjs';
import {emptyCatalog} from './drafts.mjs';

// `pay` edits one pay button (product → payment method → label); `catalog` is the minimal
// SKU editor the pay page links to, because the price is only ever edited on the SKU.
export const RICH_PAGES = ['templates', 'editor', 'blocks', 'buttons', 'pay', 'catalog', 'preview', 'drafts'];
// Kinds offered in the editor, in the order they are listed. `pre` is left out: a
// monospace block in a membership announcement is almost always a mistake.
export const OFFERED_BLOCKS = ['heading', 'text', 'bold', 'italic', 'underline', 'strike',
  'spoiler', 'code', 'quote', 'quote_expandable', 'list', 'numbered', 'link', 'divider', 'spacer'];
export const BLOCK_LABELS = {heading:'見出し（太字）', text:'本文', bold:'太字', italic:'斜体',
  underline:'下線', strike:'打ち消し', spoiler:'伏せ字', code:'等幅', quote:'引用',
  quote_expandable:'引用（折りたたみ）', list:'箇条書き', numbered:'番号つき', link:'リンク',
  divider:'区切り線', spacer:'空行'};

export function initialRich(draft = emptyDraft(), {catalog = emptyCatalog()} = {}) {
  return {page:'templates', draft, stack:[], selected:null, dirty:false, saved:null, error:null, sent:null,
    catalog, catalogDirty:false, payTarget:null, skuSelected:null};
}
export function goRich(state, page) {
  if (!RICH_PAGES.includes(page)) throw new Error('invalid_page');
  return {...state, page, stack:[...state.stack, state.page].slice(-16), error:null};
}
export function backRich(state) {
  const stack = state.stack.slice();
  return {...state, page:stack.pop() ?? 'templates', stack, error:null};
}

const touch = (state, draft) => ({...state, draft, dirty:true, error:null, sent:null});

export function setField(state, field, value) {
  const draft = structuredClone(state.draft);
  if (field === 'title') draft.title = String(value).slice(0, 80);
  else if (field === 'mediaKind') { draft.media = {...draft.media, kind:value}; if (value === 'none') draft.media.url = ''; }
  else if (field === 'mediaUrl') draft.media = {...draft.media, url:String(value).trim()};
  else if (field === 'protectContent') draft.options = {...draft.options, protectContent:!!value};
  else throw new Error('invalid_field');
  return touch(state, draft);
}

export function addBlock(state, kind) {
  if (!BLOCK_KINDS.includes(kind)) throw new Error('invalid_block_kind');
  const draft = structuredClone(state.draft);
  draft.blocks.push(kind === 'divider' ? {kind, style:'line'} : {kind, text:'', ...(kind === 'link' ? {href:''} : {})});
  return {...touch(state, draft), selected:draft.blocks.length - 1};
}
export function editBlock(state, index, patch) {
  const draft = structuredClone(state.draft);
  if (!draft.blocks[index]) throw new Error('no_such_block');
  draft.blocks[index] = {...draft.blocks[index], ...patch};
  return touch(state, draft);
}
export function removeBlock(state, index) {
  const draft = structuredClone(state.draft);
  if (!draft.blocks[index]) throw new Error('no_such_block');
  draft.blocks.splice(index, 1);
  return {...touch(state, draft), selected:null};
}
// Reordering is how the "divider between sections" layout actually gets built, so it is
// part of the editor rather than something to redo by deleting and re-adding.
export function moveBlock(state, index, delta) {
  const draft = structuredClone(state.draft);
  const to = index + delta;
  if (!draft.blocks[index] || to < 0 || to >= draft.blocks.length) return state;
  const [block] = draft.blocks.splice(index, 1);
  draft.blocks.splice(to, 0, block);
  return {...touch(state, draft), selected:to};
}

export function addButton(state, row = null) {
  const draft = structuredClone(state.draft);
  const button = {kind:'url', label:'', url:''};
  if (row === null || !draft.buttons[row]) draft.buttons.push([button]);
  else draft.buttons[row].push(button);
  return touch(state, draft);
}
export function editButton(state, row, column, patch) {
  const draft = structuredClone(state.draft);
  if (!draft.buttons[row]?.[column]) throw new Error('no_such_button');
  const next = {...draft.buttons[row][column], ...patch};
  // Switching kind must drop the other kind's field, or a stale url rides along unvalidated.
  if (patch.kind === 'callback') { delete next.url; delete next.skuId; delete next.provider; next.data ??= ''; }
  if (patch.kind === 'url') { delete next.data; delete next.skuId; delete next.provider; next.url ??= ''; }
  if (patch.kind === 'pay') { delete next.url; delete next.data; next.skuId ??= ''; next.provider ??= ''; }
  draft.buttons[row][column] = next;
  return touch(state, draft);
}
export function removeButton(state, row, column) {
  const draft = structuredClone(state.draft);
  if (!draft.buttons[row]?.[column]) throw new Error('no_such_button');
  draft.buttons[row].splice(column, 1);
  if (draft.buttons[row].length === 0) draft.buttons.splice(row, 1);
  // Positions shift after a removal, so the pay page must not keep pointing at a slot.
  return {...touch(state, draft), payTarget:null};
}
export const dividerStyles = () => Object.keys(DIVIDERS);

// ---- pay buttons ---------------------------------------------------------------------------

const payButtonAt = (state, target) => {
  const button = target ? state.draft.buttons[target.row]?.[target.col] : null;
  if (!button || button.kind !== 'pay') throw new Error('no_such_pay_button');
  return button;
};
export const currentPayButton = state => {
  try { return payButtonAt(state, state.payTarget); } catch { return null; }
};

// Adds an empty pay button and makes it the one the pay page edits. Its label stays empty
// so the price-bearing default label is used until the owner writes their own.
export function addPayButton(state, row = null) {
  const draft = structuredClone(state.draft);
  const button = {kind:'pay', label:'', skuId:'', provider:''};
  let target;
  if (row === null || !draft.buttons[row]) { draft.buttons.push([button]); target = {row:draft.buttons.length - 1, col:0}; }
  else { draft.buttons[row].push(button); target = {row, col:draft.buttons[row].length - 1}; }
  return {...touch(state, draft), payTarget:target};
}
export function openPayButton(state, row, col) {
  payButtonAt(state, {row, col});
  return {...state, payTarget:{row, col}, error:null};
}

const enabledProviders = (catalog, skuId) => providerChoices(catalog, skuId).filter(c => c.enabled).map(c => c.id);

// Choosing a product keeps the chosen method only if it can still sell that product; when
// exactly one method can, it is picked for the owner (a digital good with Stars configured).
export function choosePaySku(state, skuId) {
  const current = payButtonAt(state, state.payTarget);
  if (!skuOf(state.catalog, skuId)) throw new Error('unknown_sku');
  const allowed = enabledProviders(state.catalog, skuId);
  const provider = allowed.includes(current.provider) ? current.provider : allowed.length === 1 ? allowed[0] : '';
  const draft = structuredClone(state.draft);
  draft.buttons[state.payTarget.row][state.payTarget.col] = {...current, skuId, provider};
  return touch(state, draft);
}
// A disabled method cannot be chosen at all — the view renders it disabled, and this refuses
// it even if a stale view or a forged event asks.
export function choosePayProvider(state, provider) {
  const current = payButtonAt(state, state.payTarget);
  if (!skuOf(state.catalog, current.skuId)) throw new Error('choose_sku_first');
  if (!enabledProviders(state.catalog, current.skuId).includes(provider)) throw new Error('provider_not_selectable');
  const draft = structuredClone(state.draft);
  draft.buttons[state.payTarget.row][state.payTarget.col] = {...current, provider};
  return touch(state, draft);
}

// ---- minimal catalog editor -------------------------------------------------------------------

const touchCatalog = (state, catalog, over = {}) => ({...state, catalog, catalogDirty:true, error:null, sent:null, ...over});

export function addSku(state, skuId) {
  const id = String(skuId ?? '').trim();
  if (!SKU_ID.test(id)) throw new Error('invalid_sku_id');
  if (skuOf(state.catalog, id)) throw new Error('sku_exists');
  const catalog = structuredClone(state.catalog);
  // Amount starts unset on purpose: a made-up default price is worse than an error.
  catalog.skus[id] = {title:'', amount:null, currency:'XTR', goodsKind:'digital', recurring:false};
  return touchCatalog(state, catalog, {skuSelected:id});
}
export function selectSku(state, skuId) {
  if (!skuOf(state.catalog, skuId)) throw new Error('unknown_sku');
  return {...state, skuSelected:skuId, error:null};
}
// Currency and goods kind are kept consistent with each other (digital ⇔ Stars/XTR,
// otherwise JPY), so the catalog editor cannot produce a SKU nothing can sell.
export function editSku(state, skuId, patch) {
  if (!skuOf(state.catalog, skuId)) throw new Error('unknown_sku');
  const catalog = structuredClone(state.catalog);
  const sku = catalog.skus[skuId];
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'title') sku.title = String(value).slice(0, 64);
    else if (field === 'amount') {
      const n = typeof value === 'number' ? value : String(value).trim() === '' ? NaN : Number(String(value).replace(/[,，\s]/g, ''));
      if (!Number.isSafeInteger(n) || n < 1 || n > AMOUNT_MAX) throw new Error('invalid_amount');
      sku.amount = n;
    } else if (field === 'currency') {
      if (!CURRENCIES.includes(value)) throw new Error('invalid_currency');
      sku.currency = value;
      if (value === 'XTR') sku.goodsKind = 'digital';
      else if (sku.goodsKind === 'digital') sku.goodsKind = 'physical_service';
    } else if (field === 'goodsKind') {
      if (!GOODS_KINDS.includes(value)) throw new Error('invalid_goods_kind');
      sku.goodsKind = value;
      sku.currency = value === 'digital' ? 'XTR' : 'JPY';
    } else if (field === 'recurring') sku.recurring = !!value;
    else throw new Error('invalid_field');
  }
  return touchCatalog(state, catalog);
}
export function removeSku(state, skuId) {
  if (!skuOf(state.catalog, skuId)) throw new Error('unknown_sku');
  if (state.draft.buttons.flat().some(b => b?.kind === 'pay' && b.skuId === skuId)) throw new Error('sku_in_use');
  const catalog = structuredClone(state.catalog);
  delete catalog.skus[skuId];
  return touchCatalog(state, catalog, {skuSelected:state.skuSelected === skuId ? null : state.skuSelected});
}
// Unsaved or edited since the last save → review it; otherwise the next useful thing is the
// saved list. A template just loaded counts as unsaved, because it has never been saved.
export const richNext = state => state.draft.blocks.length === 0
  ? {page:'blocks', label:'本文のブロックを足す'}
  : (state.dirty || !state.draft.id) ? {page:'preview', label:'プレビューで確認する'}
  : {page:'drafts', label:'保存した下書きを見る'};
