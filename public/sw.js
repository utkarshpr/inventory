/* Minimal service worker: makes the app installable and lets it show system notifications.
   It does not cache pages, so a new deploy is always picked up straight away. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus()
    return self.clients.openWindow(url)
  }))
})

/* Server push (the send-push function): shows whatever title/body it sends, even when the app is closed. */
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { /* not JSON */ }
  e.waitUntil(self.registration.showNotification(d.title || 'New order', { body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: d.tag, renotify: true, requireInteraction: true, vibrate: [200, 100, 200], data: { url: d.url || '/' } }))
})
