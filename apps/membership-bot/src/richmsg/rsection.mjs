// DOM wiring for the rich-message editor. All decisions live in rflow.mjs / rview.mjs;
// this file only translates events into those calls and keeps text inputs from being
// re-rendered under the caret while someone is typing. Browser-only: nothing here runs in
// the Worker, and every browser dependency (the app element, storage, recorder) is injected.
import {renderRich} from './rview.mjs';
import {initialRich, goRich, backRich, setField, addBlock, editBlock, removeBlock, moveBlock,
  addButton, editButton, removeButton, addPayButton, openPayButton, choosePaySku, choosePayProvider,
  addSku, selectSku, editSku, removeSku} from './rflow.mjs';
import {emptyDraft, compile} from './compose.mjs';
import {fromTemplate} from './templates.mjs';
import {loadDrafts, saveDraft, duplicateDraft, deleteDraft, memoryStore, loadCatalog, saveCatalog} from './drafts.mjs';

// The browser stand-in for telegram/mock.mjs: it records calls and goes nowhere. The node
// tests use the real mock; this exists so the "send to the mock" button in the Mini App is
// honest about being a local recorder rather than quietly doing nothing.
export function createLocalRecorder() {
  const calls = [];
  return {calls, async call(method, params) { calls.push({method, params}); return {message_id:calls.length, local:true}; }};
}

// `providers` = [{id, configured}] as reported by the deployment (never edited here).
export function createRich({app, status, store = memoryStore(), recorder = createLocalRecorder(), sdk, now = () => Date.now(), providers = []}) {
  const catalogNow = () => loadCatalog(store, providers);
  let state = initialRich(emptyDraft(), {catalog:catalogNow()});
  // Flow functions throw on refused input (a disabled method, a bad amount). That is shown as
  // an error on the current screen instead of breaking the handler.
  const attempt = fn => { try { state = fn(state); } catch (error) { state = {...state, error:error.message}; } };
  const persistCatalog = () => { if (state.catalogDirty && saveCatalog(store, state.catalog)) state = {...state, catalogDirty:false}; };

  function draw(focus = false) {
    status.textContent = '';
    app.innerHTML = renderRich(state);
    bind();
    sdk?.update(state.page === 'templates' ? 'root' : state.page, {canSubmit:false});
    const heading = app.querySelector('h1');
    if (heading) heading.tabIndex = -1;
    if (focus) (heading ?? app).focus({preventScroll:false});
  }
  const pair = value => value.split('-').map(Number);

  function bind() {
    const on = (selector, event, handler) => app.querySelectorAll(selector).forEach(el => el.addEventListener(event, handler));
    on('[data-rpage]', 'click', e => { state = goRich(state, e.currentTarget.dataset.rpage); if (state.page === 'drafts') state.saved = loadDrafts(store); draw(true); });
    on('[data-rtemplate]', 'click', e => {
      state = {...initialRich(fromTemplate(e.currentTarget.dataset.rtemplate) ?? emptyDraft(), {catalog:state.catalog}), dirty:true};
      state = goRich(state, 'editor'); draw(true);
    });
    on('[data-rmedia]', 'click', e => { state = setField(state, 'mediaKind', e.currentTarget.dataset.rmedia); draw(); });
    on('[data-radd]', 'click', e => { state = addBlock(state, e.currentTarget.dataset.radd); draw(); });
    on('[data-rstyle]', 'click', e => { state = editBlock(state, state.selected, {style:e.currentTarget.dataset.rstyle}); draw(); });
    on('[data-redit]', 'click', e => { state = {...state, selected:Number(e.currentTarget.dataset.redit)}; state = goRich(state, 'blocks'); draw(true); });
    on('[data-rdel]', 'click', e => { state = removeBlock(state, Number(e.currentTarget.dataset.rdel)); draw(); });
    on('[data-rup]', 'click', e => { state = moveBlock(state, Number(e.currentTarget.dataset.rup), -1); draw(); });
    on('[data-rdown]', 'click', e => { state = moveBlock(state, Number(e.currentTarget.dataset.rdown), 1); draw(); });
    // Text inputs update the draft without redrawing, so the caret and IME composition survive.
    on('#rtitle', 'input', e => { state = setField(state, 'title', e.target.value); });
    on('#rmediaurl', 'input', e => { state = setField(state, 'mediaUrl', e.target.value); });
    on('#rtext', 'input', e => { state = editBlock(state, state.selected, {text:e.target.value}); });
    on('#rhref', 'input', e => { state = editBlock(state, state.selected, {href:e.target.value.trim()}); });
    on('[data-rbadd]', 'click', e => {
      const row = e.currentTarget.dataset.rbadd;
      state = addButton(state, row === 'new' ? null : Number(row)); draw();
    });
    on('[data-rbdel]', 'click', e => { const [r, c] = pair(e.currentTarget.dataset.rbdel); state = removeButton(state, r, c); draw(); });
    on('[data-rkind]', 'click', e => {
      const [r, c, kind] = e.currentTarget.dataset.rkind.split('-');
      state = editButton(state, Number(r), Number(c), {kind}); draw();
    });
    on('[data-rlabel]', 'input', e => { const [r, c] = pair(e.target.dataset.rlabel); state = editButton(state, r, c, {label:e.target.value}); });
    on('[data-rurl]', 'input', e => { const [r, c] = pair(e.target.dataset.rurl); state = editButton(state, r, c, {url:e.target.value.trim()}); });
    on('[data-rdata]', 'input', e => { const [r, c] = pair(e.target.dataset.rdata); state = editButton(state, r, c, {data:e.target.value.trim()}); });
    on('[data-rpayadd]', 'click', e => {
      const row = e.currentTarget.dataset.rpayadd;
      state = addPayButton(state, row === 'new' ? null : Number(row)); state = goRich(state, 'pay'); draw(true);
    });
    on('[data-rpayedit]', 'click', e => { const [r, c] = pair(e.currentTarget.dataset.rpayedit); attempt(s => goRich(openPayButton(s, r, c), 'pay')); draw(true); });
    on('[data-rpaysku]', 'click', e => { attempt(s => choosePaySku(s, e.currentTarget.dataset.rpaysku)); draw(); });
    on('[data-rpayprov]', 'click', e => { attempt(s => choosePayProvider(s, e.currentTarget.dataset.rpayprov)); draw(); });
    on('#rskuadd', 'click', () => { const input = app.querySelector('#rskunew'); attempt(s => addSku(s, input?.value ?? '')); persistCatalog(); draw(); });
    on('[data-rskusel]', 'click', e => { attempt(s => selectSku(s, e.currentTarget.dataset.rskusel)); draw(); });
    on('[data-rskugoods]', 'click', e => { attempt(s => editSku(s, s.skuSelected, {goodsKind:e.currentTarget.dataset.rskugoods})); persistCatalog(); draw(); });
    on('[data-rskucur]', 'click', e => { attempt(s => editSku(s, s.skuSelected, {currency:e.currentTarget.dataset.rskucur})); persistCatalog(); draw(); });
    on('[data-rskudel]', 'click', e => { attempt(s => removeSku(s, e.currentTarget.dataset.rskudel)); persistCatalog(); draw(); });
    on('#rskutitle', 'input', e => { attempt(s => editSku(s, s.skuSelected, {title:e.target.value})); persistCatalog(); });
    // The amount is committed on change (not per keystroke) so a half-typed number is not an error.
    on('#rskuamount', 'change', e => { attempt(s => editSku(s, s.skuSelected, {amount:e.target.value})); persistCatalog(); draw(); });
    on('#rsave', 'click', () => {
      const result = saveDraft(store, state.draft, now());
      state = result.ok
        ? {...state, draft:result.draft, dirty:false, saved:result.drafts, error:null}
        : {...state, error:result.error};
      status.textContent = result.ok ? '保存しました（この端末の中だけ）。' : '';
      draw();
    });
    on('#rmock', 'click', async () => {
      // Local recorder only. There is no transport in this app.
      const compiled = compile(state.draft, {chatId:-1009000000001, catalog:state.catalog});
      if (!compiled.ok) { state = {...state, error:'compile_failed'}; draw(); return; }
      await recorder.call(compiled.method, compiled.params);
      state = {...state, sent:{method:compiled.method, at:now()}};
      draw();
    });
    on('[data-ropen]', 'click', e => {
      const found = loadDrafts(store).find(d => d.id === e.currentTarget.dataset.ropen);
      if (!found) { state = {...state, error:'not_found'}; draw(); return; }
      state = {...initialRich(found, {catalog:state.catalog}), saved:loadDrafts(store)};
      state = goRich(state, 'editor'); draw(true);
    });
    on('[data-rdup]', 'click', e => {
      const result = duplicateDraft(store, e.currentTarget.dataset.rdup, now());
      state = {...state, saved:result.drafts, error:result.ok ? null : result.error}; draw();
    });
    on('[data-rddel]', 'click', e => {
      const result = deleteDraft(store, e.currentTarget.dataset.rddel);
      state = {...state, saved:result.drafts, error:result.ok ? null : result.error}; draw();
    });
  }

  return {
    draw,
    page: () => state.page,
    load() { state = {...state, saved:loadDrafts(store)}; draw(); },
    goBack() { state = backRich(state); draw(true); },
  };
}
