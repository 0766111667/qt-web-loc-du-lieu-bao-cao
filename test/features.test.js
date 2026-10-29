import test from 'node:test';
import assert from 'node:assert/strict';
import { findAnomalies, describeAnomaly } from '../src/core/anomaly.js';
import { coverage, sameDateReports } from '../src/core/coverage.js';
import { aggregate, compareMonths, prevMonthOf } from '../src/core/aggregate.js';
import { createCatalog } from '../src/core/catalog.js';
import { buildXlsx, buildReportXlsx, zip } from '../src/core/xlsx.js';

const cat = createCatalog();
const rep = (id, date, rows) => ({ id, name: `${id}.png`, date, month: date.slice(0, 7), rows: Object.entries(rows).map(([itemId, [occ, proc]]) => ({ itemId, occ, proc })) });
const day = (m, d) => `2026-${m}-${String(d).padStart(2, '0')}`;

test('bất thường: spike chỉ khi vượt rõ so với 14 ngày trước; ngày bình thường không báo', () => {
  const calm = Array.from({ length: 10 }, (_, i) => rep(`c${i}`, day('10', i + 1), { d1: [2 + (i % 2), 2] }));   // 2,3,2,3,…
  assert.deepEqual(findAnomalies(calm, cat, '2026-10').filter((a) => a.type === 'spike'), []);
  const spiked = [...calm.slice(0, 9), rep('s', day('10', 10), { d1: [9, 9] })];
  const a = findAnomalies(spiked, cat, '2026-10').find((x) => x.type === 'spike');
  assert.equal(a.itemId, 'd1'); assert.equal(a.value, 9); assert.equal(a.date, '2026-10-10'); assert.match(describeAnomaly(a), /10-10 发生 9 次/);
  assert.equal(findAnomalies(spiked.slice(0, 3), cat, '2026-10').length, 0);   // quá ít dữ liệu: không báo bừa
});

test('bất thường: tháng tăng ≥1,5 lần và tồn đọng; sắp xếp spike trước', () => {
  const sep = Array.from({ length: 5 }, (_, i) => rep(`p${i}`, day('09', i + 1), { d2: [2, 2] }));
  const oct = Array.from({ length: 5 }, (_, i) => rep(`o${i}`, day('10', i + 1), { d2: [4, 1] }));
  const out = findAnomalies([...sep, ...oct], cat, '2026-10');
  const types = out.map((x) => x.type);
  assert.ok(types.includes('month_up') && types.includes('backlog'));
  assert.equal(out.find((x) => x.type === 'month_up').ratio, 2); assert.equal(out.find((x) => x.type === 'backlog').value, 15);
  assert.ok(out.every((x, i) => i === 0 || out[i - 1].severity >= x.severity));
  assert.deepEqual(findAnomalies([], cat, '2026-10'), []);
});

test('độ đầy đủ: ngày thiếu (tháng hiện tại tính đến hôm qua, tháng đã qua tính đến cuối tháng), bỏ cuối tuần, trùng ngày', () => {
  const r = [rep('a', '2026-10-01', { d1: [1, 1] }), rep('b', '2026-10-05', { d1: [1, 1] })];
  assert.deepEqual(coverage(r, '2026-10', { today: '2026-10-07' }).missing, ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-06']);
  assert.deepEqual(coverage(r, '2026-10', { today: '2026-10-07', skipWeekends: true }).missing, ['2026-10-02', '2026-10-06']);   // 3,4/10 là T7, CN
  assert.equal(coverage(r, '2026-10', { today: '2026-11-15' }).missing.at(-1), '2026-10-31');
  assert.equal(coverage(r, '2026-10', { today: '2026-10-05' }).missing.includes('2026-10-05'), false);
  const d = coverage([rep('a', '2026-10-01', { d1: [3, 3] }), rep('b', '2026-10-01', { d1: [3, 3] }), rep('c', '2026-10-02', { d1: [1, 1] }), rep('d', '2026-10-02', { d1: [2, 2] })], '2026-10', { today: '2026-10-03' }).duplicates;
  assert.deepEqual(d.map((x) => [x.date, x.identical]), [['2026-10-01', true], ['2026-10-02', false]]);
  assert.deepEqual(sameDateReports(r, '2026-10-05', 'b'), []); assert.equal(sameDateReports(r, '2026-10-05', 'zz')[0].occ, 1);
  assert.deepEqual(coverage([], '2026-10', {}).missing, []);
});

test('so sánh tháng: delta, % (null khi tháng trước = 0), prevMonthOf qua năm', () => {
  const reports = [rep('a', '2026-09-10', { d1: [4, 4], d2: [0, 0] }), rep('b', '2026-10-10', { d1: [6, 5], d2: [3, 3] })];
  const cmp = compareMonths(aggregate(reports, cat, '2026-10'), aggregate(reports, cat, '2026-09'));
  assert.deepEqual([cmp.rows[0].occ, cmp.rows[0].prevOcc, cmp.rows[0].delta, cmp.rows[0].pct], [6, 4, 2, 50]);
  assert.equal(cmp.rows[1].pct, null); assert.deepEqual([cmp.totals.occ, cmp.totals.prevOcc, cmp.totals.delta], [9, 4, 5]);
  assert.equal(prevMonthOf('2026-01'), '2025-12'); assert.equal(prevMonthOf('2026-10'), '2026-09');
});

// Đọc lại zip bằng chính bộ giải nén tối thiểu: kiểm tra CRC từng tệp để chắc file không hỏng.
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22; assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const out = {};
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nl));
    const ln = dv.getUint16(off + 26, true), start = off + 30 + ln + dv.getUint16(off + 28, true);
    const data = bytes.slice(start, start + size);
    let c = 0xffffffff; for (const b of data) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
    assert.equal((c ^ 0xffffffff) >>> 0, crc, `CRC ${name}`);
    out[name] = new TextDecoder().decode(data); p += 46 + nl;
  }
  return out;
}

test('xlsx: zip hợp lệ (CRC đúng), có đủ phần bắt buộc, biểu đồ trỏ đúng cột, ký tự đặc biệt được escape', () => {
  const z = readZip(zip([{ name: 'a.txt', data: 'xin chào 你好' }, { name: 'b.txt', data: new Uint8Array([1, 2, 3]) }]));
  assert.equal(z['a.txt'], 'xin chào 你好');
  const rows = [{ id: 'd1', label: 'A & <B>', name: 'x', occ: 5, proc: 3, backlog: 2, pct: 100 }];
  const agg = { month: '2026-10', reportCount: 1, rows, totals: { occ: 5, proc: 3, backlog: 2 } };
  const cmp = { rows: [{ id: 'd1', label: 'A & <B>', occ: 5, prevOcc: 2, delta: 3, pct: 150 }], totals: { occ: 5, prevOcc: 2, delta: 3, pct: 150 } };
  const x = readZip(buildReportXlsx({ agg, cmp, daily: { dates: ['2026-10-01'], items: [{ id: 'd1', label: 'A & <B>' }], values: new Map([['2026-10-01', new Map([['d1', 5]])]]) }, anomalies: [], monthLabel: '2026年10月', prevLabel: '9月' }));
  for (const f of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/charts/chart1.xml', 'xl/drawings/drawing1.xml']) assert.ok(x[f], f);
  assert.match(x['xl/worksheets/sheet1.xml'], /A &amp; &lt;B&gt;/);
  assert.match(x['xl/charts/chart1.xml'], /\$C\$2:\$C\$2/); assert.match(x['xl/charts/chart1.xml'], /\$G\$2:\$G\$2/);
  assert.equal(Object.keys(readZip(buildXlsx([{ name: 'S', rows: [['a', 1]] }]))).some((k) => k.includes('chart')), false);
});
