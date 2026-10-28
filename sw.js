/* Photo Watermarker (COMFY) – service worker
   Makes the app work offline and installable.

   • index.html + manifest.json: network first (so a new upload shows up right away),
     falling back to the saved copy when you're offline or the network is slow.
   • Fonts, icons and everything else: saved copy first (instant, works offline).
   • If you ever replace the icons or fonts, change CACHE_VERSION below (v1 -> v2)
     so phones pick up the new files. Changing index.html alone does NOT need that. */

const CACHE_VERSION = 'v1';
const CACHE = 'wm-' + CACHE_VERSION;
const SLOW_NETWORK_MS = 4000;

// Everything the app needs. Missing files are skipped, they never break the install.
const PRECACHE = [
  'index.html',
  'manifest.json',
  'favicon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'AG Book Rounded Bold.otf',
  'AG Book Rounded Medium.otf',
  'fonts/dm-sans-latin-400-normal.woff2',
  'fonts/dm-sans-latin-500-normal.woff2',
  'fonts/dm-sans-latin-600-normal.woff2',
  'fonts/dm-mono-latin-400-normal.woff2',
  'fonts/dm-mono-latin-500-normal.woff2'
];

const urlOf = p => new URL(p, self.registration.scope).href;
const PAGE_URL = urlOf('index.html');
const NETWORK_FIRST = new Set([PAGE_URL, urlOf('manifest.json')]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async p => {
      try {
        const res = await fetch(new Request(urlOf(p), { cache: 'reload' }));
        if (res.ok) await cache.put(urlOf(p), res);
      } catch (_) { /* offline or file not uploaded: skip it */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('wm-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function offlineReply() {
  return new Response('Offline, and this file has not been saved yet. Open the app once while online.', {
    status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

// Try the network; if it fails or takes too long, use the saved copy.
// The saved copy is refreshed in the background whenever the network answers.
function networkFirst(event, key) {
  return new Promise(resolve => {
    let done = false;
    const finish = res => { if (!done) { done = true; resolve(res); } };
    const fromCache = () => caches.match(key, { ignoreSearch: true });
    const timer = setTimeout(async () => {
      const hit = await fromCache();
      if (hit) finish(hit);
    }, SLOW_NETWORK_MS);
    const network = fetch(key, { cache: 'no-cache' }).then(async res => {
      clearTimeout(timer);
      if (res.ok) {
        const copy = res.clone();
        finish(res);
        await caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
      } else {
        finish((await fromCache()) || res);
      }
    }).catch(async () => {
      clearTimeout(timer);
      finish((await fromCache()) || offlineReply());
    });
    event.waitUntil(network);
  });
}

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  } catch (_) {
    return offlineReply();
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // leave other sites alone
  if (!url.href.startsWith(self.registration.scope)) return;  // only our own folder

  if (req.mode === 'navigate') { event.respondWith(networkFirst(event, PAGE_URL)); return; }
  const clean = url.origin + url.pathname;
  if (NETWORK_FIRST.has(clean)) { event.respondWith(networkFirst(event, clean)); return; }
  event.respondWith(cacheFirst(req));
});
