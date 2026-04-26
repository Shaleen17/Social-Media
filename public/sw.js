self.__TS_SW_VERSION__ = "20260426-founder-intelligence-1";
const TS_STATIC_CACHE = `ts-static-${self.__TS_SW_VERSION__}`;
const TS_API_CACHE = `ts-api-${self.__TS_SW_VERSION__}`;

const CORE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/manifest.webmanifest?v=20260420-advanced-search-1",
  "/apple-touch-icon.png",
  "/pwa-192.png",
  "/pwa-512.png",
  "/Brand_Logo.jpg",
  "/Style.css",
  "/Style.css?v=20260426-founder-intelligence-1",
  "/Script.js?v=20260426-founder-intelligence-1",
  "/api.js?v=20260426-redis-pagination-fix-1",
  "/backend-adapter.js?v=20260426-founder-intelligence-1",
  "/founder-control.js?v=20260426-founder-intelligence-1",
  "/appwrite-auth.js?v=20260425-scale-search-oauth-1",
  "/config.js?v=20260420-advanced-search-1",
  "/socket-client.js?v=20260425-scale-search-oauth-1",
  "/webrtc-client.js?v=20260422-webrtc-socket-signaling-1",
  "/enhancements-bootstrap.js?v=20260426-founder-intelligence-1",
  "/noncritical-enhancements.js?v=20260426-founder-intelligence-1",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(TS_STATIC_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch(() => null)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith("ts-static-") || key.startsWith("ts-api-")) &&
                key !== TS_STATIC_CACHE &&
                key !== TS_API_CACHE
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function networkFirst(request, cacheName, fallbackRequest) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = (await cache.match(request)) || (fallbackRequest ? await cache.match(fallbackRequest) : null);
    if (cached) return cached;
    throw new Error("offline");
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const response = await networkPromise;
  if (response) return response;
  throw new Error("offline");
}

function isApiReadEligible(url) {
  return /^\/api\/(posts|videos|users\/all|search\/hashtags\/trending|notifications|messages)/i.test(
    url.pathname
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (/\/sw\.js$/i.test(url.pathname)) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (isApiReadEligible(url)) {
      event.respondWith(networkFirst(request, TS_API_CACHE));
    }
    return;
  }

  const isCodeAsset =
    request.destination === "script" ||
    request.destination === "style" ||
    /\.(js|css|webmanifest)$/i.test(url.pathname) ||
    /[?&]v=/.test(url.search);
  const isStaticAsset =
    isCodeAsset ||
    request.destination === "font" ||
    request.destination === "image" ||
    request.destination === "video" ||
    /\.(png|jpg|jpeg|gif|webp|avif|svg|ico|woff2?|ttf|mp4)$/i.test(url.pathname);

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, TS_STATIC_CACHE, "/index.html").catch(async () => {
        const cache = await caches.open(TS_STATIC_CACHE);
        return (
          (await cache.match("/index.html")) ||
          (await cache.match("/")) ||
          Response.error()
        );
      })
    );
    return;
  }

  if (isCodeAsset) {
    event.respondWith(networkFirst(request, TS_STATIC_CACHE));
    return;
  }

  if (isStaticAsset) {
    event.respondWith(staleWhileRevalidate(request, TS_STATIC_CACHE));
  }
});

self.addEventListener("push", (event) => {
  const payload = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch {
      return {};
    }
  })();

  const title = payload.title || "New message";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/Brand_Logo.jpg",
    badge: payload.badge || "/Brand_Logo.jpg",
    tag: payload.tag || "chat-message",
    data: payload.data || {},
  };

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const hasFocusedClient = list.some(
        (client) => client.visibilityState === "visible" && client.focused
      );
      if (hasFocusedClient) return null;
      return self.registration.showNotification(title, options);
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    event.notification.data?.url ||
    "/?openChat=" + encodeURIComponent(event.notification.data?.convId || "");

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }

      return null;
    })
  );
});
