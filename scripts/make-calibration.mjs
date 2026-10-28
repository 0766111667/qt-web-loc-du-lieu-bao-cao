// Tạo src/core/calibration.json từ các ảnh mẫu có đáp án (test/fixtures/expected.json).
// - mẫu chữ số: lấy từ ảnh thật, thêm biến thể phóng/thu (0.7x–1.7x) để đọc được ảnh chụp ở các mức zoom khác nhau
// - chữ ký tên hạng mục (16 hàng đầu) và chữ ký dòng tổng
// Chạy lại khi thay/thêm ảnh mẫu: npm run calibrate
import { writeFile } from 'node:fs/promises';
import { loadImage, expected, seeds } from '../test/helpers.js';
import { detectTable } from '../src/core/grid.js';
import { cellRect, spanRect, inkGray, signature, resizeGray } from '../src/core/cells.js';
import { readNumber, } from '../src/core/digits.js';

const FACTORS = [1, 0.7, 0.8, 0.9, 1.15, 1.3, 1.5, 1.7];
const CAP = 60, DEDUPE = 0.025;
const dist = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0) / a.length);

const digits = [], names = [], totals = [];
const add = (d, g) => {
  if (digits.filter((t) => t.d === d).length >= CAP) return;
  if (digits.some((t) => t.d === d && dist(t.v, g.v) < DEDUPE)) return;
  digits.push({ d, v: g.v, aspect: g.aspect, w: 1 });
};

for (const [file, truth] of Object.entries(expected)) {
  const img = await loadImage(file);
  const t = detectTable(img);
  const last = t.rows.length - 1;
  totals.push(signature(inkGray(img, spanRect(t, last))));
  t.rows.slice(0, 16).forEach((_, i) => names.push({ i, sig: signature(inkGray(img, cellRect(t, i, 'name'))) }));
  for (const f of FACTORS) {
    for (const k of ['occ', 'proc']) {
      t.rows.forEach((_, i) => {
        let g = inkGray(img, cellRect(t, i, k));
        if (f !== 1) g = resizeGray(g, Math.round(g.width * f), Math.round(g.height * f));
        const label = String(truth[k][i]);
        const glyphs = readNumber(g, seeds).glyphs;
        if (glyphs.length === label.length) glyphs.forEach((gl, n) => add(label[n], gl));
      });
    }
  }
}
await writeFile(new URL('../src/core/calibration.json', import.meta.url), JSON.stringify({ digits, names, totals }));
const per = {}; digits.forEach((d) => { per[d.d] = (per[d.d] || 0) + 1; });
console.log('calibration: mẫu chữ số', digits.length, JSON.stringify(per), '| chữ ký tên', names.length, '| chữ ký tổng', totals.length);
