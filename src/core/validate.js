// Kiểm tra khớp: quyết định ảnh được tự duyệt hay phải xem lại. Không bao giờ lấp số 0 âm thầm.
export const MIN_CONFIDENCE = 0.45;

export function sumRows(rows) {
  let occ = 0, proc = 0;
  for (const r of rows) { occ += r.occ.value ?? 0; proc += r.proc.value ?? 0; }
  return { occ, proc };
}

// rows: [{ itemId, occ:{value,confidence}, proc:{value,confidence} }], total: {occ,proc}|null
export function validate(rows, total, { minConfidence = MIN_CONFIDENCE, requireProcessedLE = true } = {}) {
  const issues = [];
  rows.forEach((r, i) => {
    if (r.occ.value == null || r.proc.value == null) issues.push({ code: 'unreadable', row: i });
    else {
      if (r.occ.confidence < minConfidence || r.proc.confidence < minConfidence) issues.push({ code: 'low_confidence', row: i });
      if (requireProcessedLE && r.proc.value > r.occ.value) issues.push({ code: 'processed_exceeds', row: i });
    }
    if (!r.itemId) issues.push({ code: 'unknown_name', row: i });
    // Số suy ra từ tổng (không phải do đọc được) luôn cần người nhìn lại ảnh, không bao giờ tự duyệt.
    if (r.occ.suggested || r.proc.suggested) issues.push({ code: 'suggested', row: i });
  });
  const sums = sumRows(rows);
  if (!rows.length) issues.push({ code: 'no_rows' });
  if (!total) issues.push({ code: 'no_total' });
  else if (total.occ == null || total.proc == null) issues.push({ code: 'unreadable_total' });
  else if (total.occ !== sums.occ || total.proc !== sums.proc) issues.push({ code: 'sum_mismatch', sums, total });
  // Khi tổng các dòng khớp đúng tổng in trên ảnh, đó là bằng chứng độc lập mạnh hơn độ tin cậy từng ô:
  // cảnh báo "độ tin cậy thấp" chỉ còn là ghi chú, không chặn tự duyệt.
  const sumsMatch = !!total && total.occ === sums.occ && total.proc === sums.proc;
  const notes = [];
  if (sumsMatch) for (let k = issues.length - 1; k >= 0; k--) if (issues[k].code === 'low_confidence') notes.push(...issues.splice(k, 1));
  const dupIds = rows.map((r) => r.itemId).filter(Boolean).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupIds.length) issues.push({ code: 'duplicate_item', ids: [...new Set(dupIds)] });
  return { status: issues.length ? 'review' : 'ok', issues, notes, sums };
}
