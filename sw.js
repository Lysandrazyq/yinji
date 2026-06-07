// 印迹 service worker — minimal offline cache so the PWA still works without network.
// Bump CACHE name whenever you ship a new watermark.html to force re-cache.
var CACHE = 'yinji-v38-2026-06-07-v3.0.0-beta.18';
var PRECACHE = [
  './',
  './watermark.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-mask.svg'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(PRECACHE); }));
  // v2.11.0：不再自动 skipWaiting()。新版会停在 waiting 状态，等页面提示用户「有新版本」、
  // 用户点「刷新」后页面发来 SKIP_WAITING 消息才激活，避免用户正在编辑时被强制刷新。
  // （首次安装时本来就没有旧 sw 控制页面，浏览器会直接 activate，无需 skipWaiting。）
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){ if(k!==CACHE) return caches['delete'](k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// v2.11.0：收到页面「刷新」按钮发来的指令 → 立即激活新版（配合页面里的 controllerchange→reload）。
self.addEventListener('message', function(e){
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
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
