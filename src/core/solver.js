// Bộ giải tổ hợp cục bộ (không cần AI, không tốn hạn mức): dùng "tổng" in trên ảnh làm ràng buộc.
// Với mỗi cột (phát sinh / đã xử lý), các ô nghi ngờ có vài phương án (đọc lại với chữ số thay thế gần nhất, hoặc suy ra từ tổng
// nếu chỉ có một ô nghi ngờ). Quy hoạch động theo tổng tìm cách chọn có "chi phí" thấp nhất mà cộng lại đúng bằng tổng.
// Chỉ nhận khi lời giải DUY NHẤT (phương án tốt thứ hai kém hơn rõ rệt); kết quả luôn bị đánh dấu "suggested" và không tự duyệt.
import { revertSuggestions } from './suggest.js';

const MAX = 1e6;
const SUSPECT_BELOW = 0.75;       // tin cậy < 0.75 ⇔ chênh lệch với phương án 2 < 0.09
const MAX_SUSPECTS = 10;
const MAX_OPTIONS = 6;
const UNIQUE_GAP = 0.03;
const ARITH_COST = 6;             // suy luận số học thuần tuý: kém tin cậy hơn việc đọc lại bằng chữ số thay thế

export const isSuspect = (c, min = SUSPECT_BELOW) => !c.edited && c.source !== 'ai' && (c.value == null || c.confidence < min);

// Các giá trị có thể có của một ô: giá trị đọc được (chi phí 0) + thay 1–2 chữ số yếu nhất bằng chữ số thay thế.
export function cellOptions(c) {
  const opts = new Map();
  if (c.value != null) opts.set(c.value, 0);
  const gl = c.glyphs || [];
  const digits = gl.map((g) => g.d);
  if (gl.length && gl.every((g) => g.d != null)) {
    const weak = gl.map((g, i) => ({ g, i })).filter(({ g }) => g.alt?.length && g.m < 0.12).sort((a, b) => a.g.m - b.g.m).slice(0, 3);
    const num = (arr) => Number(arr.join(''));
    const put = (arr, cost) => { const v = num(arr); if (Number.isInteger(v) && v < MAX && !(opts.has(v) && opts.get(v) <= cost)) opts.set(v, cost); };
    for (const { g, i } of weak) for (const a of g.alt) { const d = digits.slice(); d[i] = a; put(d, g.m + 0.001); }
    for (let x = 0; x < weak.length; x++) for (let y = x + 1; y < weak.length; y++) {
      for (const a of weak[x].g.alt) for (const b of weak[y].g.alt) { const d = digits.slice(); d[weak[x].i] = a; d[weak[y].i] = b; put(d, weak[x].g.m + weak[y].g.m + 0.002); }
    }
  }
  return [...opts].map(([value, cost]) => ({ value, cost })).sort((a, b) => a.cost - b.cost).slice(0, MAX_OPTIONS);
}

// cells: ô của các dòng chưa bỏ qua. Trả về { picks: [value|undefined…], unique, cost } hoặc null nếu không có lời giải.
export function solveColumn(cells, target, { min = SUSPECT_BELOW } = {}) {
  if (!Number.isInteger(target) || target < 0) return null;
  const idx = cells.map((c, i) => i).filter((i) => isSuspect(cells[i], min));
  idx.sort((a, b) => (cells[a].confidence ?? 0) - (cells[b].confidence ?? 0));
  const sus = idx.slice(0, MAX_SUSPECTS);
  if (!sus.length) return null;
  const susSet = new Set(sus);
  const fixed = cells.reduce((s, c, i) => s + (susSet.has(i) ? 0 : (c.value ?? 0)), 0);
  const need = target - fixed;
  if (need < 0) return null;
  const options = sus.map((i) => cellOptions(cells[i]));
  if (sus.length === 1) {                                              // suy luận số học: ô duy nhất còn lại = tổng − phần còn lại
    const v = need;
    if (!options[0].some((o) => o.value === v) && v >= 0 && v < MAX) options[0].push({ value: v, cost: ARITH_COST });
  }
  let states = new Map([[0, [{ cost: 0, pick: [] }]]]);
  for (const opts of options) {
    const next = new Map();
    for (const [sum, list] of states) for (const st of list) for (const o of opts) {
      const s = sum + o.value;
      if (s > need) continue;
      const arr = next.get(s) || [];
      arr.push({ cost: st.cost + o.cost, pick: [...st.pick, o.value] });
      arr.sort((a, b) => a.cost - b.cost); if (arr.length > 2) arr.length = 2;
      next.set(s, arr);
    }
    states = next;
    if (!states.size) return null;
  }
  const fin = states.get(need);
  if (!fin?.length) return null;
  const values = new Array(cells.length);
  sus.forEach((ci, k) => { values[ci] = fin[0].pick[k]; });
  return { values, cost: fin[0].cost, unique: fin.length === 1 || fin[1].cost - fin[0].cost >= UNIQUE_GAP };
}

// Áp bộ giải lên kết quả: trả { result, applied, ambiguous }.
export function autoFix(result, { minConfidence = SUSPECT_BELOW } = {}) {
  const t = result.total;
  if (!t || (t.confidence != null && t.confidence < 0.45 && !t.manual)) return { result, applied: 0, ambiguous: 0 };
  const base = revertSuggestions(result);
  const rows = base.rows.map((r) => ({ ...r }));
  const live = rows.filter((r) => !r.skip);
  const found = {};
  let ambiguous = 0;
  for (const key of ['occ', 'proc']) {
    const target = t[key];
    const cells = live.map((r) => r[key]);
    const sum = cells.reduce((s, c) => s + (c.value ?? 0), 0);
    if (!Number.isInteger(target) || sum === target) continue;
    const sol = solveColumn(cells, target, { min: minConfidence });
    if (!sol) continue;
    if (!sol.unique) { ambiguous++; continue; }
    found[key] = sol.values;
  }
  const eff = (i, key) => (found[key]?.[i] !== undefined ? found[key][i] : live[i][key].value);
  let applied = 0;
  for (const key of Object.keys(found)) {
    found[key].forEach((v, i) => {
      if (v === undefined || v === live[i][key].value) return;
      const occ = key === 'occ' ? v : eff(i, 'occ'), proc = key === 'proc' ? v : eff(i, 'proc');
      if (occ != null && proc != null && proc > occ) return;                     // đã xử lý không thể vượt phát sinh
      const c = live[i][key];
      live[i][key] = { ...c, value: v, text: String(v), confidence: 0.8, source: 'solver', suggested: true, was: { value: c.value, text: c.text, confidence: c.confidence } };
      applied++;
    });
  }
  return { result: applied ? { ...base, rows } : base, applied, ambiguous };
}
