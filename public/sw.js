/* Invest Like Buffett service worker: shows signal alerts and opens the Signals tab when tapped. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Invest Like Buffett", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Invest Like Buffett";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || "diversify-signal",
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      data: { url: data.url || "/#signals" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/#signals", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => c.url.startsWith(self.location.origin));
      if (open) return open.focus().then((c) => (c && "navigate" in c ? c.navigate(url) : undefined));
      return self.clients.openWindow(url);
    }),
  );
});
