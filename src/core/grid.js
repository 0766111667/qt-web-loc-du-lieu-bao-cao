// Dò cấu trúc bảng (hàng/cột) trong ảnh chụp bảng Excel. Hàm thuần, chạy được cả ở trình duyệt lẫn Node.
// Đầu vào: img = { data: Uint8ClampedArray RGBA, width, height }.

export class GridError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

function runsOf(flags, min = 1) {
  const out = []; let s = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i];
    if (on && s < 0) s = i;
    if (!on && s >= 0) { if (i - s >= min) out.push([s, i - 1]); s = -1; }
  }
  return out;
}

const center = ([a, b]) => Math.round((a + b) / 2);

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

// Hàng tiêu đề: dải màu xanh đậm chiếm phần lớn chiều ngang.
function findHeader(img) {
  const { data, width: w, height: h } = img;
  const rowFrac = new Float32Array(h);
  const colHit = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < 90 && g < 130 && b > 90 && b < 200 && b - r > 40) { n++; colHit[x]++; }
    }
    rowFrac[y] = n / w;
  }
  const runs = runsOf(Array.from(rowFrac, (v) => v > 0.5), 6);
  if (!runs.length) throw new GridError('NO_HEADER', '未找到表格的蓝色表头。');
  const [y0, y1] = runs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
  const bandH = y1 - y0 + 1;
  const xs = []; for (let x = 0; x < w; x++) xs.push(colHit[x] > bandH * 0.4);
  const first = xs.indexOf(true), last = xs.lastIndexOf(true);
  return { y0, y1, x0: Math.max(0, first), x1: Math.min(w - 1, last) };
}

// Đường kẻ ngang: hàng mà phần lớn bề ngang tối hơn rõ rệt so với hàng cách 2px phía trên/dưới.
function findRowSeparators(img, hdr) {
  const { data, width: w, height: h } = img;
  const flags = new Array(h).fill(false);
  const xa = hdr.x0 + 2, xb = hdr.x1 - 2, span = xb - xa + 1;
  for (let y = hdr.y1 + 2; y < h; y++) {
    let n = 0;
    for (let x = xa; x <= xb; x++) {
      const c = lum(data, (y * w + x) * 4);
      const up = y - 2 >= 0 ? lum(data, ((y - 2) * w + x) * 4) : c;
      const dn = y + 2 < h ? lum(data, ((y + 2) * w + x) * 4) : c;
      if (c < Math.min(up, dn) - 22) n++;
    }
    flags[y] = n / span > 0.55;
  }
  return runsOf(flags).map(center);
}

// Biên cột: x mà gần như toàn bộ chiều cao thân bảng có cạnh dọc rõ (đường kẻ hoặc đổi nền).
function findColumnEdges(img, hdr, yTop, yBot) {
  const { data, width: w } = img;
  const flags = new Array(w).fill(false);
  const height = yBot - yTop + 1;
  for (let x = hdr.x0 + 2; x <= hdr.x1 - 2; x++) {
    let n = 0;
    for (let y = yTop; y <= yBot; y++) {
      const a = lum(data, (y * w + x - 1) * 4), b = lum(data, (y * w + x + 1) * 4);
      if (Math.abs(a - b) > 14) n++;
    }
    flags[x] = n / height > 0.72;
  }
  return runsOf(flags).map(center);
}

export function detectTable(img) {
  const hdr = findHeader(img);
  const seps = findRowSeparators(img, hdr);
  if (seps.length < 3) throw new GridError('NO_ROWS', '无法识别表格的行线。');

  // Chiều cao hàng chuẩn = trung vị khoảng cách giữa các đường kẻ.
  const gaps = seps.slice(1).map((v, i) => v - seps[i]);
  const rowH = median(gaps);
  const bounds = [hdr.y1 + 1];
  for (const s of seps) {
    const prev = bounds[bounds.length - 1];
    const gap = s - prev;
    const missing = Math.round(gap / rowH) - 1; // đường kẻ bị mờ -> nội suy
    for (let k = 1; k <= missing; k++) bounds.push(Math.round(prev + (gap * k) / (missing + 1)));
    if (gap >= rowH * 0.6) bounds.push(s);
  }
  // Hàng cuối (thường là dòng tổng) có thể sát mép dưới ảnh nên không có đường kẻ phía dưới.
  if (img.height - bounds[bounds.length - 1] >= rowH * 0.6) bounds.push(img.height);
  const rows = [];
  for (let i = 0; i + 1 < bounds.length; i++) rows.push({ y0: bounds[i], y1: bounds[i + 1] - 1 });
  if (!rows.length) throw new GridError('NO_ROWS', '无法分出数据行。');

  const edges = findColumnEdges(img, hdr, rows[0].y0 + 1, rows[rows.length - 1].y1 - 1);
  const xs = [hdr.x0, ...edges.filter((x) => x - hdr.x0 > 12 && hdr.x1 - x > 12), hdr.x1 + 1];
  const cols = [];
  for (let i = 0; i + 1 < xs.length; i++) if (xs[i + 1] - xs[i] > 12) cols.push([xs[i], xs[i + 1] - 1]);
  if (cols.length < 3) throw new GridError('NO_COLUMNS', '无法识别足够的列（需要名称列和两列数字）。');

  // Gán vai trò: cột rộng nhất là tên; trước nó là số thứ tự; sau nó là phát sinh, đã xử lý, tỷ lệ.
  let nameIx = 0;
  cols.forEach((c, i) => { if (c[1] - c[0] > cols[nameIx][1] - cols[nameIx][0]) nameIx = i; });
  const after = cols.slice(nameIx + 1);
  if (after.length < 2) throw new GridError('NO_COLUMNS', '名称列之后缺少数字列。');
  const roles = { name: cols[nameIx], occ: after[0], proc: after[1] };
  if (nameIx > 0) roles.seq = cols[0];
  if (after[2]) roles.pct = after[2];

  return { header: hdr, rows, rowHeight: rowH, cols: roles, size: { width: img.width, height: img.height } };
}
