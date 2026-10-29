// Đồng bộ với Supabase: kéo thay đổi của đồng đội, đẩy thay đổi của mình, hàng đợi "outbox" bền (mất mạng vẫn không mất thay đổi).
// Thuần logic: mọi thao tác ngoài đều đi qua `remote` và `local` được truyền vào, nên kiểm thử được bằng bản giả trong bộ nhớ.
import { mergeCatalogs } from '../core/catalog.js';
import { mergeLearned } from '../core/learn.js';

export const META_KEYS = ['catalog', 'learned'];
const json = (v) => JSON.stringify(v ?? null);

export const toRow = (r) => ({ id: r.id, hash: r.hash || null, name: r.name, date: r.date, month: r.month, created_at: r.createdAt, rows: r.rows, printed_total: r.printedTotal ?? null, status: r.status || 'manual', note: r.note || '', deleted: false });
export const fromRow = (w) => ({ id: w.id, hash: w.hash || undefined, name: w.name, date: w.date, month: w.month, createdAt: Number(w.created_at), rows: w.rows || [], printedTotal: w.printed_total ?? null, status: w.status || 'manual', note: w.note || '' });

export const emptySyncState = () => ({ cursor: null, initialized: false, up: {}, del: {}, rev: { catalog: 0, learned: 0 }, synced: { catalog: null, learned: null }, lastAt: 0 });

// remote: { pullReports(cursor)→rows, upsertReports(rows), markDeleted(ids), getMeta()→[{key,value,rev}], insertMeta(key,value)→bool, updateMeta(key,value,rev)→newRev|null }
// local:  { getReports(), upsertReport(rep), removeReport(id), getMeta(key), setMeta(key,value), isPristine(key) }
export function createSync({ remote, local, load, save }) {
  let st = null;
  let seq = Date.now();
  let running = null;

  const ensure = async () => (st ||= { ...emptySyncState(), ...((await load()) || {}) });
  const persist = () => save(st);

  const dirtyMeta = (k) => json(local.getMeta(k)) !== st.synced[k];
  const pendingCount = () => Object.keys(st.up).length + Object.keys(st.del).length + META_KEYS.filter((k) => st.synced[k] !== null || !local.isPristine(k) ? dirtyMeta(k) : false).length;

  async function pullReports() {
    const rows = await remote.pullReports(st.cursor);
    const seen = new Set();
    let pulled = 0;
    for (const w of rows) {
      seen.add(w.id);
      if (!st.cursor || String(w.updated_at) > st.cursor) st.cursor = String(w.updated_at);
      if (st.up[w.id] || st.del[w.id]) continue;        // mình đang có thay đổi chưa đẩy lên cho báo cáo này: bản của mình thắng
      const have = local.getReports();
      if (w.deleted) { if (have.some((r) => r.id === w.id)) { local.removeReport(w.id); pulled++; } continue; }
      // Cùng một ảnh (cùng hash) được nhập ở hai máy với id khác nhau: giữ bản trên cloud, bỏ bản local để không cộng đôi.
      const dup = w.hash && have.find((r) => r.hash === w.hash && r.id !== w.id);
      if (dup) { local.removeReport(dup.id); delete st.up[dup.id]; }
      const next = fromRow(w), cur = have.find((r) => r.id === w.id);
      if (cur && json(cur) === json(next)) continue; // chính bản mình vừa đẩy lên, không có gì mới
      local.upsertReport(next); pulled++;
    }
    return { seen, pulled, firstRun: !st.initialized };
  }

  function mergeMeta(k, remoteVal) {
    const mine = local.getMeta(k);
    if (k === 'catalog') return mergeCatalogs(mine, remoteVal);
    return mergeLearned(mine, remoteVal);
  }

  async function pullMeta() {
    const metas = await remote.getMeta();
    for (const k of META_KEYS) {
      const m = metas.find((x) => x.key === k);
      if (!m || m.rev <= st.rev[k]) continue;
      const hasLocalEdits = st.synced[k] === null ? !local.isPristine(k) : dirtyMeta(k);
      if (!hasLocalEdits) local.setMeta(k, m.value);
      else local.setMeta(k, mergeMeta(k, m.value));
      st.rev[k] = m.rev;
      st.synced[k] = json(m.value);   // so với bản gộp sẽ khác → còn "dirty" → lần đẩy sau sẽ ghi bản gộp lên
    }
  }

  async function pushReports() {
    const have = new Map(local.getReports().map((r) => [r.id, r]));
    const ups = Object.entries(st.up).filter(([id]) => have.has(id));
    for (const id of Object.keys(st.up)) if (!have.has(id) && !st.del[id]) delete st.up[id];
    for (let i = 0; i < ups.length; i += 100) {
      const chunk = ups.slice(i, i + 100);
      await remote.upsertReports(chunk.map(([id]) => toRow(have.get(id))));
      for (const [id, s] of chunk) if (st.up[id] === s) delete st.up[id];
    }
    const dels = Object.entries(st.del);
    for (let i = 0; i < dels.length; i += 100) {
      const chunk = dels.slice(i, i + 100);
      await remote.markDeleted(chunk.map(([id]) => id));
      for (const [id, s] of chunk) if (st.del[id] === s) delete st.del[id];
    }
  }

  async function pushMeta() {
    for (const k of META_KEYS) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const val = local.getMeta(k);
        if (st.synced[k] !== null ? json(val) === st.synced[k] : local.isPristine(k) && st.rev[k] === 0) break; // không có gì để đẩy
        let newRev = null;
        if (st.rev[k] === 0) newRev = (await remote.insertMeta(k, val)) ? 1 : null;
        else newRev = await remote.updateMeta(k, val, st.rev[k]);
        if (newRev != null) { st.rev[k] = newRev; st.synced[k] = json(val); break; }
        await pullMeta(); // có người khác vừa ghi: gộp rồi thử lại
      }
    }
  }

  async function runOnce() {
    await ensure();
    const { seen, pulled, firstRun } = await pullReports();
    if (firstRun) { // máy này có dữ liệu cũ chưa từng lên cloud: đưa lên
      for (const r of local.getReports()) if (!seen.has(r.id) && !st.up[r.id]) st.up[r.id] = ++seq;
      st.initialized = true;
    }
    await persist();
    await pullMeta();
    await persist();
    await pushReports();
    await persist();
    await pushMeta();
    st.lastAt = Date.now();
    await persist();
    return { pulled, pending: pendingCount() };
  }

  return {
    // Chạy một lượt đồng bộ; nếu đang chạy thì dùng lại lượt đó (không chồng lượt).
    run() { return (running ||= runOnce().finally(() => { running = null; })); },
    async enqueueUpsert(id) { await ensure(); delete st.del[id]; st.up[id] = ++seq; await persist(); },
    async enqueueDelete(id) { await ensure(); delete st.up[id]; st.del[id] = ++seq; await persist(); },
    async pending() { await ensure(); return pendingCount(); },
    async info() { await ensure(); return { lastAt: st.lastAt, pending: pendingCount() }; },
  };
}

// Cầu nối REST thật (PostgREST) cho createSync.
export function createRemote(cloud) {
  const PAGE = 500;
  return {
    async pullReports(cursor) {
      const out = [];
      const filter = cursor ? `&updated_at=gte.${encodeURIComponent(cursor)}` : '';
      for (let off = 0; ; off += PAGE) {
        const page = await cloud.rest(`reports?select=*&order=updated_at.asc,id.asc&limit=${PAGE}&offset=${off}${filter}`);
        out.push(...page);
        if (page.length < PAGE) break;
      }
      return out;
    },
    upsertReports: (rows) => cloud.rest('reports?on_conflict=id', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' }),
    markDeleted: (ids) => cloud.rest(`reports?id=in.(${ids.map(encodeURIComponent).join(',')})`, { method: 'PATCH', body: { deleted: true }, prefer: 'return=minimal' }),
    getMeta: () => cloud.rest('app_meta?select=key,value,rev'),
    async insertMeta(key, value) {
      try { await cloud.rest('app_meta', { method: 'POST', body: { key, value, rev: 1 }, prefer: 'return=minimal' }); return true; }
      catch (e) { if (e.status === 409) return false; throw e; }
    },
    async updateMeta(key, value, rev) {
      const r = await cloud.rest(`app_meta?key=eq.${encodeURIComponent(key)}&rev=eq.${rev}`, { method: 'PATCH', body: { value, rev: rev + 1 }, prefer: 'return=representation' });
      return Array.isArray(r) && r.length ? r[0].rev : null;
    },
  };
}
