// App-shell cache: everything the whiteboard needs to run offline. Bump CACHE_NAME on any
// deploy that changes these files so clients pick up the new versions instead of stale ones.
const CACHE_NAME = 'electron-pwa-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './api-shim.js',
  './pdf-export.js',
  './pdf-lib.min.js',
  './register-sw.js',
  './payment-success.html',
  './payment-success.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './assets/pdf/cover-dark.svg',
  './assets/pdf/cover-white.svg',
  './assets/pdf/header-dark.svg',
  './assets/pdf/header-white.svg',
  './assets/pdf/footer-dark.svg',
  './assets/pdf/footer-white.svg',
  './assets/pdf/end-dark.svg',
  './assets/pdf/end-white.svg',
  './assets/theme/physique.svg',
  './assets/theme/chimie.svg',
  './assets/theme/biologie.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

// Cache-first for the app shell (instant load, works offline); anything not in the shell
// (e.g. the license-server API calls) just goes straight to the network untouched.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      });
    })
  );
});
