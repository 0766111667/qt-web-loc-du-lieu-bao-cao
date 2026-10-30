// Kế hoạch gửi AI: chỉ gửi những Ô thật sự không chắc (ảnh rất nhỏ), kèm ứng viên từ bộ đọc cục bộ; không gửi cả dòng hay cả ảnh.
// Kết quả AI được áp lại bằng applyAiItems rồi luôn kiểm tra lại bằng tổng.
import { matchByName } from './catalog.js';
import { validate } from './validate.js';
import { isSuspect, cellOptions } from './solver.js';

export const MAX_ITEMS_PER_IMAGE = 24;
const isCount = (v) => Number.isInteger(v) && v >= 0 && v < 1e6;

// plan: [{ kind: 'occ'|'proc'|'name'|'tot_occ'|'tot_proc', rowIx?, candidates?: string[] }]
export function planAi(result) {
  const v = result.validation;
  if (!v || v.status === 'ok') return [];
  const plan = [];
  const live = result.rows.filter((r) => !r.skip);
  const flagged = new Set();
  for (const i of v.issues) if (i.row != null && live[i.row]) flagged.add(live[i.row]);
  const mismatch = v.issues.some((i) => ['sum_mismatch', 'unreadable_total'].includes(i.code));
  for (const r of live) {
    for (const key of ['occ', 'proc']) {
      const c = r[key];
      if (c.edited || c.source === 'ai') continue;
      // ô nghi ngờ trong dòng bị cảnh báo; hoặc (tổng lệch mà không có ô nào đáng ngờ) mọi ô của dòng bị cảnh báo đều gửi
      if (isSuspect(c, 0.75) || (flagged.has(r) && c.confidence < 0.9)) {
        const cand = cellOptions(c).map((o) => String(o.value)).slice(0, 3);
        plan.push({ kind: key, rowIx: r.rowIx, candidates: cand });
      }
    }
    if (!r.itemId && !r.srcName) plan.push({ kind: 'name', rowIx: r.rowIx });
  }
  if (!plan.some((p) => p.kind === 'occ' || p.kind === 'proc') && mismatch) {
    // Không ô nào đáng ngờ nhưng tổng lệch: có thể chính ô “tổng” bị đọc sai → hỏi lại tổng trước.
    if (result.total) { plan.push({ kind: 'tot_occ', candidates: [] }, { kind: 'tot_proc', candidates: [] }); }
  } else if (result.total && result.total.confidence != null && result.total.confidence < 0.6 && !result.total.manual) {
    plan.push({ kind: 'tot_occ', candidates: [] }, { kind: 'tot_proc', candidates: [] });
  }
  return plan.slice(0, MAX_ITEMS_PER_IMAGE);
}

// answers: [{ id, value, text }] trong đó id là chỉ số (chuỗi) của mục trong plan. Không ghi đè ô người dùng đã sửa.
export function applyAiItems(result, plan, answers, { catalog, settings } = {}) {
  const next = { ...result, rows: result.rows.map((r) => ({ ...r })), total: result.total && { ...result.total } };
  let changed = 0, answered = 0;
  for (const a of answers || []) {
    const p = plan[Number(a.id)];
    if (!p) continue;
    if (p.kind === 'name') {
      const row = next.rows.find((r) => r.rowIx === p.rowIx);
      if (row && a.text && !row.itemId) { answered++; const m = catalog && matchByName(catalog, a.text); row.srcName = a.text; if (m) { row.itemId = m.id; row.nameHow = 'ai'; } }
      continue;
    }
    if (!isCount(a.value)) continue;
    answered++;
    if (p.kind === 'tot_occ' || p.kind === 'tot_proc') {
      const k = p.kind === 'tot_occ' ? 'occ' : 'proc';
      if (next.total && !next.total.manual && next.total[k] !== a.value) { next.total[k] = a.value; next.total.confidence = 0.85; next.total.source = 'ai'; changed++; }
      continue;
    }
    const row = next.rows.find((r) => r.rowIx === p.rowIx);
    const c = row?.[p.kind];
    if (!c || c.edited) continue;
    const differs = c.value !== a.value;
    if (differs) changed++;
    row[p.kind] = { ...c, value: a.value, text: String(a.value), confidence: 0.9, source: 'ai', suggested: undefined, was: differs ? (c.was ?? { value: c.value, text: c.text, confidence: c.confidence }) : c.was };
  }
  next.validation = validate(next.rows.filter((r) => !r.skip), next.total, settings || {});
  next.aiUsed = true; next.aiError = null; next.aiChanged = (result.aiChanged || 0) + changed; next.aiAnswered = (result.aiAnswered || 0) + answered;
  return { result: next, changed, answered };
}
