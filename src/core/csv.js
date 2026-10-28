const q = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function buildCsv(agg, head, totalLabel = '总计') {
  const rows = [head, ...agg.rows.map((r, i) => [i + 1, r.label, r.occ, r.proc, r.backlog, agg.totals.occ ? Math.round(r.pct * 10) / 10 : 0])];
  rows.push(['', totalLabel, agg.totals.occ, agg.totals.proc, agg.totals.backlog, agg.totals.occ ? 100 : 0]);
  return '\ufeff' + rows.map((r) => r.map(q).join(',')).join('\r\n');
}
