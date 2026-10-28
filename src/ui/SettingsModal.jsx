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
      <p class="hint">问题类型按图片中的名称识别，而不是按序号。可在此改名、调整顺序、合并或删除；历史记录会同步更新。</p>
      <ul class="cat-list">
        {items.map((it, i) => (
          <li key={it.id} class={it.hidden ? 'is-hidden' : ''}>
            <div class="cat-move">
              <button class="quiet" disabled={i === 0} onClick={() => catalogOps.move(it.id, -1)} aria-label="上移">▲</button>
              <button class="quiet" disabled={i === items.length - 1} onClick={() => catalogOps.move(it.id, 1)} aria-label="下移">▼</button>
            </div>
            <div class="cat-fields">
              <input value={it.label} onChange={(e) => catalogOps.setLabel(it.id, e.target.value)} aria-label="显示名称" />
              <input class="src" value={it.name} onChange={(e) => catalogOps.renameSource(it.id, e.target.value)} aria-label="图片中的名称" />
            </div>
            <div class="cat-actions">
              <button onClick={() => catalogOps.hide(it.id, !it.hidden)}>{it.hidden ? '显示' : '隐藏'}</button>
              {mergeFrom === it.id
                ? <select autoFocus onChange={(e) => { if (e.target.value) { catalogOps.merge(it.id, e.target.value); setMergeFrom(null); } }} onBlur={() => setMergeFrom(null)}><option value="">合并到…</option>{items.filter((x) => x.id !== it.id).map((x) => <option value={x.id}>{x.label}</option>)}</select>
                : <button onClick={() => setMergeFrom(it.id)}>合并</button>}
              <ConfirmButton class="quiet" label="删除" confirmLabel="同时删除数据？" onConfirm={() => catalogOps.remove(it.id)} />
            </div>
          </li>
        ))}
      </ul>
      <form class="cat-add" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { catalogOps.add(name.trim(), label.trim() || name.trim()); setName(''); setLabel(''); } }}>
        <input placeholder="图片中的名称（例如 新问题）" value={name} onInput={(e) => setName(e.target.value)} />
        <input placeholder="显示名称" value={label} onInput={(e) => setLabel(e.target.value)} />
        <button class="primary" disabled={!name.trim()}>添加问题类型</button>
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
      <Toggle k="autoApprove" hint="关闭后，每张图片都需要人工查看。">校验一致时自动确认</Toggle>
      <Toggle k="requireProcessedLE" hint="已处理大于发生次数的图片会转入待复核。">要求“已处理”不大于“发生次数”</Toggle>
      <Toggle k="ocrChinese" hint="仅用于尚未识别的新名称。首次使用需下载约 20 MB 的中文识别数据。">用 OCR 识别汉字问题类型名称</Toggle>
      <label class="field">同时识别的图片数
        <select value={st.concurrency} onChange={(e) => updateSettings({ concurrency: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option value={n}>{n}</option>)}</select>
      </label>
      <hr />
      <Toggle k="aiEnabled" hint="仅发送不确定的行（很小的图片片段），且仅在图片未通过校验时发送。需要在 Vercel 上配置服务端（Gemini）。">让 Gemini AI 重新识别不确定的行</Toggle>
      {st.aiEnabled && <>
        <label class="field">AI 服务地址<input value={st.aiEndpoint} onChange={(e) => updateSettings({ aiEndpoint: e.target.value.trim() })} /></label>
        <label class="field">访问密码（APP_ACCESS_KEY）<input type="password" autoComplete="off" value={st.aiKey} onChange={(e) => updateSettings({ aiKey: e.target.value })} /></label>
      </>}
    </div>
  );
}

function DataPane() {
  const s = useStore();
  const [typed, setTyped] = useState('');
  return (
    <div class="stack">
      {!s.persistent && <p class="warn-box">浏览器禁止了本地存储（可能是隐私模式）。关闭标签页后数据会丢失，请经常备份。</p>}
      <div><h3>备份</h3><p class="hint">备份文件包含报告、问题类型和已学习的样本，不含原图和 AI 访问密码。</p>
        <div class="row-gap">
          <button onClick={() => download(`qt-backup-${new Date().toISOString().slice(0, 10)}.json`, buildBackup(), 'application/json')}>下载备份</button>
          <label class="file-btn">从文件恢复<input type="file" accept="application/json,.json" hidden onChange={async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { await restoreBackup(await f.text()); } catch (err) { toast(String(err.message || err)); } }} /></label>
        </div></div>
      <div><h3>已学习的样本</h3><p class="hint">如果发现应用持续识别错误数字，可以清除。内置校准样本会保留。</p>
        <ConfirmButton label="清除已学习样本" confirmLabel="再点一次确认" onConfirm={resetLearning} /></div>
      <div><h3>清除全部数据</h3><p class="hint">输入“删除”以确认。此操作无法撤销。</p>
        <div class="row-gap"><input value={typed} onInput={(e) => setTyped(e.target.value)} placeholder="删除" aria-label="输入“删除”确认" /><button class="danger" disabled={typed !== '删除'} onClick={async () => { await wipeAll(); setTyped(''); toast('已清除全部数据。'); }}>全部清除</button></div></div>
    </div>
  );
}

export function SettingsModal() {
  const [tab, setTab] = useState('catalog');
  useEffect(() => { const k = (e) => e.key === 'Escape' && openSettings(false); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, []);
  const tabs = [['catalog', '问题类型'], ['read', '识别与 AI'], ['data', '数据']];
  return (
    <div class="modal-back" onMouseDown={(e) => e.target === e.currentTarget && openSettings(false)}>
      <div class="modal" role="dialog" aria-modal="true" aria-label="设置">
        <div class="modal-head"><h2>设置</h2><button class="quiet" onClick={() => openSettings(false)}>关闭</button></div>
        <div class="seg modal-tabs">{tabs.map(([k, l]) => <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        <div class="modal-body">{tab === 'catalog' ? <CatalogPane /> : tab === 'read' ? <ReadingPane /> : <DataPane />}</div>
      </div>
    </div>
  );
}
