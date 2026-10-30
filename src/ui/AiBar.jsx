import { useEffect, useState } from 'preact/hooks';
import { useStore, updateSettings, retryAiNow, signOutCloud } from '../app/store.js';

const fmt = (sec) => (sec >= 90 ? `${Math.ceil(sec / 60)} 分钟` : `${sec} 秒`);
const TITLES = {
  quota_minute: 'AI 正在冷却（每分钟请求上限）', quota_day: 'Gemini 今日额度已用完', daily_limit: '今日 AI 次数已用完',
  unauthorized: '需要重新登录', forbidden: '此账号没有 AI 权限', not_configured: 'AI 服务端尚未配置', gemini_key: 'Gemini 密钥无效', bad_model: 'AI 模型不可用',
};

// 全局 AI 状态条：只在有事要说时出现；冷却时显示倒计时并自动继续，不需要用户操作。
export function AiBar() {
  const s = useStore();
  const ai = s.ai;
  const [, tick] = useState(0);
  useEffect(() => { if (!ai.gateUntil) return undefined; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [ai.gateUntil]);
  if (!s.settings.aiEnabled) return null;
  const pending = s.jobs.filter((j) => j.aiPending && j.status === 'review').length;

  if (ai.busy.length) return <div class="aibar info" role="status"><span class="spin" aria-hidden="true" />AI 正在核对 {ai.busy.length} 张图片的不确定数字…</div>;
  if (ai.status !== 'error' || !pending) return null;

  const left = Math.max(0, Math.ceil(((ai.gateUntil || 0) - Date.now()) / 1000));
  const needLogin = ai.code === 'unauthorized' || ai.code === 'no_key';
  const day = ai.code === 'quota_day' || ai.code === 'daily_limit';
  return (
    <div class="aibar warn" role="alert">
      <div class="aibar-text">
        <b>{TITLES[ai.code] || 'AI 暂时不可用'}</b>
        <span>{ai.message}</span>
        <small>
          {pending} 张图片在等待 AI；其余图片不受影响。
          {ai.blocking ? '修复后会自动继续。' : day ? '额度恢复后会自动继续（每隔一段时间自动检测）。' : left > 0 ? `${fmt(left)}后自动继续。` : '正在重试…'}
        </small>
      </div>
      {needLogin
        ? <div class="aibar-actions"><button class="primary" onClick={signOutCloud}>重新登录</button></div>
        : <div class="aibar-actions">
            {!day && <button onClick={retryAiNow} disabled={ai.checking || left > 0}>{ai.checking ? '检查中…' : left > 0 ? `${left}s` : '立即重试'}</button>}
            <button class="quiet" onClick={() => updateSettings({ aiEnabled: false })}>关闭 AI</button>
          </div>}
    </div>
  );
}
