/* Offline support. Bump VERSION on every release so phones pick up the new files. */
const VERSION = '1.0.4';
const APP_CACHE = `hareem-app-${VERSION}`;
const ASSETS = [
  './',
  'css/app.css',
  'js/i18n.js',
  'js/app.js',
  'fonts/vazirmatn-arabic.woff2',
  'fonts/vazirmatn-latin.woff2',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-192.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-64.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // bypass the HTTP cache so a new version never installs yesterday's files
    await cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('hareem-app-') && key !== APP_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// answer from the cache first so the app opens instantly and without internet
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    const hit = req.mode === 'navigate' ? await cache.match('./') : await cache.match(req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});
