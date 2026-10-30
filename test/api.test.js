import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = 'test-key';
process.env.VITE_SUPABASE_URL = 'https://proj.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
process.env.AI_RETRY_DELAY_MS = '0';
process.env.AI_DAILY_LIMIT = '5';
delete process.env.GEMINI_MODEL; delete process.env.GEMINI_FALLBACK_MODEL;
const { default: handler, rankModels } = await import('../api/vision.js');

const res = () => { const r = { code: 0, body: null, headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
let ipN = 0; let tokN = 0; let worldN = 0;
const tok = () => `tok${String(++tokN).padStart(6, '0')}${'x'.repeat(24)}`;
const req = (over = {}) => ({ method: 'POST', headers: { authorization: `Bearer ${tok()}`, 'x-forwarded-for': `2.2.${Math.floor(ipN / 250)}.${ipN++ % 250}` }, body: { items: [{ id: '3', kind: 'occ', image: PNG, candidates: ['6', '5'] }] }, ...over });
const jres = (status, body, headers = {}) => ({ ok: status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body });

// Supabase + Gemini giả lập; mọi cuộc gọi đều được ghi lại.
function world({ member = true, usage = { allowed: true, n: 1, max: 5, member: true }, models = ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-embedding-001'], gemini } = {}) {
  const calls = [];
  const uid = `u${++worldN}`;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url); calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('/auth/v1/user')) return jres(200, { id: uid, email: 'admin@x.local' });
    if (url.includes('/rpc/is_member')) return jres(200, member);
    if (url.includes('/rpc/ai_usage_bump')) return jres(200, usage);
    if (url.includes('/rest/v1/ai_usage')) return jres(200, [{ n: 1 }]);
    if (/\/v1beta\/models\?/.test(url)) return jres(200, { models: models.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) });
    if (url.includes(':generateContent')) return gemini ? gemini(url, JSON.parse(init.body), calls) : jres(200, { candidates: [{ content: { parts: [{ text: '{"items":[{"id":"3","value":5,"text":"5"}]}' }] } }] });
    throw new Error(`unexpected fetch ${url}`);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const gem = (calls) => calls.filter((c) => c.url.includes(':generateContent'));

test('API: rankModels ưu tiên Flash mới nhất, loại embedding/tts/image', () => {
  const r = rankModels(['gemini-3.5-pro', 'gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-embedding-001', 'gemini-3.8-flash-image', 'gemini-3.8-flash-preview-tts', 'gemma-3']);
  assert.equal(r[0], 'gemini-3.8-flash');
  assert.ok(!r.some((n) => /embed|image|tts|gemma/.test(n)));
});

test('API: 拒绝错误的方法、未登录、非成员、错误数据、外来 Origin', async () => {
  const w = world();
  try {
    let r = res(); await handler(req({ method: 'PUT' }), r); assert.equal(r.code, 405);
    r = res(); await handler(req({ headers: { 'x-forwarded-for': '9.9.9.9' } }), r); assert.equal(r.code, 401);
    r = res(); await handler(req({ headers: { authorization: 'Bearer short', 'x-forwarded-for': '9.9.9.8' } }), r); assert.equal(r.code, 401);
    r = res(); await handler(req({ body: { items: [] } }), r); assert.equal(r.code, 400);
    r = res(); await handler(req({ body: { items: [{ id: 'abc', kind: 'occ', image: PNG }] } }), r); assert.equal(r.code, 400);
    r = res(); await handler(req({ body: { items: [{ id: '1', kind: 'evil', image: PNG }] } }), r); assert.equal(r.code, 400);
    r = res(); await handler(req({ body: { items: [{ id: '1', kind: 'occ', image: 'data:text/html;base64,AAAA' }] } }), r); assert.equal(r.code, 400);
    r = res(); await handler(req({ body: { items: [{ id: '1', kind: 'occ', image: PNG }, { id: '1', kind: 'occ', image: PNG }] } }), r); assert.equal(r.code, 400);   // 编号重复
    r = res(); await handler(req({ headers: { authorization: `Bearer ${tok()}`, origin: 'https://evil.example', host: 'app.example', 'x-forwarded-for': '9.9.9.7' } }), r); assert.equal(r.code, 403);
    assert.equal(gem(w.calls).length, 0);                                   // 以上情况一次 Gemini 请求都没发出
  } finally { w.restore(); }
  const w2 = world({ member: false });
  try { const r = res(); await handler(req(), r); assert.equal(r.code, 403); assert.equal(r.body.code, 'forbidden'); assert.equal(gem(w2.calls).length, 0); } finally { w2.restore(); }
});

test('API: 成功请求的格式（密钥在请求头、自动选模型、schema、候选提示）与结果清洗', async () => {
  const w = world({ gemini: async () => jres(200, { candidates: [{ content: { parts: [{ thought: true, text: 'x' }, { text: '```json\n{"items":[{"id":"3","value":5,"text":"5"},{"id":"99","value":1,"text":"1"},{"id":"4","value":-1,"text":""},{"id":"5","value":7,"text":"8"}]}\n```' }] } }] }) });
  try {
    const r = res();
    await handler(req({ body: { items: [{ id: '3', kind: 'occ', image: PNG, candidates: ['6', '5', 'zz'] }, { id: '4', kind: 'proc', image: PNG }, { id: '5', kind: 'tot_occ', image: PNG }] } }), r);
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.items, [{ id: '3', value: 5, text: '' }, { id: '4', value: null, text: '' }, { id: '5', value: null, text: '' }]);   // 未知编号被忽略；负数、自相矛盾的数字作废
    assert.equal(r.body.model, 'gemini-3.8-flash');
    const g = gem(w.calls)[0];
    assert.equal(g.init.headers['x-goog-api-key'], 'test-key');
    assert.ok(!g.url.includes('test-key'));
    assert.equal(g.body.generationConfig.thinkingConfig.thinkingLevel, 'low');
    assert.ok(g.body.generationConfig.responseJsonSchema?.properties?.items);
    assert.ok(g.body.contents[0].parts.some((p) => /candidates=6\|5$/.test(p.text || '')));  // 非数字候选被过滤
    assert.ok(!JSON.stringify(r.body).includes('test-key'));
  } finally { w.restore(); }
});

test('API: 429 每分钟额度 → 不对同一模型重试，换备用模型；两个都 429 → quota_minute + retryAfter', async () => {
  const quota = (scope, retry) => jres(429, { error: { message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: scope }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: retry }] } });
  let w = world({ gemini: async () => quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '23s') });
  try {
    const r = res(); await handler(req(), r);
    assert.equal(r.code, 429); assert.equal(r.body.code, 'quota_minute'); assert.equal(r.body.retryable, true); assert.equal(r.body.retryAfter, 23);
    assert.equal(gem(w.calls).length, 2);                                  // 主模型 1 次 + 备用模型 1 次，不是 2×2
    assert.equal(r.headers['Retry-After'], '23');
  } finally { w.restore(); }
  w = world({ gemini: async () => quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '3600s') });
  try { const r = res(); await handler(req(), r); assert.equal(r.body.code, 'quota_day'); assert.equal(r.body.retryable, false); } finally { w.restore(); }
  w = world({ gemini: async (url) => (url.includes('flash-lite') ? jres(200, { candidates: [{ content: { parts: [{ text: '{"items":[{"id":"3","value":2,"text":"2"}]}' }] } }] }) : quota('PerMinute', '5s')) });
  try { const r = res(); await handler(req(), r); assert.equal(r.code, 200); assert.match(r.body.model, /flash-lite/); } finally { w.restore(); }
});

test('API: 400 时依次去掉 schema、thinking；5xx 同一模型只重试一次', async () => {
  let n = 0;
  let w = world({ gemini: async () => (++n < 3 ? jres(400, {}) : jres(200, { candidates: [{ content: { parts: [{ text: '{"items":[{"id":"3","value":1,"text":"1"}]}' }] } }] })) });
  try {
    const r = res(); await handler(req(), r);
    assert.equal(r.code, 200);
    const g = gem(w.calls).map((c) => c.body.generationConfig);
    assert.ok(g[0].responseJsonSchema && g[0].thinkingConfig); assert.ok(!g[1].responseJsonSchema && g[1].thinkingConfig); assert.ok(!g[2].responseJsonSchema && !g[2].thinkingConfig);
  } finally { w.restore(); }
  w = world({ gemini: async () => jres(503, {}) });
  try { const r = res(); await handler(req(), r); assert.equal(r.code, 502); assert.equal(r.body.code, 'upstream'); assert.equal(gem(w.calls).length, 4); } finally { w.restore(); }   // 2 个模型 × 2 次
});

test('API: 每日上限、计数失败、数据库未初始化 → 都不会调用 Gemini（fail-closed）', async () => {
  let w = world({ usage: { allowed: false, n: 5, max: 5, member: true } });
  try { const r = res(); await handler(req(), r); assert.equal(r.code, 429); assert.equal(r.body.code, 'daily_limit'); assert.equal(r.body.retryable, false); assert.equal(gem(w.calls).length, 0); } finally { w.restore(); }
  w = world({ usage: { allowed: true, member: false } });
  try { const r = res(); await handler(req(), r); assert.equal(r.code, 403); assert.equal(gem(w.calls).length, 0); } finally { w.restore(); }
  const real = globalThis.fetch;
  w = world();
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, i) => (String(u).includes('ai_usage_bump') ? jres(500, {}) : inner(u, i));
  try { const r = res(); await handler(req(), r); assert.equal(r.code, 503); assert.equal(r.body.code, 'auth_unavailable'); assert.equal(gem(w.calls).length, 0); } finally { w.restore(); globalThis.fetch = real; }
  w = world();
  const inner2 = globalThis.fetch;
  globalThis.fetch = async (u, i) => (String(u).includes('ai_usage_bump') ? jres(404, {}) : inner2(u, i));
  try { const r = res(); await handler(req(), r); assert.equal(r.code, 500); assert.equal(r.body.code, 'not_configured'); } finally { w.restore(); globalThis.fetch = real; }
});

test('API: GET 未登录只透露“是否配置”，不泄露模型/用量；已登录才有；probe 原样报告额度', async () => {
  let w = world();
  try {
    let r = res(); await handler({ method: 'GET', headers: { 'x-forwarded-for': '7.7.7.1' } }, r);
    assert.deepEqual(r.body, { ok: true, missing: [], authorized: false });
    r = res(); await handler({ method: 'GET', headers: { authorization: `Bearer ${tok()}`, 'x-forwarded-for': '7.7.7.2' }, query: {} }, r);
    assert.equal(r.body.authorized, true); assert.equal(r.body.model, 'gemini-3.8-flash'); assert.equal(r.body.usage.max, 5);
    assert.equal(gem(w.calls).length, 0);                                   // 普通健康检查不消耗额度
  } finally { w.restore(); }
  w = world({ gemini: async () => jres(429, { error: { message: 'daily', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel' }] }] } }) });
  try { const r = res(); await handler({ method: 'GET', headers: { authorization: `Bearer ${tok()}`, 'x-forwarded-for': '7.7.7.3' }, query: { probe: '1' } }, r); assert.equal(r.body.probe.ok, false); assert.equal(r.body.probe.code, 'quota_day'); } finally { w.restore(); }
});

test('API: 缺少环境变量时给出明确提示', async () => {
  const save = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  try {
    let r = res(); await handler({ method: 'GET', headers: {} }, r); assert.deepEqual(r.body.missing, ['GEMINI_API_KEY']);
    r = res(); await handler(req(), r); assert.equal(r.code, 500); assert.equal(r.body.code, 'not_configured');
  } finally { process.env.GEMINI_API_KEY = save; }
});
