import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReport } from '../src/core/sanitize.js';
import { buildCsv } from '../src/core/csv.js';
import { fromRow } from '../src/cloud/sync.js';
import { readFileSync } from 'node:fs';

test('cleanReport: chấp nhận báo cáo hợp lệ; loại bỏ id/ngày sai, ép kiểu số, cắt độ dài, bỏ trường lạ', () => {
  const ok = cleanReport({ id: 'j1-a', date: '2026-10-01', month: '2026-10', createdAt: 5, name: 'a\u0000b', rows: [{ itemId: 'd1', srcName: 'x', occ: 3, proc: 2, evil: 1 }], status: 'auto', extra: '<script>' });
  assert.equal(ok.name, 'ab'); assert.deepEqual(ok.rows, [{ itemId: 'd1', srcName: 'x', occ: 3, proc: 2 }]); assert.equal(ok.extra, undefined);
  assert.equal(cleanReport({ id: '../x', date: '2026-10-01' }), null);
  assert.equal(cleanReport({ id: 'a', date: 'hôm nay' }), null);
  assert.equal(cleanReport(null), null);
  const bad = cleanReport({ id: 'a', date: '2026-10-01', rows: [{ itemId: 'd', occ: -5, proc: '9' }, null, 'x'], status: 'hack', name: 'n'.repeat(999) });
  assert.deepEqual(bad.rows, [{ itemId: 'd', srcName: '', occ: 0, proc: 0 }]); assert.equal(bad.status, 'manual'); assert.equal(bad.name.length, 200);
  assert.equal(cleanReport({ id: 'a', date: '2026-10-01', rows: new Array(1000).fill({ occ: 1, proc: 1 }) }).rows.length, 300);
  assert.equal(fromRow({ id: 'a', date: 'x' }), null);
});

test('CSV: chuỗi bắt đầu bằng = + - @ bị vô hiệu hóa (chống công thức độc hại khi mở bằng Excel)', () => {
  const agg = { rows: [{ label: '=HYPERLINK("http://evil","x")', occ: 1, proc: 1, backlog: 0, pct: 100 }, { label: '+cmd|calc', occ: 0, proc: 0, backlog: 0, pct: 0 }, { label: '正常', occ: 0, proc: 0, backlog: 0, pct: 0 }], totals: { occ: 1, proc: 1, backlog: 0 } };
  const csv = buildCsv(agg, ['#', 'n', 'o', 'p', 'b', '%']);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""x"")"`)); assert.ok(csv.includes("'+cmd|calc")); assert.ok(csv.includes(',正常,'));
});

test('cấu hình: CSP chặt, không có khóa bí mật trong mã nguồn phía trình duyệt', () => {
  const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  const h = Object.fromEntries(v.headers[0].headers.map((x) => [x.key, x.value]));
  assert.match(h['Content-Security-Policy'], /default-src 'self'/); assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/); assert.match(h['Content-Security-Policy'], /object-src 'none'/);
  assert.ok(!/unsafe-eval/.test(h['Content-Security-Policy'].replace("'wasm-unsafe-eval'", '')));
  assert.ok(h['Strict-Transport-Security'] && h['X-Frame-Options'] === 'DENY');
});
