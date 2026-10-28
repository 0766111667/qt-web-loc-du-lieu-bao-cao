import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = 'test-key';
process.env.APP_ACCESS_KEY = 'secret';
const { default: handler } = await import('../api/vision.js');

const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const req = (over = {}) => ({ method: 'POST', headers: { 'x-access-key': 'secret', 'x-forwarded-for': `2.2.2.${Math.floor(Math.random() * 250)}` }, body: { rows: [{ id: '3', image: PNG }] }, ...over });
const ok = (text) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });

test('API Gemini: 拒绝错误的方法、密码和数据', async () => {
  let r = res(); await handler(req({ method: 'GET' }), r); assert.equal(r.code, 405);
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
