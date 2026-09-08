const CACHE = "주의울림-v45-no-email-confirm-title-only";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // API/CDN/미디어 요청은 브라우저와 각 서비스의 캐시 정책에 맡깁니다.
  if (
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("jsdelivr.net") ||
    url.hostname.includes("esm.sh") ||
    url.hostname.includes("open-meteo.com") ||
    url.hostname.includes("youtube.com") ||
    url.hostname.includes("youtube-nocookie.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("ytimg.com")
  ) return;

  // 페이지 이동은 최신 파일을 먼저 받고, 오프라인일 때 캐시로 대체합니다.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) caches.open(CACHE).then(cache => cache.put("./index.html", response.clone()));
          return response;
        })
        .catch(async () => (await caches.match(event.request)) || (await caches.match("./index.html")))
    );
    return;
  }

  // 정적 자원은 캐시를 즉시 사용하면서 백그라운드에서 최신 버전으로 갱신합니다.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const network = fetch(event.request).then(response => {
          if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
