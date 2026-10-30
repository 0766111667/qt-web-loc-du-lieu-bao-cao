// Máy khách gọi /api/vision: phân loại lỗi, kiểm tra kết nối. Thuần logic, không đụng DOM (để kiểm thử).
// Nguyên tắc: KHÔNG thử lại khi hết hạn mức (mỗi lần thử lại đều tốn thêm hạn mức và làm nghẽn hàng đợi);
// việc chờ/thử lại do bộ điều phối trong store (cổng + đếm ngược) quyết định, không phải ở đây.

export class AiError extends Error {
  constructor(code, message, { status = 0, retryable = false, retryAfter = 0, missing, detail, usage } = {}) {
    super(message);
    this.name = 'AiError'; this.code = code; this.status = status; this.retryable = retryable; this.retryAfter = retryAfter; this.missing = missing; this.detail = detail; this.usage = usage;
  }
}

const CODES_TEXT = {
  not_configured: '服务器尚未配置', no_key: '尚未登录', unauthorized: '登录已失效，请重新登录', forbidden: '此账号没有使用权限', daily_limit: '今日 AI 次数已用完',
  auth_unavailable: '暂时无法验证登录状态', bad_model: '模型不可用', gemini_key: 'Gemini 密钥无效', quota_minute: 'Gemini 每分钟请求过多', quota_day: 'Gemini 今日额度已用完',
  rate_limited: '请求过于频繁', timeout: 'AI 响应超时', network: '网络不可用', unreachable: '找不到 AI 服务地址',
  upstream: 'AI 服务暂时出错', parse: '无法解析 AI 的回复', blocked: 'AI 拒绝处理该内容', bad_request: '数据无效',
};
// 这些错误短时间内重试没有意义：由调用方“关闸”，等条件变化。
export const GATE_CODES = new Set(['quota_minute', 'quota_day', 'daily_limit', 'rate_limited', 'unauthorized', 'forbidden', 'gemini_key', 'not_configured', 'bad_model', 'no_key', 'auth_unavailable', 'unreachable']);
export const textOf = (code) => CODES_TEXT[code] || 'AI 服务出错';

export async function readError(res) {
  let j = null;
  try { j = await res.json(); } catch { /* 非 JSON（例如 Vercel 的崩溃页面） */ }
  const header = Number(res.headers?.get?.('retry-after')) || 0;
  let code = typeof j?.code === 'string' ? j.code : '';
  if (code === 'quota') code = 'quota_minute';
  if (!code) code = res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'unreachable' : res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'upstream' : 'bad_request';
  const retryable = typeof j?.retryable === 'boolean' ? j.retryable : ['rate_limited', 'upstream', 'timeout', 'parse', 'quota_minute'].includes(code);
  return new AiError(code, j?.error || `${textOf(code)}（${res.status}）`, { status: res.status, retryable, retryAfter: Number(j?.retryAfter) || header, missing: j?.missing, detail: j?.detail, usage: j?.usage });
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, init, ms, fetchImpl) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetchImpl(url, { ...init, signal: ctl.signal }); }
  catch { throw new AiError(ctl.signal.aborted ? 'timeout' : 'network', ctl.signal.aborted ? 'AI 响应超时' : '网络不可用，无法连接 AI 服务', { retryable: true }); }
  finally { clearTimeout(t); }
}

// Gọi AI: tối đa 2 lần, và chỉ thử lại lỗi tạm thời của máy chủ/mạng (5xx, parse, mất mạng) một lần.
// Hết hạn mức / rate limit / lỗi cấu hình → ném ngay. Token hết hạn (unauthorized) → lấy token mới một lần.
export async function callVision({ endpoint, getHeaders, body, attempts = 2, delay = 1500, timeoutMs = 32_000, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  let last, refreshed = false, force = false;
  for (let i = 0; i < attempts + 1; i++) {
    try {
      const auth = await getHeaders(force); force = false;
      if (!auth) throw new AiError('no_key', '尚未登录');
      const res = await fetchWithTimeout(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify(body) }, timeoutMs, fetchImpl);
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (!j || !Array.isArray(j.items)) throw new AiError('parse', '无法解析 AI 的回复', { retryable: true });
        return j;
      }
      throw await readError(res);
    } catch (e) {
      last = e instanceof AiError ? e : new AiError('upstream', String(e?.message || e), { retryable: true });
      if (last.code === 'unauthorized' && !refreshed) { refreshed = true; force = true; continue; }   // 刷新令牌不算一次“尝试”
      if (GATE_CODES.has(last.code) || !last.retryable || i >= attempts - 1 || last.code === 'timeout') throw last;
      await sleep(Math.min(8000, Math.max(delay, (last.retryAfter || 0) * 1000)));
    }
  }
  throw last;
}

// Kiểm tra bằng GET (rẻ, không gọi Gemini; probe=true thì gọi một yêu cầu rất nhỏ để biết hạn mức thật).
export async function checkAi({ endpoint, getHeaders, probe = false, fetchImpl = globalThis.fetch, timeoutMs = 15_000 }) {
  const auth = (await getHeaders(false)) || {};
  let res;
  try { res = await fetchWithTimeout(probe ? `${endpoint}?probe=1` : endpoint, { method: 'GET', headers: auth }, timeoutMs, fetchImpl); }
  catch (e) { return { ready: false, code: e.code || 'network', message: e.message, retryable: true }; }
  if (!res.ok) { const e = await readError(res); return { ready: false, code: e.code, message: e.message, retryable: e.retryable, retryAfter: e.retryAfter }; }
  const j = await res.json().catch(() => null);
  if (!j) return { ready: false, code: 'unreachable', message: '找不到 AI 服务地址（返回的不是 JSON）', retryable: false };
  if (!j.ok) return { ready: false, code: 'not_configured', missing: j.missing || [], message: `服务器尚未配置：缺少 ${(j.missing || []).join('、')}（在 Vercel 设置后需要 Redeploy）`, retryable: false };
  if (!Object.keys(auth).length) return { ready: false, code: 'no_key', message: '尚未登录', retryable: false };
  if (!j.authorized) return { ready: false, code: 'unauthorized', message: '登录已失效或此账号没有权限，请重新登录', retryable: false };
  const u = j.usage;
  if (u && u.n != null && u.max != null && u.n >= u.max) return { ready: false, code: 'daily_limit', message: `今日 AI 调用次数已达上限（${u.n}/${u.max}），明天自动恢复`, retryable: false, model: j.model, usage: u };
  const out = { ready: true, model: j.model, fallbackModel: j.fallbackModel, usage: u || null, user: j.user || null };
  if (j.probe) {
    out.probe = j.probe;
    if (j.probe.ok === false) { out.ready = false; out.code = j.probe.code; out.retryAfter = j.probe.retryAfter || 0; out.message = `${textOf(j.probe.code)}${j.probe.detail ? `：${j.probe.detail}` : ''}`; out.retryable = j.probe.code === 'quota_minute'; }
  }
  return out;
}
