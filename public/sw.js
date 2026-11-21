// Eyvan Cafe Digital Menu — Smart Caching Service Worker
// Strategy:
//  - Hashed static assets (.js, .css, .woff2) & images (.webp, .png, .svg): Cache-First
//  - App shell (HTML) & menu.published.json: Stale-While-Revalidate (instant open + auto-update)
//  - PHP/API mutations: Network-Only (never cached)

const CACHE_VERSION = 'eyvan-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(pathname) {
  return /\.(?:js|css|woff2|webp|png|jpg|jpeg|svg|ico)$/i.test(pathname);
}

function isDynamicApi(pathname) {
  return /\.php$/i.test(pathname) || pathname.includes('/api/');
}

function isMenuJson(pathname) {
  return /menu\.published\.json$/i.test(pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isDynamicApi(url.pathname)) return;

  // 1. Stale-While-Revalidate for published menu JSON (instant open + notify on price/item change)
  if (isMenuJson(url.pathname)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then(async (res) => {
            if (res && res.ok) {
              const cloned = res.clone();
              const [oldText, newText] = await Promise.all([
                cached ? cached.clone().text() : Promise.resolve(null),
                res.clone().text(),
              ]);
              await cache.put(request, cloned);
              if (oldText !== null && oldText !== newText) {
                const clients = await self.clients.matchAll({ type: 'window' });
                for (const client of clients) {
                  client.postMessage({ type: 'EYVAN_MENU_UPDATED' });
                }
              }
            }
            return res;
          })
          .catch(() => cached);

        return cached || networkPromise;
      }),
    );
    return;
  }

  // 2. Cache-First for images, fonts, and hashed JS/CSS chunks
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        if (res && res.ok) {
          cache.put(request, res.clone());
        }
        return res;
      }),
    );
    return;
  }

  // 3. Stale-While-Revalidate for HTML shell navigation
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {
            if (res && res.ok) {
              cache.put(request, res.clone());
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      }),
    );
  }
});
