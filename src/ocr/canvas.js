// Cầu nối với trình duyệt: giải mã ảnh, tạo ảnh thu nhỏ, băm SHA-256, vẽ ô thành canvas. Chỉ chạy trong trình duyệt.
export async function decodeFile(blob, maxSide = 3000) {
  const bmp = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h);
    c.width = c.height = 0; // giải phóng bộ nhớ canvas sớm
    return { data: id.data, width: w, height: h };
  } finally { bmp.close?.(); }
}

export async function makeThumb(blob, width = 240) {
  const bmp = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, width / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.7));
  } finally { bmp.close?.(); }
}

export async function sha256(blob) {
  const buf = await blob.arrayBuffer();
  if (!crypto?.subtle) return `${blob.name}-${blob.size}-${blob.lastModified}`;
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// gray: { data: Uint8Array (255 = nền), width, height } -> canvas phóng to, có viền trắng (để OCR chữ Hán)
export function grayToCanvas(g, scale = 3, pad = 12) {
  const small = document.createElement('canvas');
  small.width = g.width; small.height = g.height;
  const sctx = small.getContext('2d');
  const im = sctx.createImageData(g.width, g.height);
  for (let i = 0; i < g.data.length; i++) { const v = g.data[i]; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  sctx.putImageData(im, 0, 0);
  const c = document.createElement('canvas');
  c.width = g.width * scale + pad * 2; c.height = g.height * scale + pad * 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, pad, pad, g.width * scale, g.height * scale);
  return c;
}

// Cắt một vùng từ ảnh điểm ảnh và trả về data URL PNG (gửi cho AI).
export function cropToDataURL(img, rect, scale = 3) {
  const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1;
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const sctx = src.getContext('2d');
  const im = sctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const from = ((rect.y0 + y) * img.width + rect.x0) * 4;
    im.data.set(img.data.subarray(from, from + w * 4), y * w * 4);
  }
  sctx.putImageData(im, 0, 0);
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
