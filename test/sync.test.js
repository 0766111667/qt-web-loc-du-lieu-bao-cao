import test from 'node:test';
import assert from 'node:assert/strict';
import { createSync, createRemote, toRow, fromRow } from '../src/cloud/sync.js';
import { mergeCatalogs, createCatalog } from '../src/core/catalog.js';
import { mergeLearned } from '../src/core/learn.js';

// ---- Supabase giả trong bộ nhớ (đủ các thao tác mà createSync dùng) ----
function fakeServer() {
  let tick = 0; const reports = new Map(); const meta = new Map(); let failNext = null;
  const stamp = (r) => ({ ...r, updated_at: `2026-10-29T00:00:${String(++tick).padStart(6, '0')}+00:00` });
  const guard = () => { if (failNext) { const e = failNext; failNext = null; throw e; } };
  return {
    reports, meta, fail(e) { failNext = e; },
    remote: {
      async pullReports(cursor) { guard(); return [...reports.values()].filter((r) => !cursor || r.updated_at >= cursor).sort((a, b) => a.updated_at.localeCompare(b.updated_at)); },
      async upsertReports(rows) { guard(); for (const r of rows) reports.set(r.id, stamp({ ...(reports.get(r.id) || {}), ...r })); },
      async markDeleted(ids) { guard(); for (const id of ids) if (reports.has(id)) reports.set(id, stamp({ ...reports.get(id), deleted: true })); },
      async getMeta() { guard(); return [...meta.entries()].map(([key, v]) => ({ key, value: v.value, rev: v.rev })); },
      async insertMeta(key, value) { guard(); if (meta.has(key)) return false; meta.set(key, { value, rev: 1 }); return true; },
      async updateMeta(key, value, rev) { guard(); const m = meta.get(key); if (!m || m.rev !== rev) return null; meta.set(key, { value, rev: rev + 1 }); return rev + 1; },
    },
  };
}
// ---- Một "thiết bị" giả ----
function device(server, { catalog = createCatalog(), learned = [] } = {}) {
  const dev = { reports: [], catalog, learned, saved: null };
  const pristine = { catalog: JSON.stringify(createCatalog()), learned: '[]' };
  dev.local = {
    getReports: () => dev.reports, upsertReport: (r) => { dev.reports = [...dev.reports.filter((x) => x.id !== r.id), r]; }, removeReport: (id) => { dev.reports = dev.reports.filter((x) => x.id !== id); },
    getMeta: (k) => dev[k], setMeta: (k, v) => { dev[k] = v; }, isPristine: (k) => JSON.stringify(dev[k]) === pristine[k],
  };
  dev.sync = createSync({ remote: server.remote, local: dev.local, load: async () => dev.saved && JSON.parse(dev.saved), save: async (s) => { dev.saved = JSON.stringify(s); } });
  return dev;
}
const rep = (id, date, occ, extra = {}) => ({ id, hash: `h-${id}`, name: `${id}.png`, date, month: date.slice(0, 7), createdAt: 1000, rows: [{ itemId: 'd1', srcName: '', occ, proc: occ }], printedTotal: { occ, proc: occ }, status: 'auto', note: '', ...extra });

test('sync: báo cáo của máy A xuất hiện ở máy B; sửa/xóa cũng đồng bộ (xóa mềm)', async () => {
  const sv = fakeServer(); const A = device(sv), B = device(sv);
  A.reports = [rep('a1', '2026-10-01', 3)]; await A.sync.enqueueUpsert('a1');
  await A.sync.run(); await B.sync.run();
  assert.deepEqual(B.reports.map((r) => r.id), ['a1']); assert.equal(B.reports[0].rows[0].occ, 3);
  A.reports = [rep('a1', '2026-10-01', 5)]; await A.sync.enqueueUpsert('a1'); await A.sync.run(); await B.sync.run();
  assert.equal(B.reports[0].rows[0].occ, 5);
  A.local.removeReport('a1'); await A.sync.enqueueDelete('a1'); await A.sync.run(); await B.sync.run();
  assert.equal(B.reports.length, 0); assert.equal(sv.reports.get('a1').deleted, true);
});

test('sync: lần đầu máy có dữ liệu cũ chưa lên cloud → tự đưa lên; cùng một ảnh (hash) ở hai máy không bị cộng đôi', async () => {
  const sv = fakeServer(); const A = device(sv), B = device(sv);
  A.reports = [rep('a1', '2026-10-01', 3), rep('a2', '2026-10-02', 1)];
  await A.sync.run();
  assert.equal(sv.reports.size, 2);
  B.reports = [rep('b9', '2026-10-01', 3, { hash: 'h-a1' }), rep('b2', '2026-10-05', 2)]; // b9 = cùng ảnh với a1
  await B.sync.run();
  assert.deepEqual(B.reports.map((r) => r.id).sort(), ['a1', 'a2', 'b2']);
  assert.ok(sv.reports.has('b2') && !sv.reports.has('b9'));
});

test('sync: mất mạng → thay đổi nằm trong outbox, có mạng lại thì đẩy lên đủ, không mất gì', async () => {
  const sv = fakeServer(); const A = device(sv);
  A.reports = [rep('a1', '2026-10-01', 3)]; await A.sync.enqueueUpsert('a1');
  sv.fail(new Error('offline'));
  await assert.rejects(A.sync.run(), /offline/);
  assert.equal(await A.sync.pending(), 1); assert.equal(sv.reports.size, 0);
  A.sync = createSync({ remote: sv.remote, local: A.local, load: async () => JSON.parse(A.saved), save: async (s) => { A.saved = JSON.stringify(s); } }); // khởi động lại ứng dụng
  assert.equal(await A.sync.pending(), 1);
  await A.sync.run(); assert.equal(sv.reports.size, 1); assert.equal(await A.sync.pending(), 0);
});

test('sync: thay đổi chưa đẩy của mình thắng bản cũ trên cloud (không bị kéo về ghi đè)', async () => {
  const sv = fakeServer(); const A = device(sv), B = device(sv);
  A.reports = [rep('a1', '2026-10-01', 3)]; await A.sync.enqueueUpsert('a1'); await A.sync.run(); await B.sync.run();
  B.reports = [rep('a1', '2026-10-01', 9)]; await B.sync.enqueueUpsert('a1');   // B sửa nhưng chưa đồng bộ
  A.reports = [rep('a1', '2026-10-01', 4)]; await A.sync.enqueueUpsert('a1'); await A.sync.run();
  await B.sync.run();
  assert.equal(B.reports[0].rows[0].occ, 9);        // bản của B vừa đẩy lên (last-write-wins)
  await A.sync.run(); assert.equal(A.reports[0].rows[0].occ, 9);
});

test('sync: danh mục — máy mới (còn nguyên mặc định) nhận danh mục đã chỉnh sửa; hai người cùng sửa thì gộp, không mất hạng mục nào', async () => {
  const sv = fakeServer(); const A = device(sv), B = device(sv);
  A.catalog = { ...A.catalog, items: [...A.catalog.items.map((i, k) => (k === 0 ? { ...i, label: '节点(已改名)' } : i)), { id: 'x1', name: '新问题', label: '新问题', aliases: ['新问题'], sigs: [], hidden: false }] };
  await A.sync.run();
  await B.sync.run();
  assert.equal(B.catalog.items[0].label, '节点(已改名)'); assert.ok(B.catalog.items.some((i) => i.id === 'x1'));  // B ban đầu còn mặc định → bản cloud thắng
  // cả hai cùng sửa trước khi đồng bộ
  A.catalog = { ...A.catalog, items: [...A.catalog.items, { id: 'xa', name: 'A新', label: 'A新', aliases: ['a新'], sigs: [], hidden: false }] };
  B.catalog = { ...B.catalog, items: [...B.catalog.items, { id: 'xb', name: 'B新', label: 'B新', aliases: ['b新'], sigs: [], hidden: false }] };
  await A.sync.run(); await B.sync.run(); await A.sync.run();
  for (const d of [A, B]) { const ids = d.catalog.items.map((i) => i.id); assert.ok(ids.includes('xa') && ids.includes('xb') && ids.includes('x1'), ids.join()); }
  assert.equal(sv.meta.get('catalog').rev >= 3, true);
});

test('merge: mergeCatalogs giữ nhãn local, hợp tên gọi/chữ ký; mergeLearned hợp và loại trùng, giới hạn mỗi chữ số', () => {
  const a = createCatalog(), b = createCatalog();
  a.items[0].label = 'local'; b.items[0].label = 'remote'; b.items[0].aliases.push('别名'); b.items[0].sigs.push(new Array(10).fill(0.5));
  const m = mergeCatalogs(a, b);
  assert.equal(m.items[0].label, 'local'); assert.ok(m.items[0].aliases.includes('别名')); assert.equal(m.items[0].sigs.length >= 1, true);
  const v = (x) => new Array(8).fill(x);
  const out = mergeLearned([{ d: '1', v: v(0.1), aspect: 1 }], [{ d: '1', v: v(0.1), aspect: 1 }, { d: '1', v: v(0.9), aspect: 1 }, { d: '2', v: v(0.4), aspect: 1 }]);
  assert.equal(out.length, 3);
});

test('REST thật: createRemote gửi đúng đường dẫn/header/phương thức (so sánh với PostgREST)', async () => {
  const calls = [];
  const cloud = { rest: async (path, opt = {}) => { calls.push([path, opt.method || 'GET', opt.prefer, opt.body]); if (path.startsWith('app_meta?key=eq.catalog&rev=eq.2')) return [{ rev: 3 }]; if (path.startsWith('app_meta?key=eq.learned')) return []; return []; } };
  const r = createRemote(cloud);
  await r.pullReports('2026-10-29T00:00:01.5+00:00');
  assert.match(calls[0][0], /^reports\?select=\*&order=updated_at\.asc,id\.asc&limit=500&offset=0&updated_at=gte\.2026-10-29T00%3A00%3A01\.5%2B00%3A00$/);
  await r.upsertReports([{ id: 'a' }]); assert.deepEqual(calls[1].slice(0, 3), ['reports?on_conflict=id', 'POST', 'resolution=merge-duplicates,return=minimal']);
  await r.markDeleted(['a', 'b']); assert.deepEqual(calls[2].slice(0, 3), ['reports?id=in.(a,b)', 'PATCH', 'return=minimal']);
  assert.equal(await r.updateMeta('catalog', {}, 2), 3); assert.equal(await r.updateMeta('learned', [], 5), null);
  const conflict = { rest: async () => { const e = new Error('dup'); e.status = 409; throw e; } };
  assert.equal(await createRemote(conflict).insertMeta('catalog', {}), false);
});

test('ánh xạ báo cáo ↔ hàng cloud đối xứng', () => { const r = rep('z', '2026-10-03', 7); assert.deepEqual(fromRow({ ...toRow(r), updated_at: 'x' }), r); });
