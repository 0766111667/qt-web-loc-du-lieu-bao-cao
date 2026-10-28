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
        <p class="lead">{fmtMonth(s.month)}: {list.length} báo cáo</p>
        <input type="search" placeholder="Tìm theo tên ảnh…" value={q} onInput={(e) => setQ(e.target.value)} aria-label="Tìm báo cáo" />
      </div>
      {!list.length && <p class="empty">Không có báo cáo nào.</p>}
      <ul class="jobs">
        {list.map((r) => (
          <li class="job" key={r.id}>
            <div class="job-main">
              <div class="job-name" title={r.name}>{r.name}</div>
              <div class="job-meta">Ngày {fmtDate(r.date)} · phát sinh {sum(r, 'occ')}, đã xử lý {sum(r, 'proc')}</div>
            </div>
            <Chip kind={r.status === 'auto' ? 'ok' : 'info'}>{r.status === 'auto' ? 'Tự động duyệt' : 'Duyệt tay'}</Chip>
            <div class="job-actions">
              <button onClick={() => reopenReport(r.id)} title="Đưa báo cáo về mục Cần xem lại để sửa số">Mở lại để sửa</button>
              <ConfirmButton class="quiet" label="Xóa" confirmLabel="Bấm lại để xóa" onConfirm={() => deleteReport(r.id)} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
