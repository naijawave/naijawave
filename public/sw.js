/* Naija Wave — service worker: Web Push (call alerts) + PWA shell.
   No caching of app pages here — the server already sends no-cache for
   HTML/JS/CSS. This worker only handles push notifications. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'Naija Wave';
  const body = data.body || 'You have a new alert on Naija Wave.';
  const url = data.url || '/#/messages';
  const tag = data.tag || 'naijawave';
  const options = {
    body,
    icon: '/img/icon-192.png',
    badge: '/img/icon-192.png',
    tag,
    renotify: true,
    vibrate: [200, 100, 200, 100, 200],
    data: { url },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/#/messages';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.navigate(url); return client.focus(); }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
