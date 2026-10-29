import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = 'test-key';
process.env.APP_ACCESS_KEY = 'secret';
process.env.AI_RETRY_DELAY_MS = '0';
delete process.env.VITE_SUPABASE_URL; delete process.env.VITE_SUPABASE_ANON_KEY;
const { default: handler } = await import('../api/vision.js');

const res = () => { const r = { code: 0, body: null, headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const req = (over = {}) => ({ method: 'POST', headers: { 'x-access-key': 'secret', 'x-forwarded-for': `2.2.2.${Math.floor(Math.random() * 250)}` }, body: { rows: [{ id: '3', image: PNG }] }, ...over });
const ok = (text) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });

test('API Gemini: 拒绝错误的方法、密码和数据', async () => {
  let r = res(); await handler(req({ method: 'PUT' }), r); assert.equal(r.code, 405);
  r = res(); await handler(req({ headers: { 'x-access-key': 'nope' } }), r); assert.equal(r.code, 401);
  r = res(); await handler(req({ body: { rows: [] } }), r); assert.equal(r.code, 400);
  r = res(); await handler(req({ body: { rows: [{ id: 'abc', image: PNG }] } }), r); assert.equal(r.code, 400);
  r = res(); await handler(req({ body: { rows: [{ id: '1', image: 'data:text/html;base64,AAAA' }] } }), r); assert.equal(r.code, 400);
});

test('API Gemini: 请求格式（模型、密钥在请求头、thinkingLevel、JSON schema、图片）与结果清洗', async () => {
  const real = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, init) => { sent = { url, init, body: JSON.parse(init.body) }; return ok('```json\n{"rows":[{"id":"3","name":"证书问题","occ":2,"processed":"x"},{"id":"4","name":"","occ":-1,"processed":1.5}]}\n```'); };
  try {
    const r = res(); await handler(req(), r);
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.rows, [{ id: '3', name: '证书问题', occ: 2, processed: null }, { id: '4', name: '', occ: null, processed: null }]);
    assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent');
    assert.equal(sent.init.headers['x-goog-api-key'], 'test-key');            // 密钥放在请求头，不放在网址里
    assert.ok(!sent.url.includes('test-key'));
    const gc = sent.body.generationConfig;
    assert.equal(gc.thinkingConfig.thinkingLevel, 'low');                     // Argon 不支持 thinkingBudget / minimal
    assert.equal(gc.thinkingConfig.thinkingBudget, undefined);
    assert.equal(gc.responseMimeType, 'application/json');
    assert.ok(gc.responseJsonSchema?.properties?.rows);
    assert.ok(sent.body.contents[0].parts.some((p) => p.inlineData?.mimeType === 'image/png'));
    assert.ok(sent.body.systemInstruction.parts[0].text.length > 20);
    assert.ok(!JSON.stringify(r.body).includes('test-key'));
  } finally { globalThis.fetch = real; }
});

test('API Gemini: 遇到 400 时依次去掉 schema、thinkingConfig 重试', async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_u, init) => { const b = JSON.parse(init.body); calls.push(b.generationConfig); return calls.length < 3 ? { ok: false, status: 400, json: async () => ({}) } : ok('{"rows":[{"id":"3","name":"","occ":1,"processed":1}]}'); };
  try {
    const r = res(); await handler(req(), r);
    assert.equal(r.code, 200); assert.equal(calls.length, 3);
    assert.ok(calls[0].responseJsonSchema && calls[0].thinkingConfig);
    assert.ok(!calls[1].responseJsonSchema && calls[1].thinkingConfig);
    assert.ok(!calls[2].responseJsonSchema && !calls[2].thinkingConfig);
  } finally { globalThis.fetch = real; }
});

test('API Gemini: 忽略 thought 片段；服务出错返回通用 502（不泄露密钥）；被拦截返回 502', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ thought: true, text: 'thinking...' }, { text: '{"rows":[{"id":"1","name":"a","occ":1,"processed":0}]}' }] } }] }) });
    let r = res(); await handler(req(), r); assert.equal(r.code, 200); assert.equal(r.body.rows[0].occ, 1);
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    r = res(); await handler(req(), r); assert.equal(r.code, 502); assert.ok(!JSON.stringify(r.body).includes('test-key'));
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) });
    r = res(); await handler(req(), r); assert.equal(r.code, 502);
  } finally { globalThis.fetch = real; }
});

const fail = (status) => ({ ok: false, status, json: async () => ({}) });
const GOOD = '{"rows":[{"id":"3","name":"","occ":1,"processed":1}]}';

test('API: GET 健康检查只返回布尔值，不泄露密钥；带正确密码时 authorized=true', async () => {
  let r = res(); await handler({ method: 'GET', headers: {} }, r);
  assert.equal(r.code, 200); assert.equal(r.body.ok, true); assert.equal(r.body.authorized, false); assert.deepEqual(r.body.missing, []);
  assert.ok(!JSON.stringify(r.body).includes('test-key') && !JSON.stringify(r.body).includes('secret'));
  r = res(); await handler({ method: 'GET', headers: { 'x-access-key': 'secret' } }, r); assert.equal(r.body.authorized, true);
  r = res(); await handler({ method: 'GET', headers: { 'x-access-key': 'secre' } }, r); assert.equal(r.body.authorized, false);
});

test('API: 缺少环境变量 → 500 not_configured，并说明缺哪个（这正是用户遇到的 500）', async () => {
  const k = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  try {
    let r = res(); await handler(req(), r);
    assert.equal(r.code, 500); assert.equal(r.body.code, 'not_configured'); assert.deepEqual(r.body.missing, ['GEMINI_API_KEY']); assert.equal(r.body.retryable, false);
    r = res(); await handler({ method: 'GET', headers: {} }, r); assert.equal(r.body.ok, false); assert.deepEqual(r.body.missing, ['GEMINI_API_KEY']);
  } finally { process.env.GEMINI_API_KEY = k; }
});

test('API: 错误都带 code/retryable；密码错误 401 不可重试', async () => {
  const r = res(); await handler(req({ headers: { 'x-access-key': 'nope' } }), r);
  assert.equal(r.code, 401); assert.equal(r.body.code, 'bad_key'); assert.equal(r.body.retryable, false);
});

test('API Gemini: 503 后自动重试同一模型并成功（对调用者透明）', async () => {
  const real = globalThis.fetch; let n = 0;
  globalThis.fetch = async () => (++n === 1 ? fail(503) : ok(GOOD));
  try { const r = res(); await handler(req(), r); assert.equal(r.code, 200); assert.equal(n, 2); assert.equal(r.body.rows[0].occ, 1); }
  finally { globalThis.fetch = real; }
});

test('API Gemini: 主模型 404 → 直接改用备用模型；响应里标明实际使用的模型', async () => {
  const real = globalThis.fetch; const urls = [];
  globalThis.fetch = async (u) => { urls.push(u); return u.includes('gemini-4-argon') ? fail(404) : ok(GOOD); };
  try {
    const r = res(); await handler(req(), r);
    assert.equal(r.code, 200); assert.equal(r.body.model, 'gemini-3.8-flash');
    assert.equal(urls.length, 2); assert.ok(urls[1].includes('gemini-3.8-flash'));
  } finally { globalThis.fetch = real; }
});

test('API Gemini: 所有模型都 404 → bad_model；Gemini 密钥无效 → gemini_key 且不重试；429 → quota 可重试', async () => {
  const real = globalThis.fetch; let n = 0;
  try {
    globalThis.fetch = async () => fail(404);
    let r = res(); await handler(req(), r); assert.equal(r.body.code, 'bad_model'); assert.equal(r.body.retryable, false);
    n = 0; globalThis.fetch = async () => { n++; return fail(403); };
    r = res(); await handler(req(), r); assert.equal(r.body.code, 'gemini_key'); assert.equal(n, 1);
    globalThis.fetch = async () => fail(429);
    r = res(); await handler(req(), r); assert.equal(r.code, 429); assert.equal(r.body.code, 'quota'); assert.equal(r.body.retryable, true); assert.ok(r.headers['Retry-After']);
  } finally { globalThis.fetch = real; }
});

test('API Gemini: 网络异常也会重试；回复不是 JSON → parse（可重试）', async () => {
  const real = globalThis.fetch; let n = 0;
  try {
    globalThis.fetch = async () => { if (++n === 1) throw new Error('ECONNRESET'); return ok(GOOD); };
    let r = res(); await handler(req(), r); assert.equal(r.code, 200);
    globalThis.fetch = async () => ok('not json');
    r = res(); await handler(req(), r); assert.equal(r.body.code, 'parse'); assert.equal(r.body.retryable, true);
  } finally { globalThis.fetch = real; }
});

// ---------- Supabase: đăng nhập một lần, không mật khẩu ----------
const SB = 'https://proj.supabase.co';
const withSupabase = async (fn) => {
  process.env.VITE_SUPABASE_URL = SB; process.env.VITE_SUPABASE_ANON_KEY = 'anon'; delete process.env.APP_ACCESS_KEY;
  try { await fn(); } finally { delete process.env.VITE_SUPABASE_URL; delete process.env.VITE_SUPABASE_ANON_KEY; process.env.APP_ACCESS_KEY = 'secret'; }
};
const bearer = (t) => req({ headers: { authorization: `Bearer ${t}`, 'x-forwarded-for': `3.3.3.${Math.floor(Math.random() * 250)}` } });
const jres = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('Supabase: không có token / token sai → 401 unauthorized; token đúng → gọi Gemini; APP_ACCESS_KEY không còn cần', async () => {
  await withSupabase(async () => {
    const real = globalThis.fetch; const seen = [];
    globalThis.fetch = async (u, init) => {
      seen.push(String(u));
      if (String(u).endsWith('/auth/v1/user')) return init.headers.authorization === 'Bearer good-token' ? jres(200, { id: 'u1', email: 'a@b.c' }) : jres(401, {});
      if (String(u).includes('/rpc/ai_usage_bump')) return jres(200, { allowed: true, n: 7, max: 200 });
      return ok(GOOD);
    };
    try {
      let r = res(); await handler(req({ headers: { 'x-forwarded-for': '9.9.9.9' } }), r); assert.equal(r.code, 401); assert.equal(r.body.code, 'unauthorized'); assert.equal(r.body.retryable, false);
      r = res(); await handler(bearer('bad'), r); assert.equal(r.code, 401);
      assert.ok(!seen.some((u) => u.includes('generativelanguage')));            // chưa đăng nhập thì tuyệt đối không tốn tiền Gemini
      r = res(); await handler(bearer('good-token'), r); assert.equal(r.code, 200); assert.deepEqual(r.body.usage, { n: 7, max: 200 });
    } finally { globalThis.fetch = real; }
  });
});

test('Supabase: vượt hạn mức mỗi ngày → 429 daily_limit, không gọi Gemini, không tự thử lại; lỗi hạ tầng đếm → không chặn AI', async () => {
  await withSupabase(async () => {
    const real = globalThis.fetch; let gemini = 0, rpc = jres(200, { allowed: false, n: 200, max: 200 });
    globalThis.fetch = async (u) => {
      if (String(u).endsWith('/auth/v1/user')) return jres(200, { id: 'u1', email: 'a@b.c' });
      if (String(u).includes('/rpc/ai_usage_bump')) return rpc;
      gemini++; return ok(GOOD);
    };
    try {
      let r = res(); await handler(bearer('t1'), r);
      assert.equal(r.code, 429); assert.equal(r.body.code, 'daily_limit'); assert.equal(r.body.retryable, false); assert.equal(gemini, 0); assert.match(r.body.error, /200\/200/);
      rpc = jres(404, {});                                                       // chưa chạy schema.sql: không được làm hỏng AI
      r = res(); await handler(bearer('t1'), r); assert.equal(r.code, 200); assert.equal(gemini, 1);
    } finally { globalThis.fetch = real; }
  });
});

test('Supabase: Supabase Auth không trả lời → 503 auth_unavailable (có thể thử lại), không nhầm với "sai đăng nhập"; GET health có usage & email', async () => {
  await withSupabase(async () => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = async () => { throw new Error('down'); };
      let r = res(); await handler(bearer('t2'), r); assert.equal(r.code, 503); assert.equal(r.body.code, 'auth_unavailable'); assert.equal(r.body.retryable, true);
      globalThis.fetch = async (u) => (String(u).endsWith('/auth/v1/user') ? jres(200, { id: 'u1', email: 'a@b.c' }) : jres(200, [{ n: 12 }]));
      r = res(); await handler({ method: 'GET', headers: { authorization: 'Bearer t3' } }, r);
      assert.equal(r.body.ok, true); assert.equal(r.body.auth, 'supabase'); assert.equal(r.body.authorized, true); assert.equal(r.body.user, 'a@b.c'); assert.deepEqual(r.body.usage, { n: 12, max: 200 });
      r = res(); await handler({ method: 'GET', headers: {} }, r); assert.equal(r.body.authorized, false); assert.equal(r.body.usage, null);
    } finally { globalThis.fetch = real; }
  });
});
