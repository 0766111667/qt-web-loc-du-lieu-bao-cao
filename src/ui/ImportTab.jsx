import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, addFiles, setBatchDate, pauseQueue, resumeQueue, forceImport, retryJob, removeJob, openJob, clearFinished } from '../app/store.js';
import { T } from '../app/text.js';
import { Chip, useBlobUrl, fmtDate } from './bits.jsx';

const PAGE = 25;
const FILTERS = [['all', '全部'], ['attention', '需要关注'], ['done', '已确认']];
const KIND = { queued: 'neutral', working: 'info', review: 'warn', done: 'ok', error: 'bad', duplicate: 'warn' };

function JobRow({ job }) {
  const url = useBlobUrl(job.id, 'thumb');
  const issues = job.result?.validation.issues.length || 0;
  return (
    <li class="job">
      <div class="thumb">{url && <img src={url} alt="" />}</div>
      <div class="job-main">
        <div class="job-name" title={job.name}>{job.name}</div>
        <div class="job-meta">报告日期 {fmtDate(job.date)}
          {job.status === 'review' && ` · ${issues} 处待查看`}
          {job.status === 'error' && ` · ${job.error}`}
          {job.status === 'duplicate' && ' · 该图片之前已导入过'}
          {job.result?.aiUsed && ' · 已由 AI 重新识别'}
        </div>
      </div>
      <Chip kind={KIND[job.status]}>{T.status[job.status]}</Chip>
      <div class="job-actions">
        {job.status === 'review' && <button onClick={() => openJob(job.id)}>查看</button>}
        {job.status === 'error' && <button onClick={() => retryJob(job.id)}>重新识别</button>}
        {job.status === 'duplicate' && <><button onClick={() => forceImport(job.id)}>仍然导入</button><button class="quiet" onClick={() => removeJob(job.id)}>忽略</button></>}
        {job.status === 'done' && <button class="quiet" onClick={() => removeJob(job.id)} title="仅从列表中移除图片，报告仍保留在汇总中">隐藏</button>}
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
          <strong>把图片拖到这里</strong>，或粘贴图片（Ctrl+V）、从电脑中选择。一次可导入上百张。
        </div>
        <div class="drop-row">
          <label>本批报告日期 <input type="date" value={s.batchDate} onInput={(e) => setBatchDate(e.target.value)} /></label>
          <button class="primary" onClick={() => input.current.click()}>选择图片</button>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>
      </div>

      {s.batch.total > 0 && running > 0 && (
        <div class="progress-box">
          <div class="progress-head">
            <span>已识别 <b>{s.batch.finished}</b> / {s.batch.total} 张{s.paused && '（已暂停）'}</span>
            <button onClick={s.paused ? resumeQueue : pauseQueue}>{s.paused ? '继续' : '暂停'}</button>
          </div>
          <div class="bar"><div style={{ width: `${pct}%` }} /></div>
          <p class="hint">可以关闭页面，下次打开会自动继续识别未完成的图片。</p>
        </div>
      )}

      {jobs.length > 0 && (
        <>
          <div class="summary-line">
            <span><b>{count('done')}</b> 已确认</span>
            <span class={count('review') ? 'warn-text' : ''}><b>{count('review')}</b> 待复核</span>
            <span><b>{count('error') + count('duplicate')}</b> 出错或重复</span>
            <span><b>{running}</b> 排队中</span>
          </div>
          <div class="toolbar">
            <div class="seg">{FILTERS.map(([k, l]) => <button class={filter === k ? 'on' : ''} onClick={() => { setFilter(k); setPage(0); }}>{l}</button>)}</div>
            {count('done') > 0 && <button class="quiet" onClick={clearFinished}>隐藏已确认的图片</button>}
          </div>
          <ul class="jobs">{shown.slice(cur * PAGE, cur * PAGE + PAGE).map((j) => <JobRow key={j.id} job={j} />)}</ul>
          {!shown.length && <p class="empty">该分类下没有图片。</p>}
          {pages > 1 && <div class="pager"><button disabled={cur === 0} onClick={() => setPage(cur - 1)}>上一页</button><span>第 {cur + 1}/{pages} 页</span><button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>下一页</button></div>}
        </>
      )}
      {!jobs.length && <p class="empty">还没有图片。通过校验的图片会自动确认，其余的会出现在“待复核”。</p>}
    </section>
  );
}
