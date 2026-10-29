// Service worker: (1) mở được ứng dụng khi mất mạng; (2) nhận ảnh được "Chia sẻ" từ hệ điều hành (Android).
// Không bao giờ cache /api/ và các yêu cầu tới Supabase (khác nguồn).
const SHELL = 'qt-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('qt-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await req.formData();
        const cache = await caches.open('qt-share');
        for (const k of await cache.keys()) await cache.delete(k);
        let n = 0;
        for (const f of form.getAll('images')) if (f && f.size) await cache.put(new Request(`${url.origin}${url.pathname.replace(/share-target$/, '')}shared/${Date.now()}-${n++}-${encodeURIComponent(f.name || 'shared.png')}`), new Response(f, { headers: { 'content-type': f.type || 'image/png' } }));
        return Response.redirect(`${url.pathname.replace(/share-target$/, '')}?shared=${n}`, 303);
      } catch { return Response.redirect(url.pathname.replace(/share-target$/, ''), 303); }
    })());
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  if (req.mode === 'navigate') { // trang chính: ưu tiên mạng, mất mạng thì dùng bản đã lưu
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      try { const res = await fetch(req); if (res.ok) cache.put('./', res.clone()); return res; }
      catch { return (await cache.match('./')) || (await cache.match(req)) || Response.error(); }
    })());
    return;
  }
  // tài nguyên tĩnh (tên file có mã băm): lưu lần đầu, lần sau dùng ngay và cập nhật ngầm
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })());
});
