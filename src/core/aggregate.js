import { orderedItems } from './catalog.js';

// Tổng tháng = cộng dồn "phát sinh" và "đã xử lý" của mọi báo cáo trong tháng.
export function aggregate(reports, catalog, month) {
  const sel = reports.filter((r) => r.month === month);
  const items = orderedItems(catalog);
  const acc = new Map(items.map((it) => [it.id, { occ: 0, proc: 0 }]));
  for (const rep of sel) for (const row of rep.rows) {
    const a = acc.get(row.itemId);
    if (a) { a.occ += row.occ; a.proc += row.proc; }
  }
  const rows = items.map((it) => {
    const a = acc.get(it.id);
    return { id: it.id, name: it.name, label: it.label, occ: a.occ, proc: a.proc, backlog: a.occ - a.proc };
  });
  const totals = rows.reduce((t, r) => ({ occ: t.occ + r.occ, proc: t.proc + r.proc }), { occ: 0, proc: 0 });
  totals.backlog = totals.occ - totals.proc;
  rows.forEach((r) => { r.pct = totals.occ ? (r.occ / totals.occ) * 100 : 0; });
  return { month, reportCount: sel.length, rows, totals };
}

export const monthOf = (isoDate) => isoDate.slice(0, 7);

// Ngày theo giờ địa phương (không dùng UTC để tránh lệch ngày/tháng ở UTC+7).
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
