const CACHE_NAME = 'inspection-pwa-v8';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

self.addEventListener('install', event => {
  // Separate required assets (local) from optional (CDN)
  const requiredAssets = PRECACHE_ASSETS.filter(u => !u.startsWith('http'));
  const optionalAssets = PRECACHE_ASSETS.filter(u => u.startsWith('http'));
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(requiredAssets);
      // CDN assets are optional — don't fail install if CDN is down
      for (const url of optionalAssets) {
        try { await cache.add(url); } catch (e) { console.warn('Optional cache failed:', url); }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim()) // claim inside waitUntil so it completes properly
  );
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return caches.match('/index.html');
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const url = new URL(request.url);
  if (
    request.method === 'GET' &&
    (url.origin === self.location.origin ||
     url.hostname === 'cdnjs.cloudflare.com' ||
     url.hostname === 'gstatic.com')
  ) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', event => {
  // Non-GET requests (POST/PUT/DELETE) go directly to network — don't interfere
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // API calls always go to network (reports, photos, login endpoints)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/api')) return;

  // Don't intercept Supabase requests — always go to network
  if (url.hostname.includes('supabase.co')) return;

  // Don't intercept Netlify internal paths
  if (url.pathname.startsWith('/.netlify/')) return;

  const isNavigation = event.request.mode === 'navigate';
  const isIndex = url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html');

  if (isNavigation || isIndex) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
