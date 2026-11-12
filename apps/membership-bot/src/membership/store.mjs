// Key/value store the membership service runs on. In the Worker it is the Durable Object's own
// storage (strongly consistent, one writer); in tests it is a Map. Only get/put/delete/list are used.
export function doStore(storage) {
  return {
    get: k => storage.get(k),
    put: (k, v) => storage.put(k, v),
    delete: k => storage.delete(k),
    async list(prefix) { return [...(await storage.list({prefix})).values()]; },
  };
}

export function memoryStore() {
  const m = new Map();
  return {
    _map: m,
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async put(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { return m.delete(k); },
    async list(prefix) { return [...m.keys()].filter(k => k.startsWith(prefix)).sort().map(k => structuredClone(m.get(k))); },
  };
}
