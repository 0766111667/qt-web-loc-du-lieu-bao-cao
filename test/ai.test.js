import test from 'node:test';
import assert from 'node:assert/strict';
import { applySuggestions, revertSuggestions, hasSuggested } from '../src/core/suggest.js';
import { pickRows, applyAi } from '../src/core/aiApply.js';
import { validate } from '../src/core/validate.js';
import { callVision, checkAi, AiError } from '../src/ocr/aiClient.js';
import { createCatalog } from '../src/core/catalog.js';

const cell = (value, confidence = 0.95) => ({ value, text: value == null ? '' : String(value), confidence, glyphs: [] });
const row = (rowIx, occ, proc, o = {}) => ({ rowIx, itemId: `i${rowIx}`, occ: cell(...[].concat(occ)), proc: cell(...[].concat(proc)), ...o });
// Đúng ca của người dùng: 6 dòng, hàng 4 đọc nhầm 5 thành 6 (tin cậy thấp); tổng in trên ảnh là 11/11.
const sample = () => {
  const rows = [row(0, 2, 2), row(1, 1, 1), row(2, 0, 0), row(3, [6, 0.3], [6, 0.3]), row(4, 0, 0), row(5, 3, 3)];
  const total = { rowIx: 6, occ: 11, proc: 11, confidence: 0.95 };
  return { rows, total, validation: validate(rows, total) };
};

test('đối chiếu với ca thật: 6→5 bị phát hiện (tổng 12 ≠ 11) ở đúng hàng 4', () => {
  const r = sample();
  assert.equal(r.validation.status, 'review');
  assert.deepEqual(pickRows(r).map((x) => x.rowIx), [3]);
});

test('suggest: một ô nghi ngờ + tổng chắc chắn → suy ra 5, đánh dấu suggested, và KHÔNG được coi là "ok"', () => {
  const { result, applied } = applySuggestions(sample());
  assert.equal(applied, 2);
  assert.equal(result.rows[3].occ.value, 5); assert.equal(result.rows[3].proc.value, 5);
  assert.equal(result.rows[3].occ.was.value, 6);
  const v = validate(result.rows, result.total);
  assert.equal(v.status, 'review');                                   // không bao giờ tự duyệt
  assert.deepEqual(v.issues.map((i) => i.code), ['suggested']);   // một cảnh báo cho mỗi dòng
  assert.ok(hasSuggested(result));
  assert.equal(sample().rows[3].occ.value, 6);                        // dữ liệu gốc không bị sửa tại chỗ
});

test('suggest: không đoán khi có ≥2 ô nghi ngờ, khi người dùng đã sửa tay, khi tổng không chắc, hoặc kết quả vô lý', () => {
  let r = sample(); r.rows[0].occ.confidence = 0.2;
  assert.equal(applySuggestions(r).result.rows[3].occ.value, 6);      // hai ô nghi ngờ trong cột occ → không suy
  r = sample(); r.rows[3].occ.edited = true; r.rows[3].proc.edited = true;
  assert.equal(applySuggestions(r).applied, 0);
  r = sample(); r.total.confidence = 0.1;
  assert.equal(applySuggestions(r).applied, 0);
  r = sample(); r.total.occ = 3;                                       // 3 − (2+1+0+0+3) = −3 → ô sẽ thành −3
  assert.equal(applySuggestions(r).result.rows[3].occ.value, 6);
  r = sample(); r.total = null; assert.equal(applySuggestions(r).applied, 0);
});

test('suggest: đã xử lý không được vượt phát sinh; revert khôi phục đúng giá trị gốc', () => {
  const r = sample(); r.rows[3].occ = cell(4, 0.95); r.total = { ...r.total, proc: 11 };
  r.rows[3].occ.value = 4; // occ=4 chắc chắn, proc=6 nghi ngờ; suy ra proc=5 ≤ 4? không → bỏ
  const out = applySuggestions({ ...r, rows: r.rows });
  assert.equal(out.result.rows[3].proc.value, 6);
  const s = applySuggestions(sample()).result;
  const back = revertSuggestions(s);
  assert.equal(back.rows[3].occ.value, 6); assert.equal(back.rows[3].occ.suggested, undefined); assert.equal(back.rows[3].occ.confidence, 0.3);
  assert.equal(validate(back.rows, back.total).status, 'review');
});

test('applyAi: AI trả 5 → tổng khớp, ô có nhãn AI + giá trị gốc để hoàn tác; không ghi đè ô người dùng đã sửa', () => {
  const catalog = createCatalog();
  const out = applyAi(sample(), [{ id: '3', name: '', occ: 5, processed: 5 }], { catalog });
  assert.equal(out.changed, 2);
  assert.equal(out.result.validation.status, 'ok');
  const c = out.result.rows[3].occ;
  assert.equal(c.source, 'ai'); assert.equal(c.was.value, 6); assert.equal(c.value, 5);
  const r = sample(); r.rows[3].occ.edited = true;
  const o2 = applyAi(r, [{ id: '3', name: '', occ: 5, processed: 5 }], { catalog });
  assert.equal(o2.result.rows[3].occ.value, 6); assert.equal(o2.result.rows[3].proc.value, 5);
  const o3 = applyAi(sample(), [{ id: '3', name: '', occ: null, processed: -2 }], { catalog });
  assert.equal(o3.changed, 0);                                         // AI không chắc → giữ nguyên
});

test('pickRows: bỏ qua dòng "skip" đúng chỉ số; tổng lệch không rõ dòng → gửi tất cả (tối đa 20)', () => {
  const r = sample(); r.rows[2].skip = true;
  r.validation = validate(r.rows.filter((x) => !x.skip), r.total);
  assert.deepEqual(pickRows(r).map((x) => x.rowIx), [3]);
  const q = sample(); q.rows[3] = row(3, 6, 6); q.validation = validate(q.rows, q.total);   // tất cả tự tin nhưng tổng lệch
  assert.equal(pickRows(q).length, 6);
});

// ---------- aiClient ----------
const H = (k) => async () => ({ 'x-access-key': k });
const resp = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => { if (body === undefined) throw new Error('x'); return body; } });
const noSleep = () => { const waits = []; const f = async (ms) => { waits.push(ms); }; f.waits = waits; return f; };

test('callVision: 503 → 503 → 200 tự thử lại 2 lần với độ trễ tăng dần', async () => {
  const seq = [resp(503, { error: 'x', code: 'upstream', retryable: true }), resp(502, { error: 'y', code: 'upstream', retryable: true }), resp(200, { rows: [{ id: '1' }] })];
  const sleep = noSleep(); let n = 0;
  const out = await callVision({ endpoint: '/api/vision', getHeaders: H('k'), body: {}, fetchImpl: async () => seq[n++], sleep });
  assert.equal(n, 3); assert.deepEqual(out.rows, [{ id: '1' }]); assert.deepEqual(sleep.waits, [1500, 4000]);
});

test('callVision: 401/500-cấu hình/không có mật khẩu KHÔNG thử lại (thử lại vô ích), lỗi mang code rõ ràng', async () => {
  let n = 0; const sleep = noSleep();
  await assert.rejects(callVision({ endpoint: 'e', getHeaders: H('k'), body: {}, fetchImpl: async () => { n++; return resp(401, { error: '访问密码错误', code: 'bad_key', retryable: false }); }, sleep }), (e) => e instanceof AiError && e.code === 'bad_key' && !e.retryable);
  assert.equal(n, 1);
  await assert.rejects(callVision({ endpoint: 'e', getHeaders: H('k'), body: {}, fetchImpl: async () => { n++; return resp(500, { error: 'm', code: 'not_configured', missing: ['GEMINI_API_KEY'] }); }, sleep }), (e) => e.code === 'not_configured' && e.missing[0] === 'GEMINI_API_KEY');
  assert.equal(n, 2);
  await assert.rejects(callVision({ endpoint: 'e', getHeaders: async () => null, body: {}, fetchImpl: async () => { throw new Error('không được gọi'); }, sleep }), (e) => e.code === 'no_key');
});

test('callVision: 500 không phải JSON (trang lỗi Vercel) → upstream, thử lại; 429 tôn trọng Retry-After; mạng đứt → network', async () => {
  const sleep = noSleep(); let n = 0;
  await assert.rejects(callVision({ endpoint: 'e', getHeaders: H('k'), body: {}, fetchImpl: async () => { n++; return resp(500, undefined); }, sleep }), (e) => e.code === 'upstream');
  assert.equal(n, 3);
  const s2 = noSleep(); n = 0;
  await callVision({ endpoint: 'e', getHeaders: H('k'), body: {}, fetchImpl: async () => (++n === 1 ? resp(429, { error: 'q', code: 'quota', retryable: true, retryAfter: 7 }) : resp(200, { rows: [] })), sleep: s2 });
  assert.deepEqual(s2.waits, [7000]);
  await assert.rejects(callVision({ endpoint: 'e', getHeaders: H('k'), body: {}, attempts: 1, fetchImpl: async () => { throw new TypeError('fetch failed'); }, sleep }), (e) => e.code === 'network' && e.retryable);
});

test('checkAi: phân biệt thiếu cấu hình / chưa có mật khẩu / sai mật khẩu / sẵn sàng / máy chủ cũ / sai địa chỉ', async () => {
  const f = (status, body) => async () => resp(status, body);
  let r = await checkAi({ endpoint: 'e', getHeaders: H('k'), fetchImpl: f(200, { ok: false, missing: ['GEMINI_API_KEY', 'APP_ACCESS_KEY'] }) });
  assert.equal(r.code, 'not_configured'); assert.match(r.message, /GEMINI_API_KEY、APP_ACCESS_KEY/); assert.equal(r.ready, false);
  r = await checkAi({ endpoint: 'e', getHeaders: async () => null, fetchImpl: f(200, { ok: true, missing: [], authorized: false }) }); assert.equal(r.code, 'no_key');
  r = await checkAi({ endpoint: 'e', getHeaders: H('x'), fetchImpl: f(200, { ok: true, missing: [], authorized: false }) }); assert.equal(r.code, 'bad_key');
  r = await checkAi({ endpoint: 'e', getHeaders: H('k'), fetchImpl: f(200, { ok: true, missing: [], authorized: true, model: 'm' }) }); assert.equal(r.ready, true); assert.equal(r.model, 'm');
  r = await checkAi({ endpoint: 'e', getHeaders: H('k'), fetchImpl: f(405, {}) }); assert.equal(r.ready, true); assert.ok(r.legacy);
  r = await checkAi({ endpoint: 'e', getHeaders: H('k'), fetchImpl: f(404, undefined) }); assert.equal(r.code, 'unreachable'); assert.equal(r.retryable, false);
  r = await checkAi({ endpoint: 'e', getHeaders: H('k'), fetchImpl: async () => { throw new TypeError('x'); } }); assert.equal(r.code, 'network'); assert.equal(r.retryable, true);
});
