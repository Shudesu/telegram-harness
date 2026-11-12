// Draft storage: save, duplicate, rename, delete. The backing store is injected (a
// getItem/setItem pair): a browser can hand it localStorage, the Worker a synchronous adapter,
// the tests a plain Map. Nothing here touches a global or reaches a server.
import {emptyDraft} from './compose.mjs';
import {fromTemplate} from './templates.mjs';

export const KEY = 'richmsg.drafts.v1';
export const MAX_DRAFTS = 50;

// A storage shim with the two methods we use, so `localStorage` and a Map are
// interchangeable and a quota error cannot take the editor down.
export const memoryStore = () => {
  const map = new Map();
  return {getItem:k => map.get(k) ?? null, setItem:(k, v) => void map.set(k, v)};
};

export function loadDrafts(store) {
  try {
    const parsed = JSON.parse(store.getItem(KEY) ?? '[]');
    // A row has to carry the shape the list and the preview read directly (`blocks.length`,
    // `buttons.flat()`), or an older/edited storage entry would take the screen down instead
    // of just being skipped.
    return Array.isArray(parsed)
      ? parsed.filter(d => d && typeof d.id === 'string' && Array.isArray(d.blocks) && Array.isArray(d.buttons))
      : [];
  } catch { return []; } // corrupt storage must not brick the editor
}
function persist(store, drafts) {
  try { store.setItem(KEY, JSON.stringify(drafts)); return true; }
  catch { return false; } // out of quota or private mode: the caller is told, nothing throws
}

const nextId = drafts => {
  const used = new Set(drafts.map(d => d.id));
  for (let n = 1; n <= MAX_DRAFTS + 1; n++) { const id = `draft-${String(n).padStart(3, '0')}`; if (!used.has(id)) return id; }
  return null;
};

export function saveDraft(store, draft, now) {
  const drafts = loadDrafts(store);
  const index = draft.id ? drafts.findIndex(d => d.id === draft.id) : -1;
  if (index < 0 && drafts.length >= MAX_DRAFTS) return {ok:false, error:'too_many_drafts', drafts};
  const id = draft.id ?? nextId(drafts);
  if (!id) return {ok:false, error:'too_many_drafts', drafts};
  const row = {...structuredClone(draft), id, updatedAt:now, createdAt:index < 0 ? now : drafts[index].createdAt ?? now};
  const next = index < 0 ? [...drafts, row] : drafts.map(d => (d.id === id ? row : d));
  return persist(store, next) ? {ok:true, draft:row, drafts:next} : {ok:false, error:'storage_unavailable', drafts};
}

// A copy is a new row with a new id, so editing it cannot touch the original.
export function duplicateDraft(store, id, now, {suffix = '（複製）'} = {}) {
  const drafts = loadDrafts(store);
  const source = drafts.find(d => d.id === id);
  if (!source) return {ok:false, error:'not_found', drafts};
  return saveDraft(store, {...structuredClone(source), id:null, title:`${source.title}${suffix}`}, now);
}

export function deleteDraft(store, id) {
  const drafts = loadDrafts(store);
  const next = drafts.filter(d => d.id !== id);
  if (next.length === drafts.length) return {ok:false, error:'not_found', drafts};
  return persist(store, next) ? {ok:true, drafts:next} : {ok:false, error:'storage_unavailable', drafts};
}

export function newFromTemplate(templateId) {
  return fromTemplate(templateId) ?? emptyDraft();
}

// The pay-button SKUs as edited in the editor. Same injected store, own key. Only the SKUs
// are persisted: which providers are configured is a fact about the deployment's secrets, so
// it is handed in fresh each time and can never be "saved" as enabled.
export const CATALOG_KEY = 'richmsg.catalog.v1';
export const emptyCatalog = (providers = []) => ({skus:{}, providers});
export function loadCatalog(store, providers = []) {
  try {
    const parsed = JSON.parse(store.getItem(CATALOG_KEY) ?? 'null');
    if (!parsed || typeof parsed.skus !== 'object' || parsed.skus === null || Array.isArray(parsed.skus)) return emptyCatalog(providers);
    return {skus:parsed.skus, providers};
  } catch { return emptyCatalog(providers); }
}
export function saveCatalog(store, catalog) {
  try { store.setItem(CATALOG_KEY, JSON.stringify({skus:catalog.skus})); return true; }
  catch { return false; }
}
