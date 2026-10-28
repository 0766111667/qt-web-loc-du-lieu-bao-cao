import { areaResize } from './digits.js';
// Cắt ô, chuẩn hóa mực chữ, ghép cột để OCR một lần, và chữ ký ô tên để nhận lại không cần OCR.
// Mọi hàm đều thuần (không dùng canvas) nên kiểm thử được bằng Node.

export function cellRect(table, rowIx, role, inset = 2) {
  const [x0, x1] = table.cols[role];
  const r = table.rows[rowIx];
  return { x0: x0 + inset + 1, y0: r.y0 + inset, x1: x1 - inset, y1: r.y1 - inset };
}

// Ô gộp (ví dụ chữ "Tổng" căn giữa trên cột số thứ tự + cột tên): lấy từ mép trái bảng đến hết cột tên.
export function spanRect(table, rowIx, inset = 2) {
  const left = Math.min(...Object.values(table.cols).map((c) => c[0]));
  const r = table.rows[rowIx];
  return { x0: left + inset + 1, y0: r.y0 + inset, x1: table.cols.name[1] - inset, y1: r.y1 - inset };
}

// Dải một hàng (từ mép trái bảng đến hết cột "đã xử lý") để gửi cho AI nhìn cả ngữ cảnh hàng.
export function rowStripRect(table, rowIx) {
  const left = Math.min(...Object.values(table.cols).map((c) => c[0]));
  const r = table.rows[rowIx];
  return { x0: left, y0: r.y0, x1: table.cols.proc[1], y1: r.y1 };
}

// Trả về ảnh xám: 255 = nền, 0 = mực. Nền lấy theo trung vị màu nên chữ xanh trên nền be, chữ đỏ trên nền trắng đều ra chữ đen.
export function inkGray(img, rect) {
  const { data, width: W } = img;
  const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1;
  const ch = [[], [], []];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((rect.y0 + y) * W + rect.x0 + x) * 4;
    ch[0].push(data[i]); ch[1].push(data[i + 1]); ch[2].push(data[i + 2]);
  }
  const bg = ch.map((a) => { const s = Int16Array.from(a).sort(); return s[s.length >> 1]; });
  const dist = new Float32Array(w * h);
  let mx = 0;
  for (let k = 0; k < w * h; k++) {
    const dr = ch[0][k] - bg[0], dg = ch[1][k] - bg[1], db = ch[2][k] - bg[2];
    dist[k] = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist[k] > mx) mx = dist[k];
  }
  // Giữ nguyên độ đậm nhạt (anti-aliasing) của nét chữ: chia cho độ lệch lớn nhất của ô, bỏ nhiễu JPEG nhỏ.
  const out = new Uint8Array(w * h).fill(255);
  if (mx > 40) for (let k = 0; k < w * h; k++) out[k] = dist[k] < 14 ? 255 : 255 - Math.min(255, (dist[k] / mx) * 255);
  return { data: out, width: w, height: h };
}

export function resizeGray(g, nw, nh) { return resizeBilinear(g, Math.max(1, nw), Math.max(1, nh)); }

function resizeBilinear(g, nw, nh) {
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(g.height - 1, (y + 0.5) * g.height / nh - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(g.height - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(g.width - 1, (x + 0.5) * g.width / nw - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(g.width - 1, x0 + 1), tx = fx - x0;
      const a = g.data[y0 * g.width + x0], b = g.data[y0 * g.width + x1], c = g.data[y1 * g.width + x0], d = g.data[y1 * g.width + x1];
      out[y * nw + x] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    }
  }
  return { data: out, width: nw, height: nh };
}

// Ghép các ô (mỗi ô một dòng) thành một ảnh dọc để OCR 1 lần thay vì hàng chục lần.
export function stitchColumn(cells, { scale = 3, gap = 18, pad = 12 } = {}) {
  const scaled = cells.map((c) => resizeBilinear(c, c.width * scale, c.height * scale));
  const W = Math.max(...scaled.map((c) => c.width)) + pad * 2;
  const H = scaled.reduce((s, c) => s + c.height + gap, gap);
  const data = new Uint8Array(W * H).fill(255);
  let y = gap;
  const lines = [];
  for (const c of scaled) {
    const ox = Math.round((W - c.width) / 2);
    for (let r = 0; r < c.height; r++) data.set(c.data.subarray(r * c.width, (r + 1) * c.width), (y + r) * W + ox);
    lines.push({ y0: y, y1: y + c.height - 1 });
    y += c.height + gap;
  }
  return { data, width: W, height: H, lines };
}

export function hasInk(g, minPixels = 6) {
  let n = 0;
  for (let i = 0; i < g.data.length; i++) if (g.data[i] < 128 && ++n >= minPixels) return true;
  return false;
}

// Chữ ký ô tên: cắt sát vùng mực, thu về lưới 64x12, làm mờ nhẹ, chuẩn hóa trung bình 0 / độ dài 1.
// So sánh bằng 1 - tương quan: ổn định khi ảnh được phóng to/thu nhỏ vài phần trăm. Lưu dạng số nguyên (x1000) cho gọn.
const SIG_W = 64, SIG_H = 12;

function blur1(v, w, h) {
  const o = new Float32Array(v.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && xx >= 0 && yy < h && xx < w) { s += v[yy * w + xx]; n++; }
    }
    o[y * w + x] = s / n;
  }
  return o;
}

export function signature(g) {
  let x0 = g.width, x1 = -1, y0 = g.height, y1 = -1;
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
    if (g.data[y * g.width + x] < 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const ink = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ink[y * w + x] = 1 - g.data[(y0 + y) * g.width + x0 + x] / 255;
  const v = blur1(areaResize(ink, w, h, SIG_W, SIG_H), SIG_W, SIG_H);
  let m = 0; for (const t of v) m += t; m /= v.length;
  let n = 0; for (const t of v) n += (t - m) ** 2;
  n = Math.sqrt(n) || 1;
  return { v: Array.from(v, (t) => Math.round(((t - m) / n) * 1000)), aspect: Math.round((w / h) * 100) / 100 };
}

export function sigDistance(a, b) {
  if (!a || !b || a.v.length !== b.v.length) return 1;
  let s = 0;
  for (let i = 0; i < a.v.length; i++) s += a.v[i] * b.v[i];
  return 1 - s / 1e6;
}
