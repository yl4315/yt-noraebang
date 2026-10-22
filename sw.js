// YT 노래방 서비스 워커: 앱 화면과 글꼴을 기기에 저장해서 인터넷 없이도 열리게 한다.
// 곡(MR)과 녹음은 여기가 아니라 앱의 IndexedDB에 저장된다.
const SHELL = 'yt-shell-v2', FONTS = 'yt-fonts-v1';
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== FONTS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 앱 파일: 인터넷이 되면 항상 최신 파일, 안 되면 저장해 둔 파일
  if (url.origin === location.origin) {
    e.respondWith(fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
    return;
  }

  // 글꼴: 저장해 둔 걸 먼저 쓰고 뒤에서 새로 받아 둔다
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
  // 그 밖(Google 로그인·Drive·가사 서버)은 그대로 인터넷으로
});
