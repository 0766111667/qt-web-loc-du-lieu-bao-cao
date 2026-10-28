import { useEffect, useState } from 'preact/hooks';
import * as db from '../app/db.js';

export function useBlobUrl(id, kind = 'blob') {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let dead = false, u = null;
    db.get('blobs', id).then((rec) => {
      if (dead || !rec) return;
      const b = kind === 'thumb' ? rec.thumb || rec.blob : rec.blob;
      if (b) { u = URL.createObjectURL(b); setUrl(u); }
    });
    return () => { dead = true; if (u) URL.revokeObjectURL(u); };
  }, [id, kind]);
  return url;
}

export const Chip = ({ kind = 'neutral', children }) => <span class={`chip chip-${kind}`}>{children}</span>;

// 两步确认按钮（代替 window.confirm）：第一次点击改变文字，第二次点击才执行。
export function ConfirmButton({ label, confirmLabel, onConfirm, class: cls = '' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 5000); return () => clearTimeout(t); }, [armed]);
  return <button class={`${cls} ${armed ? 'armed' : ''}`} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? confirmLabel : label}</button>;
}

export function download(name, blobOrText, type = 'text/plain') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const fmtDate = (iso) => iso.replaceAll('-', '/');
export const fmtMonth = (ym) => { const [y, m] = ym.split('-'); return `${y}年${Number(m)}月`; };
