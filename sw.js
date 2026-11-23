/* 아이폰 웹 앱용 오프라인 저장(서비스 워커)
   처음 한 번 열 때 화면 파일을 폰에 보관해 두고, 그 뒤로는 인터넷 없이 보관본으로 엽니다.
   인터넷이 될 때는 몰래 새 버전을 받아 두었다가, 다음에 앱을 열 때 적용합니다.
   고객 데이터는 여기서 다루지 않습니다(데이터는 폰 안의 저장소에만 있고 어디로도 보내지 않음). */
var VERSION = '1.3.1-1795440221666';
var CACHE = 'customer-notes-' + VERSION;
var FILES = ['./', './index.html', './app-bridge.js', './sync-config.js', './sync.js','./manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    var key = req.mode === 'navigate' ? './index.html' : req;
    return c.match(key, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok && req.mode !== 'navigate') c.put(req, res.clone());
        if (res && res.ok && req.mode === 'navigate') c.put('./index.html', res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
