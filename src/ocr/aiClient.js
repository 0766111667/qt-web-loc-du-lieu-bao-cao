// Máy khách gọi /api/vision: phân loại lỗi, tự thử lại khi lỗi tạm thời, kiểm tra kết nối. Thuần logic, không đụng DOM (để kiểm thử).

export class AiError extends Error {
  constructor(code, message, { status = 0, retryable = false, retryAfter = 0, missing } = {}) {
    super(message);
    this.name = 'AiError'; this.code = code; this.status = status; this.retryable = retryable; this.retryAfter = retryAfter; this.missing = missing;
  }
}

// Lỗi nào đáng tự thử lại ngay trong lượt gọi (tạm thời), lỗi nào phải chờ người dùng/cấu hình.
const CODES_TEXT = {
  not_configured: '服务器尚未配置', bad_key: '访问密码错误', no_key: '尚未登录', unauthorized: '登录已失效，请重新登录', daily_limit: '今日 AI 次数已用完', auth_unavailable: '暂时无法验证登录状态', bad_model: '模型不可用', gemini_key: 'Gemini 密钥无效',
  quota: 'Gemini 额度不足或请求过快', rate_limited: '请求过于频繁', timeout: 'AI 响应超时', network: '网络不可用', unreachable: '找不到 AI 服务地址',
  upstream: 'AI 服务暂时出错', parse: '无法解析 AI 的回复', blocked: 'AI 拒绝处理该内容', bad_request: '数据无效',
};

export async function readError(res) {
  let j = null;
  try { j = await res.json(); } catch { /* 非 JSON（例如 Vercel 的崩溃页面） */ }
  const header = Number(res.headers?.get?.('retry-after')) || 0;
  let code = j?.code;
  if (!code) code = res.status === 401 ? 'bad_key' : res.status === 404 ? 'unreachable' : res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'upstream' : 'bad_request';
  const retryable = typeof j?.retryable === 'boolean' ? j.retryable : ['rate_limited', 'upstream', 'timeout', 'parse', 'quota'].includes(code);
  return new AiError(code, j?.error || `${CODES_TEXT[code] || 'AI 服务出错'}（${res.status}）`, { status: res.status, retryable, retryAfter: Number(j?.retryAfter) || header, missing: j?.missing });
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, init, ms, fetchImpl) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetchImpl(url, { ...init, signal: ctl.signal }); }
  catch (e) { throw new AiError(ctl.signal.aborted ? 'timeout' : 'network', ctl.signal.aborted ? 'AI 响应超时' : '网络不可用，无法连接 AI 服务', { retryable: true }); }
  finally { clearTimeout(t); }
}

// Gọi AI, tự thử lại tối đa `attempts` lần với độ trễ tăng dần (tôn trọng Retry-After, tối đa 10 giây).
// getHeaders(force): trả về header xác thực ({authorization: 'Bearer …'} hoặc {'x-access-key': …}) hoặc null nếu chưa đăng nhập.
// Khi máy chủ báo 'unauthorized' (token vừa hết hạn), lấy lại header với force=true và thử một lần nữa.
export async function callVision({ endpoint, getHeaders, body, attempts = 3, delays = [1500, 4000], timeoutMs = 55_000, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  let last, refreshed = false, force = false;
  for (let i = 0; i < attempts; i++) {
    try {
      const auth = await getHeaders(force); force = false;
      if (!auth) throw new AiError('no_key', '尚未登录', { retryable: false });
      const res = await fetchWithTimeout(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify(body) }, timeoutMs, fetchImpl);
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (!j || !Array.isArray(j.rows)) throw new AiError('parse', '无法解析 AI 的回复', { retryable: true });
        return j;
      }
      throw await readError(res);
    } catch (e) {
      last = e instanceof AiError ? e : new AiError('upstream', String(e?.message || e), { retryable: true });
      if (last.code === 'unauthorized' && !refreshed && i < attempts - 1) { refreshed = true; force = true; continue; }
      const canRetry = last.retryable && i < attempts - 1 && !(last.code === 'timeout' && i >= 1);
      if (!canRetry) throw last;
      await sleep(Math.min(10_000, Math.max(delays[Math.min(i, delays.length - 1)], (last.retryAfter || 0) * 1000)));
    }
  }
  throw last;
}

// Kiểm tra cấu hình/mật khẩu bằng GET (rẻ, không gọi Gemini). Trả về { ready, code, message, missing }.
export async function checkAi({ endpoint, getHeaders, fetchImpl = globalThis.fetch, timeoutMs = 12_000 }) {
  let res;
  const auth = (await getHeaders(false)) || {};
  try { res = await fetchWithTimeout(endpoint, { method: 'GET', headers: auth }, timeoutMs, fetchImpl); }
  catch (e) { return { ready: false, code: e.code || 'network', message: e.message, retryable: true }; }
  // Bản máy chủ cũ chưa có GET (405): không kiểm tra được, cứ thử gọi thật.
  if (res.status === 405) return { ready: true, legacy: true };
  if (!res.ok) { const e = await readError(res); return { ready: false, code: e.code, message: e.message, retryable: e.retryable }; }
  const j = await res.json().catch(() => null);
  if (!j) return { ready: false, code: 'unreachable', message: '找不到 AI 服务地址（返回的不是 JSON）', retryable: false };
  if (!j.ok) return { ready: false, code: 'not_configured', missing: j.missing || [], message: `服务器尚未配置：缺少 ${(j.missing || []).join('、')}（在 Vercel 设置后需要 Redeploy）`, retryable: false };
  if (!Object.keys(auth).length) return { ready: false, code: 'no_key', message: '尚未登录', retryable: false, model: j.model };
  if (!j.authorized) return { ready: false, code: j.auth === 'supabase' ? 'unauthorized' : 'bad_key', message: j.auth === 'supabase' ? '登录已失效，请重新登录' : '访问密码错误', retryable: false, model: j.model };
  const u = j.usage;
  if (u && u.n != null && u.max != null && u.n >= u.max) return { ready: false, code: 'daily_limit', message: `今日 AI 调用次数已达上限（${u.n}/${u.max}），明天自动恢复`, retryable: false, model: j.model, usage: u };
  return { ready: true, model: j.model, fallbackModel: j.fallbackModel, usage: u || null, user: j.user || null };
}
