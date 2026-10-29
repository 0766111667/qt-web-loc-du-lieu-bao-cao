// AI (Gemini) dự phòng: chỉ gửi các "hàng" không chắc (dải ảnh rất nhỏ), không gửi cả ảnh. Kết quả luôn được kiểm tra lại bằng tổng.
// Tách làm hai bước để không ghi đè thao tác sửa tay của người dùng trong lúc chờ AI: requestAi (gọi mạng) rồi applyAi (áp lên kết quả hiện tại).
import { rowStripRect } from '../core/cells.js';
import { cropToDataURL } from './canvas.js';
import { pickRows } from '../core/aiApply.js';
import { callVision } from './aiClient.js';

export async function requestAi({ img, result, settings, limit, getHeaders, onUsage }) {
  const picks = pickRows(result);
  if (!picks.length) return null;
  const body = { rows: picks.map((r) => ({ id: String(r.rowIx), image: cropToDataURL(img, rowStripRect(result.table, r.rowIx), 3) })) };
  const data = await limit(() => callVision({ endpoint: settings.aiEndpoint, getHeaders, body }));
  if (data.usage) onUsage?.(data.usage);
  return data.rows;
}
