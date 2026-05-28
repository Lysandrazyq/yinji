// 印迹 service worker — minimal offline cache so the PWA still works without network.
// Bump CACHE name whenever you ship a new watermark.html to force re-cache.
var CACHE = 'yinji-v3-2026-05-28';
var PRECACHE = [
  './',
  './watermark.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-mask.svg'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(PRECACHE); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){ if(k!==CACHE) return caches['delete'](k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// Cache-first for same-origin GETs, network-first fallback.
self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if(url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(function(hit){
      if(hit) return hit;
      return fetch(e.request).then(function(resp){
        try{
          var copy = resp.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
        }catch(err){}
        return resp;
      }).catch(function(){
        // offline + not cached
        return caches.match('./watermark.html');
      });
    })
  );
});
