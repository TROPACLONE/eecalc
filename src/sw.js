// Offline support: caches only the app's own files and station logos (never user data). Cache-first; a new version
// (new hash below, set by the build) takes over on the next launch. The previous version's cache is kept until the
// one after: a page still running the old code can then load its screens (c-….js chunks, named by content hash).
const CACHE = 'eecalc-__HASH__';
const FILES = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => {                     // keys are in creation order: keep this version and the newest older one
    const old = keys.filter(k => k.startsWith('eecalc-') && k !== CACHE);
    return Promise.all(old.slice(0, -1).map(k => caches.delete(k)));
  }).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // streams, chat, LibriVox: straight to the network
  const chunk = /\/c-[A-Z0-9]+\.js$/.test(url.pathname);   // immutable: an older cache may still hold one an old page needs
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: true }))
    .then(r => r || (chunk ? caches.match(e.request, { ignoreSearch: true }) : null))
    .then(r => r || fetch(e.request).then(res => {
      // station logos are not precached: each is kept the first time it is shown (same version as the app)
      if (res.ok && url.pathname.includes('/logos/')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    })));
});
