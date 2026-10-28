import { buildCsv } from '../core/csv.js';
import { T } from '../app/vi.js';
import { download, fmtMonth } from './bits.jsx';

export function exportCsv(agg) {
  const head = ['STT', T.col.item, T.col.occ, T.col.proc, T.col.backlog, 'Tỷ lệ (%)'];
  download(`tong-hop-su-co-${agg.month}.csv`, buildCsv(agg, head), 'text/csv;charset=utf-8');
}

export function exportPng(agg) {
  const W = 1200, rowH = 40, top = 96, cols = [70, 560, 140, 140, 130, 160];
  const H = top + rowH * (agg.rows.length + 2) + 24;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const font = (w, px) => `${w} ${px}px "Segoe UI", "Noto Sans", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`;
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#1B2430'; x.font = font(700, 26); x.textBaseline = 'middle';
  x.fillText(`Thống kê sự cố QT — ${fmtMonth(agg.month)}`, 24, 40);
  x.font = font(400, 15); x.fillStyle = '#5B6675';
  x.fillText(`${agg.reportCount} báo cáo được cộng dồn`, 24, 68);

  const xs = cols.reduce((a, w, i) => (a.push((a[i] ?? 24) + w), a), [24]);
  const cell = (text, i, y, align = 'left') => {
    x.textAlign = align;
    const px = align === 'left' ? xs[i] + 12 : xs[i] + cols[i] - 14;
    let t = String(text);
    while (x.measureText(t).width > cols[i] - 26 && t.length > 4) t = `${t.slice(0, -2)}…`;
    x.fillText(t, px, y);
  };
  const rowsOut = [
    { cells: ['STT', T.col.item, T.col.occ, T.col.proc, T.col.backlog, 'Tỷ lệ'], head: true },
    ...agg.rows.map((r, i) => ({ cells: [i + 1, r.label, r.occ, r.proc, r.backlog, `${Math.round(r.pct)}%`], warn: r.backlog > 0 })),
    { cells: ['', 'Tổng cộng', agg.totals.occ, agg.totals.proc, agg.totals.backlog, agg.totals.occ ? '100%' : '0%'], total: true },
  ];
  rowsOut.forEach((r, n) => {
    const y = top + n * rowH;
    x.fillStyle = r.head ? '#1F4E79' : r.total ? '#FBE6D3' : n % 2 ? '#fff' : '#F6F7F9';
    x.fillRect(24, y, W - 48, rowH);
    x.fillStyle = r.head ? '#fff' : '#1B2430';
    x.font = font(r.head || r.total ? 700 : 400, 16);
    r.cells.forEach((v, i) => {
      x.fillStyle = r.head ? '#fff' : (i === 4 && r.warn) ? '#A85B00' : '#1B2430';
      cell(v, i, y + rowH / 2, i >= 2 ? 'right' : 'left');
    });
  });
  x.strokeStyle = '#C9D0D8'; x.strokeRect(24.5, top + 0.5, W - 49, rowH * rowsOut.length);
  c.toBlob((b) => download(`tong-hop-su-co-${agg.month}.png`, b), 'image/png');
}
