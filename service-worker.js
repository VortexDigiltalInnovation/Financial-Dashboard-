/* Financial Dashboard – Service Worker v3.11.3 */
const VERSION = 'v3-11-3';
const SHELL_CACHE = 'findash-shell-' + VERSION;
const RUNTIME_CACHE = 'findash-runtime-' + VERSION;
const RUNTIME_MAX_ENTRIES = 80;
const NAV_TIMEOUT_MS = 3500;

// Unico file indispensabile: tutto il resto (manifest, stili, icone, loghi) è best effort e non blocca mai l'installazione.
const CORE_SHELL = ['./index.html'];

// File locali (essenziali + icone/loghi/librerie incluse): salvati per l'uso offline.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './tailwind.css?v=3.5',
  './Guida_Utente_FinDashboard_Ultimate_Pro.pdf',
  './favicon-64.png',
  './financial-dashboard-mark.svg',
  './logo-96.png',
  './logo-128.png',
  './icon-72.png',
  './icon-96.png',
  './icon-128.png',
  './icon-144.png',
  './icon-152.png',
  './icon-192.png',
  './icon-384.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

// Librerie esterne (versioni fisse): precache "best effort", senza bloccare l'installazione.
const CDN_PRECACHE = [
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// Solo questi host vengono messi in cache; tutto il resto passa direttamente dalla rete.
const CACHEABLE_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // v3.10.4: solo i file essenziali bloccano l'installazione; icone, loghi e librerie locali sono "best effort"
    // (prima un solo file mancante sul server, es. la cartella vendor, impediva ogni aggiornamento in silenzio).
    // cache:'reload' evita di salvare copie vecchie prese dalla cache HTTP del browser.
    const fetchFresh = url => fetch(new Request(url, { cache: 'reload' })).then(res => {
      if (!res || !res.ok) throw new Error(url + ' -> ' + (res && res.status));
      return shell.put(url, res);
    });
    await Promise.all(CORE_SHELL.map(fetchFresh));
    await Promise.allSettled(APP_SHELL.filter(u => !CORE_SHELL.includes(u)).map(fetchFresh));
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(CDN_PRECACHE.map(async url => {
      const res = await fetch(new Request(url, { mode: 'no-cors', credentials: 'omit' }));
      if (res && (res.ok || res.type === 'opaque')) await runtime.put(url, res);
    }));
    // Nessun skipWaiting automatico: l'app mostra l'avviso "Nuova versione disponibile" e invia SKIP_WAITING su richiesta.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, RUNTIME_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('findash-') && !keep.includes(k)).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// Navigazione: rete (con preload e timeout), poi cache.
async function handleNavigation(event) {
  const shell = await caches.open(SHELL_CACHE);
  try {
    const network = (async () => (await event.preloadResponse) || fetch(event.request))();
    const response = await withTimeout(network, NAV_TIMEOUT_MS);
    if (response && response.ok) shell.put('./index.html', response.clone()).catch(() => {});
    return response;
  } catch (err) {
    return (await shell.match('./index.html')) || (await shell.match('./')) || Response.error();
  }
}

// File locali statici: risposta immediata dalla cache e aggiornamento in background.
async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  const update = fetch(event.request).then(res => {
    if (res && res.ok) cache.put(event.request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(update); return cached; }
  return (await update) || Response.error();
}

// Librerie esterne: cache-first (le versioni sono fisse).
async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(request, res.clone()).then(() => trimCache(RUNTIME_CACHE, RUNTIME_MAX_ENTRIES)).catch(() => {});
    }
    return res;
  } catch (err) {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (url.origin === self.location.origin) {
    if (request.headers.has('range')) {
      event.respondWith(
        caches.match(request.url, { ignoreSearch: true, ignoreVary: true }).then(hit => hit || fetch(request))
      );
      return;
    }
    event.respondWith(staleWhileRevalidate(event, SHELL_CACHE));
    return;
  }

  if (CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* v3.9.1: tocco sulla notifica (avvisi di prezzo) -> apre/riporta in primo piano l'app */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
