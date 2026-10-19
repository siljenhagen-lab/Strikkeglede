// Service worker: gjør Strikkeglede tilgjengelig uten nett.
// Øk VERSION ved hver endring, så får brukerne tilbud om oppdatering.
const VERSION = '1.0.0';
const CACHE = 'strikkeglede-' + VERSION;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/backup.js',
  'js/data.js',
  'js/db.js',
  'js/media.js',
  'js/pwa.js',
  'js/router.js',
  'js/ui.js',
  'js/views/more.js',
  'js/views/needles.js',
  'js/views/pattern.js',
  'js/views/project.js',
  'js/views/projects.js',
  'js/views/recipes.js',
  'js/views/viewer.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'vendor/pdfjs/pdf.min.mjs',
  'vendor/pdfjs/pdf.worker.min.mjs',
  'vendor/pdfjs/standard_fonts/FoxitDingbats.pfb',
  'vendor/pdfjs/standard_fonts/FoxitFixed.pfb',
  'vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb',
  'vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb',
  'vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb',
  'vendor/pdfjs/standard_fonts/FoxitSerif.pfb',
  'vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb',
  'vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb',
  'vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb',
  'vendor/pdfjs/standard_fonts/FoxitSymbol.pfb',
  'vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf',
  'vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf',
  'vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf',
  'vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  // Rydd kun i våre egne cacher – andre apper på samme domene har sine egne.
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('strikkeglede-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;

  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./', { cacheName: CACHE }).then((r) => r || fetch(req)));
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(req, { cacheName: CACHE, ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  })());
});
