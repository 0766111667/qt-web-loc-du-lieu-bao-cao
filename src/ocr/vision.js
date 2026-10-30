// AI (Gemini) dự phòng: chỉ gửi vài Ô nhỏ không chắc chắn (không gửi cả ảnh hay cả dòng). Việc gọi mạng do bộ điều phối trong store thực hiện (gom nhiều ảnh/lần).
import { cellRect } from '../core/cells.js';
import { cropToDataURL } from './canvas.js';

// Ảnh của từng ô theo kế hoạch; trả về [{ kind, image, candidates }] cùng thứ tự plan.
export function buildItems(img, result, plan) {
  const rectOf = (p) => {
    if (p.kind === 'tot_occ' || p.kind === 'tot_proc') return result.total ? cellRect(result.table, result.total.rowIx, p.kind === 'tot_occ' ? 'occ' : 'proc') : null;
    return cellRect(result.table, p.rowIx, p.kind);
  };
  return plan.map((p) => {
    const rect = rectOf(p);
    return rect ? { kind: p.kind, image: cropToDataURL(img, rect, p.kind === 'name' ? 3 : 5), candidates: p.candidates || [] } : null;
  });
}
