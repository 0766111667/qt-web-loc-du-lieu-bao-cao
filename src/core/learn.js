// Học từ dữ liệu đã được xác nhận: mẫu chữ số, chữ ký tên hạng mục, chữ ký dòng tổng.

const MAX_PER_DIGIT = 24;
const glyphDist = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0) / a.length);

export function mergeTemplates(...sets) {
  return sets.flat().filter(Boolean);
}

// glyphs: [{v, aspect}], label: chuỗi số đã xác nhận. Chỉ học khi số ký tự khớp số vệt tách được.
export function learnDigits(learned, glyphs, label) {
  const text = String(label);
  if (!glyphs?.length || glyphs.length !== text.length) return learned;
  const out = [...learned];
  glyphs.forEach((g, k) => {
    const d = text[k];
    const near = out.some((t) => t.d === d && glyphDist(t.v, g.v) < 0.03);
    if (near) return;
    out.push({ d, v: g.v, aspect: g.aspect, w: 1 });
    const same = out.filter((t) => t.d === d);
    if (same.length > MAX_PER_DIGIT) out.splice(out.indexOf(same[0]), 1);
  });
  return out;
}

// Tạo dữ liệu hiệu chuẩn từ một ảnh đã biết đáp án (dùng cho script và kiểm thử).
export function calibrationFrom({ rowsResult, truth }) {
  const digits = [], names = [];
  rowsResult.rows.forEach((r, i) => {
    for (const k of ['occ', 'proc']) digits.push(...learnDigits([], r[k].glyphs, truth[k][i]));
    if (r.sig) names.push({ i, sig: r.sig });
  });
  return { digits, names, totals: rowsResult.totalSig ? [rowsResult.totalSig] : [] };
}
