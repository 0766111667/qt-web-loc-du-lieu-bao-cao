// Tạo src/core/seeds.json: mẫu chữ số khởi đầu từ ảnh render font (chạy: node scripts/make-seeds.mjs <thư mục png>)
import sharp from 'sharp';
import { readdir, writeFile } from 'node:fs/promises';
import { glyphVector } from '../src/core/digits.js';
const dir = process.argv[2];
const out = [];
for (const f of (await readdir(dir)).sort()) {
  const [font, d] = f.replace('.png', '').split('_');
  const { data, info } = await sharp(`${dir}/${f}`).greyscale().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, x1 = -1, y0 = info.height, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[y * info.width + x] < 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const gv = glyphVector({ data, width: info.width, height: info.height }, { x0, x1, y0, y1 });
  out.push({ d, font, v: gv.v, aspect: gv.aspect, w: 1.25 });
}
await writeFile(new URL('../src/core/seeds.json', import.meta.url), JSON.stringify(out));
console.log('seeds', out.length);
