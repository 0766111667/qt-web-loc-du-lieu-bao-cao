import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadImage, expected, seeds } from './helpers.js';
import { detectTable } from '../src/core/grid.js';
import { cellRect, inkGray, signature, spanRect } from '../src/core/cells.js';
import { readNumber } from '../src/core/digits.js';
import { analyzeImage } from '../src/ocr/pipeline.js';
import { createCatalog, matchByName, matchBySignature, addItem, mergeItems, removeItem, setHidden, moveItem, addSignature, orderedItems } from '../src/core/catalog.js';
import { validate, MIN_CONFIDENCE } from '../src/core/validate.js';
import { aggregate, localDate, monthOf } from '../src/core/aggregate.js';
import { buildCsv } from '../src/core/csv.js';
import { learnDigits } from '../src/core/learn.js';
import { sigDistance } from '../src/core/cells.js';

const calibration = JSON.parse(await readFile(new URL('../src/core/calibration.json', import.meta.url), 'utf8'));
const files = Object.keys(expected);
const images = Object.fromEntries(await Promise.all(files.map(async (f) => [f, await loadImage(f)])));
const full = { catalog: createCatalog(calibration), templates: [...seeds, ...calibration.digits] };

test('grid: tìm đủ 16 hàng dữ liệu + dòng tổng và các cột trên cả hai ảnh (khác kích thước)', () => {
  for (const f of files) {
    const t = detectTable(images[f]);
    assert.equal(t.rows.length, 17, f);
    for (const role of ['name', 'occ', 'proc']) assert.ok(t.cols[role], `${f} thiếu cột ${role}`);
    assert.ok(t.cols.name[1] - t.cols.name[0] > 150);
  }
  assert.notEqual(images['sample-a.jpg'].width, images['sample-b.jpg'].width);
});

test('chữ số: kiểm tra chéo — học từ ảnh kia, mọi lần đọc sai đều có độ tin cậy thấp (không có "sai mà tự tin")', () => {
  for (const f of files) {
    const other = files.find((x) => x !== f);
    const to = detectTable(images[other]);
    let learned = [];
    for (const k of ['occ', 'proc']) to.rows.forEach((_, i) => {
      const r = readNumber(inkGray(images[other], cellRect(to, i, k)), seeds);
      learned = learnDigits(learned, r.glyphs, expected[other][k][i]);
    });
    const tpl = [...seeds, ...learned];
    const t = detectTable(images[f]);
    let ok = 0, total = 0;
    for (const k of ['occ', 'proc']) t.rows.forEach((_, i) => {
      const r = readNumber(inkGray(images[f], cellRect(t, i, k)), tpl);
      total++;
      if (r.value === expected[f][k][i]) ok++;
      else assert.ok(r.confidence < MIN_CONFIDENCE, `${f} ${k}[${i}] đọc "${r.text}" sai (đúng ${expected[f][k][i]}) nhưng độ tin cậy ${r.confidence}`);
    });
    assert.ok(ok / total >= 0.9, `${f}: chỉ đúng ${ok}/${total}`);
  }
});

test('tên hạng mục: chữ ký học từ ảnh này nhận ra đúng hạng mục ở ảnh kia (không OCR, không nhầm)', () => {
  for (const f of files) {
    const other = files.find((x) => x !== f);
    const to = detectTable(images[other]);
    let cat = createCatalog();
    to.rows.slice(0, 16).forEach((_, i) => { cat = addSignature(cat, `d${i + 1}`, signature(inkGray(images[other], cellRect(to, i, 'name')))); });
    const t = detectTable(images[f]);
    t.rows.slice(0, 16).forEach((_, i) => {
      const m = matchBySignature(cat, signature(inkGray(images[f], cellRect(t, i, 'name'))));
      assert.ok(m, `${f} hàng ${i + 1} không khớp chữ ký`);
      assert.equal(m.id, `d${i + 1}`, `${f} hàng ${i + 1} khớp nhầm`);
      assert.ok(m.margin >= 0.06, `${f} hàng ${i + 1} biên quá sát (${m.margin.toFixed(3)})`);
    });
  }
});

test('đầu-cuối: cả hai ảnh mẫu tự duyệt, đúng số liệu, đúng tổng, nhận ra dòng tổng', async () => {
  for (const f of files) {
    const res = await analyzeImage(images[f], full);
    assert.equal(res.validation.status, 'ok', `${f}: ${JSON.stringify(res.validation.issues)}`);
    assert.equal(res.rows.length, 16);
    res.rows.forEach((r, i) => {
      assert.equal(r.itemId, `d${i + 1}`);
      assert.equal(r.occ.value, expected[f].occ[i]);
      assert.equal(r.proc.value, expected[f].proc[i]);
    });
    assert.deepEqual([res.total.occ, res.total.proc], [expected[f].occ[16], expected[f].proc[16]]);
  }
});

test('an toàn: chỉ với mẫu font (chưa hiệu chuẩn), kết quả "ok" nếu có thì phải đúng hoàn toàn', async () => {
  for (const f of files) {
    const res = await analyzeImage(images[f], { catalog: createCatalog(calibration), templates: seeds });
    if (res.validation.status === 'ok') res.rows.forEach((r, i) => { assert.equal(r.occ.value, expected[f].occ[i]); assert.equal(r.proc.value, expected[f].proc[i]); });
  }
});

test('hạng mục mới / tên lạ: không tự gán, chuyển sang xem lại', async () => {
  const cat = createCatalog(calibration);
  cat.items[3].sigs = []; // quên chữ ký hạng mục 4 => tên lạ
  const res = await analyzeImage(images['sample-a.jpg'], { catalog: cat, templates: full.templates });
  assert.equal(res.validation.status, 'review');
  assert.ok(res.validation.issues.some((x) => x.code === 'unknown_name' && x.row === 3));
  assert.equal(res.rows[3].itemId, null);
});

test('validate: tổng lệch, đã xử lý > phát sinh, ô không đọc được, trùng hạng mục', () => {
  const cell = (v, c = 1) => ({ value: v, confidence: c });
  const row = (id, o, p, c = 1) => ({ itemId: id, occ: cell(o, c), proc: cell(p, c) });
  assert.equal(validate([row('a', 2, 2), row('b', 1, 1)], { occ: 3, proc: 3 }).status, 'ok');
  assert.ok(validate([row('a', 2, 2), row('b', 1, 1)], { occ: 4, proc: 3 }).issues.some((i) => i.code === 'sum_mismatch'));
  assert.ok(validate([row('a', 1, 2)], { occ: 1, proc: 2 }).issues.some((i) => i.code === 'processed_exceeds'));
  assert.equal(validate([row('a', 1, 2)], { occ: 1, proc: 2 }, { requireProcessedLE: false }).status, 'ok');
  assert.ok(validate([{ itemId: 'a', occ: cell(null, 0), proc: cell(1) }], { occ: 1, proc: 1 }).issues.some((i) => i.code === 'unreadable'));
  assert.ok(validate([row('a', 1, 1)], null).issues.some((i) => i.code === 'no_total'));
  assert.ok(validate([row('a', 1, 1), row('a', 1, 1)], { occ: 2, proc: 2 }).issues.some((i) => i.code === 'duplicate_item'));
  // độ tin cậy thấp nhưng tổng khớp => ghi chú, không chặn; tổng lệch => chặn
  const low = validate([row('a', 1, 1, 0.1)], { occ: 1, proc: 1 });
  assert.equal(low.status, 'ok'); assert.equal(low.notes.length, 1);
  assert.equal(validate([row('a', 1, 1, 0.1)], { occ: 2, proc: 1 }).status, 'review');
});

test('danh mục động: thêm, gộp, ẩn, xóa, đổi thứ tự, so khớp tên gần đúng', () => {
  let cat = createCatalog();
  assert.equal(matchByName(cat, ' 证书问题 ').id, 'd3');
  assert.equal(matchByName(cat, '证书向题').id, 'd3'); // OCR sai 1 ký tự
  assert.equal(matchByName(cat, '完全不同的名称xyz'), null);
  const added = addItem(cat, { name: '新问题', label: '新问题（显示名）' });
  cat = added.catalog;
  assert.equal(cat.items.length, 17);
  assert.equal(matchByName(cat, '新问题').id, added.id);
  cat = moveItem(cat, added.id, -1);
  assert.equal(cat.items[15].id, added.id);
  const merged = mergeItems(cat, added.id, 'd1');
  assert.deepEqual(merged.map, { [added.id]: 'd1' });
  assert.equal(matchByName(merged.catalog, '新问题').id, 'd1'); // tên cũ nay trỏ về mục đích
  cat = setHidden(cat, 'd2', true);
  assert.equal(orderedItems(cat).length, 16);
  assert.equal(orderedItems(cat, true).length, 17);
  assert.equal(removeItem(cat, 'd2').items.some((x) => x.id === 'd2'), false);
});

test('tổng hợp tháng: cộng dồn phát sinh/đã xử lý theo hạng mục, bỏ mục ẩn, tính tồn và %', () => {
  let cat = createCatalog();
  const rep = (month, rows) => ({ month, rows: rows.map(([itemId, occ, proc]) => ({ itemId, occ, proc })) });
  const reports = [rep('2026-10', [['d1', 2, 1], ['d2', 1, 1]]), rep('2026-10', [['d1', 3, 3]]), rep('2026-09', [['d1', 99, 99]])];
  const agg = aggregate(reports, cat, '2026-10');
  assert.equal(agg.reportCount, 2);
  assert.deepEqual([agg.rows[0].occ, agg.rows[0].proc, agg.rows[0].backlog], [5, 4, 1]);
  assert.deepEqual(agg.totals, { occ: 6, proc: 5, backlog: 1 });
  assert.equal(Math.round(agg.rows[0].pct), 83);
  cat = setHidden(cat, 'd2', true);
  assert.equal(aggregate(reports, cat, '2026-10').totals.occ, 5);
  assert.match(buildCsv(agg, ['序号', '问题类型', '发生次数', '已处理', '未处理', '占比例(%)']), /^\ufeff序号,问题类型,发生次数/);
});

test('ngày theo giờ địa phương, không lệch UTC', () => {
  assert.equal(localDate(new Date(2026, 9, 1, 0, 30)), '2026-10-01'); // 00:30 giờ địa phương vẫn là ngày 1
  assert.equal(monthOf('2026-10-01'), '2026-10');
});
