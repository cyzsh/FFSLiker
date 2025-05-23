// Service Worker for FFSLikes PWA
const CACHE_NAME = 'ffsliker-v4';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/offline.html',  // Added offline page to cache
  '/icons/FFS-192x192.png',
  '/icons/FFS-512x512.png',
  '/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/vue@3.5.14/dist/vue.global.min.js',
  'https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/js/all.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11'
];

// Install event - cache all static assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching all assets');
        return cache.addAll(ASSETS_TO_CACHE.map(url => new Request(url, { 
          cache: 'reload',
          credentials: 'include' 
        })));
      })
      .catch(err => console.error('[Service Worker] Failed to cache assets', err))
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Enhanced fetch handler with offline fallback
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and non-http(s) requests
  if (event.request.method !== 'GET' || 
      !event.request.url.startsWith('http')) {
    return;
  }

  const requestUrl = new URL(event.request.url);
  
  // API requests - Network first with cache fallback
  if (requestUrl.pathname.startsWith('/api/')) {
    event.respondWith(
      fetchWithTimeout(event.request, 5000) // 5 second timeout
        .then((response) => {
          if (response.ok) {
            cacheApiResponse(event.request, response.clone());
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets - Cache first with network update
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        const fetchPromise = fetchWithTimeout(event.request, 3000)
          .then((networkResponse) => {
            if (networkResponse.ok) {
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, networkResponse.clone()));
            }
            return networkResponse;
          })
          .catch(() => {}); // Silent fail for background update

        // Return cached response if available, otherwise wait for network
        return cachedResponse || fetchPromise;
      })
      .catch(() => {
        // Final fallback for HTML requests
        if (event.request.headers.get('accept').includes('text/html')) {
          return caches.match('/offline.html');
        }
        return offlineResponse(event.request);
      })
  );
});

// Helper function to cache API responses
function cacheApiResponse(request, response) {
  caches.open(CACHE_NAME)
    .then(cache => cache.put(request, response));
}

// Helper function with timeout
function fetchWithTimeout(request, timeout) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Request timeout')), timeout)
    )
  ]);
}

// Helper function to generate offline response
function offlineResponse(request) {
  if (request.headers.get('accept').includes('application/json')) {
    return new Response(JSON.stringify({ error: "You're offline" }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response('Offline', { status: 503 });
}

// Background sync for failed requests
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-api-requests') {
    event.waitUntil(retryFailedRequests());
  }
});

async function retryFailedRequests() {
  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.keys();
  
  for (const request of requests) {
    if (request.url.includes('/api/')) {
      const retryCount = parseInt(request.headers.get('x-retry-count') || 0;
      if (retryCount >= MAX_RETRIES) {
        await cache.delete(request);
        continue;
      }

      try {
        const response = await fetch(request);
        if (response.ok) {
          await cache.delete(request);
          continue;
        }
      } catch (error) {}

      // Update retry count
      const newHeaders = new Headers(request.headers);
      newHeaders.set('x-retry-count', (retryCount + 1).toString());
      const newRequest = new Request(request, { headers: newHeaders });
      const cachedResponse = await cache.match(request);
      
      if (cachedResponse) {
        await cache.put(newRequest, cachedResponse);
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {
    title: 'FFSLiker',
    body: 'New update available!',
    url: '/'
  };

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/FFS-192x192.png',
      badge: '/icons/FFS-192x192.png',
      vibrate: [100, 50, 100],
      data: { url: data.url }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow(event.notification.data.url);
    })
  );
});

// Periodic updates
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-content') {
    event.waitUntil(updateCache());
  }
});

async function updateCache() {
  const cache = await caches.open(CACHE_NAME);
  const updatedAssets = await Promise.all(
    ASSETS_TO_CACHE.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (response.ok) {
          await cache.put(url, response.clone());
          return true;
        }
      } catch (error) {}
      return false;
    })
  );
  
  if (updatedAssets.some(success => success)) {
    self.registration.showNotification('FFSLiker Updated', {
      body: 'New content is available!',
      icon: '/icons/FFS-192x192.png'
    });
  }
}
