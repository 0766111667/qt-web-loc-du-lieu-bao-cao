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
const H = (k) => async () => ({ authorization: `Bearer ${k}` });
const resp = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => { if (body === undefined) throw new Error('x'); return body; } });
const noSleep = () => { const waits = []; const f = async (ms) => { waits.push(ms); }; f.waits = waits; return f; };

test('callVision: lỗi tạm thời của máy chủ chỉ thử lại MỘT lần (tối đa 2 lần gọi)', async () => {
  const seq = [resp(503, { error: 'x', code: 'upstream', retryable: true }), resp(200, { items: [{ id: '1' }] })];
  const sleep = noSleep(); let n = 0;
  const out = await callVision({ endpoint: '/api/vision', getHeaders: H('k'), body: {}, fetchImpl: async () => seq[n++], sleep });
  assert.equal(n, 2); assert.deepEqual(out.items, [{ id: '1' }]); assert.deepEqual(sleep.waits, [1500]);
  n = 0;
  await assert.rejects(callVision({ endpoint: 'e', getHeaders: H('k'), body: {}, fetchImpl: async () => { n++; return resp(500, undefined); }, sleep }), (e) => e.code === 'upstream');
  assert.equal(n, 2);
});

test('callVision: hết hạn mức / rate limit / cấu hình / đăng nhập KHÔNG thử lại (mỗi lần thử lại đều tốn hạn mức)', async () => {
  const sleep = noSleep();
  for (const [status, code] of [[429, 'quota_minute'], [429, 'quota_day'], [429, 'daily_limit'], [429, 'rate_limited'], [500, 'not_configured'], [502, 'gemini_key'], [403, 'forbidden']]) {
    let n = 0;
    await assert.rejects(callVision({ endpoint: 'e', getHeaders: H('k'), body: {}, fetchImpl: async () => { n++; return resp(status, { error: 'm', code, retryable: code === 'quota_minute', retryAfter: 23 }); }, sleep }), (e) => e instanceof AiError && e.code === code);
    assert.equal(n, 1, code);
  }
  assert.equal(sleep.waits.length, 0);
  let e1; try { await callVision({ endpoint: 'e', getHeaders: H('k'), body: {}, fetchImpl: async () => resp(429, { error: 'q', code: 'quota_minute', retryAfter: 23 }), sleep }); } catch (e) { e1 = e; }
  assert.equal(e1.retryAfter, 23);
  await assert.rejects(callVision({ endpoint: 'e', getHeaders: async () => null, body: {}, fetchImpl: async () => { throw new Error('không được gọi'); }, sleep }), (e) => e.code === 'no_key');
});

test('callVision: token hết hạn → lấy token mới đúng một lần rồi gọi lại; mạng đứt → network', async () => {
  const sleep = noSleep(); const forced = []; let n = 0;
  const out = await callVision({ endpoint: 'e', getHeaders: async (f) => { forced.push(!!f); return { authorization: 'Bearer t' }; }, body: {}, fetchImpl: async () => (++n === 1 ? resp(401, { error: 'x', code: 'unauthorized' }) : resp(200, { items: [] })), sleep });
  assert.deepEqual(forced, [false, true]); assert.deepEqual(out.items, []);
  n = 0;
  await assert.rejects(callVision({ endpoint: 'e', getHeaders: async () => ({ authorization: 'Bearer t' }), body: {}, fetchImpl: async () => { n++; return resp(401, { error: 'x', code: 'unauthorized' }); }, sleep }), (e) => e.code === 'unauthorized');
  assert.equal(n, 2);
  await assert.rejects(callVision({ endpoint: 'e', getHeaders: H('k'), body: {}, attempts: 1, fetchImpl: async () => { throw new TypeError('fetch failed'); }, sleep }), (e) => e.code === 'network' && e.retryable);
});

test('checkAi: phân biệt thiếu cấu hình / chưa đăng nhập / không có quyền / sẵn sàng / sai địa chỉ / probe báo hết hạn mức', async () => {
  const f = (status, body) => async () => resp(status, body);
  let r = await checkAi({ endpoint: 'e', getHeaders: H('k'), fetchImpl: f(200, { ok: false, missing: ['GEMINI_API_KEY'] }) });
  assert.equal(r.ready, false); assert.equal(r.code, 'not_configured'); assert.deepEqual(r.missing, ['GEMINI_API_KEY']);
  r = await checkAi({ endpoint: 'e', getHeaders: async () => null, fetchImpl: f(200, { ok: true, missing: [], authorized: false }) }); assert.equal(r.code, 'no_key');
  r = await checkAi({ endpoint: 'e', getHeaders: H('x'), fetchImpl: f(200, { ok: true, missing: [], authorized: false }) }); assert.equal(r.code, 'unauthorized');
  r = await checkAi({ endpoint: 'e', getHeaders: H('k'), fetchImpl: f(200, { ok: true, missing: [], authorized: true, model: 'm', usage: { n: 1, max: 5 } }) }); assert.equal(r.ready, true); assert.equal(r.model, 'm');
  r = await checkAi({ endpoint: 'e', getHeaders: H('k'), fetchImpl: f(200, { ok: true, missing: [], authorized: true, usage: { n: 5, max: 5 } }) }); assert.equal(r.code, 'daily_limit');
  r = await checkAi({ endpoint: 'e', getHeaders: H('k'), fetchImpl: f(404, undefined) }); assert.equal(r.code, 'unreachable'); assert.equal(r.retryable, false);
  r = await checkAi({ endpoint: 'e', getHeaders: H('k'), fetchImpl: async () => { throw new TypeError('x'); } }); assert.equal(r.code, 'network'); assert.equal(r.retryable, true);
  let url; r = await checkAi({ endpoint: '/api/vision', probe: true, getHeaders: H('k'), fetchImpl: async (u) => { url = u; return resp(200, { ok: true, authorized: true, model: 'm', probe: { ok: false, code: 'quota_minute', retryAfter: 31, detail: 'quota' } }); } });
  assert.equal(url, '/api/vision?probe=1'); assert.equal(r.ready, false); assert.equal(r.code, 'quota_minute'); assert.equal(r.retryAfter, 31);
});

// ---------- bộ giải tổ hợp cục bộ ----------
// Ô số với chữ số thay thế: g(d, margin, alt)
const g = (d, m = 1, alt = []) => ({ d: String(d), m, alt: alt.map(String), v: [], aspect: 0.6 });
const gc = (glyphs, conf) => ({ value: Number(glyphs.map((x) => x.d).join('')), text: glyphs.map((x) => x.d).join(''), confidence: conf, glyphs });
const sure = (n) => gc(String(n).split('').map((d) => g(d, 1)), 0.95);
const mk = (occ, proc, total) => { const rows = occ.map((o, i) => ({ rowIx: i, itemId: `i${i}`, occ: o, proc: proc[i] })); return { rows, total, validation: validate(rows, total) }; };

test('solver: hai ô nghi ngờ cùng cột — chữ số thay thế gần nhất + tổng chọn ra lời giải duy nhất (suy luận số học đơn thuần không làm được)', async () => {
  const { autoFix } = await import('../src/core/solver.js');
  // thực tế 12 + 3 + 8 + 5 = 28. 12 đọc thành 17 (7 gần 2), 8 đọc thành 6 (6 gần 8), tổng in 28.
  const occ = [gc([g(1), g(7, 0.03, [2])], 0.25), sure(3), gc([g(6, 0.05, [8])], 0.4), sure(5)];
  const proc = occ.map((c) => ({ ...c }));
  const r = mk(occ, proc, { rowIx: 4, occ: 28, proc: 28, confidence: 0.95 });
  assert.equal(r.validation.status, 'review');
  const out = autoFix(r);
  assert.ok(out.applied >= 4);
  assert.deepEqual(out.result.rows.map((x) => x.occ.value), [12, 3, 8, 5]);
  assert.equal(out.result.rows[0].occ.source, 'solver'); assert.equal(out.result.rows[0].occ.was.value, 17);
  assert.equal(r.rows[0].occ.value, 17);                                   // không sửa dữ liệu gốc
  assert.equal(validate(out.result.rows, out.result.total).status, 'review');   // vẫn cần người xác nhận (suggested)
});

test('solver: không đoán khi có nhiều lời giải ngang nhau, khi tổng không chắc, khi người dùng đã sửa, hoặc đã khớp', async () => {
  const { autoFix, solveColumn } = await import('../src/core/solver.js');
  // hai ô giống hệt nhau, đều có thể là 6 hoặc 8; tổng cần 14 → hai cách (6+8, 8+6) cùng chi phí → mơ hồ
  const amb = [gc([g(6, 0.05, [8])], 0.4), gc([g(6, 0.05, [8])], 0.4)];
  const s = solveColumn(amb, 14); assert.ok(s && s.unique === false);
  const r = mk(amb.map((c) => ({ ...c })), amb.map((c) => ({ ...c })), { rowIx: 2, occ: 14, proc: 14, confidence: 0.95 });
  assert.equal(autoFix(r).applied, 0);
  const q = mk([gc([g(6, 0.05, [8])], 0.4), sure(1)], [sure(0), sure(0)], { rowIx: 2, occ: 9, proc: 0, confidence: 0.1 });
  assert.equal(autoFix(q).applied, 0);                                    // tổng không chắc
  const e = mk([{ ...gc([g(6, 0.05, [8])], 0.4), edited: true }, sure(1)], [sure(0), sure(0)], { rowIx: 2, occ: 9, proc: 0, confidence: 0.95 });
  assert.equal(autoFix(e).applied, 0);                                    // ô đã sửa tay
  const ok = mk([sure(2), sure(1)], [sure(0), sure(0)], { rowIx: 2, occ: 3, proc: 0, confidence: 0.95 });
  assert.equal(autoFix(ok).applied, 0);                                   // đã khớp
});

test('solver: ô nghi ngờ duy nhất không có chữ số thay thế → vẫn suy ra từ tổng (như cũ); đã xử lý không vượt phát sinh', async () => {
  const { autoFix } = await import('../src/core/solver.js');
  const r = mk([sure(2), gc([g(6, 0.02)], 0.2)], [sure(2), gc([g(6, 0.02)], 0.2)], { rowIx: 2, occ: 7, proc: 7, confidence: 0.95 });
  const out = autoFix(r);
  assert.equal(out.result.rows[1].occ.value, 5); assert.equal(out.result.rows[1].proc.value, 5);
  const bad = mk([sure(2), gc([g(6, 0.02)], 0.2)], [sure(2), gc([g(6, 0.02)], 0.2)], { rowIx: 2, occ: 4, proc: 7, confidence: 0.95 });
  const o2 = autoFix(bad);
  assert.equal(o2.result.rows[1].proc.value === 5 && o2.result.rows[1].occ.value === 2, false);   // 5 > 2 → bị loại
});

// ---------- kế hoạch & áp kết quả AI theo ô ----------
test('planAi: chỉ gửi các ô nghi ngờ (kèm ứng viên), không gửi cả dòng; ảnh đã ổn thì không gửi gì', async () => {
  const { planAi } = await import('../src/core/aiPlan.js');
  const occ = [sure(2), gc([g(6, 0.03, [5])], 0.25), sure(3)];
  const r = mk(occ, occ.map((c) => ({ ...c })), { rowIx: 3, occ: 10, proc: 10, confidence: 0.95 });
  const plan = planAi(r);
  assert.deepEqual(plan.map((p) => [p.kind, p.rowIx]), [['occ', 1], ['proc', 1]]);
  assert.deepEqual(plan[0].candidates, ['6', '5']);
  const fine = mk([sure(2)], [sure(2)], { rowIx: 1, occ: 2, proc: 2, confidence: 0.95 });
  assert.deepEqual(planAi(fine), []);
});

test('applyAiItems: ghi đúng ô theo chỉ số kế hoạch, đánh dấu AI + giá trị gốc, không đè ô sửa tay, kiểm tra lại bằng tổng; AI "không chắc" thì giữ nguyên', async () => {
  const { planAi, applyAiItems } = await import('../src/core/aiPlan.js');
  const occ = [sure(2), gc([g(6, 0.03, [5])], 0.25), sure(3)];
  const r = mk(occ, occ.map((c) => ({ ...c })), { rowIx: 3, occ: 10, proc: 10, confidence: 0.95 });
  const plan = planAi(r);
  const out = applyAiItems(r, plan, [{ id: '0', value: 5, text: '' }, { id: '1', value: 5, text: '' }, { id: '9', value: 1, text: '' }]);
  assert.equal(out.changed, 2); assert.equal(out.result.validation.status, 'ok');
  assert.equal(out.result.rows[1].occ.source, 'ai'); assert.equal(out.result.rows[1].occ.was.value, 6);
  const none = applyAiItems(r, plan, [{ id: '0', value: null, text: '' }, { id: '1', value: -3, text: '' }]);
  assert.equal(none.changed, 0); assert.equal(none.result.validation.status, 'review');
  const ed = mk([sure(2), { ...gc([g(6, 0.03, [5])], 0.25), edited: true }, sure(3)], occ.map((c) => ({ ...c })), { rowIx: 3, occ: 10, proc: 10, confidence: 0.95 });
  assert.equal(applyAiItems(ed, plan, [{ id: '0', value: 5, text: '' }]).result.rows[1].occ.value, 6);
});
