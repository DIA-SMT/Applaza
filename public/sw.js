/* Service worker de Applaza: app instalable y tolerante a cortes de conexion.
   - Shell y estaticos: cache-first (hasheados por Next).
   - Paginas: network-first con respaldo cacheado (si la red tarda mas de 6 s y hay copia).
   - Mosaicos del mapa: stale-while-revalidate con tope de entradas.
   - Fotos de evidencia: stale-while-revalidate con tope.
   - Datos de Supabase (solo GET /rest): network-first con respaldo, para
     abrir la app sin conexion con los ultimos datos vistos.
   - Todo lo demas (auth, escrituras) va siempre a la red. */

const VERSION = "applaza-sw-v2";
const CACHES = {
  assets: `${VERSION}-assets`,
  pages: `${VERSION}-pages`,
  tiles: `${VERSION}-tiles`,
  images: `${VERSION}-images`,
  data: `${VERSION}-data`,
};
// Dominio de la API de Supabase: lo pasa la app al registrar el service worker (/sw.js?api=...).
// Sirve tanto para Supabase Cloud (*.supabase.co) como para el Supabase propio.
const API_HOST = (() => {
  try { return new URL(new URL(self.location.href).searchParams.get("api")).hostname; } catch { return null; }
})();

function isSupabaseHost(hostname) {
  return hostname.endsWith(".supabase.co") || (API_HOST !== null && hostname === API_HOST);
}

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

// Con señal débil la red a veces no falla: queda colgada. Si pasa este tiempo y hay copia
// guardada, se muestra la copia y la respuesta de la red sigue actualizando la caché.
const NAVIGATION_TIMEOUT_MS = 6000;
const DATA_TIMEOUT_MS = 8000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function networkFirstWithFallback(network, fallback, timeoutMs) {
  network.catch(() => undefined); // si ya se respondió con la copia, un error tardío de red no queda sin manejar
  try {
    return await Promise.race([
      network,
      wait(timeoutMs).then(async () => (await fallback()) || network),
    ]);
  } catch (error) {
    const hit = await fallback();
    if (hit) return hit;
    throw error;
  }
}

async function networkFirst(name, request, limit) {
  const cache = await caches.open(name);
  const network = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
      if (limit) trimCache(name, limit);
    }
    return response;
  });
  return networkFirstWithFallback(network, () => cache.match(request), DATA_TIMEOUT_MS);
}

async function pageStrategy(request) {
  const cache = await caches.open(CACHES.pages);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  const fallback = async () => (await cache.match(request)) || (await cache.match(new URL("/", self.location.origin).toString()));
  return networkFirstWithFallback(network, fallback, NAVIGATION_TIMEOUT_MS);
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

  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    event.respondWith(staleWhileRevalidate(CACHES.tiles, request, TILE_LIMIT));
    return;
  }

  if (isSupabaseHost(url.hostname)) {
    if (url.pathname.startsWith("/storage/")) {
      event.respondWith(staleWhileRevalidate(CACHES.images, request, IMAGE_LIMIT));
      return;
    }
    if (url.pathname.startsWith("/rest/")) {
      event.respondWith(networkFirst(CACHES.data, request, DATA_LIMIT));
    }
  }
});
