import { useState } from 'preact/hooks';
import { signIn } from '../app/store.js';
import { T } from '../app/text.js';

export function LoginScreen() {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fails, setFails] = useState(0);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !account.trim() || !password) return;
    setBusy(true); setErr('');
    try { await signIn(account, password); }
    catch (x) {
      setErr(x.message || '登录失败'); setPassword(''); setFails((n) => n + 1);
      if (fails >= 2) await new Promise((r) => setTimeout(r, Math.min(8000, 1000 * 2 ** (fails - 1)))); // 连续失败时拖慢重试
      setBusy(false);
    }
  };

  return (
    <main class="login">
      <h1>{T.appName}</h1>
      <form onSubmit={submit} class="stack" autoComplete="on">
        <label class="field">账号<input name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus value={account} onInput={(e) => setAccount(e.target.value)} /></label>
        <label class="field">密码
          <span class="pw"><input name="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onInput={(e) => setPassword(e.target.value)} />
            <button type="button" class="quiet" onClick={() => setShow(!show)} aria-label={show ? '隐藏密码' : '显示密码'}>{show ? '隐藏' : '显示'}</button></span>
        </label>
        {err && <p class="login-err" role="alert">{err}</p>}
        <button class="primary" disabled={busy || !account.trim() || !password}>{busy ? '登录中…' : '登录'}</button>
      </form>
    </main>
  );
}
