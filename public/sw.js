/* Service worker de Applaza: app instalable y tolerante a cortes de conexion.
   - Shell y estaticos: cache-first (hasheados por Next).
   - Paginas: network-first con respaldo cacheado.
   - Mosaicos del mapa: stale-while-revalidate con tope de entradas.
   - Fotos de evidencia: stale-while-revalidate con tope.
   - Datos de Supabase (solo GET /rest): network-first con respaldo, para
     abrir la app sin conexion con los ultimos datos vistos.
   - Todo lo demas (auth, escrituras) va siempre a la red. */

const VERSION = "applaza-sw-v1";
const CACHES = {
  assets: `${VERSION}-assets`,
  pages: `${VERSION}-pages`,
  tiles: `${VERSION}-tiles`,
  images: `${VERSION}-images`,
  data: `${VERSION}-data`,
};
const TILE_LIMIT = 600;
const IMAGE_LIMIT = 150;
const DATA_LIMIT = 60;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const valid = Object.values(CACHES);
    await Promise.all(names.filter((name) => !valid.includes(name)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

async function cacheFirst(name, request) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(name, request, limit) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  const refresh = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
      trimCache(name, limit);
    }
    return response;
  }).catch(() => undefined);
  return hit || refresh.then((response) => response || Response.error());
}

async function networkFirst(name, request, limit) {
  const cache = await caches.open(name);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
      if (limit) trimCache(name, limit);
    }
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

async function pageStrategy(request) {
  const cache = await caches.open(CACHES.pages);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    const root = await cache.match(new URL("/", self.location.origin).toString());
    if (root) return root;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || /\.(png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)) {
      event.respondWith(cacheFirst(CACHES.assets, request));
      return;
    }
    if (request.mode === "navigate") {
      event.respondWith(pageStrategy(request));
    }
    return;
  }

  if (url.hostname.endsWith("basemaps.cartocdn.com") || url.hostname.endsWith("tile.openstreetmap.org")) {
    event.respondWith(staleWhileRevalidate(CACHES.tiles, request, TILE_LIMIT));
    return;
  }

  if (url.hostname.endsWith(".supabase.co")) {
    if (url.pathname.startsWith("/storage/")) {
      event.respondWith(staleWhileRevalidate(CACHES.images, request, IMAGE_LIMIT));
      return;
    }
    if (url.pathname.startsWith("/rest/")) {
      event.respondWith(networkFirst(CACHES.data, request, DATA_LIMIT));
    }
  }
});
