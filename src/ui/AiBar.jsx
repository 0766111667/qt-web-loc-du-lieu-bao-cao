import { useState } from 'preact/hooks';
import { useStore, updateSettings, retryAiNow, signOutCloud } from '../app/store.js';

// Thanh trạng thái AI hiện trên mọi tab: đang chạy / lỗi (kèm cách khắc phục ngay tại chỗ, không cần vào cài đặt).
export function AiBar() {
  const s = useStore();
  const ai = s.ai;
  const [key, setKey] = useState('');
  if (!s.settings.aiEnabled) return null;
  const pending = s.jobs.filter((j) => j.aiPending && j.status === 'review').length;

  if (ai.busy.length) return <div class="aibar info" role="status"><span class="spin" aria-hidden="true" />AI 正在重新识别 {ai.busy.length} 张图片…</div>;
  if (ai.status !== 'error' || !pending) return null;

  const cloudMode = s.auth.status !== 'off';
  const needKey = ai.code === 'no_key' || ai.code === 'bad_key' || ai.code === 'unauthorized';
  return (
    <div class="aibar warn" role="alert">
      <div class="aibar-text">
        <b>{needKey ? (cloudMode ? '需要重新登录' : 'AI 需要访问密码') : ai.code === 'daily_limit' ? '今日 AI 次数已用完' : ai.code === 'not_configured' ? 'AI 服务端尚未配置' : 'AI 暂时不可用'}</b>
        <span>{!cloudMode && needKey && ai.code === 'bad_key' ? '密码与服务器上的 APP_ACCESS_KEY 不一致。' : ai.message}</span>
        <small>{pending} 张图片在等待 AI。{ai.blocking ? '修复后会自动继续。' : '会自动重试，无需操作。'}</small>
      </div>
      {needKey && cloudMode
        ? <div class="aibar-actions"><button class="primary" onClick={signOutCloud}>重新登录</button></div>
        : needKey
        ? <form class="aibar-form" onSubmit={(e) => { e.preventDefault(); if (key.trim()) { updateSettings({ aiKey: key.trim() }); setKey(''); } }}>
            <input type="password" autoComplete="off" placeholder="访问密码" value={key} onInput={(e) => setKey(e.target.value)} aria-label="访问密码（APP_ACCESS_KEY）" />
            <button class="primary" disabled={!key.trim()}>保存并重试</button>
          </form>
        : <div class="aibar-actions">
            <button onClick={retryAiNow} disabled={ai.checking}>{ai.checking ? '检查中…' : '立即重试'}</button>
            <button class="quiet" onClick={() => updateSettings({ aiEnabled: false })}>关闭 AI</button>
          </div>}
    </div>
  );
}
