// AI（Gemini）备用识别：只发送不确定的“行”（很小的图片片段），不发送整张图。结果始终会用总计再次校验。
import { rowStripRect } from '../core/cells.js';
import { cropToDataURL } from './canvas.js';
import { matchByName } from '../core/catalog.js';
import { revalidate } from './pipeline.js';

const isCount = (v) => Number.isInteger(v) && v >= 0 && v < 1e6;

export async function refineWithVision({ img, result, catalog, settings, limit }) {
  const flagged = new Set(result.validation.issues.filter((i) => i.row != null).map((i) => i.row));
  // Tổng lệch mà không rõ hàng nào sai => gửi tất cả hàng (tối đa 20) để AI đối chiếu.
  if (!flagged.size && result.validation.issues.some((i) => ['sum_mismatch', 'no_total', 'unreadable_total'].includes(i.code))) result.rows.forEach((_, i) => flagged.add(i));
  const picks = [...flagged].slice(0, 20).map((i) => result.rows[i]);
  if (!picks.length) return result;

  const body = { rows: picks.map((r) => ({ id: String(r.rowIx), image: cropToDataURL(img, rowStripRect(result.table, r.rowIx), 3) })) };
  const data = await limit(async () => {
    const res = await fetch(settings.aiEndpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-access-key': settings.aiKey || '' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`AI 服务返回错误（${res.status}）`);
    return res.json();
  });

  const next = { ...result, rows: result.rows.map((r) => ({ ...r })) };
  for (const a of data.rows || []) {
    const row = next.rows.find((r) => String(r.rowIx) === String(a.id));
    if (!row) continue;
    if (isCount(a.occ)) row.occ = { ...row.occ, value: a.occ, text: String(a.occ), confidence: 0.9, source: 'ai' };
    if (isCount(a.processed)) row.proc = { ...row.proc, value: a.processed, text: String(a.processed), confidence: 0.9, source: 'ai' };
    if (!row.itemId && a.name) { const m = matchByName(catalog, a.name); row.srcName = a.name; if (m) { row.itemId = m.id; row.nameHow = 'ai'; } }
  }
  next.validation = revalidate(next, settings);
  next.aiUsed = true;
  return next;
}
