import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { useStore, monthAggregate, openJob } from '../app/store.js';
import { T } from '../app/vi.js';
import { exportCsv, exportPng } from './export.js';
import { fmtDate, fmtMonth } from './bits.jsx';

export function SummaryTab() {
  const s = useStore();
  const agg = monthAggregate();
  const [open, setOpen] = useState(null);
  const sources = (id) => s.reports.filter((r) => r.month === s.month).map((r) => ({ rep: r, row: r.rows.find((x) => x.itemId === id) })).filter((x) => x.row && (x.row.occ || x.row.proc));
  const hidden = s.catalog.items.filter((i) => i.hidden).length;

  if (!agg.reportCount) return <section><p class="empty">Chưa có báo cáo nào trong {fmtMonth(s.month)}. Chọn tháng khác ở góc trên, hoặc nhập ảnh ở mục “Nhập ảnh”.</p></section>;

  return (
    <section>
      <div class="toolbar">
        <p class="lead">{fmtMonth(s.month)}: cộng dồn <b>{agg.reportCount}</b> báo cáo. Phát sinh <b>{agg.totals.occ}</b>, đã xử lý <b>{agg.totals.proc}</b>, tồn <b class={agg.totals.backlog ? 'warn-text' : ''}>{agg.totals.backlog}</b>.</p>
        <div class="row-gap"><button onClick={() => exportCsv(agg)}>Tải CSV (Excel)</button><button onClick={() => exportPng(agg)}>Tải ảnh PNG</button></div>
      </div>
      <div class="tablewrap">
        <table class="grid summary">
          <thead><tr><th>STT</th><th>{T.col.item}</th><th>{T.col.occ}</th><th>{T.col.proc}</th><th>{T.col.backlog}</th><th>{T.col.pct}</th></tr></thead>
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
                    <ul>{sources(r.id).map(({ rep, row }) => <li><span>{fmtDate(rep.date)}</span><span>{rep.name}</span><span>phát sinh {row.occ}, đã xử lý {row.proc}</span>{rep.status === 'manual' && <em>duyệt tay</em>}{s.jobs.some((j) => j.id === rep.id && j.result) && <button class="quiet" onClick={(e) => { e.stopPropagation(); openJob(rep.id); }}>Xem ảnh</button>}</li>)}</ul>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
          <tfoot><tr class="sum"><td /><td>Tổng cộng</td><td>{agg.totals.occ}</td><td>{agg.totals.proc}</td><td>{agg.totals.backlog}</td><td>{agg.totals.occ ? '100%' : '0%'}</td></tr></tfoot>
        </table>
      </div>
      {hidden > 0 && <p class="hint">{hidden} hạng mục đang ẩn nên không nằm trong bảng này (bật lại trong Cài đặt → Hạng mục).</p>}
      <p class="hint">Bấm một dòng có số liệu để xem các báo cáo đã góp vào dòng đó.</p>
    </section>
  );
}
