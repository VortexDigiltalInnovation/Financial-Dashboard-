/* Financial Dashboard – Service Worker v3.10.6 */
const VERSION = 'v3-10-6';
const SHELL_CACHE = 'findash-shell-' + VERSION;
const RUNTIME_CACHE = 'findash-runtime-' + VERSION;
const RUNTIME_MAX_ENTRIES = 80;
const NAV_TIMEOUT_MS = 4500;
const scopeURL = path => new URL(path, self.registration.scope).href;

// Solo i due file necessari all'avvio bloccano l'installazione del service worker.
// Le risorse secondarie sono precaricate in modalità best-effort: un logo o una libreria
// assente sul server non deve rendere impossibile installare/aggiornare l'intera PWA.
const CORE_SHELL = ['./index.html', './manifest.webmanifest'];
const APP_SHELL = [
  './', './tailwind.css', './Guida_Utente_FinDashboard_Ultimate_Pro.pdf',
  './icons/favicon-64.png', './icons/financial-dashboard-mark.svg',
  './icons/logo-96.png', './icons/logo-128.png', './icons/logo-192.png',
  './icons/icon-72.png', './icons/icon-96.png', './icons/icon-128.png',
  './icons/icon-144.png', './icons/icon-152.png', './icons/icon-192.png',
  './icons/icon-384.png', './icons/icon-512.png', './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
  './vendor/fontawesome/css/all.min.css',
  './vendor/fontawesome/webfonts/fa-solid-900.woff2',
  './vendor/fontawesome/webfonts/fa-regular-400.woff2',
  './vendor/fontawesome/webfonts/fa-brands-400.woff2'
];
const CDN_PRECACHE = [
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];
const CACHEABLE_HOSTS = ['cdnjs.cloudflare.com','cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com'];

async function cacheOne(cache, path, required=false) {
  const url = scopeURL(path);
  try {
    const response = await fetch(new Request(url, {cache:'reload', credentials:'same-origin'}));
    if (!response || !response.ok) throw new Error(`${path} -> ${response && response.status}`);
    await cache.put(url, response);
    return true;
  } catch (error) {
    if (required) throw error;
    console.warn('[Financial Dashboard] Risorsa non precaricata:', path, error);
    return false;
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await Promise.all(CORE_SHELL.map(path => cacheOne(shell, path, true)));
    await Promise.all(APP_SHELL.map(path => cacheOne(shell, path, false)));
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(CDN_PRECACHE.map(async url => {
      try {
        const response = await fetch(new Request(url, {mode:'no-cors', credentials:'omit'}));
        if (response && (response.ok || response.type === 'opaque')) await runtime.put(url, response);
      } catch (_) {}
    }));
    // L'aggiornamento viene attivato dall'utente tramite il banner in-app.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, RUNTIME_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('findash-') && !keep.includes(key)).map(key => caches.delete(key)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (_) {} }
    await self.clients.claim();
  })());
});

async function trimCache(name, max) {
  const cache = await caches.open(name), keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length-max).map(key => cache.delete(key)));
}
function withTimeout(promise, ms) {
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(value => {clearTimeout(timer);resolve(value);}, error => {clearTimeout(timer);reject(error);});
  });
}
async function handleNavigation(event) {
  const shell = await caches.open(SHELL_CACHE);
  try {
    const response = await withTimeout((async()=> (await event.preloadResponse) || fetch(event.request))(), NAV_TIMEOUT_MS);
    if (response && response.ok) shell.put(scopeURL('./index.html'), response.clone()).catch(()=>{});
    return response;
  } catch (_) {
    return (await shell.match(scopeURL('./index.html'))) || (await shell.match(scopeURL('./'))) || Response.error();
  }
}
async function staleWhileRevalidate(event) {
  const cache = await caches.open(SHELL_CACHE), cached = await cache.match(event.request);
  const update = fetch(event.request).then(response => {
    if (response && response.ok) cache.put(event.request, response.clone()).catch(()=>{});
    return response;
  }).catch(()=>null);
  if (cached) { event.waitUntil(update); return cached; }
  return (await update) || Response.error();
}
async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE), cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone()).then(()=>trimCache(RUNTIME_CACHE,RUNTIME_MAX_ENTRIES)).catch(()=>{});
    }
    return response;
  } catch (_) { return Response.error(); }
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') { event.respondWith(handleNavigation(event)); return; }
  if (url.origin === self.location.origin) {
    if (request.headers.has('range')) {
      event.respondWith(caches.match(request.url,{ignoreSearch:true,ignoreVary:true}).then(hit=>hit||fetch(request)));
      return;
    }
    event.respondWith(staleWhileRevalidate(event));
    return;
  }
  if (CACHEABLE_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(request));
});
self.addEventListener('message', event => { if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for (const client of list) if ('focus' in client) return client.focus();
    return self.clients.openWindow(scopeURL('./'));
  }));
});
