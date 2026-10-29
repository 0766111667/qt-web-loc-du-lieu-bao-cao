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

export function prevMonthOf(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// So sánh tháng này với tháng trước theo từng hạng mục (cùng danh mục). pct = null khi tháng trước bằng 0.
export function compareMonths(cur, prev) {
  const pm = new Map(prev.rows.map((r) => [r.id, r]));
  const rows = cur.rows.map((r) => {
    const p = pm.get(r.id) || { occ: 0, proc: 0 };
    return { id: r.id, label: r.label, occ: r.occ, prevOcc: p.occ, delta: r.occ - p.occ, pct: p.occ ? ((r.occ - p.occ) / p.occ) * 100 : null };
  });
  const t = { occ: cur.totals.occ, prevOcc: prev.totals.occ, delta: cur.totals.occ - prev.totals.occ };
  t.pct = prev.totals.occ ? (t.delta / prev.totals.occ) * 100 : null;
  return { month: cur.month, prevMonth: prev.month, rows, totals: t, prevReportCount: prev.reportCount };
}
