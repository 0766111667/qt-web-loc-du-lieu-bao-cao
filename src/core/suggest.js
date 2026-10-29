// Dự phòng không cần AI: khi tổng in trên ảnh đọc chắc chắn và chỉ có MỘT ô nghi ngờ trong một cột,
// giá trị đúng của ô đó suy ra được từ tổng (tổng − các ô còn lại). Kết quả luôn bị đánh dấu "suggested" và KHÔNG tự duyệt:
// tổng khớp sau khi suy ra là hiển nhiên (vòng tròn), nên cần người nhìn lại ảnh.
const MAX = 1e6;

const live = (result) => result.rows.filter((r) => !r.skip);
const isSuspect = (c, minConfidence) => !c.edited && c.source !== 'ai' && (c.value == null || c.confidence < minConfidence);

export function hasSuggested(result) { return result.rows.some((r) => !r.skip && (r.occ.suggested || r.proc.suggested)); }

// Khôi phục giá trị gốc của các ô đã được suy ra từ tổng (để AI có thể đọc lại từ số gốc).
export function revertSuggestions(result) {
  if (!result.rows.some((r) => r.occ.suggested || r.proc.suggested)) return result;
  const fix = (c) => (c.suggested ? { ...c.was, glyphs: c.glyphs, source: undefined, suggested: undefined, was: undefined } : c);
  return { ...result, rows: result.rows.map((r) => ({ ...r, occ: fix(r.occ), proc: fix(r.proc) })) };
}

export function applySuggestions(result, { minConfidence = 0.45, requireProcessedLE = true } = {}) {
  const t = result.total;
  if (!t || (t.confidence != null && t.confidence < minConfidence && !t.manual)) return { result, applied: 0 };
  const base = revertSuggestions(result);
  const rows = base.rows.map((r) => ({ ...r }));
  const liveRows = rows.filter((r) => !r.skip);
  // 1) tìm ứng viên cho từng cột; 2) kiểm tra ràng buộc "đã xử lý ≤ phát sinh" trên giá trị SAU khi suy ra (cả hai cột có thể cùng sai).
  const cands = [];
  for (const key of ['occ', 'proc']) {
    const target = t[key];
    if (!Number.isInteger(target)) continue;
    const diff = target - liveRows.reduce((s, r) => s + (r[key].value ?? 0), 0);
    if (diff === 0) continue;
    const suspects = liveRows.filter((r) => isSuspect(r[key], minConfidence));
    if (suspects.length !== 1) continue;
    const row = suspects[0];
    const cand = (row[key].value ?? 0) + diff;
    if (!Number.isInteger(cand) || cand < 0 || cand >= MAX) continue;
    cands.push({ row, key, cand });
  }
  const eff = (row, key) => cands.find((c) => c.row === row && c.key === key)?.cand ?? row[key].value;
  let applied = 0;
  for (const { row, key, cand } of cands) {
    if (requireProcessedLE) {
      const occ = eff(row, 'occ'), proc = eff(row, 'proc');
      if (occ != null && proc != null && proc > occ) continue;
    }
    const c = row[key];
    row[key] = { ...c, value: cand, text: String(cand), confidence: 0.8, source: 'total', suggested: true, was: { value: c.value, text: c.text, confidence: c.confidence } };
    applied++;
  }
  return { result: applied ? { ...base, rows } : base, applied };
}
