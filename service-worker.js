/* ایرانمنش فایل — کش پوسته برنامه و کتابخانه‌ها برای کار آفلاین. هیچ فایل کاربری از اینجا عبور نمی‌کند. */
const CACHE = "iranmanesh-file-v1";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest",
  "./Vazirmatn-FD-Regular.woff2", "./Vazirmatn-FD-Medium.woff2", "./Vazirmatn-FD-SemiBold.woff2",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./icon-180.png", "./apple-touch-icon.png", "./favicon-32.png",
  "./pdf-lib.min.js", "./jszip.min.js", "./heic2any.min.js",
  "./pdf.min.mjs", "./pdf.worker.min.mjs",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("iranmanesh-file-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
