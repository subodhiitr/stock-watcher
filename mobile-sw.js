const CACHE_NAME = 'intradayx-mobile-v5';
const SHELL_ASSETS = [
  '/mobile',
  '/mobile.css?v=20260629-2',
  '/mobile-app.js?v=20260629-2',
  '/mobile-manifest.webmanifest',
  '/mobile-icon.svg',
  '/mobile-icon-192.png',
  '/mobile-icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname === '/mobile' || url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.png') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request)),
    );
  }
});
