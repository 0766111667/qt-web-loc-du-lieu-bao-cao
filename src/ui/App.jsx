import { useStore, setTab, setMonth, openSettings } from '../app/store.js';
import { T } from '../app/vi.js';
import { ImportTab } from './ImportTab.jsx';
import { ReviewTab } from './ReviewTab.jsx';
import { SummaryTab } from './SummaryTab.jsx';
import { HistoryTab } from './HistoryTab.jsx';
import { SettingsModal } from './SettingsModal.jsx';

const VIEWS = { import: ImportTab, review: ReviewTab, summary: SummaryTab, history: HistoryTab };

export function App() {
  const s = useStore();
  if (!s.ready) return <div class="boot">Đang mở dữ liệu…</div>;
  const View = VIEWS[s.tab];
  const reviewCount = s.jobs.filter((j) => j.status === 'review').length;
  const busy = s.jobs.filter((j) => j.status === 'queued' || j.status === 'working').length;
  return (
    <>
      <header class="top">
        <h1>{T.appName}</h1>
        <div class="top-right">
          <label class="inline">Tháng <input type="month" value={s.month} onInput={(e) => e.target.value && setMonth(e.target.value)} /></label>
          <button onClick={() => openSettings(true)}>Cài đặt</button>
        </div>
      </header>
      <nav class="tabs" role="tablist">
        {Object.entries(T.tabs).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={s.tab === k} class={s.tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
            {k === 'review' && reviewCount > 0 && <em class="badge warn">{reviewCount}</em>}
            {k === 'import' && busy > 0 && <em class="badge">{busy}</em>}
          </button>
        ))}
      </nav>
      {!s.persistent && <div class="warn-box wide">Trình duyệt không cho lưu dữ liệu cục bộ — dữ liệu sẽ mất khi đóng tab. Hãy sao lưu trong Cài đặt → Dữ liệu.</div>}
      <main><View /></main>
      {s.toast && <div class="toast" role="status"><span>{s.toast.text}</span>{s.toast.action && <button onClick={() => { s.toast.action.run(); s.toast = null; }}>{s.toast.action.label}</button>}</div>}
      {s.settingsOpen && <SettingsModal />}
    </>
  );
}
