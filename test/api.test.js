import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.APP_ACCESS_KEY = 'secret';
const { default: handler } = await import('../api/vision.js');

const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const req = (over = {}) => ({ method: 'POST', headers: { 'x-access-key': 'secret', 'x-forwarded-for': `1.1.1.${Math.floor(Math.random() * 250)}` }, body: { rows: [{ id: '3', image: PNG }] }, ...over });

test('API AI: từ chối sai phương thức, sai mã truy cập, dữ liệu xấu', async () => {
  let r = res(); await handler(req({ method: 'GET' }), r); assert.equal(r.code, 405);
  r = res(); await handler(req({ headers: { 'x-access-key': 'nope' } }), r); assert.equal(r.code, 401);
  r = res(); await handler(req({ body: { rows: [] } }), r); assert.equal(r.code, 400);
  r = res(); await handler(req({ body: { rows: [{ id: 'abc', image: PNG }] } }), r); assert.equal(r.code, 400);
  r = res(); await handler(req({ body: { rows: [{ id: '1', image: 'data:text/html;base64,AAAA' }] } }), r); assert.equal(r.code, 400);
});

test('API AI: gọi Claude (giả lập), làm sạch kết quả, không rò khóa API', async () => {
  const real = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, init) => { sent = { url, init }; return { ok: true, json: async () => ({ content: [{ type: 'text', text: '```json\n{"rows":[{"id":"3","name":"证书问题","occ":2,"processed":"x"},{"id":"4","name":"","occ":-1,"processed":1.5}]}\n```' }] }) }; };
  try {
    const r = res(); await handler(req(), r);
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.rows, [
      { id: '3', name: '证书问题', occ: 2, processed: null },
      { id: '4', name: '', occ: null, processed: null },
    ]);
    assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(JSON.parse(sent.init.body).messages[0].content.some((b) => b.type === 'image'), true);
    assert.ok(!JSON.stringify(r.body).includes('test-key'));
  } finally { globalThis.fetch = real; }
});

test('API AI: lỗi từ dịch vụ AI trả 502 chung chung (không lộ chi tiết)', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 529, json: async () => ({}) });
  try { const r = res(); await handler(req(), r); assert.equal(r.code, 502); assert.ok(!JSON.stringify(r.body).includes('test-key')); }
  finally { globalThis.fetch = real; }
});
