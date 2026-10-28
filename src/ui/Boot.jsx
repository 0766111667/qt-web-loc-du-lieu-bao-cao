import { useEffect, useState } from 'preact/hooks';
import { deleteDatabase } from '../app/db.js';

// 清除本地数据并重新加载页面（需要先关闭其他打开了本应用的标签页）
export async function resetLocalData() {
  const ok = await deleteDatabase();
  if (!ok) { alert('无法清除：请先关闭其他打开了本应用的标签页，然后再试一次。'); return; }
  location.reload();
}

export function Boot() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 5000); return () => clearTimeout(t); }, []);
  return (
    <div class="boot">
      <p>正在打开数据…</p>
      {slow && (
        <>
          <p class="hint">打开数据用的时间比平时长。请先尝试刷新页面（Ctrl/⌘+Shift+R）；如果仍然卡住，可以清除本地数据后重新开始。</p>
          <p class="hint">注意：清除会删除本浏览器中保存的全部报告，请先确认已有备份。</p>
          <button class="danger" onClick={resetLocalData}>清除本地数据并重试</button>
        </>
      )}
    </div>
  );
}
