self.__TS_SW_VERSION__ = "20260419-language-deploy-fix-5";
const TS_STATIC_CACHE = `ts-static-${self.__TS_SW_VERSION__}`;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ts-static-") && key !== TS_STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(TS_STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline");
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(TS_STATIC_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;
  throw new Error("offline");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (/\/sw\.js$/i.test(url.pathname)) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  const isStaticAsset =
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "font" ||
    request.destination === "image" ||
    request.destination === "video" ||
    /[?&]v=/.test(url.search) ||
    /\.(js|css|png|jpg|jpeg|gif|webp|avif|svg|ico|woff2?|ttf|mp4|webmanifest)$/i.test(
      url.pathname
    );
  const isCodeAsset =
    request.destination === "script" ||
    request.destination === "style" ||
    /\.(js|css|webmanifest)$/i.test(url.pathname) ||
    /[?&]v=/.test(url.search);

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isCodeAsset) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset) {
    event.respondWith(staleWhileRevalidate(request));
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
    event.notification.data?.url || "/?openChat=" + encodeURIComponent(event.notification.data?.convId || "");

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
