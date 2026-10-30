import { useEffect, useState } from 'preact/hooks';
import { useStore, openSettings, updateSettings, testAi, runSync, signOutCloud, catalogOps, buildBackup, restoreBackup, resetLearning, wipeAll, toast } from '../app/store.js';
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
      <Toggle k="aiEnabled" hint="只发送不确定的行（很小的图片片段）。校验未通过的图片会自动交给 AI；失败时在后台自动重试，不需要手动开关。">用 Gemini AI 自动重新识别不确定的行</Toggle>
      {st.aiEnabled && <>
        <label class="field">AI 服务地址<input value={st.aiEndpoint} onChange={(e) => updateSettings({ aiEndpoint: e.target.value.trim() })} /></label>
        <div class="row-gap">
          <button onClick={testAi} disabled={s.ai.checking}>{s.ai.checking ? '检查中…' : '检查 AI 连接'}</button>
          {s.ai.status === 'ok' && <span class="ai-ok">✓ 连接正常{s.ai.model ? `（模型 ${s.ai.model}）` : ''}</span>}
          {s.ai.status === 'error' && <span class="ai-bad">✗ {s.ai.message}</span>}
        </div>
        <AiDiag />
      </>}
    </div>
  );
}

// AI 诊断：真实的额度状态（来自 Google 的回应）、本次使用的统计、最近的错误。
function AiDiag() {
  const { ai } = useStore();
  const st = ai.stats, p = ai.probe;
  return (
    <div class="diag">
      <h3>AI 诊断</h3>
      <p>模型：<b>{ai.model || '—'}</b>　今日已用：<b>{ai.usage?.n ?? '—'}</b> / {ai.usage?.max ?? '—'}</p>
      {p && <p>最近检测（{new Date(p.at).toLocaleTimeString('zh-CN')}）：{p.ok ? '✓ 正常，可以使用' : `✗ ${p.message || p.code}${p.retryAfter ? `（约 ${p.retryAfter} 秒后可重试）` : ''}`}</p>}
      <p class="hint">本次使用：调用 {st.calls} 次 · 询问 {st.asked} 个单元格 · 修正 {st.fixed} 处 · 使校验通过 {st.solved} 张图片 · 没有改动 {st.unchanged} 张</p>
      {ai.log.length > 0 && <details><summary>最近的错误（{ai.log.length}）</summary><ul>{ai.log.map((l) => <li>{new Date(l.at).toLocaleTimeString('zh-CN')} · {l.code} · {l.message}</li>)}</ul></details>}
      <p class="hint">免费版 Gemini 有“每分钟”和“每天”两种额度。每分钟满了会自动等待后继续；每天满了会暂停，次日自动恢复，不会反复重试。</p>
    </div>
  );
}

function AccountPane() {
  const s = useStore();
  const { status, pending, lastAt, error } = s.sync;
  const u = s.ai.usage;
  if (s.auth.status === 'off') return <div class="stack"><p class="warn-box">尚未配置 Supabase：数据只保存在这台设备上，也没有登录和多设备同步。配置方法见 README 的“第 3 步”。</p></div>;
  return (
    <div class="stack">
      <div><h3>账号</h3><p>已登录：<b>{(s.auth.email || '—').replace(/@qt\.app$/, '')}</b></p><button onClick={signOutCloud}>退出登录</button></div>
      <div><h3>云同步</h3>
        <p>{status === 'syncing' ? '同步中…' : status === 'offline' ? '离线：恢复网络后自动同步。' : status === 'error' ? `同步出错：${error}` : '已连接到团队共用的数据。'}{pending > 0 && ` 有 ${pending} 项等待上传。`}</p>
        {lastAt > 0 && <p class="hint">上次同步：{new Date(lastAt).toLocaleString('zh-CN')}</p>}
        <p class="hint">同步内容：已确认的报告、问题类型、已学习的数字样本。原图不会上传，待复核的图片只在导入它的设备上。</p>
        <button onClick={() => runSync({ manual: true })} disabled={status === 'syncing'}>立即同步</button></div>
      <div><h3>今日 AI 用量</h3>
        <p>{u && u.n != null ? <>已用 <b>{u.n}</b> / {u.max} 次（全团队合计，当地 0 点重置）</> : '暂无数据（首次使用 AI 或点击“检查 AI 连接”后显示）'}</p>
        <button onClick={testAi} disabled={s.ai.checking}>{s.ai.checking ? '检查中…' : '检查 AI 连接'}</button></div>
    </div>
  );
}

function DataPane() {
  const s = useStore();
  const [typed, setTyped] = useState('');
  return (
    <div class="stack">
      {!s.persistent && <p class="warn-box">浏览器禁止了本地存储（可能是隐私模式）。关闭标签页后数据会丢失，请经常备份。</p>}
      <div><h3>备份</h3><p class="hint">备份文件包含报告、问题类型和已学习的样本，不含原图。</p>
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
  const tabs = [['catalog', '问题类型'], ['read', '识别与 AI'], ['account', '账号与云'], ['data', '数据']];
  return (
    <div class="modal-back" onMouseDown={(e) => e.target === e.currentTarget && openSettings(false)}>
      <div class="modal" role="dialog" aria-modal="true" aria-label="设置">
        <div class="modal-head"><h2>设置</h2><button class="quiet" onClick={() => openSettings(false)}>关闭</button></div>
        <div class="seg modal-tabs">{tabs.map(([k, l]) => <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        <div class="modal-body">{tab === 'catalog' ? <CatalogPane /> : tab === 'read' ? <ReadingPane /> : tab === 'account' ? <AccountPane /> : <DataPane />}</div>
      </div>
    </div>
  );
}
