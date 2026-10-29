import { useStore, monthAggregate, monthCompare, monthAnomalies, monthCoverage } from '../app/store.js';
import { T } from '../app/text.js';
import { fmtMonth, fmtDate } from './bits.jsx';

const C_CUR = '#1f4e79', C_PREV = '#e8a361';

// 横向对比柱状图（纯 SVG，打印/保存 PDF 时矢量清晰）。
export function CompareChart({ cmp, prevLabel }) {
  const rows = cmp.rows.filter((r) => r.occ || r.prevOcc).slice(0, 16);
  if (!rows.length) return null;
  const W = 720, L = 190, R = 50, rowH = 30, H = rows.length * rowH + 40;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.occ, r.prevOcc)));
  const x = (v) => (v / max) * (W - L - R);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="本月与上月发生次数对比" style="max-width:720px;font:12px sans-serif">
      <g transform="translate(0,6)">
        <rect x={L} y={0} width="10" height="10" fill={C_CUR} /><text x={L + 16} y={9} fill="#333">本月</text>
        <rect x={L + 70} y={0} width="10" height="10" fill={C_PREV} /><text x={L + 86} y={9} fill="#333">{prevLabel}</text>
      </g>
      {rows.map((r, i) => (
        <g transform={`translate(0,${28 + i * rowH})`} key={r.id}>
          <text x={L - 8} y={12} text-anchor="end" fill="#222">{r.label.length > 13 ? `${r.label.slice(0, 12)}…` : r.label}</text>
          <rect x={L} y={0} width={Math.max(1, x(r.occ))} height="11" fill={C_CUR} />
          <text x={L + x(r.occ) + 4} y={10} fill="#222">{r.occ}</text>
          <rect x={L} y={13} width={Math.max(1, x(r.prevOcc))} height="11" fill={C_PREV} />
          <text x={L + x(r.prevOcc) + 4} y={23} fill="#555">{r.prevOcc}</text>
        </g>
      ))}
    </svg>
  );
}

const sign = (n) => (n > 0 ? `+${n}` : String(n));

// 报告预览：点“打印 / 保存为 PDF”即可在手机或电脑上另存为 PDF。打印时只输出这一页。
export function ReportPreview({ onClose }) {
  const s = useStore();
  const agg = monthAggregate(), cmp = monthCompare(), an = monthAnomalies(), cov = monthCoverage();
  const prevLabel = `${Number(cmp.prevMonth.split('-')[1])}月`;
  const shown = agg.rows.map((r, i) => ({ r, c: cmp.rows[i] })).filter(({ r, c }) => r.occ || c.prevOcc);
  return (
    <div class="report-paper">
      <div class="no-print report-bar">
        <button onClick={onClose}>← 返回</button>
        <button class="primary" onClick={() => window.print()}>打印 / 保存为 PDF</button>
      </div>
      <h1>QT软件问题统计 — {fmtMonth(agg.month)}</h1>
      <p class="meta">共累计 {agg.reportCount} 份报告 · 发生 {agg.totals.occ} · 已处理 {agg.totals.proc} · 未处理 {agg.totals.backlog}
        {cmp.totals.prevOcc > 0 && <> · 较{prevLabel}发生次数 {sign(cmp.totals.delta)}{cmp.totals.pct != null && `（${sign(Math.round(cmp.totals.pct))}%）`}</>}</p>
      <h2>本月与{prevLabel}对比</h2>
      <CompareChart cmp={cmp} prevLabel={prevLabel} />
      <table class="rep-table">
        <thead><tr><th>{T.col.no}</th><th>{T.col.item}</th><th>{T.col.occ}</th><th>{T.col.proc}</th><th>{T.col.backlog}</th><th>{T.col.pct}</th><th>{prevLabel}发生</th><th>变化</th></tr></thead>
        <tbody>
          {shown.map(({ r, c }, i) => <tr><td>{i + 1}</td><td>{r.label}</td><td>{r.occ}</td><td>{r.proc}</td><td class={r.backlog > 0 ? 'w' : ''}>{r.backlog}</td><td>{Math.round(r.pct)}%</td><td>{c.prevOcc}</td><td>{sign(c.delta)}</td></tr>)}
        </tbody>
        <tfoot><tr><td /><td>总计</td><td>{agg.totals.occ}</td><td>{agg.totals.proc}</td><td>{agg.totals.backlog}</td><td>{agg.totals.occ ? '100%' : '0%'}</td><td>{cmp.totals.prevOcc}</td><td>{sign(cmp.totals.delta)}</td></tr></tfoot>
      </table>
      {an.length > 0 && <><h2>异常提醒</h2><ul>{an.map((a) => <li><b>{a.label}</b>：{a.text}</li>)}</ul></>}
      {(cov.missing.length > 0 || cov.duplicates.length > 0) && <><h2>数据完整性</h2>
        {cov.missing.length > 0 && <p>缺少报告的日期（{cov.missing.length} 天）：{cov.missing.map((d) => d.slice(5)).join('、')}</p>}
        {cov.duplicates.map((d) => <p>{fmtDate(d.date)} 有 {d.count} 份报告{d.identical ? '（数字完全相同，疑似重复导入）' : ''}</p>)}</>}
      <p class="meta">生成时间：{new Date().toLocaleString('zh-CN')} · {s.auth.email || '本机'}</p>
    </div>
  );
}
