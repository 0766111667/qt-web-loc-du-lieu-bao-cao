import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, createLimiter } from '../src/ocr/queue.js';
import { loadImage, seeds } from './helpers.js';
import { readFile } from 'node:fs/promises';
import { analyzeImage } from '../src/ocr/pipeline.js';
import { createCatalog } from '../src/core/catalog.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('hàng đợi 100 ảnh: không vượt giới hạn song song, lỗi xen kẽ không làm dừng lô, xử lý đủ 100', async () => {
  let running = 0, maxRunning = 0;
  const done = new Set(), failed = new Set();
  const q = createQueue({
    concurrency: 3,
    run: async (id) => { running++; maxRunning = Math.max(maxRunning, running); await sleep(Math.random() * 4); running--; if (id % 7 === 0) throw new Error('boom'); },
    onEvent: (e) => { if (e.type === 'done') done.add(e.id); if (e.type === 'error') failed.add(e.id); },
  });
  q.add(Array.from({ length: 100 }, (_, i) => i + 1));
  await q.whenIdle();
  assert.equal(done.size + failed.size, 100);
  assert.equal(failed.size, 14); // 7, 14, ..., 98
  assert.ok(maxRunning <= 3, `chạy song song tối đa ${maxRunning}`);
});

test('tạm dừng rồi tiếp tục: không bỏ sót, không chạy lặp', async () => {
  const seen = [];
  const q = createQueue({ concurrency: 2, run: async (id) => { seen.push(id); await sleep(2); } });
  q.pause();
  q.add([1, 2, 3, 4, 5, 6]);
  await sleep(20);
  assert.equal(seen.length, 0, 'đang tạm dừng thì không được chạy');
  q.add([3, 4]); // thêm trùng id đang chờ => bỏ qua
  q.resume();
  await q.whenIdle();
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6]);
});

test('limiter giới hạn lời gọi đồng thời', async () => {
  const limit = createLimiter(2);
  let cur = 0, max = 0;
  await Promise.all(Array.from({ length: 12 }, () => limit(async () => { cur++; max = Math.max(max, cur); await sleep(3); cur--; })));
  assert.equal(max, 2);
});

test('hiệu năng: 100 lần phân tích ảnh liên tiếp (mô phỏng lô 100 ảnh) — thời gian và bộ nhớ', async () => {
  const calibration = JSON.parse(await readFile(new URL('../src/core/calibration.json', import.meta.url), 'utf8'));
  const ctx = { catalog: createCatalog(calibration), templates: [...seeds, ...calibration.digits] };
  const imgs = [await loadImage('sample-a.jpg'), await loadImage('sample-b.jpg')];
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  let ok = 0;
  for (let i = 0; i < 100; i++) { const r = await analyzeImage(imgs[i % 2], ctx); if (r.validation.status === 'ok') ok++; }
  const ms = performance.now() - t0;
  const heapMB = (process.memoryUsage().heapUsed - heap0) / 1048576;
  console.log(`  100 ảnh: ${(ms / 1000).toFixed(2)} s tổng, ${(ms / 100).toFixed(1)} ms/ảnh, heap tăng ${heapMB.toFixed(1)} MB`);
  assert.equal(ok, 100);
  assert.ok(ms / 100 < 400, 'mỗi ảnh nên < 400 ms trên máy thường');
});
