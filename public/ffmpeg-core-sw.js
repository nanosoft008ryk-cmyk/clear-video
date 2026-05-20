const CORE_VERSION = "0.12.9";
const CORE_CACHE_REVISION = "2";
const CACHE_NAME = `ffmpeg-core-${CORE_VERSION}-r${CORE_CACHE_REVISION}`;
const CORE_PREFIX = `/ffmpeg-core/${CORE_VERSION}/`;
const CORE_FILES = [
  `${CORE_PREFIX}ffmpeg-core.js`,
  `${CORE_PREFIX}ffmpeg-core.wasm`,
];

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
            .filter((key) => key.startsWith("ffmpeg-core-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(CORE_PREFIX)) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached && cached.ok) return cached;
      const response = await fetch(event.request, { cache: "no-store" });
      if (response.ok) {
        const headers = new Headers(response.headers);
        if (url.pathname.endsWith(".js")) headers.set("Content-Type", "text/javascript");
        if (url.pathname.endsWith(".wasm")) headers.set("Content-Type", "application/wasm");
        const body = await response.blob();
        const stable = new Response(body, { status: 200, statusText: "OK", headers });
        await cache.put(event.request, stable.clone());
        return stable;
      }
      return response;
    }),
  );
});