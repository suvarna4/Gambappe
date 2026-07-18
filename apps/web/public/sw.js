// Web push service worker (design doc §13.2, WS9-T2). Deliberately minimal: this app has no
// offline/cache strategy (spectator pages are ISR/CDN-served, §10.2) — this worker exists
// solely to receive `push` events and forward them to the OS notification tray, and to route a
// notification tap back into the app. No `fetch` handler: registering one would opt every
// navigation into this worker's control for no benefit here, and any bug in it would risk
// breaking normal page loads app-wide.

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Receipts', body: event.data.text() };
  }

  const title = payload.title || 'Receipts';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    data: { url: payload.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const relativeUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  // client.url is always absolute; resolve the notification's (possibly relative) url the same
  // way before comparing, or an existing tab is never matched and every tap opens a duplicate.
  const targetUrl = new URL(relativeUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    }),
  );
});
