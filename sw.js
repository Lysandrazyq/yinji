// 印迹 service worker — minimal offline cache so the PWA still works without network.
// Bump CACHE name whenever you ship a new watermark.html to force re-cache.
var CACHE = 'yinji-v67-2026-06-14-v4.1.0';
var SHARED_CACHE = 'yinji-shared';
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
      return Promise.all(keys.map(function(k){ if(k!==CACHE && k!==SHARED_CACHE) return caches['delete'](k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// v2.11.0：收到页面「刷新」按钮发来的指令 → 立即激活新版（配合页面里的 controllerchange→reload）。
self.addEventListener('message', function(e){
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);
  if(url.origin !== self.location.origin) return;

  // v3.12.0：PWA 分享目标 — 接收系统分享过来的照片（POST multipart/form-data）
  if(e.request.method === 'POST' && url.pathname.endsWith('/share-target')){
    e.respondWith(
      e.request.formData().then(function(formData){
        var file = formData.get('photo');
        if(!file) return Response.redirect('./watermark.html', 302);
        return caches.open(SHARED_CACHE).then(function(cache){
          var headers = new Headers();
          headers.set('Content-Type', file.type || 'image/jpeg');
          headers.set('X-Shared-File-Name', encodeURIComponent(file.name || 'shared.jpg'));
          return cache.put('shared-image', new Response(file, {headers: headers})).then(function(){
            return Response.redirect('./watermark.html?shared=1', 302);
          });
        });
      }).catch(function(){
        return Response.redirect('./watermark.html', 302);
      })
    );
    return;
  }

  // v3.12.0：页面启动后取回 SW 暂存的分享图片（用完即删）
  if(e.request.method === 'GET' && url.pathname.endsWith('/__shared_image')){
    e.respondWith(
      caches.open(SHARED_CACHE).then(function(cache){
        return cache.match('shared-image').then(function(resp){
          if(!resp) return new Response('no shared image', {status: 404});
          cache.delete('shared-image');
          return resp;
        });
      })
    );
    return;
  }

  if(e.request.method !== 'GET') return;
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
