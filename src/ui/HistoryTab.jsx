import { useState } from 'preact/hooks';
import { useStore, deleteReport, reopenReport } from '../app/store.js';
import { Chip, ConfirmButton, fmtDate, fmtMonth } from './bits.jsx';

export function HistoryTab() {
  const s = useStore();
  const [q, setQ] = useState('');
  const list = s.reports.filter((r) => r.month === s.month && r.name.toLowerCase().includes(q.toLowerCase()));
  const sum = (r, k) => r.rows.reduce((t, x) => t + x[k], 0);
  return (
    <section>
      <div class="toolbar">
        <p class="lead">{fmtMonth(s.month)}：{list.length} 份报告</p>
        <input type="search" placeholder="按图片名称搜索…" value={q} onInput={(e) => setQ(e.target.value)} aria-label="搜索报告" />
      </div>
      {!list.length && <p class="empty">没有报告。</p>}
      <ul class="jobs">
        {list.map((r) => (
          <li class="job" key={r.id}>
            <div class="job-main">
              <div class="job-name" title={r.name}>{r.name}</div>
              <div class="job-meta">日期 {fmtDate(r.date)} · 发生 {sum(r, 'occ')}，已处理 {sum(r, 'proc')}</div>
            </div>
            <Chip kind={r.status === 'auto' ? 'ok' : 'info'}>{r.status === 'auto' ? '自动确认' : '人工确认'}</Chip>
            {/(^|,)(ai|solver|edited)(,|$)/.test(r.note || '') && <Chip kind="neutral">已校正</Chip>}
            <div class="job-actions">
              <button onClick={() => reopenReport(r.id)} title="把报告放回“待复核”以修改数字">重新打开修改</button>
              <ConfirmButton class="quiet" label="删除" confirmLabel="再点一次删除" onConfirm={() => deleteReport(r.id)} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
