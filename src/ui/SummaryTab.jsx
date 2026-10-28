import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { useStore, monthAggregate, openJob } from '../app/store.js';
import { T } from '../app/text.js';
import { exportCsv, exportPng } from './export.js';
import { fmtDate, fmtMonth } from './bits.jsx';

export function SummaryTab() {
  const s = useStore();
  const agg = monthAggregate();
  const [open, setOpen] = useState(null);
  const sources = (id) => s.reports.filter((r) => r.month === s.month).map((r) => ({ rep: r, row: r.rows.find((x) => x.itemId === id) })).filter((x) => x.row && (x.row.occ || x.row.proc));
  const hidden = s.catalog.items.filter((i) => i.hidden).length;

  if (!agg.reportCount) return <section><p class="empty">{fmtMonth(s.month)}还没有任何报告。请在右上角选择其他月份，或到“导入图片”中导入。</p></section>;

  return (
    <section>
      <div class="toolbar">
        <p class="lead">{fmtMonth(s.month)}：累计 <b>{agg.reportCount}</b> 份报告。发生次数 <b>{agg.totals.occ}</b>，已处理 <b>{agg.totals.proc}</b>，未处理 <b class={agg.totals.backlog ? 'warn-text' : ''}>{agg.totals.backlog}</b>。</p>
        <div class="row-gap"><button onClick={() => exportCsv(agg)}>下载 CSV（Excel）</button><button onClick={() => exportPng(agg)}>下载 PNG 图片</button></div>
      </div>
      <div class="tablewrap">
        <table class="grid summary">
          <thead><tr><th>{T.col.no}</th><th>{T.col.item}</th><th>{T.col.occ}</th><th>{T.col.proc}</th><th>{T.col.backlog}</th><th>{T.col.pct}</th></tr></thead>
          <tbody>
            {agg.rows.map((r, i) => (
              <Fragment key={r.id}>
                <tr class={`${r.occ ? 'has' : 'zero'} ${open === r.id ? 'active' : ''}`} onClick={() => r.occ && setOpen(open === r.id ? null : r.id)}>
                  <td class="c-no">{i + 1}</td>
                  <td>{r.label}{r.label !== r.name && <span class="src-name"> {r.name}</span>}</td>
                  <td class="c-occ">{r.occ}</td><td class="c-occ">{r.proc}</td>
                  <td class={`c-occ ${r.backlog > 0 ? 'warn-text' : ''}`}>{r.backlog}</td>
                  <td class="c-pct">{Math.round(r.pct)}%</td>
                </tr>
                {open === r.id && (
                  <tr class="drill"><td /><td colSpan={5}>
                    <ul>{sources(r.id).map(({ rep, row }) => <li><span>{fmtDate(rep.date)}</span><span>{rep.name}</span><span>发生 {row.occ}，已处理 {row.proc}</span>{rep.status === 'manual' && <em>人工确认</em>}{s.jobs.some((j) => j.id === rep.id && j.result) && <button class="quiet" onClick={(e) => { e.stopPropagation(); openJob(rep.id); }}>查看图片</button>}</li>)}</ul>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
          <tfoot><tr class="sum"><td /><td>总计</td><td>{agg.totals.occ}</td><td>{agg.totals.proc}</td><td>{agg.totals.backlog}</td><td>{agg.totals.occ ? '100%' : '0%'}</td></tr></tfoot>
        </table>
      </div>
      {hidden > 0 && <p class="hint">有 {hidden} 个问题类型已隐藏，不在此表中（可在 设置 → 问题类型 中重新显示）。</p>}
      <p class="hint">点击有数据的行，可查看计入该行的各份报告。</p>
    </section>
  );
}
