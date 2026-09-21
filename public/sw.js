/* Service Worker عمل‌یار — شِلِ آفلاین برای PWA
 * - ناوبری‌ها: network-first با fallback به شِلِ کش‌شده (SPA)
 * - داراییِ هم‌مبدأ (assets/آیکون/فونت): cache-first (نامِ فایل‌ها هش‌دارند)
 * - API هم‌مبدأ روی /api است و Service Worker اصلاً آن را intercept نمی‌کند
 */
const CACHE = 'amalyar-shell-v12';
const STATIC = ['/icon-192.png', '/icon-512.png', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      // شِل + استخراجِ داراییِ هش‌دار از خودِ HTML تا از همان نصبِ اول آفلاین کار کند
      const res = await fetch('/app', { cache: 'no-cache' });
      await c.put('/app', res.clone());
      const html = await res.text();
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      await c.addAll([...new Set([...STATIC, ...assets])]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      // Never navigate an open form: the user accepts the update banner.
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/version.json') return;

  // ناوبریِ SPA — network-first (بدونِ کشِ HTTP تا HTMLِ کهنه سرو نشود)، آفلاین → شِل
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/app', copy));
          return res;
        })
        .catch(() => caches.match('/app', { ignoreSearch: true })),
    );
    return;
  }

  // دارایی‌های استاتیک — cache-first (+ تلاشِ دوبارهٔ کش به‌عنوانِ آخرین پناه)
  e.respondWith(
    caches
      .match(req, { ignoreVary: true })
      .then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && (url.pathname.startsWith('/assets/') || /\.(png|svg|woff2?|ico)$/.test(url.pathname))) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      )
      .catch(() => caches.match(url.pathname, { ignoreVary: true, ignoreSearch: true })),
  );
});
