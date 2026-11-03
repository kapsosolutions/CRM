/* Kapso CRM service worker: desktop notifications (Web Push).
 *
 * The backend pushes every CRM notification this browser's Settings allow
 * (backend/services/webPush.js). Each one pops up as a desktop notification
 * (Windows: the corner of the screen), with the CRM closed, in the background
 * or in front. Only a message of the chat being read right now is skipped.
 * An open CRM tab plays the chosen sound, so the pop-up is silent then.
 * Clicking one opens what it is about.
 * Nothing is cached here; the app itself loads as usual.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const windows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });

// The chat each CRM tab has open on screen (tab id → phone), told by the page.
// Lost when the browser stops the worker; then a message simply shows.
const watching = new Map();
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'crm-watching' && event.source && event.source.id) {
    if (d.phone) watching.set(event.source.id, String(d.phone));
    else watching.delete(event.source.id);
  }
});

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    d = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    windows().then((list) => {
      const phone = d.target && d.target.phone ? String(d.target.phone) : '';
      // Reading that very chat right now: it's already on screen.
      const reading = phone && list.some((w) => w.focused && w.visibilityState === 'visible' && watching.get(w.id) === phone);
      if (reading) return undefined;
      return self.registration.showNotification(d.title || 'Kapso CRM', {
        body: d.body || '',
        icon: '/image.png',
        badge: '/image.png',
        // One per notification row: a chat's next message replaces its
        // earlier notification (and alerts again) instead of stacking up.
        tag: d.id ? `crm-${d.id}` : 'crm',
        renotify: !!d.id,
        // An open CRM tab plays the chosen sound itself, so no second one.
        silent: list.length > 0,
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
