// Máy khách Supabase tối giản, KHÔNG phụ thuộc thư viện: đăng nhập bằng email (mã/OTP hoặc liên kết), giữ phiên nhiều tháng,
// tự làm mới token, gọi PostgREST. Viết thuần fetch để kiểm thử được bằng Node.
export class CloudError extends Error {
  constructor(code, message, status = 0) { super(message); this.name = 'CloudError'; this.code = code; this.status = status; }
}

const KEY = 'qt-session';
const SKEW = 90; // giây: làm mới token trước khi hết hạn

const memoryStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

function errMessage(j, status) {
  const m = String(j?.msg || j?.error_description || j?.message || j?.error || '');
  if (/signups? not allowed|not allowed for otp|user not found/i.test(m)) return '该邮箱没有被邀请。请联系管理员在 Supabase 中邀请你的邮箱。';
  if (/token has expired|invalid|otp_expired/i.test(m)) return '验证码无效或已过期，请重新获取。';
  if (/rate limit|too many|security purposes/i.test(m) || status === 429) return '发送太频繁，请稍等一分钟再试（Supabase 默认每小时限制发送邮件数量）。';
  return m || `请求失败（${status}）`;
}

export function createCloud({ url, anonKey, storage, fetchImpl, now = () => Date.now() } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const configured = !!(base && anonKey);
  const store = storage || memoryStorage();
  const doFetch = (...a) => (fetchImpl || globalThis.fetch)(...a);
  const listeners = new Set();
  let session = null;
  let refreshing = null;

  const read = () => { try { const s = JSON.parse(store.getItem(KEY) || 'null'); return s?.access_token && s?.refresh_token ? s : null; } catch { return null; } };
  const write = (s) => { try { s ? store.setItem(KEY, JSON.stringify(s)) : store.removeItem(KEY); } catch { /* chế độ riêng tư: chỉ giữ trong bộ nhớ */ } };
  session = read();

  const emit = () => listeners.forEach((f) => f(api.user()));
  const setSession = (s, quiet = false) => { const had = !!session; session = s; write(s); if (!quiet || had !== !!s) emit(); };
  const toSession = (j) => ({
    access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(now() / 1000) + (Number(j.expires_in) || 3600),
    user: j.user ? { id: j.user.id, email: j.user.email } : session?.user || null,
  });
  const headers = (token, extra = {}) => ({ apikey: anonKey, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra });

  async function call(path, { method = 'GET', body, token, extra } = {}) {
    let res;
    try { res = await doFetch(`${base}${path}`, { method, headers: headers(token, extra), body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw new CloudError('network', '网络不可用，无法连接云端', 0); }
    return res;
  }
  async function fail(res) {
    let j = null; try { j = await res.json(); } catch { /* không phải JSON */ }
    return new CloudError(res.status === 401 || res.status === 403 ? 'unauthorized' : res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'server' : 'request', errMessage(j, res.status), res.status);
  }

  async function refresh() {
    if (refreshing) return refreshing;
    const rt = session?.refresh_token;
    if (!rt) return null;
    refreshing = (async () => {
      let res;
      try { res = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: rt } }); }
      catch { return null; }                       // mất mạng: giữ phiên, thử lại sau
      if (res.ok) { setSession(toSession(await res.json()), true); return session; }
      if (res.status === 400 || res.status === 401 || res.status === 403) { setSession(null); return null; } // refresh token không còn hiệu lực: phải đăng nhập lại
      return null;                                 // lỗi máy chủ tạm thời: giữ phiên
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  const api = {
    configured,
    user: () => (session ? { id: session.user?.id, email: session.user?.email } : null),
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },

    // Token hợp lệ (tự làm mới nếu sắp hết hạn). null = chưa đăng nhập hoặc phiên đã mất.
    async getToken({ force = false } = {}) {
      if (!session) return null;
      if (force || session.expires_at - now() / 1000 < SKEW) {
        const s = await refresh();
        if (!s) return session && session.expires_at - now() / 1000 > 5 && !force ? session.access_token : null;
        return s.access_token;
      }
      return session.access_token;
    },

    async sendCode(email, redirectTo) {
      const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
      const res = await call(`/auth/v1/otp${q}`, { method: 'POST', body: { email: String(email).trim(), create_user: false } });
      if (!res.ok) throw await fail(res);
      return true;
    },
    async verifyCode(email, token) {
      const res = await call('/auth/v1/verify', { method: 'POST', body: { type: 'email', email: String(email).trim(), token: String(token).replace(/\s+/g, '') } });
      if (!res.ok) throw await fail(res);
      setSession(toSession(await res.json()));
      return api.user();
    },
    // Khi người dùng bấm liên kết trong email, Supabase đưa token vào phần #hash của URL.
    consumeUrlHash(hash, clean) {
      const h = String(hash || '').replace(/^#/, '');
      if (!h.includes('access_token=') && !h.includes('error_description=')) return null;
      const p = new URLSearchParams(h);
      clean?.();
      if (p.get('error_description')) throw new CloudError('link', errMessage({ error_description: p.get('error_description') }, 400), 400);
      if (!p.get('access_token') || !p.get('refresh_token')) return null;
      setSession(toSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in'), expires_at: Number(p.get('expires_at')) || undefined, user: undefined }));
      return api.user();
    },
    async loadUser() { // điền email/id nếu phiên mới chỉ có token (đăng nhập bằng liên kết)
      const token = await api.getToken(); if (!token) return null;
      const res = await call('/auth/v1/user', { token });
      if (res.ok) { const u = await res.json(); setSession({ ...session, user: { id: u.id, email: u.email } }); }
      return api.user();
    },
    async signOut() {
      const token = session?.access_token;
      setSession(null);
      if (token) { try { await call('/auth/v1/logout', { method: 'POST', token }); } catch { /* bỏ qua */ } }
    },

    // PostgREST. Tự làm mới token và thử lại một lần khi 401.
    async rest(path, { method = 'GET', body, prefer } = {}) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = await api.getToken({ force: attempt > 0 });
        if (!token) throw new CloudError('unauthorized', '登录已失效，请重新登录', 401);
        const res = await call(`/rest/v1/${path}`, { method, body, token, extra: prefer ? { prefer } : undefined });
        if (res.status === 401 && attempt === 0) continue;
        if (!res.ok) throw await fail(res);
        if (res.status === 204) return null;
        const text = await res.text(); return text ? JSON.parse(text) : null;
      }
      throw new CloudError('unauthorized', '登录已失效，请重新登录', 401);
    },
    rpc: (name, args) => api.rest(`rpc/${name}`, { method: 'POST', body: args }),
  };
  return api;
}

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
let ls = null;
try { ls = typeof localStorage !== 'undefined' ? localStorage : null; } catch { ls = null; }
export const cloud = createCloud({ url: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY, storage: ls });
