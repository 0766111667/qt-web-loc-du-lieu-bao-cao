import { useEffect, useState } from 'preact/hooks';
import { useStore, openSettings, updateSettings, catalogOps, buildBackup, restoreBackup, resetLearning, wipeAll, toast } from '../app/store.js';
import { orderedItems } from '../core/catalog.js';
import { ConfirmButton, download } from './bits.jsx';

function CatalogPane() {
  const s = useStore();
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [mergeFrom, setMergeFrom] = useState(null);
  const items = orderedItems(s.catalog, true);
  return (
    <div>
      <p class="hint">Hạng mục được nhận theo tên trên ảnh, không theo số thứ tự. Đổi tên, đổi thứ tự, gộp hoặc xóa ở đây; lịch sử được cập nhật theo.</p>
      <ul class="cat-list">
        {items.map((it, i) => (
          <li key={it.id} class={it.hidden ? 'is-hidden' : ''}>
            <div class="cat-move">
              <button class="quiet" disabled={i === 0} onClick={() => catalogOps.move(it.id, -1)} aria-label="Đưa lên">▲</button>
              <button class="quiet" disabled={i === items.length - 1} onClick={() => catalogOps.move(it.id, 1)} aria-label="Đưa xuống">▼</button>
            </div>
            <div class="cat-fields">
              <input value={it.label} onChange={(e) => catalogOps.setLabel(it.id, e.target.value)} aria-label="Tên hiển thị" />
              <input class="src" value={it.name} onChange={(e) => catalogOps.renameSource(it.id, e.target.value)} aria-label="Tên trên ảnh" />
            </div>
            <div class="cat-actions">
              <button onClick={() => catalogOps.hide(it.id, !it.hidden)}>{it.hidden ? 'Hiện lại' : 'Ẩn'}</button>
              {mergeFrom === it.id
                ? <select autoFocus onChange={(e) => { if (e.target.value) { catalogOps.merge(it.id, e.target.value); setMergeFrom(null); } }} onBlur={() => setMergeFrom(null)}><option value="">Gộp vào…</option>{items.filter((x) => x.id !== it.id).map((x) => <option value={x.id}>{x.label}</option>)}</select>
                : <button onClick={() => setMergeFrom(it.id)}>Gộp</button>}
              <ConfirmButton class="quiet" label="Xóa" confirmLabel="Xóa cả số liệu?" onConfirm={() => catalogOps.remove(it.id)} />
            </div>
          </li>
        ))}
      </ul>
      <form class="cat-add" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { catalogOps.add(name.trim(), label.trim() || name.trim()); setName(''); setLabel(''); } }}>
        <input placeholder="Tên trên ảnh (ví dụ 新问题)" value={name} onInput={(e) => setName(e.target.value)} />
        <input placeholder="Tên hiển thị" value={label} onInput={(e) => setLabel(e.target.value)} />
        <button class="primary" disabled={!name.trim()}>Thêm hạng mục</button>
      </form>
    </div>
  );
}

function ReadingPane() {
  const s = useStore();
  const st = s.settings;
  const Toggle = ({ k, children, hint }) => (
    <label class="toggle"><input type="checkbox" checked={st[k]} onChange={(e) => updateSettings({ [k]: e.target.checked })} /><span>{children}{hint && <small>{hint}</small>}</span></label>
  );
  return (
    <div class="stack">
      <Toggle k="autoApprove" hint="Tắt đi nếu muốn tự tay xem mọi ảnh.">Tự duyệt ảnh khi kiểm tra khớp đạt</Toggle>
      <Toggle k="requireProcessedLE" hint="Ảnh có đã xử lý lớn hơn phát sinh sẽ chuyển sang Cần xem lại.">Yêu cầu “đã xử lý” không lớn hơn “phát sinh”</Toggle>
      <Toggle k="ocrChinese" hint="Chỉ dùng cho tên hạng mục lạ. Lần đầu tải khoảng 20 MB dữ liệu chữ Hán.">Đọc tên hạng mục chữ Hán bằng OCR</Toggle>
      <label class="field">Số ảnh đọc song song
        <select value={st.concurrency} onChange={(e) => updateSettings({ concurrency: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option value={n}>{n}</option>)}</select>
      </label>
      <hr />
      <Toggle k="aiEnabled" hint="Chỉ gửi các dòng không chắc (dải ảnh nhỏ), và chỉ khi ảnh chưa khớp kiểm tra. Cần cấu hình máy chủ trên Vercel.">Nhờ AI đọc lại các dòng không chắc</Toggle>
      {st.aiEnabled && <>
        <label class="field">Địa chỉ máy chủ AI<input value={st.aiEndpoint} onChange={(e) => updateSettings({ aiEndpoint: e.target.value.trim() })} /></label>
        <label class="field">Mã truy cập (APP_ACCESS_KEY)<input type="password" autoComplete="off" value={st.aiKey} onChange={(e) => updateSettings({ aiKey: e.target.value })} /></label>
      </>}
    </div>
  );
}

function DataPane() {
  const s = useStore();
  const [typed, setTyped] = useState('');
  return (
    <div class="stack">
      {!s.persistent && <p class="warn-box">Trình duyệt đang chặn lưu trữ cục bộ (có thể do chế độ riêng tư). Dữ liệu sẽ mất khi đóng tab — hãy sao lưu thường xuyên.</p>}
      <div><h3>Sao lưu</h3><p class="hint">Tệp gồm báo cáo, danh mục và mẫu đã học. Không gồm ảnh gốc và mã truy cập AI.</p>
        <div class="row-gap">
          <button onClick={() => download(`sao-luu-su-co-qt-${new Date().toISOString().slice(0, 10)}.json`, buildBackup(), 'application/json')}>Tải bản sao lưu</button>
          <label class="file-btn">Khôi phục từ tệp<input type="file" accept="application/json,.json" hidden onChange={async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { await restoreBackup(await f.text()); } catch (err) { toast(String(err.message || err)); } }} /></label>
        </div></div>
      <div><h3>Mẫu đã học</h3><p class="hint">Xóa nếu thấy ứng dụng đọc sai số liên tục. Mẫu hiệu chuẩn có sẵn được giữ.</p>
        <ConfirmButton label="Xóa mẫu đã học" confirmLabel="Bấm lại để xóa" onConfirm={resetLearning} /></div>
      <div><h3>Xóa toàn bộ dữ liệu</h3><p class="hint">Gõ XOA để xác nhận. Không thể hoàn tác.</p>
        <div class="row-gap"><input value={typed} onInput={(e) => setTyped(e.target.value)} placeholder="XOA" aria-label="Gõ XOA để xác nhận" /><button class="danger" disabled={typed !== 'XOA'} onClick={async () => { await wipeAll(); setTyped(''); toast('Đã xóa toàn bộ dữ liệu.'); }}>Xóa tất cả</button></div></div>
    </div>
  );
}

export function SettingsModal() {
  const [tab, setTab] = useState('catalog');
  useEffect(() => { const k = (e) => e.key === 'Escape' && openSettings(false); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, []);
  const tabs = [['catalog', 'Hạng mục'], ['read', 'Đọc ảnh và AI'], ['data', 'Dữ liệu']];
  return (
    <div class="modal-back" onMouseDown={(e) => e.target === e.currentTarget && openSettings(false)}>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Cài đặt">
        <div class="modal-head"><h2>Cài đặt</h2><button class="quiet" onClick={() => openSettings(false)}>Đóng</button></div>
        <div class="seg modal-tabs">{tabs.map(([k, l]) => <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        <div class="modal-body">{tab === 'catalog' ? <CatalogPane /> : tab === 'read' ? <ReadingPane /> : <DataPane />}</div>
      </div>
    </div>
  );
}
