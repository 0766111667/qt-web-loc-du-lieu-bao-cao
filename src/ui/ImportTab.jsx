import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, addFiles, setBatchDate, pauseQueue, resumeQueue, forceImport, retryJob, removeJob, openJob, clearFinished } from '../app/store.js';
import { T } from '../app/vi.js';
import { Chip, useBlobUrl, fmtDate } from './bits.jsx';

const PAGE = 25;
const FILTERS = [['all', 'Tất cả'], ['attention', 'Cần chú ý'], ['done', 'Đã duyệt']];
const KIND = { queued: 'neutral', working: 'info', review: 'warn', done: 'ok', error: 'bad', duplicate: 'warn' };

function JobRow({ job }) {
  const url = useBlobUrl(job.id, 'thumb');
  const issues = job.result?.validation.issues.length || 0;
  return (
    <li class="job">
      <div class="thumb">{url && <img src={url} alt="" />}</div>
      <div class="job-main">
        <div class="job-name" title={job.name}>{job.name}</div>
        <div class="job-meta">Ngày báo cáo {fmtDate(job.date)}
          {job.status === 'review' && ` · ${issues} điểm cần xem`}
          {job.status === 'error' && ` · ${job.error}`}
          {job.status === 'duplicate' && ' · ảnh này đã được nhập trước đó'}
          {job.result?.aiUsed && ' · đã nhờ AI đọc lại'}
        </div>
      </div>
      <Chip kind={KIND[job.status]}>{T.status[job.status]}</Chip>
      <div class="job-actions">
        {job.status === 'review' && <button onClick={() => openJob(job.id)}>Xem lại</button>}
        {job.status === 'error' && <button onClick={() => retryJob(job.id)}>Đọc lại</button>}
        {job.status === 'duplicate' && <><button onClick={() => forceImport(job.id)}>Vẫn nhập</button><button class="quiet" onClick={() => removeJob(job.id)}>Bỏ</button></>}
        {job.status === 'done' && <button class="quiet" onClick={() => removeJob(job.id)} title="Chỉ xóa ảnh khỏi danh sách, báo cáo vẫn nằm trong tổng">Ẩn</button>}
      </div>
    </li>
  );
}

export function ImportTab() {
  const s = useStore();
  const input = useRef(null);
  const [drag, setDrag] = useState(false);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const onPaste = (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); addFiles(files); } };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const jobs = s.jobs.filter((j) => j.status !== 'removed');
  const count = (st) => jobs.filter((j) => j.status === st).length;
  const running = count('queued') + count('working');
  const shown = jobs.filter((j) => filter === 'all' || (filter === 'done' ? j.status === 'done' : ['review', 'error', 'duplicate'].includes(j.status))).sort((a, b) => b.createdAt - a.createdAt);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const pct = s.batch.total ? Math.round((s.batch.finished / s.batch.total) * 100) : 0;

  return (
    <section>
      <div
        class={`drop ${drag ? 'over' : ''} ${jobs.length ? 'compact' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
      >
        <div>
          <strong>Kéo thả ảnh vào đây</strong>, dán ảnh (Ctrl+V) hoặc chọn từ máy. Nhập được cả trăm ảnh một lần.
        </div>
        <div class="drop-row">
          <label>Ngày báo cáo của lô này <input type="date" value={s.batchDate} onInput={(e) => setBatchDate(e.target.value)} /></label>
          <button class="primary" onClick={() => input.current.click()}>Chọn ảnh</button>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>
      </div>

      {s.batch.total > 0 && running > 0 && (
        <div class="progress-box">
          <div class="progress-head">
            <span>Đã đọc <b>{s.batch.finished}</b> / {s.batch.total} ảnh{s.paused && ' (đang tạm dừng)'}</span>
            <button onClick={s.paused ? resumeQueue : pauseQueue}>{s.paused ? 'Tiếp tục' : 'Tạm dừng'}</button>
          </div>
          <div class="bar"><div style={{ width: `${pct}%` }} /></div>
          <p class="hint">Có thể đóng tab và mở lại: ảnh chưa đọc sẽ tự đọc tiếp.</p>
        </div>
      )}

      {jobs.length > 0 && (
        <>
          <div class="summary-line">
            <span><b>{count('done')}</b> đã duyệt</span>
            <span class={count('review') ? 'warn-text' : ''}><b>{count('review')}</b> cần xem lại</span>
            <span><b>{count('error') + count('duplicate')}</b> lỗi hoặc trùng</span>
            <span><b>{running}</b> đang chờ</span>
          </div>
          <div class="toolbar">
            <div class="seg">{FILTERS.map(([k, l]) => <button class={filter === k ? 'on' : ''} onClick={() => { setFilter(k); setPage(0); }}>{l}</button>)}</div>
            {count('done') > 0 && <button class="quiet" onClick={clearFinished}>Ẩn các ảnh đã duyệt</button>}
          </div>
          <ul class="jobs">{shown.slice(cur * PAGE, cur * PAGE + PAGE).map((j) => <JobRow key={j.id} job={j} />)}</ul>
          {!shown.length && <p class="empty">Không có ảnh nào trong mục này.</p>}
          {pages > 1 && <div class="pager"><button disabled={cur === 0} onClick={() => setPage(cur - 1)}>Trước</button><span>Trang {cur + 1}/{pages}</span><button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Sau</button></div>}
        </>
      )}
      {!jobs.length && <p class="empty">Chưa có ảnh nào. Ảnh khớp kiểm tra sẽ được tự duyệt, ảnh còn lại nằm ở mục “Cần xem lại”.</p>}
    </section>
  );
}
