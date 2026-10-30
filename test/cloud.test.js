import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloud, CloudError } from '../src/cloud/supabase.js';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
const mkStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };
const SESSION = (over = {}) => ({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, user: { id: 'u1', email: 'a@b.c' }, ...over });

function setup(handler, { t0 = 1_000_000_000_000 } = {}) {
  const calls = []; let t = t0; const storage = mkStorage();
  const fetchImpl = async (url, init) => { calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined }); return handler(url, init, calls.length); };
  const cloud = createCloud({ url: 'https://x.supabase.co/', anonKey: 'ANON', storage, fetchImpl, now: () => t });
  return { cloud, calls, storage, advance: (s) => { t += s * 1000; } };
}

test('cloud: đăng nhập tài khoản + mật khẩu → có phiên, lưu bền và khôi phục sau khi tải lại trang; "admin" thành admin@qt.app', async () => {
  const { cloud, calls, storage } = setup(() => json(200, SESSION()));
  const u = await cloud.signIn(' Admin ', 'p@ss w0rd');
  assert.deepEqual(u, { id: 'u1', email: 'a@b.c' });
  assert.equal(calls[0].url, 'https://x.supabase.co/auth/v1/token?grant_type=password');
  assert.deepEqual(calls[0].body, { email: 'admin@qt.app', password: 'p@ss w0rd' }); assert.equal(calls[0].init.headers.apikey, 'ANON');
  assert.ok(storage.getItem('qt-session'));
  const again = createCloud({ url: 'https://x.supabase.co', anonKey: 'ANON', storage, now: () => 1_000_000_000_000, fetchImpl: async () => { throw new Error('không cần mạng'); } });
  assert.equal(again.user().email, 'a@b.c'); assert.equal(await again.getToken(), 'AT1');
  await cloud.signIn('boss@corp.com', 'x'); assert.equal(calls[1].body.email, 'boss@corp.com');
});

test('cloud: sai mật khẩu / tài khoản lạ đều chỉ báo "账号或密码错误" (không lộ tài khoản có tồn tại); không gửi gì khi thiếu thông tin; quá nhiều lần → thông báo riêng', async () => {
  const a = setup(() => json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }));
  await assert.rejects(a.cloud.signIn('admin', 'sai'), (e) => e instanceof CloudError && e.message === '账号或密码错误');
  const b = setup(() => json(400, { msg: 'User not found' }));
  await assert.rejects(b.cloud.signIn('ghost', 'x'), (e) => e.message === '账号或密码错误');
  await assert.rejects(b.cloud.signIn('', 'x'), (e) => e.message === '账号或密码错误'); await assert.rejects(b.cloud.signIn('a b/c', 'x'), (e) => e.message === '账号或密码错误'); await assert.rejects(b.cloud.signIn('admin', ''), (e) => e.message === '账号或密码错误');
  assert.equal(b.calls.length, 1);
  const c = setup(() => json(429, { msg: 'email rate limit exceeded' }));
  await assert.rejects(c.cloud.signIn('admin', 'x'), (e) => e.code === 'rate_limited' && /次数过多/.test(e.message));
});

test('cloud: token sắp hết hạn tự làm mới (một lần dù nhiều nơi cùng hỏi); refresh token hỏng → đăng xuất; mất mạng → giữ phiên', async () => {
  let refreshes = 0;
  const { cloud, advance, calls } = setup((url) => {
    if (url.includes('grant_type=refresh_token')) { refreshes++; return json(200, SESSION({ access_token: `AT${refreshes + 1}`, refresh_token: `RT${refreshes + 1}` })); }
    return json(200, SESSION());
  });
  await cloud.signIn('admin', 'pw');
  assert.equal(await cloud.getToken(), 'AT1');
  advance(3600 - 30);                                   // còn 30 giây → làm mới
  const [t1, t2] = await Promise.all([cloud.getToken(), cloud.getToken()]);
  assert.equal(refreshes, 1); assert.equal(t1, 'AT2'); assert.equal(t2, 'AT2');
  assert.equal(calls.at(-1).body.refresh_token, 'RT1');

  const bad = setup((url) => (url.includes('grant_type=refresh_token') ? json(400, { error: 'invalid_grant' }) : json(200, SESSION())));
  await bad.cloud.signIn('admin', 'pw'); bad.advance(4000);
  let changes = 0; bad.cloud.onChange(() => changes++);
  assert.equal(await bad.cloud.getToken(), null); assert.equal(bad.cloud.user(), null); assert.ok(changes >= 1); assert.equal(bad.storage.getItem('qt-session'), null);

  let offline = false;
  const net = setup((url) => { if (offline) throw new Error('net'); return json(200, SESSION()); });
  await net.cloud.signIn('admin', 'pw'); offline = true; net.advance(3600 - 30);
  assert.equal(await net.cloud.getToken(), 'AT1');       // token còn hạn ~30 giây, mất mạng: vẫn dùng được, KHÔNG đăng xuất
  assert.ok(net.cloud.user());
});

test('cloud: rest gửi apikey + Bearer, gặp 401 thì làm mới token rồi thử lại đúng một lần; chưa đăng nhập → unauthorized', async () => {
  let n = 0;
  const { cloud, calls } = setup((url, init) => {
    if (url.includes('grant_type=refresh_token')) return json(200, SESSION({ access_token: 'AT-new', refresh_token: 'RT-new' }));
    if (url.includes('grant_type=password')) return json(200, SESSION());
    n++; return init.headers.authorization === 'Bearer AT1' ? json(401, {}) : json(200, [{ ok: 1 }]);
  });
  await assert.rejects(cloud.rest('reports'), (e) => e.code === 'unauthorized');
  await cloud.signIn('admin', 'pw');
  const r = await cloud.rest('reports?select=*');
  assert.deepEqual(r, [{ ok: 1 }]); assert.equal(n, 2);
  const last = calls.at(-1); assert.equal(last.init.headers.authorization, 'Bearer AT-new'); assert.equal(last.init.headers.apikey, 'ANON');
  assert.equal(last.url, 'https://x.supabase.co/rest/v1/reports?select=*');
});

test('cloud: chưa cấu hình → configured=false (ứng dụng chạy chế độ chỉ lưu trên máy)', () => { assert.equal(createCloud({}).configured, false); });
