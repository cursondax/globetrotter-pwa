/**
 * GlobeTrotter SQL - Service Worker
 * Strategie: Stale-While-Revalidate fuer App-Shell, Cache-First fuer Assets,
 * Network-First fuer API-Calls, Background Sync fuer Offline-Aktionen.
 */

const SW_VERSION = '1.0.0';
const CACHE_APP_SHELL = `gt-shell-v${SW_VERSION}`;
const CACHE_STATIC = `gt-static-v${SW_VERSION}`;
const CACHE_TILES = `gt-tiles-v${SW_VERSION}`;
const CACHE_DOCS = `gt-docs-v${SW_VERSION}`;

const ALL_CACHES = [CACHE_APP_SHELL, CACHE_STATIC, CACHE_TILES, CACHE_DOCS];

// App-Shell: Wird sofort gecacht und offline verfuegbar gemacht
const APP_SHELL_URLS = [
  '/index.html',
  '/manifest.json',
  '/js/db.js',
];

// Statische Assets (Fonts, Icons, etc.)
const STATIC_ASSET_PATTERNS = [
  /\.(woff2?|ttf|otf|eot)$/,
  /\.(svg|png|jpg|jpeg|webp|ico)$/,
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
];

// Leaflet Kacheln (OpenStreetMap)
const MAP_TILE_PATTERN = /tile\.openstreetmap\.org/;
// Maximale Anzahl gecachter Kartenkacheln
const MAX_TILE_CACHE_ENTRIES = 500;

// Microsoft Graph API - nie cachen
const NEVER_CACHE_PATTERNS = [
  /graph\.microsoft\.com/,
  /login\.microsoftonline\.com/,
  /microsoftonline\.com\/oauth2/,
];

// ----------------------------------------------------------------
// INSTALL: App-Shell vorab cachen
// ----------------------------------------------------------------
self.addEventListener('install', (event) => {
  console.log(`[SW] Installation: ${CACHE_APP_SHELL}`);

  event.waitUntil(
    caches.open(CACHE_APP_SHELL)
      .then((cache) => {
        // addAll schlaegt fehl wenn eine Ressource fehlt
        // Im Produktionsbetrieb alle Dateien sicherstellen
        return cache.addAll(APP_SHELL_URLS).catch((err) => {
          console.warn('[SW] App-Shell konnte nicht vollstaendig gecacht werden:', err);
          // Trotzdem fortfahren - Dateien existieren noch nicht in der Entwicklung
        });
      })
      .then(() => {
        console.log('[SW] App-Shell gecacht. Sofort aktivieren.');
        return self.skipWaiting();
      })
  );
});

// ----------------------------------------------------------------
// ACTIVATE: Alte Caches aufraeumen
// ----------------------------------------------------------------
self.addEventListener('activate', (event) => {
  console.log(`[SW] Aktivierung: ${SW_VERSION}`);

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => !ALL_CACHES.includes(name) && name.startsWith('gt-'))
            .map((name) => {
              console.log(`[SW] Veralteter Cache wird geloescht: ${name}`);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Clients uebernehmen.');
        return self.clients.claim();
      })
  );
});

// ----------------------------------------------------------------
// FETCH: Haupt-Routing-Logik
// ----------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Nur GET-Anfragen abfangen
  if (request.method !== 'GET') return;

  // Niemals cachen: Auth & Microsoft Graph
  if (NEVER_CACHE_PATTERNS.some((pattern) => pattern.test(request.url))) {
    event.respondWith(fetch(request));
    return;
  }

  // Kartenkacheln: Cache-First mit Groessenbegrenzung
  if (MAP_TILE_PATTERN.test(request.url)) {
    event.respondWith(cacheFirstWithLimit(request, CACHE_TILES, MAX_TILE_CACHE_ENTRIES));
    return;
  }

  // Statische Assets: Cache-First
  if (STATIC_ASSET_PATTERNS.some((pattern) => pattern.test(request.url))) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // App-Shell (HTML-Navigation): Stale-While-Revalidate
  if (request.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html')) {
    event.respondWith(staleWhileRevalidate(request, CACHE_APP_SHELL));
    return;
  }

  // JS/CSS der App: Stale-While-Revalidate
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(staleWhileRevalidate(request, CACHE_APP_SHELL));
    return;
  }

  // Alles andere: Network-First mit Fallback
  event.respondWith(networkFirst(request, CACHE_STATIC));
});

// ----------------------------------------------------------------
// STRATEGIEN
// ----------------------------------------------------------------

/**
 * Stale-While-Revalidate:
 * Sofort aus Cache antworten (schnell), im Hintergrund aktualisieren.
 * Ideal fuer App-Shell und sich selten aendernde Ressourcen.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse?.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  return cachedResponse || fetchPromise || offlineFallback(request);
}

/**
 * Cache-First:
 * Erst Cache pruefen, nur bei Cache-Miss Netzwerk nutzen.
 * Ideal fuer unveraenderliche Assets (Fonts, Icons).
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) return cachedResponse;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse?.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return offlineFallback(request);
  }
}

/**
 * Cache-First mit Eintraegsbegrenzung:
 * Fuer Kartenkacheln - verhindert unkontrolliertes Cache-Wachstum.
 */
async function cacheFirstWithLimit(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) return cachedResponse;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse?.ok) {
      // Cache-Groesse pruefen und aelteste Eintraege loeschen
      const keys = await cache.keys();
      if (keys.length >= maxEntries) {
        // Die aeltesten 50 Eintraege loeschen (FIFO)
        const toDelete = keys.slice(0, 50);
        await Promise.all(toDelete.map((key) => cache.delete(key)));
      }
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // Offline: Leere Antwort fuer fehlende Kacheln
    return new Response('', { status: 503 });
  }
}

/**
 * Network-First:
 * Netzwerk bevorzugen, bei Fehler auf Cache fallen.
 * Ideal fuer dynamische Inhalte.
 */
async function networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse?.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    return cachedResponse || offlineFallback(request);
  }
}

/**
 * Offline-Fallback:
 * Fuer HTML-Anfragen die gecachte index.html zurueckgeben.
 */
async function offlineFallback(request) {
  if (request.headers.get('accept')?.includes('text/html')) {
    const cache = await caches.open(CACHE_APP_SHELL);
    return await cache.match('/index.html') || new Response(
      '<h1>Offline</h1><p>GlobeTrotter ist offline. Bitte pruefen Sie Ihre Verbindung.</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
  return new Response('Ressource nicht verfuegbar', { status: 503 });
}

// ----------------------------------------------------------------
// BACKGROUND SYNC: Offline-Aktionen nachsynchronisieren
// ----------------------------------------------------------------
self.addEventListener('sync', (event) => {
  console.log('[SW] Background Sync:', event.tag);

  if (event.tag === 'sync-checklist') {
    event.waitUntil(syncChecklist());
  }

  if (event.tag === 'sync-comments') {
    event.waitUntil(syncComments());
  }
});

async function syncChecklist() {
  // Implementierung in db.js: Pending-Checklist-Items an Server senden
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_COMPLETE', payload: 'checklist' });
  });
}

async function syncComments() {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_COMPLETE', payload: 'comments' });
  });
}

// ----------------------------------------------------------------
// PUSH NOTIFICATIONS (Vorbereitung fuer spaetere Erweiterung)
// ----------------------------------------------------------------
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title || 'GlobeTrotter';
  const options = {
    body: data.body || 'Neue Reise-Benachrichtigung',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || 'globetrotter',
    renotify: true,
    data: data.url ? { url: data.url } : {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      const existing = windowClients.find((c) => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});

// ----------------------------------------------------------------
// PERIODIC BACKGROUND SYNC (fuer regelmaessige Karten-Updates)
// ----------------------------------------------------------------
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-map-tiles') {
    event.waitUntil(prefetchCurrentTripTiles());
  }
});

async function prefetchCurrentTripTiles() {
  // Koordinaten der aktuellen Reise aus IDB lesen und Kacheln vorladen
  // Implementierung erfolgt wenn IDB-Modul eingebunden ist
  console.log('[SW] Kartenkacheln werden aktualisiert...');
}

console.log('[SW] GlobeTrotter Service Worker geladen:', SW_VERSION);
