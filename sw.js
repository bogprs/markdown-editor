/* Service worker: offline app shell + receiving files shared to the installed app. */
const VERSION = 'mded-v4';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'mded-share').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    let text = '', name = 'shared.md';
    if (file && typeof file.text === 'function') { text = await file.text(); name = file.name || name; }
    else text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join('\n\n');
    const cache = await caches.open('mded-share');
    await cache.put('shared-file', new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-File-Name': encodeURIComponent(name) } }));
  } catch (e) { /* fall through to the app */ }
  return Response.redirect('./?shared=1', 303);
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) { e.respondWith(receiveShare(e.request)); return; }
  if (e.request.method !== 'GET') return;
  // stale-while-revalidate: instant offline start, updates picked up on the next launch
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(res => { if (res.ok) cache.put(e.request.url.split('?')[0], res.clone()); return res; }).catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    return (await fresh) || new Response('Offline', { status: 503 });
  })());
});
