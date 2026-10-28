// Lưu trữ cục bộ bằng IndexedDB (ảnh, công việc, báo cáo, danh mục). Nếu trình duyệt chặn IndexedDB (chế độ riêng tư)
// thì tự chuyển sang bộ nhớ tạm và báo `db.persistent === false` để giao diện cảnh báo.
const NAME = 'qt-report-aggregator', VERSION = 1, STORES = ['jobs', 'blobs', 'reports', 'meta'];
const keyPaths = { jobs: 'id', blobs: 'id', reports: 'id', meta: 'key' };

export const db = { persistent: true };
let dbPromise = null;
const mem = Object.fromEntries(STORES.map((s) => [s, new Map()]));

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => { for (const s of STORES) req.result.createObjectStore(s, { keyPath: keyPaths[s] }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  }).catch((e) => { db.persistent = false; console.warn('IndexedDB không khả dụng, dùng bộ nhớ tạm:', e); return null; });
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await open();
  if (!d) return null;
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export async function init() { await open(); return db.persistent; }
export const get = async (s, k) => (db.persistent ? run(s, 'readonly', (st) => st.get(k)) : mem[s].get(k));
export const all = async (s) => (db.persistent ? run(s, 'readonly', (st) => st.getAll()) : [...mem[s].values()]);
export const put = async (s, v) => { if (!db.persistent) { mem[s].set(v[keyPaths[s]], v); return; } await run(s, 'readwrite', (st) => st.put(v)); };
export const del = async (s, k) => { if (!db.persistent) { mem[s].delete(k); return; } await run(s, 'readwrite', (st) => st.delete(k)); };
export const clear = async (s) => { if (!db.persistent) { mem[s].clear(); return; } await run(s, 'readwrite', (st) => st.clear()); };
