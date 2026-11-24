// YT 노래방 서비스 워커: 앱 화면과 글꼴을 기기에 저장해서 인터넷 없이도 열리게 한다.
// 곡(MR)과 녹음은 여기가 아니라 앱의 IndexedDB에 저장된다.
const SHELL = 'yt-shell-v19', FONTS = 'yt-fonts-v1';
const SHELL_FILES = ['./', './index.html', './css/tokens.css', './css/app.css', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './js/util.js', './js/haptics.js', './js/core.js', './js/store.js', './js/demo.js', './js/audio.js', './js/songs.js', './js/bulk.js', './js/mr.js', './js/playback.js', './js/recording.js', './js/syncedit.js', './js/karaoke.js', './js/profiles.js', './js/cloud.js', './js/key.js', './js/remote.js', './js/backup.js', './js/devsync.js',
  './js/vendor/supabase-2.117.1.js', './js/hub.js', './js/guesthost.js', './js/myremote.js', './js/vendor/toqr-0.1.1.mjs', './js/autosync.js', './js/yt.js', './js/main.js',
  './guest.html', './css/guest.css', './js/guest.js',   // 손님 리모컨 (CR-228): 손님 폰은 서비스 워커를 안 쓰지만 방장 기기에서 같이 열릴 수 있다
  './js/myphone.js'];   // 내 폰 리모컨 (CR-228 ③): remote.html이 허브 길일 때 (core.js·supabase는 위에 있음)

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

  // 리모컨 중계(/api/)는 실시간 통신이라 저장하지 않는다
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;

  // 폰 유튜브 앱 [공유]로 연 주소(?title=&text=&url=, CR-030)는 저장하지 않는다 (공유한 글이 캐시에 남지 않게).
  // 인터넷이 끊겨 있으면 저장해 둔 앱 화면으로 연다 (앱이 "인터넷이 끊겨서…"를 알려 줌)
  if (url.origin === location.origin && ['title', 'text', 'url'].some(k => url.searchParams.has(k))) {
    if (req.mode === 'navigate') e.respondWith(fetch(req).catch(() => caches.match('./index.html').then(hit => hit || Response.error())));
    return;
  }

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
  // 그 밖(Google 로그인·Drive·가사 서버 LRCLIB·회사 허브)은 저장하지 않고 그대로 인터넷으로
});
