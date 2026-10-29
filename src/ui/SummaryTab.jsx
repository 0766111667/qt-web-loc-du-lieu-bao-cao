import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { useStore, monthAggregate, openJob, monthAnomalies, monthCoverage, monthCompare, dailyTable, updateSettings, toast } from '../app/store.js';
import { T } from '../app/text.js';
import { exportCsv, exportPng, exportXlsx } from './export.js';
import { ReportPreview } from './ReportPreview.jsx';
import { fmtDate, fmtMonth } from './bits.jsx';

export function SummaryTab() {
  const s = useStore();
  const agg = monthAggregate();
  const [open, setOpen] = useState(null);
  const [preview, setPreview] = useState(false);
  const sources = (id) => s.reports.filter((r) => r.month === s.month).map((r) => ({ rep: r, row: r.rows.find((x) => x.itemId === id) })).filter((x) => x.row && (x.row.occ || x.row.proc));
  const hidden = s.catalog.items.filter((i) => i.hidden).length;

  if (preview) return <ReportPreview onClose={() => setPreview(false)} />;
  if (!agg.reportCount) return <section><p class="empty">{fmtMonth(s.month)}还没有任何报告。请在右上角选择其他月份，或到“导入图片”中导入。</p></section>;

  return (
    <section>
      <div class="toolbar">
        <p class="lead">{fmtMonth(s.month)}：累计 <b>{agg.reportCount}</b> 份报告。发生次数 <b>{agg.totals.occ}</b>，已处理 <b>{agg.totals.proc}</b>，未处理 <b class={agg.totals.backlog ? 'warn-text' : ''}>{agg.totals.backlog}</b>。</p>
        <div class="row-gap">
          <button class="primary" onClick={() => exportXlsx(agg, monthCompare(), dailyTable(), monthAnomalies()).catch((e) => toast(`导出失败：${e.message || e}`))}>下载 Excel（含图表与上月对比）</button>
          <button onClick={() => setPreview(true)}>PDF 报告</button>
          <button class="quiet" onClick={() => exportCsv(agg)}>CSV</button><button class="quiet" onClick={() => exportPng(agg)}>PNG</button>
        </div>
      </div>
      <Alerts />
      <Coverage />
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

const TYPE = { spike: '单日突增', month_up: '月度上升', backlog: '未处理积压' };

// 异常提醒：规则简单可解释（见 core/anomaly.js），每条都说明依据。
function Alerts() {
  const list = monthAnomalies();
  if (!list.length) return null;
  return (
    <div class="notice warn" role="status">
      <b>异常提醒（{list.length}）</b>
      <ul>{list.slice(0, 8).map((a) => <li><em>{TYPE[a.type]}</em> <b>{a.label}</b>：{a.text}</li>)}</ul>
      {list.length > 8 && <p class="hint">还有 {list.length - 8} 条，见下载的 Excel 中的“异常提醒”。</p>}
    </div>
  );
}

// 数据完整性：缺哪几天、哪天有多份报告（可能被重复导入而加倍计数）。
function Coverage() {
  const s = useStore();
  const cov = monthCoverage();
  const dupes = cov.duplicates;
  const label = (d) => d.slice(5).replace('-', '/');
  return (
    <div class="notice info">
      <div class="row-gap"><b>数据完整性</b>
        <label class="inline"><input type="checkbox" checked={s.settings.skipWeekends} onChange={(e) => updateSettings({ skipWeekends: e.target.checked })} /> 忽略周末</label></div>
      {!cov.missing.length && !dupes.length && <p>已有报告的日期（{cov.dates.length} 天）连续，没有发现重复。</p>}
      {cov.missing.length > 0 && <p class="warn-text">缺少 {cov.missing.length} 天的报告：{cov.missing.slice(0, 20).map(label).join('、')}{cov.missing.length > 20 && '…'}</p>}
      {dupes.map((d) => <p class={d.identical ? 'warn-text' : ''}>{label(d.date)} 有 {d.count} 份报告{d.identical ? '，数字完全相同，疑似同一张图被重复导入（会被累计两次，请在“历史记录”删除多余的）' : '（数字不同，按不同班次/来源累计）'}</p>)}
    </div>
  );
}
