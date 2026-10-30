// Kiểm tra dữ liệu từ nguồn không tin cậy (đồng bộ từ đám mây, file sao lưu): chỉ nhận đúng hình dạng và giới hạn kích thước.
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n) : '');
const cnt = (v) => (Number.isInteger(v) && v >= 0 && v < 1e6 ? v : 0);
const DATE = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-\d{2}$/;

export function cleanReport(r) {
  if (!r || typeof r !== 'object' || !/^[\w-]{1,80}$/.test(String(r.id ?? '')) || !DATE.test(String(r.date ?? ''))) return null;
  const rows = Array.isArray(r.rows) ? r.rows.slice(0, 300).filter((x) => x && typeof x === 'object').map((x) => ({
    itemId: x.itemId == null ? null : str(x.itemId, 80) || null, srcName: str(x.srcName, 120), occ: cnt(x.occ), proc: cnt(x.proc),
  })) : [];
  const created = Number(r.createdAt);
  return {
    id: String(r.id), hash: typeof r.hash === 'string' && /^[\w-]{1,128}$/.test(r.hash) ? r.hash : undefined, name: str(r.name, 200), date: r.date,
    month: MONTH.test(String(r.month ?? '')) ? r.month : String(r.date).slice(0, 7), createdAt: Number.isFinite(created) ? created : 0, rows,
    printedTotal: r.printedTotal && typeof r.printedTotal === 'object' ? { occ: cnt(r.printedTotal.occ), proc: cnt(r.printedTotal.proc) } : (r.printedTotal == null ? null : null),
    status: ['auto', 'manual'].includes(r.status) ? r.status : 'manual', note: str(r.note, 300),
  };
}
