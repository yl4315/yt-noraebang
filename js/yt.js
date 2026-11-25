// YT 노래방 · 유튜브 곡 (CR-030)
// 유튜브 영상은 공식 IFrame 플레이어로 보이는 채로만 튼다: 광고·로고·컨트롤을 가리지 않고, 플레이어는 200×200보다 크게,
// 화면이 숨으면 멈춘다(백그라운드 재생 없음). 내려받기·소리 빼기·녹화·영상 소리를 Web Audio에 잇기는 하지 않는다.
// 재생·일시정지·위치·길이는 playback.js의 재생 소스 층(R3)이 이 파일의 ytPlay·ytPause·ytSeek·ytTime·ytDur로 부른다.
// 검색 열쇠(YouTube Data API)는 ytSetKey로 메모리에만 받는다 (CR-227이 허브에서 넣음). 저장·화면·로그에 쓰지 않는다.
// 플레이어 host는 기본 youtube-nocookie, 설정 "프리미엄 계정으로 틀기 (이 기기만)"(nb-yt-www)를 켠 기기만 www.youtube.com (CR-251 ②).
// 광고는 막거나 숨기거나 건너뛰지 않는다 (나오면 그대로 보인다).
'use strict';

const Yt = {
  player: null, ready: false, api: null, playerP: null,
  loaded: null,            // 플레이어에 올린 영상 번호
  st: -1,                  // 플레이어 상태 (-1 시작 전, 0 끝, 1 재생, 2 일시정지, 3 버퍼링, 5 올려 둠)
  raw: 0, rawAt: 0, last: 0, pending: null, rate: 1,
  err: null, wantPlay: false, fresh: null, blockTimer: 0,
  tab: 'mr', sel: 0, rows: [], cache: new Map(), busy: null, searchErr: null, keyBlocked: false,
  meta: new Map(), lyrTried: new Map(), share: null, lay: {}, bandNote: 0,
  www: lsGet(YT_WWW_KEY) === '1',   // 프리미엄 계정으로 틀기 (이 기기만, CR-251 ②)
  gen: 0,                  // 플레이어를 다시 만들 때마다 +1 (늦게 온 옛 플레이어 알림은 버림)
  errCode: null, errTv: null, qr: null,   // 지금 보이는 못 트는 영상 안내 · 그때 TV 화면이었나 · 그린 QR {id, src, px}
};
const ytPlaceholder = id => '유튜브 영상 ' + id;
const ytApiReady = () => !!(Yt.player && Yt.ready);
const ytTabIsYt = () => Yt.tab === 'yt';   // karaoke.js runSearch·검색 칸 키가 부름

/* ---------------- 검색 열쇠 (메모리에만) ---------------- */
let ytKeySrc = null;   // 글자 또는 글자를 돌려주는 함수. 이 기기에 저장하지 않는다
function ytSetKey(k) {
  ytKeySrc = typeof k === 'function' || (typeof k === 'string' && k.trim()) ? k : null;
  Yt.keyBlocked = false; Yt.cache.clear(); Yt.searchErr = null;
  if (ytTabOn()) ytSetTab('yt');
}
function ytKeyValue() {
  try { const k = typeof ytKeySrc === 'function' ? ytKeySrc() : ytKeySrc; return typeof k === 'string' && k.trim() ? k.trim() : null; }
  catch { return null; }
}
const ytHasKey = () => !Yt.keyBlocked && !!ytKeyValue();

/* ---------------- 플레이어 ---------------- */
function ytLoadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (Yt.api) return Yt.api;
  Yt.api = new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    const fail = why => { clearTimeout(timer); Yt.api = null; rej(new Error(why)); };
    const timer = setTimeout(() => fail('yt-api-timeout'), 15000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); try { if (typeof prev === 'function') prev(); } catch {} res(window.YT); };
    const sc = document.createElement('script');
    sc.src = 'https://www.youtube.com/iframe_api'; sc.async = true;
    sc.onerror = () => { sc.remove(); fail('yt-api-load'); };
    document.head.append(sc);
  });
  return Yt.api;
}
function ytPlayer() {
  if (ytApiReady()) return Promise.resolve(Yt.player);
  if (Yt.playerP) return Yt.playerP;
  const gen = Yt.gen, mine = () => gen === Yt.gen;   // 그사이 설정을 바꿔 다시 만들었으면(ytRebuild) 이 플레이어는 버린다
  const p = Yt.playerP = ytLoadApi().then(YT => new Promise((res, rej) => {
    if (!mine()) { rej(new Error('yt-player-old')); return; }
    const host = $('#ytFrame'); if (!host) { rej(new Error('no-box')); return; }
    host.textContent = '';
    const el = document.createElement('div'); el.id = 'ytPlayerEl'; host.append(el);
    const vars = { playsinline: 1, controls: 1, rel: 0 };
    if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
    const timer = setTimeout(() => rej(new Error('yt-player-timeout')), 15000);
    const pl = Yt.player = new YT.Player(el, {
      host: ytHostFor(Yt.www), width: '100%', height: '100%', playerVars: vars,
      events: {
        onReady: () => {
          clearTimeout(timer);
          if (!mine()) { try { pl.destroy(); } catch {} rej(new Error('yt-player-old')); return; }
          Yt.ready = true; res(pl);
        },
        onStateChange: e => { if (mine()) ytOnState(e.data); },
        onError: e => { if (mine()) ytOnError(e.data); },
      },
    });
  })).catch(e => { if (Yt.playerP === p) { Yt.playerP = null; if (!Yt.ready) Yt.player = null; } throw e; });
  return p;
}
// 플레이어를 버리고 처음부터 (설정 "프리미엄 계정으로 틀기"를 바꿀 때, CR-251 ②).
// 지금 곡이 유튜브 곡이면: 재생 중이었으면 멈춘 뒤, 같은 자리에 멈춘 채로 다시 올린다 (자동 재생 안 함)
function ytRebuild() {
  const s = state.song, cur = ytSong(s);
  if (cur && (state.playing || Yt.wantPlay)) ytPause();
  const keep = cur && Yt.err == null ? state.offset : 0;
  const old = Yt.player;
  Yt.gen++;
  Object.assign(Yt, { player: null, ready: false, playerP: null, loaded: null, st: -1, pending: null, last: 0, raw: 0, rawAt: 0, lay: {} });
  try { if (old && typeof old.destroy === 'function') old.destroy(); } catch {}
  const host = $('#ytFrame'); if (host) host.textContent = '';
  if (cur) { ytSelect(s); state.offset = keep; Yt.last = keep; updateTransportUI(); }
  else ytFrame(true);
}
const ytOldErr = e => e?.message === 'yt-player-old';   // 다시 만들어서 버린 옛 플레이어 (오류 안내를 띄우지 않음)
function ytCall(fn, ...args) { try { return Yt.player && Yt.player[fn] ? Yt.player[fn](...args) : undefined; } catch { return undefined; } }
function ytCue(id) { Yt.loaded = id; Yt.st = 5; Yt.raw = 0; Yt.rawAt = 0; Yt.last = 0; Yt.pending = null; ytCall('cueVideoById', id); }

// 곡을 고를 때 (songs.js selectSong). s = 유튜브 곡 또는 null(다른 곡 → 영상 칸 숨김)
function ytSelect(s) {
  const stage = $('#stage');
  stage.classList.toggle('yt', !!s);
  const note = $('#ytNote'); if (note) note.hidden = !s;   // 키·녹음 단추는 제자리에 흐리게 + 한 줄 안내 (시안 T1c)
  for (const b of document.querySelectorAll('#tvRemote [data-act="mr-"], #tvRemote [data-act="mr+"]')) { b.classList.toggle('yt-off', !!s); b.setAttribute('aria-disabled', !!s); }
  // 못 튼 곡을 다시 고르면 다시 올린다 (CR-251: 같은 곡이라 안 올리면 오류가 다시 안 와서 안내가 사라지고 빈 플레이어만 남음)
  if (Yt.err != null) Yt.loaded = null;
  Yt.err = null; Yt.wantPlay = false; Yt.fresh = null; clearTimeout(Yt.blockTimer);
  ytShowTap(false); ytShowErr(null);
  if (s) {
    state.offset = 0; Yt.pending = null; Yt.last = 0;
    if (!navigator.onLine) ytShowErr('offline');
    else ytPlayer().then(() => { if (state.song === s && Yt.loaded !== s.ytId) ytCue(s.ytId); ytFrame(true); })
      .catch(e => { if (state.song === s && !ytOldErr(e)) ytShowErr('api'); });
  }
  updateTransportUI(); updateKeyUI();
  ytFrame(true);
}

/* ---------------- 위치·길이 (R3 층이 부름) ---------------- */
function ytRawTime() { const t = +ytCall('getCurrentTime'); return isFinite(t) ? t : 0; }
function ytDur() {
  const s = state.song;
  const d = ytApiReady() && Yt.loaded === s?.ytId ? +ytCall('getDuration') || 0 : 0;
  return d > 0 ? d : (s?.ytDur || 0);
}
function ytTime() {
  const s = state.song;
  if (!ytApiReady() || Yt.loaded !== s?.ytId || Yt.err || Yt.st === 5 || Yt.st === -1) return state.offset;
  const now = performance.now(), raw = ytRawTime();
  if (raw !== Yt.raw) { Yt.raw = raw; Yt.rawAt = now; }
  let t = raw;
  if (Yt.st === 1) t += Math.min(1, (now - Yt.rawAt) / 1000) * Yt.rate;   // 플레이어는 위치를 띄엄띄엄 알려 줘서 사이를 메운다
  if (Yt.pending) {   // 내가 옮긴 위치에 플레이어가 따라올 때까지는 옮긴 위치로
    const p = Yt.pending;
    if (Math.abs(raw - p.t) < 1.5 || now - p.at > 1500) Yt.pending = null;
    else t = p.t + (Yt.st === 1 ? (now - p.at) / 1000 * Yt.rate : 0);
  } else if (Yt.st === 1 && t < Yt.last && Yt.last - t < 0.3) t = Yt.last;   // 재생 중 작은 뒤로 감은 무시 (가사가 떨리지 않게)
  Yt.last = t;
  const d = ytDur();
  return clamp(t, 0, d || t);
}

/* ---------------- 조작 (R3 층이 부름) ---------------- */
async function ytPlay() {
  const s = state.song; if (!ytSong(s)) return;
  if (!navigator.onLine) { ytShowErr('offline'); toast('인터넷이 끊겨서 유튜브 곡을 틀 수 없어요'); return; }
  if (Yt.err != null && Yt.err !== 'offline' && Yt.err !== 'api') { flash('이 영상은 노래방에서 틀 수 없어요'); return; }
  if (state.playing) return;
  cancelNext(); if (typeof pStop === 'function') pStop(true); hideScore();
  ytShowErr(null); Yt.err = null;
  let p;
  try { p = await ytPlayer(); } catch (e) { if (state.song === s && !ytOldErr(e)) ytShowErr('api'); return; }
  if (state.song !== s || state.playing) return;
  if (Yt.loaded !== s.ytId) ytCue(s.ytId);
  const d = ytDur();
  if (d && state.offset >= d - 0.5) state.offset = 0;
  Yt.fresh = state.offset < 0.5;
  Yt.wantPlay = true;
  ytApplyRate();
  if (state.offset > 0.5 || ytRawTime() > 0.5) { Yt.pending = { t: state.offset, at: performance.now() }; Yt.last = state.offset; ytCall('seekTo', state.offset, true); }
  ytCall('playVideo');
  if (state.armed && !state.sync) toast('유튜브 곡은 녹음하지 않아요');
  clearTimeout(Yt.blockTimer);
  // 폰 크롬은 누르지 않은 재생(다음 곡 자동 시작)을 막을 수 있다 → 영상 밖에 큰 "눌러서 시작"
  Yt.blockTimer = setTimeout(() => { if (Yt.wantPlay && Yt.st !== 1 && state.song === s && Yt.err == null) ytShowTap(true); }, 2500);
  ytFrame(true);
}
function ytPause() {
  Yt.wantPlay = false; clearTimeout(Yt.blockTimer); ytShowTap(false);
  if (ytApiReady()) ytCall('pauseVideo');
  if (state.playing) { state.offset = ytTime(); state.playing = false; updateTransportUI(); }
  ytFrame(true);
}
// 곡 바꾸기·취소·끝: 멈추고 처음 그림으로 (stopPlayback·onFinish가 부름. 내 MR 곡에서는 할 일 없음)
function ytStop() {
  Yt.wantPlay = false; Yt.fresh = null; clearTimeout(Yt.blockTimer); ytShowTap(false);
  if (!ytApiReady() || !Yt.loaded) return;
  if (Yt.st !== 5 && Yt.st !== -1) { ytCall('pauseVideo'); ytCue(Yt.loaded); }
  Yt.pending = null; Yt.last = 0;
}
function ytSeek(t) {
  if (!ytApiReady() || Yt.loaded !== state.song?.ytId) return;
  if (Yt.st === 5 || Yt.st === -1) return;   // 아직 시작 전: 위치만 기억했다가 시작할 때 옮긴다 (ytPlay)
  Yt.pending = { t, at: performance.now() }; Yt.last = t;
  ytCall('seekTo', t, true);
}
// 싱크 편집의 느리게·빠르게 (유튜브는 0.25~2배)
function ytApplyRate() {
  const r = clamp(state.rate || 1, 0.25, 2);
  Yt.rate = r; ytCall('setPlaybackRate', r);
}

/* ---------------- 플레이어 알림 ---------------- */
function ytOnState(st) {
  Yt.st = st;
  const s = state.song;
  if (!ytSong(s) || Yt.loaded !== s.ytId) return;   // 다른 곡을 고른 뒤 늦게 온 알림
  if (st === 1) {
    clearTimeout(Yt.blockTimer); ytShowTap(false);
    ytNoteMeta(s);
    if (!state.playing) {
      const fresh = Yt.fresh != null ? Yt.fresh : ytRawTime() < 0.5;
      Yt.fresh = null; Yt.wantPlay = false;
      state.playing = true;
      if (fresh && !state.sync) {
        state.score = { frames: 0, voiced: 0, pitched: 0 }; countPlay(s);   // 점수는 마이크만 본다 (영상 소리를 쓰지 않음)
        if (!state.micOn) toast('마이크를 켜면 점수를 받을 수 있어요');
      }
      updateTransportUI();
      if (state.tv) pokeUI();
    }
  } else if (st === 2) {
    if (state.playing) { state.playing = false; state.offset = ytTime(); updateTransportUI(); }
  } else if (st === 0) {
    Yt.wantPlay = false;
    if (state.playing) onFinish();   // 점수·다음 예약곡 (playback.js)
  } else if (st === 5) {
    ytNoteMeta(s);
  }
  ytFrame(true);
}
const YT_ERR_WHY = {
  2: '영상 주소가 잘못됐어요', 5: '이 브라우저에서 틀 수 없는 영상이에요', 100: '지워졌거나 비공개인 영상이에요',
  101: '올린 사람이 다른 곳에서 틀지 못하게 막았어요', 150: '올린 사람이 다른 곳에서 틀지 못하게 막았어요',
  153: '유튜브가 이 화면 주소를 확인하지 못했어요',
};
function ytOnError(code) {
  const s = state.song;
  if (!ytSong(s)) return;
  const starting = state.playing || Yt.wantPlay;
  Yt.err = +code || code; Yt.wantPlay = false; Yt.fresh = null; clearTimeout(Yt.blockTimer); ytShowTap(false);
  state.playing = false; state.offset = 0; state.score = null;
  updateTransportUI();
  ytShowErr(Yt.err);
  // 바로 넘어가지 않고 안내를 보여 준 뒤 3초 뒤 다음 예약곡
  if (starting && !state.sync && state.queue.length) scheduleNext(3000);
  ytFrame(true);
}
// 플레이어가 아는 제목·길이를 곡에 적는다 (제목은 아직 "유튜브 영상 …"일 때만, 길이는 0.5초 넘게 다를 때만)
function ytNoteMeta(s) {
  if (!ytApiReady() || Yt.loaded !== s.ytId) return;
  let changed = false;
  const d = +ytCall('getDuration') || 0;
  const newDur = d > 0 && !(Math.abs(d - (s.ytDur || 0)) <= 0.5);
  if (newDur) { s.ytDur = Math.round(d * 10) / 10; changed = true; }
  const vd = ytCall('getVideoData') || {};
  if (s.title === ytPlaceholder(s.ytId) && vd.title) {
    const p = ytTitleParts(vd.title, vd.author);
    if (p.title) { s.title = p.title; if (!s.artist) s.artist = p.artist; changed = true; }
  }
  if (!changed) return;
  persistSong(s, true, true); ytRefreshSong(s);
  if (state.song === s && state.autoTimed) computeLines();
  if (newDur || changed) ytAutoLyrics(s);
}

/* ---------------- 안내: 재생 못 함 · 눌러서 시작 ---------------- */
function ytShowErr(code) {
  const box = $('#ytErr'); if (!box) return;
  Yt.errCode = code; Yt.errTv = !$('#tv').hidden;
  if (code == null) { box.hidden = true; ytFrame(true); return; }
  const s = state.song, id = s?.ytId;
  const head = code === 'offline' ? '인터넷이 끊겨서 유튜브 곡을 틀 수 없어요'
    : code === 'api' ? '유튜브 플레이어를 불러오지 못했어요' : '이 영상은 노래방에서 틀 수 없어요';
  const why = code === 'offline' ? '인터넷이 다시 되면 곡을 다시 골라 주세요'
    : code === 'api' ? '인터넷 연결을 확인하고 곡을 다시 골라 주세요' : (YT_ERR_WHY[code] || `유튜브 오류 (${code})`);
  $('#ytErrHead').textContent = head; $('#ytErrWhy').textContent = why;
  // 퍼가기를 막은 영상(101·150, CR-251 ①): 폰·PC는 큰 [유튜브 앱으로 열기], TV는 링크 대신 "TV 유튜브 앱에서 찾기" + QR.
  // 그 밖의 오류는 예전 그대로 작은 [유튜브에서 열기]
  const app = !!id && ytErrToApp(code), tv = Yt.errTv;
  const a = $('#ytErrLink'); a.hidden = code === 'offline' || !id || (app && tv); if (id) a.href = ytWatchUrl(id);
  a.classList.toggle('small', !app); a.classList.toggle('primary', app); a.classList.toggle('yt-err-app', app);
  if (app) a.innerHTML = '<span class="for-touch">유튜브 앱으로 열기</span><span class="for-keys">유튜브에서 열기</span>';
  else a.textContent = '유튜브에서 열기';
  $('#ytErrNote').hidden = !app;
  ytErrTvGuide(app && tv ? s : null);
  if (code === 'offline' || code === 'api') Yt.err = code;
  box.hidden = false;
  ytFrame(true);
}
// TV: 링크를 TV 브라우저로 여는 대신 "TV 유튜브 앱에서 이 곡 찾기" + 찾을 말(제목 가수 노래방) + 영상 링크 QR (폰으로 찍어 폰 유튜브 앱으로).
// QR은 앱 안 사본 toqr(guesthost.js guestQrMake)로 그린다 — 바깥에서 받지 않는다. 못 그리면 글만
function ytErrTvGuide(s) {
  const box = $('#ytErrTv'), img = $('#ytErrQr');
  box.hidden = !s; if (!s) return;
  const words = ytAppFindWords(s.title, s.artist);
  $('#ytErrTvHead').textContent = words ? 'TV 유튜브 앱에서 이 곡 찾기' : '폰 카메라로 QR을 찍어 주세요';
  $('#ytErrFindBox').hidden = !words; $('#ytErrFind').textContent = words;
  const tip = $('#ytErrQrTip'), id = s.ytId;
  const draw = () => {
    const q = Yt.qr && Yt.qr.id === id ? Yt.qr : null;
    img.hidden = !q; tip.hidden = !q;
    tip.textContent = words ? '또는 폰 카메라로 QR을 찍으면 폰 유튜브 앱에서 열려요' : '폰 유튜브 앱에서 이 영상이 열려요';
    img.style.removeProperty('--qr-px');
    if (!q) return;
    if (img.src !== q.src) img.src = q.src;
    const w = img.getBoundingClientRect().width;
    if (w > 0) img.style.setProperty('--qr-px', qrFitPx(w, q.px, 96) + 'px');   // 칸당 정수 px (흐리지 않게, 손님 QR과 같은 방법)
  };
  draw();
  if ((Yt.qr && Yt.qr.id === id) || typeof guestQrMake !== 'function') return;
  guestQrMake(ytWatchUrl(id)).then(q => {
    Yt.qr = { id, src: q.src, px: q.px };
    if (!box.hidden && state.song === s && Yt.errCode != null) { draw(); ytFrame(true); }
  }).catch(() => {});
}
// 큰 [유튜브 앱으로 열기]를 누르면 3초 뒤 다음 예약곡(V7)은 멈춘다: 유튜브 앱에서 부르는 동안 노래방이 뒤에서 다음 곡을 틀지 않게.
// 예약 목록은 그대로 (돌아와서 다음 곡·Enter로 이어 간다)
$('#ytErrLink').addEventListener('click', () => { if ($('#ytErrLink').classList.contains('yt-err-app')) cancelNext(); });
function ytShowTap(on) { const b = $('#ytTap'); if (b && b.hidden === on) { b.hidden = !on; ytFrame(true); } }
function ytTapStart() {
  ytShowTap(false);
  if (!ytSong()) return;
  Yt.wantPlay = true; ytCall('playVideo');
  clearTimeout(Yt.blockTimer);
  Yt.blockTimer = setTimeout(() => { if (Yt.wantPlay && Yt.st !== 1 && ytSong()) { ytShowTap(true); flash('영상 가운데 ▶를 눌러 주세요'); } }, 2500);
}

/* ---------------- 영상 칸 자리 잡기 ----------------
   플레이어(#ytBox)는 무대 밖(body 바로 아래)에 있다: TV 화면으로 무대를 옮겨도 iframe이 다시 불러와지지 않게.
   매번 무대·곡 머리줄·가사·TV 조작 막대의 자리를 보고, 그 사이 빈 곳에 16:9로 놓는다 → 노래방 요소가 영상 위에 겹치지 않는다.
   검색·예약 목록 같은 창이 열리면 무대를 둘로 나눈다 (넓으면 왼쪽 영상·오른쪽 창, 좁으면 위 영상·아래 창). */
const YT_SPLIT = ['#searchOv', '#queueOv', '#chartOv', '#mineOv', '#numPad', '#numBox'];
const YT_IDLE = ['#scoreOverlay', '#nextCard', '#tvIdle'];
const ytOpen = q => { const e = $(q); return !!e && !e.hidden; };
function ytFrame(force) {
  if (!force && state.frame % 3) return;
  const box = $('#ytBox'), stage = $('#stage'); if (!box || !stage) return;
  const s = state.song, yt = ytSong(s), tvOn = !$('#tv').hidden;
  ytBand(tvOn && yt);
  // TV 화면에 들어가거나 나오면 못 트는 영상 안내를 그 화면에 맞게 다시 (CR-251 ①: TV는 QR, 폰·PC는 큰 단추)
  if (Yt.errCode != null && Yt.errTv !== tvOn && !$('#ytErr').hidden) { ytShowErr(Yt.errCode); return; }
  stage.classList.toggle('yt-nolyr', yt && !(state.lines || []).some(l => String(l.text || '').trim()));
  if (yt && ytApiReady() && Yt.rate !== clamp(state.rate || 1, 0.25, 2)) ytApplyRate();   // 싱크 편집에서 바꾼 배속
  if (yt && !state.playing && Yt.st === 2 && !Yt.pending) state.offset = ytTime();   // 영상 안 단추로 위치를 옮겨도 따라감
  const active = state.playing || Yt.wantPlay || Yt.st === 3;
  const sr0 = stage.getBoundingClientRect(), narrow = sr0.width < 640, win = YT_SPLIT.some(ytOpen);
  // 폰(좁은 화면, TV 아님): 멈춰 있는 영상은 창을 열면 숨겨서 창이 무대를 다 쓴다.
  // 재생 중이면 위 영상 · 아래 창으로 나누고 무대가 창 높이만큼 길어진다 (yt-grow) → 창 머리·닫기가 영상 밑에 깔리지 않는다
  const phoneWin = narrow && !tvOn && win;
  const show = yt && ytApiReady() && Yt.loaded === s.ytId && Yt.err == null && (active || (!YT_IDLE.some(ytOpen) && !phoneWin));
  const split = show && win;
  stage.classList.toggle('yt-on', show);
  stage.classList.toggle('yt-split', split);
  stage.classList.toggle('yt-narrow', narrow);
  stage.classList.toggle('yt-grow', split && phoneWin);
  if (!show) { box.classList.add('off'); stage.classList.remove('yt-small'); return; }
  const sr = stage.getBoundingClientRect();
  const pad = Math.max(6, Math.round(sr.width * 0.012));
  const head = stage.querySelector('.song-head').getBoundingClientRect();
  let L = sr.left + pad, R = sr.right - pad, T = Math.max(sr.top + pad, head.bottom + pad), B;
  if (split && !narrow) { R = sr.left + sr.width / 2 - pad / 2; B = sr.bottom - pad; }
  else if (split) B = T + (R - L) * 9 / 16;
  else {
    const tap = $('#ytTap'), ly = stage.querySelector('.lyrics').getBoundingClientRect();
    B = ly.height ? ly.top - pad : sr.bottom - pad;   // TV 유튜브 띠에서 가사가 없으면 가사 칸을 접는다
    if (tap && !tap.hidden) B = Math.min(B, tap.getBoundingClientRect().top - pad);
  }
  if (tvOn) { const rm = $('#tvRemote').getBoundingClientRect(); if (rm.height) B = Math.min(B, rm.top - pad); }
  B = Math.min(B, sr.bottom - pad);
  let w = R - L, h = B - T;
  if (w / Math.max(1, h) > 16 / 9) w = h * 16 / 9; else h = w * 9 / 16;
  const small = h < 200 || w < 200;   // 약관: 플레이어는 200×200보다 작게 줄이지 않는다 → 모자라면 가사를 숨기고 키운다
  stage.classList.toggle('yt-small', small);
  if (small) { h = Math.max(200, h); w = Math.min(Math.max(w, h * 16 / 9, 200), sr.width - 2 * pad); h = Math.max(200, Math.min(h, w * 9 / 16 + 1)); }
  const x = Math.round(L + (R - L - w) / 2), y = Math.round(T);
  const ox = tvOn ? 0 : scrollX, oy = tvOn ? 0 : scrollY;
  const lay = { pos: tvOn ? 'fixed' : 'absolute', l: x + ox, t: y + oy, w: Math.round(w), h: Math.round(h) };
  const o = Yt.lay;
  if (o.pos !== lay.pos || o.l !== lay.l || o.t !== lay.t || o.w !== lay.w || o.h !== lay.h) {
    Object.assign(box.style, { position: lay.pos, left: lay.l + 'px', top: lay.t + 'px', width: lay.w + 'px', height: lay.h + 'px' });
    Yt.lay = lay;
  }
  // 무대 안 요소가 쓸 선: 영상 아래(--yt-below), 좁은 화면 나누기에서 창이 시작할 곳(--yt-cut)
  const below = Math.round(y + lay.h - sr.top + pad / 2);
  if (stage._ytBelow !== below) { stage._ytBelow = below; stage.style.setProperty('--yt-below', below + 'px'); stage.style.setProperty('--yt-cut', below + 'px'); }
  box.classList.remove('off');
}
addEventListener('resize', () => ytFrame(true));
addEventListener('scroll', () => ytFrame(true), { passive: true });
// 화면이 숨으면 멈춘다 (유튜브 곡은 백그라운드 재생을 하지 않음)
document.addEventListener('visibilitychange', () => { if (document.hidden && ytSong() && (state.playing || Yt.wantPlay)) ytPause(); });
addEventListener('online', () => { if (ytSong() && Yt.err === 'offline') ytSelect(state.song); });
addEventListener('offline', () => { if (ytSong() && !state.playing) ytShowErr('offline'); });

/* ---------------- TV 유튜브 띠 (시안 T1) ----------------
   유튜브 곡이 TV 화면에 있으면 #tv에 yt-mode: 영상은 위 칸(무대)에만, 아래 68px 띠에 [곡 검색 S] [예약 목록 L] [일시정지 Space] [⏭ 다음 곡 N] [나가기 T].
   띠는 숨지 않고 영상 위에 겹치지 않는다. 안 되는 키(키·녹음·반주)의 안내는 무대 가운데 대신 띠 안에 3초 */
const ytBandNoteEl = el('span', 'yt-band-note', '');
ytBandNoteEl.setAttribute('role', 'status');
$('#ytBand').append(ytBandNoteEl);
function ytBand(on) {
  const tv = $('#tv'); if (!tv) return;
  if (tv.classList.contains('yt-mode') !== on) {
    tv.classList.toggle('yt-mode', on);
    if (!on) { $('#ytBand').classList.remove('note'); clearTimeout(Yt.bandNote); }
    if (typeof updateBarSpace === 'function') updateBarSpace();
  }
  tv.classList.toggle('yt-playing', on && (state.playing || Yt.wantPlay));
  if (!on) return;
  const s = state.song, nx = state.queue.length ? songById(state.queue[0]) : null;
  const t = s ? `${s.no} ${s.title}` : '', n = nx ? `· 다음 ${nx.no} ${nx.title}` : '· 다음 예약곡 없음';
  if ($('#ytBandTitle').textContent !== t) $('#ytBandTitle').textContent = t;
  if ($('#ytBandNext').textContent !== n) $('#ytBandNext').textContent = n;
}
const ytBandOn = () => !$('#tv').hidden && $('#tv').classList.contains('yt-mode');
function ytBandNote(text, ms) {
  ytBandNoteEl.textContent = text; $('#ytBand').classList.add('note');
  clearTimeout(Yt.bandNote); Yt.bandNote = setTimeout(() => $('#ytBand').classList.remove('note'), Math.max(3000, ms || 0));
}
// 무대 가운데 알림(karaoke.js flash)은 영상 위에 뜨므로, TV 유튜브 띠가 있으면 띠 안으로 보낸다.
// 아래 알림(util.js toast)도 띠가 있으면 띠 안으로 (띠 왼쪽 제목 위에 겹치거나 영상 위로 올라가지 않게)
const ytFlash0 = flash, ytToast0 = toast;
flash = function (text, ms) { if (ytBandOn()) { ytBandNote(text); return; } return ytFlash0(text, ms); };
toast = function (msg, ms) { if (ytBandOn()) { $('#toast').hidden = true; ytBandNote(msg, ms); return; } return ytToast0(msg, ms); };
// TV 화면에서 영상(iframe)을 누르면 키보드가 영상 쪽으로 가서 노래방 키가 안 먹는다 → 노래방 쪽으로 돌려 둔다
addEventListener('blur', () => setTimeout(() => {
  const a = document.activeElement;
  if (state.tv && a && a.tagName === 'IFRAME' && $('#ytBox').contains(a)) { try { a.blur(); window.focus(); } catch {} }
}, 0));

/* ---------------- 유튜브 곡 넣기 ---------------- */
// 곡 이름이 바뀌면 보이는 곳을 모두 다시 그린다
function ytRefreshSong(s) {
  renderSongs(); renderQueue();
  if (typeof renderMine === 'function') renderMine();
  if (state.song === s) {
    $('#songTtl').innerHTML = ''; $('#songTtl').append(s.title, Object.assign(document.createElement('small'), { textContent: s.artist || '' }));
    $('#cardTitle').textContent = s.title; $('#cardArtist').textContent = s.artist || '';
  }
  if (ytTabOn()) renderYtTab();
}
// id = 영상 번호, meta = { title, channel } (검색 결과·공유 제목). 같은 영상이 있으면 그 곡을 쓴다
async function ytAdd(id, meta = {}, { reserveIt = false, top = false } = {}) {
  let s = findYtSong(state.songs, id);
  if (s) { if (!reserveIt) toast(`이미 곡 목록에 있어요 · ${s.no}번 '${s.title}'`); }
  else {
    const p = ytTitleParts(meta.title || '', meta.channel || '');
    s = { id: uid(), no: nextSongNumbers(state.songs, 1)[0], source: 'yt', ytId: id, title: p.title || ytPlaceholder(id), artist: p.artist || '',
      lyrics: '', lyricOffset: 0, createdAt: Date.now() };
    if (meta.title) Yt.meta.set(id, { title: meta.title, channel: meta.channel || '' });
    await persistSong(s);
    state.songs.push(s); renderSongs();
    if (!reserveIt) toast(`${s.no}번 '${s.title}' 추가됨 (유튜브)`);   // 예약하면 예약 알림 하나만
    ytAutoLyrics(s);
  }
  if (reserveIt) reserve(s, top);
  if (ytTabOn()) renderYtTab();
  return s;
}
// 제목을 모르고 넣은 곡("유튜브 영상 …")은 곡을 고를 때 플레이어가 알려 주는 제목으로 채운다 (ytNoteMeta). 바깥 접속을 더하지 않는다
// 싱크 가사 자동: LRCLIB에 제목·가수만 보내고, 확실할 때만(싱크·제목·가수·길이 3초 안, core.js chooseLyrics) 넣는다.
// 길이를 모르면 한 번 보고, 영상 길이를 알게 되면 한 번 더 본다
async function ytAutoLyrics(s) {
  if (!isYtSong(s) || String(s.lyrics || '').trim() || s.title === ytPlaceholder(s.ytId) || !navigator.onLine) return;
  const tried = Yt.lyrTried.get(s.id), withDur = !!s.ytDur;
  if (tried === 'dur' || tried === 'busy' || (tried === 'nodur' && !withDur)) return;
  Yt.lyrTried.set(s.id, 'busy');
  try {
    const found = await findLyrics(s.title, s.artist || '', () => {});
    Yt.lyrTried.set(s.id, withDur ? 'dur' : 'nodur');
    if (String(s.lyrics || '').trim()) return;
    const c = chooseLyrics(found, { title: s.title, artist: s.artist || '', mrDur: s.ytDur || null });
    if (!c.auto) { if (!withDur && s.ytDur) ytAutoLyrics(s); return; }
    s.lyrics = c.auto.syncedLyrics; s.lyricOffset = 0;
    if (c.swapped) { s.title = c.title; s.artist = c.artist; }
    await persistSong(s); ytRefreshSong(s);
    if (state.song === s) { computeLines(); updateLyrOffUI(); }
    toast(`'${s.title}' 시각 붙은 가사를 넣었어요 (LRCLIB)`);
  } catch { Yt.lyrTried.set(s.id, withDur ? 'dur' : 'nodur'); }
}

/* ---------------- 검색 창의 [유튜브 노래방 검색] 탭 ---------------- */
const ytTabOn = () => Yt.tab === 'yt' && !$('#searchOv').hidden;
const looksLikeLink = q => /^(https?:\/\/|www\.)|\.(com|be|net|kr|org)(\/|$)/i.test(q);
function ytSetTab(tab, quiet) {
  Yt.tab = tab === 'yt' ? 'yt' : 'mr'; Yt.sel = 0;
  const yt = Yt.tab === 'yt';
  for (const [b, on] of [[$('#searchTabMr'), !yt], [$('#searchTabYt'), yt]]) if (b) { b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }
  const inp = $('#searchInput');
  inp.placeholder = yt ? (ytHasKey() ? '노래 제목 · 가수, 또는 유튜브 링크' : '유튜브 링크 붙여넣기 (youtu.be/…)') : '제목·가수·번호, 초성(ㅂㅍㅈ)으로 찾기';
  inp.setAttribute('aria-label', yt ? '유튜브 노래방 검색' : '곡 검색');
  ytHint();
  const foot = $('#searchFoot'); if (foot) foot.hidden = yt;
  const yfoot = $('#searchFootYt'); if (yfoot) yfoot.hidden = !yt;
  if (!yt && typeof ytListClose === 'function') ytListClose();   // 재생목록 카드·읽는 플레이어는 유튜브 탭에서만 (CR-244)
  if (!quiet) { runSearch(); inp.focus(); }
}
function ytHint() {
  const hint = $('#searchHint'); if (!hint) return;
  hint.textContent = Yt.tab !== 'yt' ? '제목·가수·번호, 초성(ㅂㅍㅈ)으로도 찾아요'
    : ytHasKey() ? '유튜브 결과 · 검색어 뒤에 ‘노래방’을 붙여 찾아요' : '링크를 붙이거나 [공유] → 노래방으로 넣어요';
}
// 결과 한 줄: 썸네일(열쇠 검색일 때만, 128×72) · 제목 두 줄 · 채널 · [예약](보조 단추)
function ytRow(idx, title, sub, sel, acts, thumb) {
  const li = document.createElement('li'); li.className = 'ov-row yt-row' + (sel ? ' sel' : '') + (thumb ? ' has-thumb' : '');
  li.innerHTML = '<span class="idx"></span><span class="no"></span><span class="nm"><span class="yt-t"></span><small></small></span><span class="acts"></span>';
  li.querySelector('.idx').textContent = idx;
  if (thumb) { const im = el('img', 'yt-thumb', ''); im.src = thumb; im.alt = ''; im.loading = 'lazy'; im.width = 128; im.height = 72; im.referrerPolicy = 'no-referrer'; li.querySelector('.no').append(im); }
  else li.querySelector('.no').append(el('span', 'ytag', '유튜브'));
  li.querySelector('.yt-t').textContent = title; li.querySelector('small').textContent = sub || '';
  for (const [txt, cls, fn] of acts) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + cls; b.textContent = txt;
    b.onclick = e => { e.stopPropagation(); fn(); }; li.querySelector('.acts').append(b);
  }
  return li;
}
function ytOpenSearch(q) {
  const url = ytResultsUrl(q);
  window.open(url, '_blank', 'noopener');
  toast('유튜브에서 영상을 고른 뒤 [공유] → 노래방, 또는 링크를 복사해 여기에 붙여 넣으세요', 6000);
}
// 안내 카드 (시안 S1): 굵은 제목 · 줄들 · 작은 글 · 단추
function ytCard(ul, cls, head, lines = [], btns = [], small = '') {
  const li = el('li', 'yt-card ' + (cls || ''), '');
  if (head) li.append(el('b', 'yt-card-h', head));
  for (const t of lines) li.append(el('span', 'yt-card-l', t));
  if (small) li.append(el('small', 'yt-card-s', small));
  if (btns.length) {
    const row = el('div', 'yt-guide-btns', '');
    for (const [txt, c, fn, id] of btns) { const b = el('button', 'btn ' + c, txt); b.type = 'button'; if (id) b.id = id; b.onclick = e => { e.stopPropagation(); fn(); }; row.append(b); }
    li.append(row);
  }
  ul.append(li); return li;
}
const ytInfo = (ul, text, btns) => ytCard(ul, 'yt-info-line', '', [text], btns);
const YT_NOKEY = '유튜브 검색 열쇠가 없어서 여기서 제목으로 찾기는 안 돼요. 제목을 치면 [유튜브에서 열어 찾기]로 유튜브 앱·사이트에서 찾아요';
function ytShareCard(ul) {
  ytCard(ul, 'yt-c-share', '폰 유튜브 앱에서 [공유] → 노래방',
    ['① 유튜브 앱에서 노래방 영상을 열어요', '② [공유]를 눌러요', '③ 목록에서 ‘노래방’을 골라요'], [], '노래방을 폰 홈 화면에 설치했을 때만 목록에 나와요');
}
/* 재생목록 링크 (CR-244, js/ytlist.js): 링크에 list=가 있으면 미리 보기 카드 → [곡 목록에 다 넣기]. 예약은 안 한다.
   영상 링크에 목록이 붙어 있으면(watch?v=…&list=…) 영상 줄은 그대로 두고 그 아래에 카드. 영상 링크에 붙은 자동 믹스·내 목록은 카드 없이 영상만 */
let ytListWant = null;   // 다시 그린 뒤 카드 안에서 둘 곳 ('sw'·'add'·'retry')
const ytListCardEl = () => $('#searchList .yt-c-list');
function ytListRedraw(focus) { if (!ytTabOn()) return; ytListWant = focus || null; renderYtTab(); }
function ytListShow(ul, lst, focus) {
  if (!lst.ok) return ytListCard(ul, ytListView({ phase: 'bad', why: lst.why }), { onExit: () => $('#searchInput').focus() });
  // 목록 플레이어 칸은 #searchList 바로 뒤 (목록을 다시 그려도 iframe이 안 지워짐). 읽을 때만 생기고 다 읽으면 없어진다
  const st = ytListOpen(lst.id, { box: () => ytListBox($('#searchList')), host: ytHostFor(Yt.www), onChange: () => ytListRedraw() });
  const live = st.phase === 'ready' || st.phase === 'adding';
  return ytListCard(ul, ytListView({ ...st, plan: live ? ytListPlanOf(st) : null }), {
    onToggle: on => { if (YtList.st === st) st.includeBlocked = on; ytListRedraw('sw'); },
    onAct: a => {
      if (a === 'add') ytListCommit(() => ytListRedraw('add'));
      else { ytListOpen(lst.id, { box: () => ytListBox($('#searchList')), host: ytHostFor(Yt.www), onChange: () => ytListRedraw(), retry: true }); ytListRedraw(); }
    },
    onExit: () => $('#searchInput').focus(),
    focus,
  });
}
function renderYtTab() {
  const ul = $('#searchList'), inp = $('#searchInput'), q = inp.value.trim();
  const ae = document.activeElement, inCard = !!ae && ae !== inp && ul.contains(ae) && !!ae.closest('.yt-c-list');
  const fk = ytListWant || (inCard ? ae.dataset.k || null : null); ytListWant = null;
  ul.textContent = '';
  Yt.rows = []; ytHint();
  const key = ytHasKey(), id = parseYouTubeId(q);
  const lst = typeof parseYouTubeListId === 'function' ? parseYouTubeListId(q) : null;
  const showList = !!lst && (!id || lst.ok);
  if (!(showList && lst.ok) && typeof ytListClose === 'function' && YtList.st) ytListClose();
  const listCard = () => {
    const li = ytListShow(ul, lst, fk);
    if (fk && li && !li.contains(document.activeElement)) { if (!ytListFocus(li)) inp.focus(); }   // 막힌 단추(넣는 중·다 넣음)에 있었으면 카드 첫 칸이나 검색 칸으로
    return li;
  };
  if (showList && !id) { listCard(); return; }
  if (id) {
    const have = findYtSong(state.songs, id), m = Yt.meta.get(id);
    if (have) Yt.rows.push({ song: have, act: top => reserve(have, top) });
    else Yt.rows.push({ id, title: m?.title || '유튜브 영상 1개', channel: m?.channel || '제목은 재생할 때 보여요', link: true, act: top => ytAdd(id, m || {}, { reserveIt: true, top }) });
  } else if (q && looksLikeLink(q)) {
    ytCard(ul, 'yt-c-bad', '유튜브 링크가 아니에요', ['youtu.be/… 나 youtube.com/watch?v=… 링크를 붙여 넣어 주세요']);
    return;
  } else if (q) {
    const query = ytSearchQuery(q), list = key ? Yt.cache.get(query) : null;
    if (list) for (const r of list) {
      const have = findYtSong(state.songs, r.id);
      Yt.rows.push(have ? { song: have, act: top => reserve(have, top) } : { ...r, act: top => ytAdd(r.id, r, { reserveIt: true, top }) });
    }
    if (!list) {
      const open = ['유튜브에서 열어 찾기', '', () => ytOpenSearch(q), 'ytOpenBtn'];
      if (key) {
        if (Yt.busy === query) ytCard(ul, 'yt-c-busy', '유튜브에서 찾는 중…', [`‘${query}’`]);
        else ytCard(ul, 'yt-c-find', `‘${query}’ 유튜브에서 찾기`, [Yt.searchErr || 'Enter 또는 [찾기]를 누르면 여기에 결과가 나와요'],
          [['찾기', '', () => ytKeySearch(q), 'ytFindBtn'], ['유튜브에서 열어 찾기', 'ghost', () => ytOpenSearch(q), 'ytOpenBtn']]);
      } else {
        ytCard(ul, 'yt-c-open', `‘${query}’ 유튜브에서 찾기`, ['유튜브에서 영상을 고른 뒤 [공유] → 노래방, 또는 링크를 복사해 위 칸에 붙여 넣어요'], [open]);
        ytInfo(ul, Yt.keyBlocked ? '유튜브 검색 한도가 찼어요 · 링크·[공유]로는 그대로 넣을 수 있어요' : YT_NOKEY);
      }
      return;
    }
    if (!list.length) { ytCard(ul, 'yt-c-none', '유튜브에서 찾은 영상이 없어요', ['다른 말로 찾거나 링크를 붙여 넣어 주세요'], [['유튜브에서 열어 찾기', '', () => ytOpenSearch(q), 'ytOpenBtn']]); return; }
  } else {
    if (state.tv && !key) {
      // TV: 손님 폰으로 보내기(QR)는 CR-228 → 자리만 남겨 둔다
      ytCard(ul, 'yt-c-tv', '유튜브 곡은 폰으로 보내 주세요', ['폰 유튜브 앱에서 [공유] → 노래방으로 넣어요', '키보드가 있으면 위 칸에 유튜브 링크를 붙여 넣어 예약해요']);
      ul.append(el('li', 'yt-qr-slot', ''));
      return;
    }
    if (key) ytCard(ul, 'yt-c-type', '노래 제목·가수를 쳐 보세요', ['검색어 뒤에 ‘노래방’을 붙여 유튜브에서 찾아요 · 링크를 붙여 넣어도 돼요']);
    else ytCard(ul, 'yt-c-link', '유튜브 링크 붙여넣기', ['위 칸에 유튜브 링크(youtu.be/… · youtube.com/watch?v=…)를 붙여 넣으면 바로 예약할 수 있어요']);
    ytShareCard(ul);
    if (!key) ytInfo(ul, Yt.keyBlocked ? '유튜브 검색 한도가 찼어요 · 링크·[공유]로는 그대로 넣을 수 있어요' : YT_NOKEY);
    return;
  }
  Yt.sel = clamp(Yt.sel, 0, Math.max(0, Yt.rows.length - 1));
  Yt.rows.forEach((r, i) => {
    let li;
    if (r.song) li = songRow(r.song, i + 1, i === Yt.sel, [[isFav(r.song) ? '♥' : '♡', 'ghost', () => toggleFav(r.song)], ['우선', '', () => r.act(true), '우선예약'], ['예약', '', () => r.act(false)]], '곡 목록에 있음');
    else if (r.link) li = ytRow(i + 1, r.title, r.channel, i === Yt.sel, [['예약하기', 'primary', () => r.act(false)], ['곡 목록에만', 'ghost', () => ytAdd(r.id, Yt.meta.get(r.id) || {})]]);
    else li = ytRow(i + 1, r.title, r.channel, i === Yt.sel, [['예약', '', () => r.act(false)]], r.thumb);
    li.onclick = () => { Yt.sel = i; renderYtTab(); $('#searchInput').focus(); };
    li.ondblclick = () => r.act(false);
    ul.append(li);
  });
  if (showList) listCard();
  if (key && !id) ytInfo(ul, '유튜브 검색은 하루 한도가 있어요', [['링크로 넣기', 'ghost', () => { inp.value = ''; renderYtTab(); inp.focus(); toast('위 칸에 유튜브 링크를 붙여 넣어 주세요'); }, 'ytLinkBtn']]);
  ul.children[Yt.sel]?.scrollIntoView({ block: 'nearest' });
}
// 검색 칸의 키 (karaoke.js가 유튜브 탭일 때 먼저 부름). 처리했으면 true
function ytSearchKey(e) {
  const inp = $('#searchInput'), q = inp.value.trim();
  const card = ytListCardEl();
  if (e.key === 'ArrowDown' && card && (!Yt.rows.length || Yt.sel >= Yt.rows.length - 1) && ytListFocus(card)) { e.preventDefault(); return true; }   // 재생목록 카드로
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!Yt.rows.length) return false;
    e.preventDefault(); Yt.sel = clamp(Yt.sel + (e.key === 'ArrowDown' ? 1 : -1), 0, Yt.rows.length - 1); renderYtTab(); return true;
  }
  if (e.key !== 'Enter') return false;
  e.preventDefault();
  const r = Yt.rows[Yt.sel];
  if (r) { r.act(e.shiftKey); return true; }
  if (card) { const b = [...card.querySelectorAll('button')].find(x => !x.disabled); if (b) b.focus(); else ytListFocus(card); return true; }   // 바로 넣지 않고 [곡 목록에 다 넣기]로
  if (!q || looksLikeLink(q)) return true;
  if (ytHasKey()) ytKeySearch(q); else ytOpenSearch(q);
  return true;
}
// 열쇠 검색 (YouTube Data API search.list). 같은 검색어는 이 화면 동안 다시 부르지 않는다. 한도 초과(403)면 열쇠 없는 길로
async function ytKeySearch(q) {
  const key = ytKeyValue(), query = ytSearchQuery(q);
  if (!key || Yt.keyBlocked || !query || Yt.busy) return;
  if (Yt.cache.has(query)) { renderYtTab(); return; }
  if (!navigator.onLine) { Yt.searchErr = '인터넷이 끊겨 있어요'; renderYtTab(); return; }
  Yt.busy = query; Yt.searchErr = null; Yt.sel = 0; renderYtTab();
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const url = 'https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '10', q: query, key });
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer-when-downgrade' });
    if (res.status === 403 || res.status === 400 || res.status === 429) { Yt.keyBlocked = true; toast('유튜브 검색 한도가 찼어요 · 링크·[공유]로 넣어 주세요'); }
    else if (!res.ok) Yt.searchErr = `유튜브 검색 오류(${res.status})예요. 잠시 후 다시 찾거나 [유튜브에서 열어 찾기]`;
    else {
      const j = await res.json();
      let list = parseYtSearch(j);
      // 금영 공식 채널 영상을 앞으로 (순서만, 빼는 것 없음. TJ·그 밖은 받은 순서 그대로) — CR-244 ②
      if (typeof ytRankOfficial === 'function' && typeof ytWithChannelIds === 'function') list = ytRankOfficial(ytWithChannelIds(list, j));
      Yt.cache.set(query, list);
    }
  } catch { Yt.searchErr = '유튜브 검색이 안 됐어요. 잠시 후 다시 찾거나 [유튜브에서 열어 찾기]'; }
  finally { clearTimeout(timer); Yt.busy = null; if (ytTabOn()) renderYtTab(); }
}

/* ---------------- 폰 유튜브 앱 [공유] → 노래방 (manifest share_target) ---------------- */
// 시작할 때 main.js가 부른다. 주소줄의 ?title=&text=&url=은 바로 지운다 (?tv=1 같은 다른 칸은 그대로)
function ytHandleShare() {
  const sp = shareParams(location.search);
  if (!sp) return;
  const raw = new URLSearchParams(location.search);
  try { history.replaceState(history.state, '', location.pathname + stripShareParams(location.search) + location.hash); } catch {}
  if (!sp.id) {
    // 재생목록 공유 (CR-244): 유튜브 탭을 열고 검색 칸에 목록 링크(si= 같은 꼬리는 뺌) → 미리 보기 카드
    const lst = typeof parseYouTubeListId === 'function' ? ['url', 'text', 'title'].map(k => parseYouTubeListId(raw.get(k) || '')).find(Boolean) : null;
    if (lst && typeof openSearch === 'function') {
      openSearch('yt');
      if (!$('#searchOv').hidden) { $('#searchInput').value = 'https://www.youtube.com/playlist?list=' + encodeURIComponent(lst.id); renderYtTab(); return; }
    }
    toast('유튜브 링크가 아니에요'); return;
  }
  Yt.share = sp;
  const have = findYtSong(state.songs, sp.id), p = ytTitleParts(sp.title, '');
  $('#ytShareTitle').textContent = have ? `${have.no}번 ${have.title}` : (p.title ? p.title + (p.artist ? ' · ' + p.artist : '') : ytPlaceholder(sp.id));
  $('#ytShareHint').textContent = have ? '이미 곡 목록에 있는 영상이에요' : '유튜브 곡으로 곡 목록에 넣어요';
  $('#ytShareList').hidden = !!have;
  $('#ytShareDialog').showModal();
  $('#ytShareReserve').focus();
}
$('#ytShareReserve').onclick = () => { const sp = Yt.share; $('#ytShareDialog').close(); if (sp) ytAdd(sp.id, { title: sp.title }, { reserveIt: true }); };
$('#ytShareList').onclick = () => { const sp = Yt.share; $('#ytShareDialog').close(); if (sp) ytAdd(sp.id, { title: sp.title }); };
$('#ytShareClose').onclick = () => $('#ytShareDialog').close();
$('#ytTap').onclick = ytTapStart;
$('#searchTabMr').onclick = () => ytSetTab('mr');
$('#searchTabYt').onclick = () => ytSetTab('yt');
$('#ytAddBtn').onclick = () => { if (typeof openSearch === 'function') openSearch('yt'); };
addEventListener('online', () => { if (typeof YtList === 'object' && YtList.st && YtList.st.kind === 'offline') ytListRedraw(); });   // 끊겼던 재생목록 카드를 다시 읽기

/* ---------------- 설정 › 더 보기 (고급) › 유튜브 곡 › 프리미엄 계정으로 틀기 (이 기기만, CR-251 ②) ----------------
   켜면 이 기기에서만 플레이어 host를 www.youtube.com으로 바꾸고 플레이어를 다시 만든다 (그 브라우저의 유튜브 로그인 쿠키를 씀 →
   프리미엄 계정이면 광고가 안 나올 수 있음. 효과는 유튜브가 정한다). 끄면 youtube-nocookie로 되돌린다.
   값은 이 기기 nb-yt-www에만: 백업 파일(backup.js는 localStorage를 담지 않음)·Drive·허브·손님 폰에 안 간다 */
function ytWwwUI() {
  const c = $('#ytWww'); if (c) c.checked = Yt.www;
  const sub = $('#ytWwwSub'); if (sub) sub.textContent = Yt.www ? '켜짐 · 이 브라우저의 유튜브 로그인으로 틀어요' : '꺼짐 · 로그인 정보를 쓰지 않는 기본 플레이어';
}
function ytSetWww(on) {
  on = !!on;
  if (on === Yt.www) { ytWwwUI(); return; }
  Yt.www = on; lsSet(YT_WWW_KEY, on ? '1' : null);
  ytWwwUI();
  ytRebuild();
  toast(on ? '유튜브 로그인 정보(쿠키)를 써요. 광고가 그대로면 끄세요' : '유튜브 기본 플레이어로 돌아왔어요 (로그인 정보를 안 써요)', 5000);
}
$('#ytWww').onchange = e => ytSetWww(e.target.checked);
ytWwwUI();
