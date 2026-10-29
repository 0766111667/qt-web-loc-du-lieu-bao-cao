// Vercel Serverless Function：用 Google Gemini 重新识别表格中不确定的行。
// 环境变量（Vercel > Settings > Environment Variables，修改后必须 Redeploy）：
//   GEMINI_API_KEY        （必填）在 https://aistudio.google.com/apikey 创建；只保存在服务端
//   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY （必填）Supabase 项目地址与 anon 公钥；同一组变量前端也用，
//                         服务端用它验证用户的登录令牌（Authorization: Bearer），所以不再需要任何访问密码。
//   AI_DAILY_LIMIT        （可选）每天最多调用 AI 的次数（全团队合计），默认 200，防止意外产生费用
//   APP_ACCESS_KEY        （可选，旧方式）未配置 Supabase 时，才用共用密码 x-access-key
//   GEMINI_MODEL          （可选）主模型，默认 gemini-4-argon
//   GEMINI_FALLBACK_MODEL （可选）备用模型，主模型不存在/过载时自动改用，默认 gemini-3.8-flash；设为 none 则不用
//   GEMINI_THINKING_LEVEL （可选）low | medium | high，默认 low；设为 none 则不发送该参数
//
// GET  /api/vision  → 健康检查：只返回“是否已配置”的布尔值（绝不返回密钥）；带正确 x-access-key 时 authorized=true。
// POST /api/vision  → 识别。所有错误都是 { error, code, retryable }，前端据此决定自动重试还是提示用户。
import { timingSafeEqual, createHash } from 'node:crypto';

const MAX_ROWS = 20;
const MAX_IMAGE_CHARS = 700_000; // base64 后约 500 KB
const DEADLINE_MS = 50_000;      // 小于 vercel.json 中的 maxDuration（60 秒）
const hits = new Map();          // 简单的按 IP 限速（尽力而为，每个实例独立）

const cfg = () => ({
  key: process.env.GEMINI_API_KEY || '',
  access: process.env.APP_ACCESS_KEY || '',
  sbUrl: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, ''),
  sbAnon: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
  dailyLimit: Math.max(1, Number(process.env.AI_DAILY_LIMIT) || 200),
  model: (process.env.GEMINI_MODEL || 'gemini-4-argon').trim(),
  fallback: (process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-3.8-flash').trim(),
  thinking: (process.env.GEMINI_THINKING_LEVEL || 'low').trim(),
  retryDelay: Number(process.env.AI_RETRY_DELAY_MS ?? 400),
});
const MODEL_RE = /^[a-z0-9.\-]+$/i;

const SYSTEM = `You read cropped rows of a Chinese issue-statistics table (Simplified Chinese text plus numbers).
Each image is ONE table row with columns: serial number, issue type name, occurrence count (发生次数), processed count (已处理).
Return only JSON. For every image return its id, the issue type name exactly as printed, and the two counts as integers.
If you are not sure about a value use null. Never guess.`;

const SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          occ: { type: ['integer', 'null'] },
          processed: { type: ['integer', 'null'] },
        },
        required: ['id', 'name', 'occ', 'processed'],
      },
    },
  },
  required: ['rows'],
};

class ApiError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
const RETRYABLE = new Set(['rate_limited', 'upstream', 'timeout', 'parse', 'quota', 'auth_unavailable']);

function fail(res, e) {
  if (e.extra?.retryAfter) res.setHeader?.('Retry-After', String(e.extra.retryAfter));
  const { retryAfter, ...extra } = e.extra || {};
  return res.status(e.status).json({ error: e.message, code: e.code, retryable: RETRYABLE.has(e.code), ...(retryAfter ? { retryAfter } : {}), ...extra });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
  return arr.length > 30;
}

// ---------- xác thực ----------
// Ưu tiên Supabase (Bearer token của người dùng đã đăng nhập). Chỉ khi chưa cấu hình Supabase mới dùng mật khẩu chung cũ.
const authMode = (c) => (c.sbUrl && c.sbAnon ? 'supabase' : c.access ? 'key' : 'none');
const verified = new Map(); // băm token → hạn dùng của kết quả xác minh (giảm số lần gọi Supabase)
const bearer = (req) => /^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization || ''))?.[1]?.trim() || '';
const localDay = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); // UTC+7, khớp public.today_local()

async function verifyToken(c, token) {
  if (!token) return null;
  const h = createHash('sha256').update(token).digest('hex');
  const hit = verified.get(h);
  if (hit && hit.exp > Date.now()) return hit.user;
  let r;
  try { r = await fetch(`${c.sbUrl}/auth/v1/user`, { headers: { apikey: c.sbAnon, authorization: `Bearer ${token}` } }); }
  catch { throw new ApiError(503, 'auth_unavailable', '暂时无法验证登录状态，请稍后再试'); }
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new ApiError(503, 'auth_unavailable', '暂时无法验证登录状态，请稍后再试');
  const u = await r.json().catch(() => null);
  const user = u?.id ? { id: u.id, email: u.email } : null;
  if (user) { verified.set(h, { exp: Date.now() + 60_000, user }); if (verified.size > 200) for (const [k, v] of verified) if (v.exp < Date.now()) verified.delete(k); }
  return user;
}

async function authorize(c, req) {
  const mode = authMode(c);
  if (mode === 'supabase') {
    const token = bearer(req);
    if (!token) return { ok: false, mode };
    const user = await verifyToken(c, token);
    return user ? { ok: true, mode, user, token } : { ok: false, mode };
  }
  return { ok: mode === 'key' && safeEqual(req.headers?.['x-access-key'], c.access), mode };
}

// Hạn mức mỗi ngày (cả nhóm). Nếu chưa chạy schema.sql hoặc Supabase lỗi thì KHÔNG chặn AI (chỉ mất giới hạn), tránh hỏng tính năng vì lỗi phụ.
async function bumpUsage(c, auth) {
  if (auth.mode !== 'supabase') return { n: null, max: null };
  try {
    const r = await fetch(`${c.sbUrl}/rest/v1/rpc/ai_usage_bump`, { method: 'POST', headers: { apikey: c.sbAnon, authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ max_per_day: c.dailyLimit }) });
    if (!r.ok) return { n: null, max: c.dailyLimit };
    const j = await r.json();
    return { allowed: j.allowed !== false, n: j.n, max: j.max ?? c.dailyLimit };
  } catch { return { n: null, max: c.dailyLimit }; }
}
async function readUsage(c, auth) {
  if (auth.mode !== 'supabase') return null;
  try {
    const r = await fetch(`${c.sbUrl}/rest/v1/ai_usage?select=n&day=eq.${localDay()}`, { headers: { apikey: c.sbAnon, authorization: `Bearer ${auth.token}` } });
    if (!r.ok) return { n: null, max: c.dailyLimit };
    const rows = await r.json();
    return { n: rows?.[0]?.n ?? 0, max: c.dailyLimit };
  } catch { return { n: null, max: c.dailyLimit }; }
}

function buildBody(parts, { schema, thinking }) {
  const generationConfig = { responseMimeType: 'application/json', maxOutputTokens: 4096 };
  if (schema) generationConfig.responseJsonSchema = SCHEMA;
  if (thinking && thinking !== 'none') generationConfig.thinkingConfig = { thinkingLevel: thinking };
  return {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts }],
    generationConfig,
  };
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(new ApiError(502, 'timeout', 'AI 响应超时'));
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); reject(new ApiError(502, 'timeout', 'AI 响应超时')); }, { once: true });
});

// 对一个模型：先用完整参数；若返回 400（例如该模型不支持某个参数），依次去掉 JSON Schema、再去掉 thinkingConfig 重试。
async function callModel(model, parts, c, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const variants = [{ schema: true, thinking: c.thinking }, { schema: false, thinking: c.thinking }, { schema: false, thinking: 'none' }];
  let last;
  for (const v of variants) {
    last = await fetch(url, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': c.key },
      body: JSON.stringify(buildBody(parts, v)),
    });
    if (last.status !== 400) return last;
  }
  return last;
}

// 主模型 → 备用模型；每个模型对 429/5xx/网络错误最多尝试 2 次。
// 404（模型不存在）直接换模型；401/403（Gemini 密钥无效）立即报错，因为重试没有意义。
async function callGemini(parts, c, signal) {
  const models = [c.model, c.fallback].filter((m, i, a) => m && m !== 'none' && MODEL_RE.test(m) && a.indexOf(m) === i);
  let lastErr = new ApiError(502, 'upstream', 'AI 服务暂时不可用');
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try { r = await callModel(model, parts, c, signal); }
      catch (e) {
        if (e instanceof ApiError) throw e;
        if (signal.aborted) throw new ApiError(502, 'timeout', 'AI 响应超时');
        lastErr = new ApiError(502, 'upstream', '无法连接 AI 服务');
        if (attempt === 0) await sleep(c.retryDelay, signal);
        continue;
      }
      if (r.ok) return { r, model };
      if (r.status === 401 || r.status === 403) throw new ApiError(502, 'gemini_key', 'Gemini 密钥无效或无权限（请检查 GEMINI_API_KEY）');
      if (r.status === 404) { lastErr = new ApiError(502, 'bad_model', `模型“${model}”不可用（请检查 GEMINI_MODEL）`); break; }
      if (r.status === 400) { lastErr = new ApiError(502, 'upstream', `AI 服务拒绝了请求（400，模型 ${model}）`); break; }
      if (r.status === 429) {
        lastErr = new ApiError(429, 'quota', 'Gemini 额度已用完或请求过快，请稍后再试', { retryAfter: 20 });
      } else lastErr = new ApiError(502, 'upstream', `AI 服务出错（${r.status}）`);
      if (attempt === 0) await sleep(c.retryDelay, signal);
    }
  }
  throw lastErr;
}

export default async function handler(req, res) {
  const c = cfg();
  const mode = authMode(c);
  const missing = [!c.key && 'GEMINI_API_KEY', mode === 'none' && 'VITE_SUPABASE_URL', mode === 'none' && 'VITE_SUPABASE_ANON_KEY'].filter(Boolean);
  res.setHeader?.('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    let auth = { ok: false, mode };
    try { auth = await authorize(c, req); } catch { /* chỉ là kiểm tra sức khỏe */ }
    return res.status(200).json({
      ok: !missing.length, missing, auth: mode, model: c.model, fallbackModel: c.fallback === 'none' ? null : c.fallback,
      authorized: auth.ok, user: auth.ok ? auth.user?.email || null : null, usage: auth.ok ? await readUsage(c, auth) : null,
    });
  }
  if (req.method !== 'POST') return fail(res, new ApiError(405, 'bad_method', '不支持的请求方法'));
  if (missing.length) return fail(res, new ApiError(500, 'not_configured', `服务器尚未配置：缺少 ${missing.join('、')}（在 Vercel 设置后需要 Redeploy）`, { missing }));
  if (!MODEL_RE.test(c.model)) return fail(res, new ApiError(500, 'bad_model', '模型名称无效（请检查 GEMINI_MODEL）'));
  let auth;
  try { auth = await authorize(c, req); } catch (e) { return fail(res, e); }
  if (!auth.ok) return fail(res, mode === 'supabase' ? new ApiError(401, 'unauthorized', '登录已失效，请重新登录') : new ApiError(401, 'bad_key', '访问密码错误'));
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return fail(res, new ApiError(429, 'rate_limited', '请求过于频繁，请稍后再试', { retryAfter: 15 }));

  const rows = req.body?.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) return fail(res, new ApiError(400, 'bad_request', '数据无效'));
  const parts = [];
  for (const r of rows) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(r?.image || ''));
    if (!m || m[1].length > MAX_IMAGE_CHARS || !/^[0-9]{1,3}$/.test(String(r.id))) return fail(res, new ApiError(400, 'bad_request', '图片或编号无效'));
    parts.push({ text: `id=${r.id}` }, { inlineData: { mimeType: 'image/png', data: m[1] } });
  }
  parts.push({ text: 'Return the JSON now.' });

  const usage = await bumpUsage(c, auth);
  if (usage.allowed === false) return fail(res, new ApiError(429, 'daily_limit', `今日 AI 调用次数已达上限（${usage.n}/${usage.max}），明天自动恢复；可在 Vercel 调高 AI_DAILY_LIMIT`, { usage }));

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DEADLINE_MS);
  try {
    const { r, model } = await callGemini(parts, c, ctl.signal);
    const data = await r.json();
    if (data.promptFeedback?.blockReason) throw new ApiError(502, 'blocked', 'AI 拒绝处理该内容');
    const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    let json;
    try { json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); }
    catch { throw new ApiError(502, 'parse', '无法解析 AI 的回复'); }
    const clean = (Array.isArray(json.rows) ? json.rows : []).map((x) => ({
      id: String(x.id ?? ''), name: typeof x.name === 'string' ? x.name.slice(0, 80) : '',
      occ: Number.isInteger(x.occ) && x.occ >= 0 ? x.occ : null,
      processed: Number.isInteger(x.processed) && x.processed >= 0 ? x.processed : null,
    }));
    return res.status(200).json({ rows: clean, model, usage: usage.n == null ? null : { n: usage.n, max: usage.max } });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e);
    return fail(res, new ApiError(502, ctl.signal.aborted ? 'timeout' : 'upstream', ctl.signal.aborted ? 'AI 响应超时' : '无法解析 AI 的回复'));
  } finally { clearTimeout(timer); }
}
