import { useEffect, useState } from 'preact/hooks';
import { useStore, sendLoginCode, verifyLoginCode } from '../app/store.js';
import { T } from '../app/text.js';

const lastEmail = () => { try { return localStorage.getItem('qt-last-email') || ''; } catch { return ''; } };

// 一次性登录：输入被邀请的邮箱 → 点邮件中的链接，或输入邮件中的验证码。之后这台设备会保持登录数月，不再输入任何密码。
export function LoginScreen() {
  const s = useStore();
  const [email, setEmail] = useState(lastEmail());
  const [step, setStep] = useState('email');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(s.auth.error || '');
  const [cool, setCool] = useState(0);
  useEffect(() => { if (cool <= 0) return undefined; const t = setTimeout(() => setCool(cool - 1), 1000); return () => clearTimeout(t); }, [cool]);

  const send = async (e) => {
    e?.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true); setErr('');
    try { await sendLoginCode(email); try { localStorage.setItem('qt-last-email', email.trim()); } catch { /* 忽略 */ } setStep('code'); setCool(60); }
    catch (x) { setErr(x.message || String(x)); }
    finally { setBusy(false); }
  };
  const verify = async (e) => {
    e.preventDefault();
    if (busy || code.replace(/\s/g, '').length < 6) return;
    setBusy(true); setErr('');
    try { await verifyLoginCode(email, code); }
    catch (x) { setErr(x.message || String(x)); setBusy(false); }
  };

  return (
    <main class="login">
      <h1>{T.appName}</h1>
      <p class="hint">首次在这台设备上使用，需要登录一次。之后会自动保持登录，不用再输入密码。</p>
      {step === 'email' ? (
        <form onSubmit={send} class="stack">
          <label class="field">被邀请的邮箱<input type="email" inputMode="email" autoComplete="email" autoFocus required value={email} onInput={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></label>
          <button class="primary" disabled={busy || !email.trim()}>{busy ? '发送中…' : '发送登录邮件'}</button>
        </form>
      ) : (
        <form onSubmit={verify} class="stack">
          <p>已发送邮件到 <b>{email}</b>。<br />请点击邮件里的链接，<b>或</b>在下面输入邮件中的验证码：</p>
          <label class="field">验证码<input inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onInput={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ''))} placeholder="123456" /></label>
          <button class="primary" disabled={busy || code.replace(/\s/g, '').length < 6}>{busy ? '验证中…' : '登录'}</button>
          <div class="row-gap">
            <button type="button" class="quiet" disabled={cool > 0 || busy} onClick={send}>{cool > 0 ? `${cool} 秒后可重新发送` : '重新发送'}</button>
            <button type="button" class="quiet" onClick={() => { setStep('email'); setCode(''); setErr(''); }}>更换邮箱</button>
          </div>
        </form>
      )}
      {err && <p class="warn-box" role="alert">{err}</p>}
      <p class="hint">只有被管理员邀请的邮箱才能登录。没有收到邮件？请查看垃圾邮件箱，或联系管理员。</p>
    </main>
  );
}
