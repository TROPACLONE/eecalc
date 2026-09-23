// Offline support: caches only the app's own files (never user data). Cache-first; a new version
// (new hash below, set by the build) replaces the old cache on the next launch.
const CACHE = 'eecalc-549c1b31a13e';
const FILES = ["./","./app.js","./c-KJR2GYOI.js","./c-KPBPKWEZ.js","./c-PQAVO6OB.js","./c-X3YFTYMA.js","./icon-180.png","./icon-192.png","./icon-512.png","./index.html","./manifest.webmanifest"];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
