// Nhận diện chữ số in trong ảnh chụp bảng bằng so khớp mẫu (không dùng OCR cho số).
// Mỗi chữ số được cắt sát khung bao rồi thu về lưới GW x GH nên không phụ thuộc cỡ phóng đại của ảnh.

export const GW = 10, GH = 14;
export const params = { aspectWeight: 0.3 };

export function areaResize(src, sw, sh, dw, dh) {
  // src: Float32Array (0..1, 1 = mực) -> lưới dw x dh, trung bình theo diện tích
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const y0 = (y * sh) / dh, y1 = ((y + 1) * sh) / dh;
    for (let x = 0; x < dw; x++) {
      const x0 = (x * sw) / dw, x1 = ((x + 1) * sw) / dw;
      let sum = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          sum += src[yy * sw + xx] * wx * wy; wsum += wx * wy;
        }
      }
      out[y * dw + x] = wsum ? sum / wsum : 0;
    }
  }
  return out;
}

// g: { data: Uint8Array (255 = nền, 0 = mực), width, height }, box: vùng cột cần lấy
export function glyphVector(g, box) {
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1;
  const ink = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ink[y * w + x] = 1 - g.data[(box.y0 + y) * g.width + box.x0 + x] / 255;
  const v = areaResize(ink, w, h, GW, GH);
  // chuẩn hóa độ đậm nét để chữ thường/đậm vẫn so khớp được
  let mx = 0; for (const t of v) if (t > mx) mx = t;
  if (mx > 0) for (let i = 0; i < v.length; i++) v[i] = Math.min(1, v[i] / mx);
  return { v: Array.from(v, (t) => Math.round(t * 100) / 100), aspect: Math.round((w / h) * 100) / 100 };
}

// Tách ảnh ô thành các chữ số: vệt cột có mực; vệt quá rộng (hai số dính nhau) được chia tại chỗ ít mực nhất.
export function segmentDigits(g, thr = 150) {
  const colInk = new Array(g.width).fill(0);
  let top = g.height, bottom = -1;
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
    if (g.data[y * g.width + x] < thr) { colInk[x]++; if (y < top) top = y; if (y > bottom) bottom = y; }
  }
  if (bottom < 0) return [];
  const h = bottom - top + 1;
  const runs = []; let s = -1;
  for (let x = 0; x <= g.width; x++) {
    const on = x < g.width && colInk[x] > 0;
    if (on && s < 0) s = x;
    if (!on && s >= 0) { runs.push([s, x - 1]); s = -1; }
  }
  const parts = [];
  for (const [a, b] of runs) {
    const w = b - a + 1;
    const n = w > h * 1.05 ? Math.max(2, Math.round(w / (h * 0.62))) : 1; // một chữ số rộng tối đa ~0.9h
    if (n === 1) { parts.push([a, b]); continue; }
    let start = a;
    for (let k = 1; k < n; k++) {
      const target = a + Math.round((w * k) / n);
      let best = target, bestInk = Infinity;
      for (let x = Math.max(start + 2, target - 2); x <= Math.min(b - 2, target + 2); x++) if (colInk[x] < bestInk) { bestInk = colInk[x]; best = x; }
      parts.push([start, best - 1]); start = best;
    }
    parts.push([start, b]);
  }
  return parts.map(([a, b]) => ({ x0: a, x1: b, y0: top, y1: bottom }));
}

function dist(a, b) {
  let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s / a.length);
}

// templates: [{ d: '0'..'9', v: number[], aspect, w?: trọng số }]
export function classify(glyph, templates) {
  const best = {}; // khoảng cách nhỏ nhất theo từng chữ số
  for (const t of templates) {
    const aspectPenalty = Math.abs(Math.log((glyph.aspect + 0.05) / (t.aspect + 0.05))) * params.aspectWeight;
    const d = (dist(glyph.v, t.v) + aspectPenalty) * (t.w ?? 1);
    if (best[t.d] === undefined || d < best[t.d]) best[t.d] = d;
  }
  const ranked = Object.entries(best).sort((p, q) => p[1] - q[1]);
  if (!ranked.length) return { digit: null, dist: 1, margin: 0 };
  const [d1, s1] = ranked[0], s2 = ranked[1]?.[1] ?? s1 + 1;
  return { digit: d1, dist: s1, margin: s2 - s1, second: ranked[1]?.[0], third: ranked[2]?.[0] };
}

// Đọc một ô số. confidence: 0..1, thấp -> cần kiểm tra lại (AI / người).
export function readNumber(g, templates) {
  const boxes = segmentDigits(g);
  if (!boxes.length) return { value: null, text: '', confidence: 0, reason: 'empty', glyphs: [] };
  const glyphs = boxes.map((b) => { const gv = glyphVector(g, b); return { box: b, ...gv, ...classify(gv, templates) }; });
  const text = glyphs.map((x) => x.digit).join('');
  const conf = Math.min(...glyphs.map((x) => Math.max(0, Math.min(1, x.margin / 0.12))), ...glyphs.map((x) => (x.dist < 0.3 ? 1 : 0.3)));
  return { value: /^\d+$/.test(text) ? Number(text) : null, text, confidence: conf, glyphs };
}
