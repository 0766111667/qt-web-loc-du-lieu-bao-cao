// Từ điểm ảnh -> bảng đã đọc. Thuần logic (không đụng DOM); các bước chậm/ngoại vi (OCR chữ Hán, AI) được truyền vào qua ctx.
import { detectTable } from '../core/grid.js';
import { cellRect, spanRect, inkGray, signature, hasInk } from '../core/cells.js';
import { readNumber } from '../core/digits.js';
import { matchBySignature, matchByName, matchTotalSignature, isTotalText } from '../core/catalog.js';
import { validate, sumRows } from '../core/validate.js';

const pack = (c) => ({
  value: c.value, text: c.text, confidence: Math.round(c.confidence * 100) / 100,
  // d/m/alt: chữ số đọc được, độ chênh với phương án thứ hai, và các chữ số thay thế (cho bộ giải tổ hợp cục bộ & gợi ý cho AI)
  glyphs: c.glyphs.map((g) => ({ v: g.v, aspect: g.aspect, d: g.digit, m: Math.round((g.margin ?? 1) * 1000) / 1000, alt: [g.second, g.third].filter((x) => x != null) })),
});

// ctx: { catalog, templates, settings?, ocrName?: (gray) => Promise<string> }
export async function analyzeImage(img, ctx) {
  const { catalog, templates, ocrName } = ctx;
  const table = detectTable(img);
  const n = table.rows.length;
  const numCells = table.rows.map((_, i) => ({
    occ: readNumber(inkGray(img, cellRect(table, i, 'occ')), templates),
    proc: readNumber(inkGray(img, cellRect(table, i, 'proc')), templates),
  }));

  // 1) Dòng cuối có phải dòng tổng?
  const last = n - 1;
  const spanGray = inkGray(img, spanRect(table, last));
  const totalSig = signature(spanGray);
  const before = sumRows(numCells.slice(0, last));
  const lc = numCells[last];
  let isTotal = matchTotalSignature(catalog, totalSig) || (lc.occ.value != null && lc.occ.value === before.occ && lc.proc.value === before.proc);
  if (!isTotal && ocrName && hasInk(spanGray)) isTotal = isTotalText(catalog, await ocrName(spanGray).catch(() => ''));
  const dataCount = isTotal ? last : n;

  // 2) Tên từng hàng: chữ ký đã biết -> OCR chữ Hán (nếu có) -> chưa rõ (hỏi người dùng 1 lần).
  const rows = [];
  for (let i = 0; i < dataCount; i++) {
    const g = inkGray(img, cellRect(table, i, 'name'));
    const empty = !hasInk(g);
    if (empty && numCells[i].occ.value == null && numCells[i].proc.value == null) continue;
    const sig = empty ? null : signature(g);
    let itemId = null, how = 'none', srcName = '', dist = null;
    const bySig = matchBySignature(catalog, sig);
    if (bySig) { itemId = bySig.id; how = 'signature'; dist = bySig.dist; }
    else if (ocrName && !empty) {
      srcName = await ocrName(g).catch(() => '');
      const byName = matchByName(catalog, srcName);
      if (byName) { itemId = byName.id; how = 'ocr'; }
    }
    rows.push({ rowIx: i, itemId, srcName, nameHow: how, sig, occ: pack(numCells[i].occ), proc: pack(numCells[i].proc) });
  }

  const total = isTotal ? { rowIx: last, occ: lc.occ.value, proc: lc.proc.value, confidence: Math.min(lc.occ.confidence, lc.proc.confidence) } : null;
  const validation = validate(rows, total, ctx.settings || {});
  return {
    table: { size: table.size, rows: table.rows, cols: table.cols, rowHeight: table.rowHeight },
    rows, total, totalSig: isTotal ? totalSig : null, validation,
  };
}

export const revalidate = (result, settings) => validate(result.rows, result.total, settings || {});
