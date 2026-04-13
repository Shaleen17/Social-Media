self.__TS_SW_VERSION__ = "20260413-storyfix-8";

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
