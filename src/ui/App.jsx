import { useStore, setTab, setMonth, openSettings } from '../app/store.js';
import { T } from '../app/text.js';
import { ImportTab } from './ImportTab.jsx';
import { ReviewTab } from './ReviewTab.jsx';
import { SummaryTab } from './SummaryTab.jsx';
import { HistoryTab } from './HistoryTab.jsx';
import { SettingsModal } from './SettingsModal.jsx';
import { Boot, resetLocalData } from './Boot.jsx';

const VIEWS = { import: ImportTab, review: ReviewTab, summary: SummaryTab, history: HistoryTab };

export function App() {
  const s = useStore();
  if (!s.ready) return <Boot />;
  const View = VIEWS[s.tab];
  const reviewCount = s.jobs.filter((j) => j.status === 'review').length;
  const busy = s.jobs.filter((j) => j.status === 'queued' || j.status === 'working').length;
  return (
    <>
      <header class="top">
        <h1>{T.appName}</h1>
        <div class="top-right">
          <label class="inline">月份 <input type="month" value={s.month} onInput={(e) => e.target.value && setMonth(e.target.value)} /></label>
          <button onClick={() => openSettings(true)}>设置</button>
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
      {s.initError && <div class="warn-box wide">读取本地数据时出错（{s.initError}）。当前显示的是空白状态。<button class="danger" onClick={resetLocalData}>清除本地数据并重试</button></div>}
      {!s.persistent && !s.initError && <div class="warn-box wide">浏览器不允许本地保存数据——关闭标签页后数据会丢失。请在 设置 → 数据 中备份。</div>}
      <main><View /></main>
      {s.toast && <div class="toast" role="status"><span>{s.toast.text}</span>{s.toast.action && <button onClick={() => { s.toast.action.run(); s.toast = null; }}>{s.toast.action.label}</button>}</div>}
      {s.settingsOpen && <SettingsModal />}
    </>
  );
}
