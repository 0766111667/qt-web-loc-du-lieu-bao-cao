import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, setTab, openJob, editCell, editTotal, assignItem, createItemForRow, approveJob, retryJob, removeJob, jobReady, setJobDate, runAiNow, rescanAll, undoAiCell, conflictsForJob, approveAllMatched, matchedJobs } from '../app/store.js';
import { orderedItems } from '../core/catalog.js';
import { T } from '../app/text.js';
import { Chip, ConfirmButton, useBlobUrl } from './bits.jsx';

function ImageViewer({ url, table, row }) {
  const [zoom, setZoom] = useState(1);
  const [tall, setTall] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const scroller = useRef(null);
  const hl = row != null ? table.rows[row] : null;
  // 选中某一行（或点击提示）时，原图自动滚动到该行：手机上不用再手动拖动对照。
  useEffect(() => {
    const el = scroller.current;
    if (!el || !hl) return;
    const top = (hl.y0 / table.size.height) * el.scrollHeight;
    el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3), behavior: 'smooth' });
  }, [row, zoom, tall, loaded, url]);
  return (
    <div class={`viewer ${tall ? 'tall' : ''}`}>
      <div class="viewer-tools">
        <button onClick={() => setZoom(Math.max(1, zoom - 0.5))} aria-label="缩小">−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(Math.min(4, zoom + 0.5))} aria-label="放大">+</button>
        <button class="quiet" onClick={() => setZoom(1)}>适应窗口</button>
        <button class="quiet only-narrow" onClick={() => setTall(!tall)}>{tall ? '收起原图' : '展开原图'}</button>
      </div>
      <div class="viewer-scroll" ref={scroller}>
        <div class="viewer-stage" style={{ width: `${zoom * 100}%` }}>
          {url ? <img src={url} alt="待核对的原图" onLoad={() => setLoaded((n) => n + 1)} /> : <div class="img-loading">正在加载图片…</div>}
          {hl && <div class="hl" style={{ top: `${(hl.y0 / table.size.height) * 100}%`, height: `${((hl.y1 - hl.y0 + 1) / table.size.height) * 100}%` }} />}
        </div>
      </div>
    </div>
  );
}

// 只保留数字：误输入的字母会立即被去掉。
const digitsOnly = (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); return e.target.value; };

function Cell({ cell, min, onInput, onUndo, label }) {
  const cls = cell.suggested ? 'sug' : cell.source === 'ai' ? 'ai' : cell.value == null ? 'bad' : cell.confidence < min && !cell.edited ? 'warn' : cell.edited ? 'edited' : '';
  const tag = cell.suggested ? (cell.source === 'solver' ? '组合推算' : '总计推算') : cell.source === 'ai' ? 'AI' : null;
  return (
    <div class="cellwrap">
      <input class={`num ${cls}`} inputMode="numeric" pattern="[0-9]*" enterKeyHint="next" aria-label={label} value={cell.value ?? ''} onFocus={(e) => e.target.select()} onInput={(e) => onInput(digitsOnly(e))} />
      {tag && (cell.was
        ? <button class={`tag ${cls}`} onClick={onUndo} title="撤销，恢复为识别到的原值">{tag} {cell.was.value ?? '空'}→{cell.value} ↩</button>
        : <span class={`tag ${cls}`}>{tag} ✓</span>)}
    </div>
  );
}

function ReviewPane({ job }) {
  const s = useStore();
  const res = job.result;
  const url = useBlobUrl(job.id);
  const live = res.rows.filter((r) => !r.skip);
  const rowOf = (issue) => (issue.row != null ? live[issue.row]?.rowIx ?? null : null);
  const [hl, setHl] = useState(() => { const first = res.validation.issues.find((i) => i.row != null); return first ? rowOf(first) : null; });
  const [armed, setArmed] = useState(false);
  const [onlySus, setOnlySus] = useState(false);
  const [draft, setDraft] = useState(null); // { rowIx, name, label }
  const v = res.validation;
  const ready = jobReady(job);
  const soft = v.issues.length > 0 && v.issues.every((i) => i.code === 'suggested'); // 只有“由总计推算”的提示：看过原图后一次点击即可确认
  const busy = s.ai.busy.includes(job.id);
  const sameDay = conflictsForJob(job);
  const goRow = (rowIx) => { if (rowIx == null) return; setHl(rowIx); document.getElementById(`r-${job.id}-${rowIx}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  const items = orderedItems(s.catalog);
  const isSusRow = (r) => !r.skip && (!r.itemId || [r.occ, r.proc].some((c) => c.value == null || c.suggested || c.source === 'ai' || (!c.edited && c.confidence < s.settings.minConfidence)) || v.issues.some((i) => i.row != null && live[i.row] === r));
  const shownRows = onlySus ? res.rows.filter(isSusRow) : res.rows;

  const onSelect = (r, val) => {
    if (val === '__new') setDraft({ rowIx: r.rowIx, name: r.srcName || '', label: '' });
    else if (val) { setDraft(null); assignItem(job.id, r.rowIx, val); }
  };
  const approve = () => {
    if (v.status === 'ok' || soft || armed) { setArmed(false); approveJob(job.id); }
    else { setArmed(true); setTimeout(() => setArmed(false), 6000); }
  };

  return (
    <div class="review">
      <div class="review-image">
        <ImageViewer url={url} table={res.table} row={hl} />
      </div>
      <div class="review-data">
        <div class="review-head">
          <div>
            <h2 title={job.name}>{job.name}</h2>
            <label class="inline">报告日期 <input type="date" value={job.date} onInput={(e) => setJobDate(job.id, e.target.value)} /></label>
            {sameDay.length > 0 && <p class="hint warn-text">该日期已有 {sameDay.length} 份已确认的报告（发生 {sameDay.reduce((t, x) => t + x.occ, 0)} 次）。若是同一份，请“忽略此图片”，否则会累计两次。</p>}
          </div>
          <div class="chips">
            <Chip kind={v.status === 'ok' ? 'ok' : 'warn'}>{v.status === 'ok' ? '校验一致：通过' : `${v.issues.length} 处待查看`}</Chip>
            {res.aiChanged > 0 && <Chip kind="info">AI 已修正 {res.aiChanged} 处</Chip>}
            {job.aiPending && !busy && <Chip kind="neutral">等待 AI</Chip>}
          </div>
        </div>

        {v.issues.length > 0 && <ul class="issues">{v.issues.map((i) => <li class={rowOf(i) != null ? 'link' : ''} onMouseEnter={() => setHl(rowOf(i))} onClick={() => goRow(rowOf(i))}>{(T.issue[i.code] || (() => i.code))(i.row, i)}</li>)}</ul>}
        {busy && <p class="hint">AI 正在重新识别这张图片…</p>}
        {!busy && job.aiPending && res.aiError && <p class="hint">AI 暂不可用：{res.aiError}。系统会自动重试，也可点“AI 重新识别”立即重试。</p>}

        <label class="inline sus-toggle"><input type="checkbox" checked={onlySus} onChange={(e) => setOnlySus(e.target.checked)} /> 只看可疑行（{res.rows.filter(isSusRow).length}/{live.length}）</label>
        <div class="tablewrap">
          <table class="grid">
            <thead><tr><th>{T.col.no}</th><th>{T.col.item}</th><th>{T.col.occ}</th><th>{T.col.proc}</th></tr></thead>
            <tbody>
              {shownRows.map((r, n) => (
                <Fragment key={r.rowIx}>
                  <tr id={`r-${job.id}-${r.rowIx}`} class={`${r.skip ? 'skipped' : ''} ${hl === r.rowIx ? 'active' : ''}`} onMouseEnter={() => setHl(r.rowIx)} onFocusIn={() => setHl(r.rowIx)}>
                    <td class="c-no">{n + 1}</td>
                    <td>
                      <select class={r.itemId || r.skip ? '' : 'bad'} value={r.skip ? '__skip' : r.itemId || ''} onChange={(e) => onSelect(r, e.target.value)} aria-label={`第${n + 1}行问题类型`}>
                        <option value="" disabled>选择问题类型…</option>
                        {items.map((it) => <option value={it.id}>{it.label}</option>)}
                        {r.itemId && !items.some((it) => it.id === r.itemId) && <option value={r.itemId}>（已隐藏）</option>}
                        <option value="__new">＋ 新问题类型…</option>
                        <option value="__skip">跳过此行</option>
                      </select>
                      {!r.itemId && !r.skip && r.srcName && <div class="src-name">图片中：{r.srcName}</div>}
                    </td>
                    <td class="c-occ"><Cell cell={r.occ} min={s.settings.minConfidence} label={`第${n + 1}行发生次数`} onUndo={() => undoAiCell(job.id, r.rowIx, 'occ')} onInput={(t) => editCell(job.id, r.rowIx, 'occ', t)} /></td>
                    <td class="c-occ"><Cell cell={r.proc} min={s.settings.minConfidence} label={`第${n + 1}行已处理`} onUndo={() => undoAiCell(job.id, r.rowIx, 'proc')} onInput={(t) => editCell(job.id, r.rowIx, 'proc', t)} /></td>
                  </tr>
                  {draft?.rowIx === r.rowIx && (
                    <tr class="draft"><td /><td colSpan={3}>
                      <p class="hint">该问题类型还不在列表中。添加一次，之后的图片会自动识别。</p>
                      <div class="draft-form">
                        <label>图片中的名称<input value={draft.name} onInput={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                        <label>显示名称<input value={draft.label} placeholder={draft.name} onInput={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
                        <button class="primary" disabled={!draft.name.trim()} onClick={() => { createItemForRow(job.id, r.rowIx, draft); setDraft(null); }}>添加问题类型</button>
                        <button class="quiet" onClick={() => setDraft(null)}>取消</button>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr class="sum"><td /><td>各行合计</td><td>{v.sums.occ}</td><td>{v.sums.proc}</td></tr>
              <tr class="sum printed">
                <td />
                <td>图片中的总计 {!res.total && <span class="hint">（未能识别，请手动输入以便核对）</span>}</td>
                <td><input class="num" inputMode="numeric" aria-label="图片中的总计：发生次数" value={res.total?.occ ?? ''} onInput={(e) => editTotal(job.id, 'occ', digitsOnly(e))} /></td>
                <td><input class="num" inputMode="numeric" aria-label="图片中的总计：已处理" value={res.total?.proc ?? ''} onInput={(e) => editTotal(job.id, 'proc', digitsOnly(e))} /></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="actions">
          <button class="primary" disabled={!ready} onClick={approve}>{v.status === 'ok' ? '确认并计入汇总' : soft ? '已对照原图，确认' : armed ? '再点一次，强制确认（未校验一致）' : '人工确认'}</button>
          <button onClick={() => runAiNow(job.id)} disabled={busy}>{busy ? 'AI 识别中…' : 'AI 重新识别'}</button>
          <button onClick={() => retryJob(job.id)}>重新识别</button>
          <ConfirmButton class="quiet" label="忽略此图片" confirmLabel="再点一次忽略" onConfirm={() => removeJob(job.id)} />
        </div>
        {!ready && <p class="hint">请为每一行选择问题类型并填写数字（或选择“跳过此行”）后才能确认。</p>}
        {ready && v.status !== 'ok' && <p class="hint">未通过校验。请逐行对照原图后再人工确认。</p>}
      </div>
    </div>
  );
}

export function ReviewTab() {
  const s = useStore();
  const items = s.jobs.filter((j) => j.status === 'review' && j.result);
  const sel = items.find((j) => j.id === s.selectedJob) || items[0];
  if (!sel) return (
    <section><p class="empty">没有需要复核的图片。</p><p class="center"><button onClick={() => setTab('import')}>继续导入图片</button></p></section>
  );
  const needy = items.filter((j) => j.result.validation.status !== 'ok').length;
  return (
    <section>
      {matchedJobs().length > 0 && <div class="bulk"><button class="primary" onClick={approveAllMatched}>一键确认全部总计一致的图片（{matchedJobs().length}）</button></div>}
      {needy > 0 && <div class="bulk"><button onClick={rescanAll} disabled={s.ai.busy.length > 0}>{s.ai.busy.length ? 'AI 识别中…' : `AI 重新识别全部（${needy}）`}</button></div>}
      <nav class="queue" aria-label="待复核的图片">
        {items.map((j) => <button class={j.id === sel.id ? 'on' : ''} onClick={() => openJob(j.id)} title={j.name}><span>{j.name}</span><em>{j.result.validation.issues.length}</em></button>)}
      </nav>
      <ReviewPane key={sel.id} job={sel} />
    </section>
  );
}
