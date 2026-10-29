// Chọn dòng cần gửi cho AI và áp kết quả AI vào bảng. Thuần logic.
import { matchByName } from './catalog.js';
import { validate } from './validate.js';

const isCount = (v) => Number.isInteger(v) && v >= 0 && v < 1e6;
export const MAX_AI_ROWS = 20;

// Các dòng nghi ngờ (issue.row là chỉ số trong các dòng chưa bị bỏ qua). Tổng lệch mà không rõ dòng nào => gửi tất cả.
export function pickRows(result) {
  const live = result.rows.filter((r) => !r.skip);
  const flagged = new Set();
  for (const i of result.validation.issues) if (i.row != null && live[i.row]) flagged.add(live[i.row]);
  if (!flagged.size && result.validation.issues.some((i) => ['sum_mismatch', 'no_total', 'unreadable_total'].includes(i.code))) live.forEach((r) => flagged.add(r));
  return [...flagged].slice(0, MAX_AI_ROWS);
}

// Áp câu trả lời của AI lên kết quả HIỆN TẠI (không ghi đè ô người dùng đã tự sửa). Trả về { result, changed }.
export function applyAi(result, answers, { catalog, settings } = {}) {
  const next = { ...result, rows: result.rows.map((r) => ({ ...r })) };
  let changed = 0;
  const put = (row, key, v) => {
    const c = row[key];
    if (c.edited || !isCount(v)) return;
    const differs = c.value !== v;
    if (differs) changed++;
    next.rows[next.rows.indexOf(row)][key] = { ...c, value: v, text: String(v), confidence: 0.9, source: 'ai', suggested: undefined, was: differs ? (c.was ?? { value: c.value, text: c.text, confidence: c.confidence }) : c.was };
  };
  for (const a of answers || []) {
    const row = next.rows.find((r) => String(r.rowIx) === String(a.id));
    if (!row) continue;
    put(row, 'occ', a.occ);
    put(row, 'proc', a.processed);
    if (!row.itemId && !row.skip && a.name) { const m = catalog && matchByName(catalog, a.name); row.srcName = a.name; if (m) { row.itemId = m.id; row.nameHow = 'ai'; } }
  }
  next.validation = validate(next.rows.filter((r) => !r.skip), next.total, settings || {});
  next.aiUsed = true; next.aiError = null; next.aiChanged = (result.aiChanged || 0) + changed;
  return { result: next, changed };
}
