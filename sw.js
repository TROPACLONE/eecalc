// Offline support: caches only the app's own files (never user data). Cache-first; a new version
// (new hash below, set by the build) replaces the old cache on the next launch.
const CACHE = 'eecalc-cfb1454016ad';
const FILES = ["./","./app.js","./c-3FH3VMK5.js","./c-GK4VSFOG.js","./c-M5IJGAS2.js","./c-PA2PGJNM.js","./c-PDAHEWYS.js","./c-TQI26J24.js","./c-U2WJME2Y.js","./c-VHNSBD2M.js","./c-ZEUBA653.js","./icon-180.png","./icon-192.png","./icon-512.png","./index.html","./manifest.webmanifest"];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;   // radio / chat: straight to the network
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
