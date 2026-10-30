"use strict";
const PREFIX =
  "mes-missions-" + encodeURIComponent(self.registration.scope) + "-";
const CACHE = PREFIX + "v12.3-static-1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./themes.css",
  "./core.js",
  "./messages.js",
  "./adult-messages.js",
  "./history.js",
  "./config.js",
  "./dashboard.js",
  "./family.js",
  "./reminders.js",
  "./shared.js",
  "./supabase.min.js",
  "./themes.js",
  "./app.js",
  "./dynamic-core.js",
  "./dynamic.js",
  "./daily-core.js",
  "./mission-wizard.js",
  "./art/avatar-presets.png",
  "./dynamic.css",
  "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon.svg",
  ...[
    "morning",
    "horsebook",
    "clean",
    "garden",
    "bows",
    "minimal",
    "kawaii",
    "ponyrose",
    "stables",
    "country",
  ].map((id) => "./art/" + id + ".webp"),
  ...[
    "tavern",
    "grimoire",
    "forest",
    "rest",
    "cocoon",
    "quietgarden",
    "lavender",
    "sunday",
  ].map((id) => "./art/" + id + "-v10.webp"),
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        c.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))),
      )
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(PREFIX) && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.href.startsWith(self.registration.scope)
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE).then((c) => c.put(event.request, copy)),
          );
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request, { cacheName: CACHE })
          .then(
            (r) =>
              r ||
              (event.request.mode === "navigate"
                ? caches.match("./index.html", { cacheName: CACHE })
                : Response.error()),
          ),
      ),
  );
});

function identityDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("mm-identity-" + self.registration.scope, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("identity");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function identity(value) {
  const db = await identityDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
          "identity",
          value === undefined ? "readonly" : "readwrite",
        ),
        store = tx.objectStore("identity");
      const r =
        value === undefined ? store.get("user") : store.put(value, "user");
      r.onsuccess = () => resolve(value === undefined ? r.result : value);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
self.addEventListener("message", (event) => {
  if (event.data?.type === "SET_USER" && typeof event.data.userId === "string")
    event.waitUntil(identity(event.data.userId));
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data?.json() || {};
      } catch {}
      if (!data.userId || data.userId !== (await identity())) return;
      const listId = typeof data.listId === "string" ? data.listId : "";
      await self.registration.showNotification("Mes missions 🔔", {
        body:
          typeof data.body === "string"
            ? data.body
            : "Une petite mission t’attend ✨",
        icon: new URL("icon.svg", self.registration.scope).href,
        tag: "mission-" + (data.tag || listId || "test"),
        data: { listId, userId: data.userId, jobId: data.jobId || null },
        vibrate: [120, 60, 120],
      });
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const listId = event.notification.data?.listId || "";
  const target = new URL("./", self.registration.scope);
  if (listId) target.searchParams.set("liste", listId);
  event.waitUntil(
    (async () => {
      if (event.notification.data?.userId !== (await identity())) return;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find((c) =>
        c.url.startsWith(self.registration.scope),
      );
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: "OPEN_LIST", listId });
      } else await self.clients.openWindow(target.href);
    })(),
  );
});
