/* Kapso CRM service worker: desktop notifications (Web Push).
 *
 * The backend pushes every CRM notification this browser's Settings allow
 * (backend/services/webPush.js). It is shown as a desktop notification, even
 * with no CRM tab open, unless a CRM tab is in front: that tab already plays
 * its own sound and updates the bell. Clicking one opens what it is about.
 * Nothing is cached here; the app itself loads as usual.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const windows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    d = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    windows().then((list) => {
      // Someone is looking at the CRM: the page shows it there.
      if (list.some((w) => w.focused && w.visibilityState === 'visible')) return undefined;
      return self.registration.showNotification(d.title || 'Kapso CRM', {
        body: d.body || '',
        icon: '/image.png',
        badge: '/image.png',
        // One per notification row: a chat's next message replaces its
        // earlier notification (and alerts again) instead of stacking up.
        tag: d.id ? `crm-${d.id}` : 'crm',
        renotify: !!d.id,
        timestamp: Date.now(),
        data: { id: d.id || '', target: d.target || {} },
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    windows().then((list) => {
      const tab = list.find((w) => new URL(w.url).origin === self.location.origin);
      if (tab) {
        tab.postMessage({ type: 'crm-open-notification', id: data.id, target: data.target });
        return tab.focus();
      }
      const q = encodeURIComponent(JSON.stringify({ id: data.id, target: data.target }));
      return self.clients.openWindow(`/?crmOpen=${q}`);
    }),
  );
});
