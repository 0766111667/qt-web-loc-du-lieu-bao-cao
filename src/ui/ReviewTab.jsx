import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { useStore, setTab, openJob, editCell, editTotal, assignItem, createItemForRow, approveJob, retryJob, removeJob, jobReady, setJobDate } from '../app/store.js';
import { orderedItems } from '../core/catalog.js';
import { T } from '../app/vi.js';
import { Chip, ConfirmButton, useBlobUrl } from './bits.jsx';

function ImageViewer({ url, table, row }) {
  const [zoom, setZoom] = useState(1);
  const hl = row != null ? table.rows.find((_, i) => i === row) : null;
  return (
    <div class="viewer">
      <div class="viewer-tools">
        <button onClick={() => setZoom(Math.max(1, zoom - 0.5))} aria-label="Thu nhỏ">−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(Math.min(4, zoom + 0.5))} aria-label="Phóng to">+</button>
        <button class="quiet" onClick={() => setZoom(1)}>Vừa khung</button>
      </div>
      <div class="viewer-scroll">
        <div class="viewer-stage" style={{ width: `${zoom * 100}%` }}>
          {url ? <img src={url} alt="Ảnh gốc cần đối chiếu" /> : <div class="img-loading">Đang tải ảnh…</div>}
          {hl && <div class="hl" style={{ top: `${(hl.y0 / table.size.height) * 100}%`, height: `${((hl.y1 - hl.y0 + 1) / table.size.height) * 100}%` }} />}
        </div>
      </div>
    </div>
  );
}

// Chỉ giữ chữ số: gõ nhầm chữ cái sẽ bị bỏ ngay trong ô.
const digitsOnly = (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); return e.target.value; };

function Cell({ cell, min, onInput, label }) {
  const cls = cell.value == null ? 'bad' : cell.confidence < min && !cell.edited ? 'warn' : cell.edited ? 'edited' : '';
  return <input class={`num ${cls}`} inputMode="numeric" aria-label={label} value={cell.value ?? ''} onInput={(e) => onInput(digitsOnly(e))} />;
}

function ReviewPane({ job }) {
  const s = useStore();
  const res = job.result;
  const url = useBlobUrl(job.id);
  const [hl, setHl] = useState(null);
  const [armed, setArmed] = useState(false);
  const [draft, setDraft] = useState(null); // { rowIx, name, label }
  const v = res.validation;
  const ready = jobReady(job);
  const items = orderedItems(s.catalog);
  const shownRows = res.rows;

  const onSelect = (r, val) => {
    if (val === '__new') setDraft({ rowIx: r.rowIx, name: r.srcName || '', label: '' });
    else if (val) { setDraft(null); assignItem(job.id, r.rowIx, val); }
  };
  const approve = () => {
    if (v.status === 'ok' || armed) { setArmed(false); approveJob(job.id); }
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
            <label class="inline">Ngày báo cáo <input type="date" value={job.date} onInput={(e) => setJobDate(job.id, e.target.value)} /></label>
          </div>
          <Chip kind={v.status === 'ok' ? 'ok' : 'warn'}>{v.status === 'ok' ? 'Kiểm tra khớp: đạt' : `${v.issues.length} điểm cần xem`}</Chip>
        </div>

        {v.issues.length > 0 && <ul class="issues">{v.issues.map((i) => <li onMouseEnter={() => setHl(i.row ?? null)}>{(T.issue[i.code] || (() => i.code))(i.row, i)}</li>)}</ul>}
        {res.aiError && <p class="hint">AI dự phòng không dùng được: {res.aiError}</p>}

        <div class="tablewrap">
          <table class="grid">
            <thead><tr><th>STT</th><th>{T.col.item}</th><th>{T.col.occ}</th><th>{T.col.proc}</th></tr></thead>
            <tbody>
              {shownRows.map((r, n) => (
                <Fragment key={r.rowIx}>
                  <tr class={`${r.skip ? 'skipped' : ''} ${hl === r.rowIx ? 'active' : ''}`} onMouseEnter={() => setHl(r.rowIx)} onFocusIn={() => setHl(r.rowIx)}>
                    <td class="c-no">{n + 1}</td>
                    <td>
                      <select class={r.itemId || r.skip ? '' : 'bad'} value={r.skip ? '__skip' : r.itemId || ''} onChange={(e) => onSelect(r, e.target.value)} aria-label={`Hạng mục dòng ${n + 1}`}>
                        <option value="" disabled>Chọn hạng mục…</option>
                        {items.map((it) => <option value={it.id}>{it.label}</option>)}
                        {r.itemId && !items.some((it) => it.id === r.itemId) && <option value={r.itemId}>(đã ẩn)</option>}
                        <option value="__new">＋ Hạng mục mới…</option>
                        <option value="__skip">Bỏ qua dòng này</option>
                      </select>
                      {!r.itemId && !r.skip && r.srcName && <div class="src-name">Trên ảnh: {r.srcName}</div>}
                    </td>
                    <td class="c-occ"><Cell cell={r.occ} min={s.settings.minConfidence} label={`Phát sinh dòng ${n + 1}`} onInput={(t) => editCell(job.id, r.rowIx, 'occ', t)} /></td>
                    <td class="c-occ"><Cell cell={r.proc} min={s.settings.minConfidence} label={`Đã xử lý dòng ${n + 1}`} onInput={(t) => editCell(job.id, r.rowIx, 'proc', t)} /></td>
                  </tr>
                  {draft?.rowIx === r.rowIx && (
                    <tr class="draft"><td /><td colSpan={3}>
                      <p class="hint">Hạng mục này chưa có trong danh mục. Thêm một lần, các ảnh sau sẽ tự nhận ra.</p>
                      <div class="draft-form">
                        <label>Tên trên ảnh<input value={draft.name} onInput={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                        <label>Tên hiển thị (tiếng Việt)<input value={draft.label} placeholder={draft.name} onInput={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
                        <button class="primary" disabled={!draft.name.trim()} onClick={() => { createItemForRow(job.id, r.rowIx, draft); setDraft(null); }}>Thêm hạng mục</button>
                        <button class="quiet" onClick={() => setDraft(null)}>Hủy</button>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr class="sum"><td /><td>Tổng các dòng</td><td>{v.sums.occ}</td><td>{v.sums.proc}</td></tr>
              <tr class="sum printed">
                <td />
                <td>Tổng in trên ảnh {!res.total && <span class="hint">(chưa đọc được — nhập tay để đối chiếu)</span>}</td>
                <td><input class="num" inputMode="numeric" aria-label="Tổng phát sinh trên ảnh" value={res.total?.occ ?? ''} onInput={(e) => editTotal(job.id, 'occ', digitsOnly(e))} /></td>
                <td><input class="num" inputMode="numeric" aria-label="Tổng đã xử lý trên ảnh" value={res.total?.proc ?? ''} onInput={(e) => editTotal(job.id, 'proc', digitsOnly(e))} /></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="actions">
          <button class="primary" disabled={!ready} onClick={approve}>{v.status === 'ok' ? 'Duyệt và cộng vào tổng' : armed ? 'Bấm lại để duyệt dù chưa khớp' : 'Duyệt tay'}</button>
          <button onClick={() => retryJob(job.id)}>Đọc lại ảnh</button>
          <ConfirmButton class="quiet" label="Bỏ ảnh này" confirmLabel="Bấm lại để bỏ" onConfirm={() => removeJob(job.id)} />
        </div>
        {!ready && <p class="hint">Cần chọn hạng mục và điền đủ số cho mọi dòng (hoặc “Bỏ qua dòng này”) trước khi duyệt.</p>}
        {ready && v.status !== 'ok' && <p class="hint">Chưa khớp kiểm tra. Hãy đối chiếu từng dòng với ảnh gốc rồi mới duyệt tay.</p>}
      </div>
    </div>
  );
}

export function ReviewTab() {
  const s = useStore();
  const items = s.jobs.filter((j) => j.status === 'review' && j.result);
  const sel = items.find((j) => j.id === s.selectedJob) || items[0];
  if (!sel) return (
    <section><p class="empty">Không có ảnh nào cần xem lại.</p><p class="center"><button onClick={() => setTab('import')}>Nhập thêm ảnh</button></p></section>
  );
  return (
    <section>
      <nav class="queue" aria-label="Ảnh cần xem lại">
        {items.map((j) => <button class={j.id === sel.id ? 'on' : ''} onClick={() => openJob(j.id)} title={j.name}><span>{j.name}</span><em>{j.result.validation.issues.length}</em></button>)}
      </nav>
      <ReviewPane key={sel.id} job={sel} />
    </section>
  );
}
