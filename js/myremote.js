// YT 노래방 · 내 폰 리모컨 (PC 쪽, CR-228 ③): 예나 계정으로 로그인한 폰이 다른 와이파이에서도 이 화면을 조작한다
'use strict';
// 허브 Realtime 공개 broadcast 채널 하나. 손님 방(guesthost.js)과 따로: 방 이름 'nbm-' + 256비트 난수(core.js myRoomName),
// 폰 → PC 이벤트 'p', PC → 폰 이벤트 'm'. 방 이름은 허브 열쇠 칸 remote_room(0008 hub_secret_set)에만 넣는다 — 예나 계정만 읽는다.
// 켤 때마다 새 이름 → 채널에 붙어 듣고 → 열쇠 칸에 씀. 끄면 "닫힘"을 보내고 칸을 비운다. 이 화면을 닫으면 방도 끝난다.
// 명령은 옛 폰 리모컨과 같은 16가지를 remote.js remoteRun이 그대로 실행한다 (먼저 core.js myMsgOk로 모양, 여기서 곡·사용자가 있는지).
// 상태는 remote.js remoteState() 그대로 (폰 remote.html이 이미 읽는 모양). 곡 목록은 바뀔 때만 조각으로 보낸다.
// 방 이름·허브 주소·키·계정은 콘솔·기록·화면 글에 찍지 않는다. 폰 화면은 remote.html + js/myphone.js.
// 지키는 것: 폰 4대까지 · 한 대 1초 8개 · 방 전체 1초 20개 · 4KB 넘는 메시지 버림 · 모르는 종류·명령 버림.

const MY_LS = 'nb-myremote';          // '1' = 켜 둠 (이 기기 설정, 처음엔 꺼짐). 다음에 열 때도 로그인해 있으면 새 방으로 다시 켠다
const MY_SEEN_MS = 60000;             // 폰은 20초마다 hello. 60초 소식이 없으면 나간 것으로 셈
const MY_EVERY_MS = 10000;            // 상태가 안 바뀌어도 10초마다 (폰은 30초 소식이 없으면 끊김으로 봄)
const MY_SLOT_MS = 60000;             // 1분마다 열쇠 칸이 아직 이 방인지 본다 (다른 노래방 화면에서 켜면 여기는 끈다)
const MY_SONGS_GAP_MS = 2000;         // 곡 목록 다시 보내기는 2초에 한 번까지
const MY_PART_GAP_MS = 150;           // 곡 목록 조각 사이
// TV 대기 화면 내 폰 리모컨 QR 글 (CR-228 ④ L6, 기본 길). 디자인실이 다듬는 곳은 여기 한 곳.
// old = 옛 길(같은 와이파이 server.py 리모컨)로 가는 방법 한 줄 (팀장 11-24)
const MY_TV_TEXT = {
  title: '내 폰 리모컨',
  line: '허브에 로그인한 내 폰으로 찍어요',
  old: "안 되면: PC에서 'YT 노래방 켜기'로 열면 같은 와이파이 옛 리모컨 QR이 나와요",
  alt: '내 폰 리모컨 QR 코드',
};

const My = {
  on: false, busy: false, want: lsGet(MY_LS) === '1', sb: null, ch: null, room: null,
  phones: new Map(),      // 폰 표 → { rate: [시각…], seen }
  all: [], tick: 0, slotAt: 0, last: '', lastAt: 0, songSig: '', songsAt: 0, sending: 0, note: '', bad: false, shown: false,
  gen: 0,                 // 끌 때마다 +1 (여는 중에 끄거나 로그아웃하면 그 방은 열지 않는다)
};

/* ---------------- 열쇠 칸 (허브 0008 hub_secret · hub_secret_set, 이름 remote_room) ---------------- */
async function mySlotSet(sb, value) {
  try { const r = await sb.rpc('hub_secret_set', { p_app: HUB_APP, p_name: MY_HUB_NAME, p_value: value }); return !!r && !r.error; } catch { return false; }
}
async function mySlotGet(sb) {
  try { const r = await sb.rpc('hub_secret', { p_app: HUB_APP, p_name: MY_HUB_NAME }); return r && !r.error ? { ok: true, value: typeof r.data === 'string' ? r.data : null } : { ok: false }; } catch { return { ok: false }; }
}
const myLoggedIn = async () => typeof hubOn === 'function' && hubOn() && !!(await hubSession());

/* ---------------- 켜기·끄기 ---------------- */
async function myOpen() {
  if (My.busy) return false;
  My.busy = true; myNote(''); myRender();
  const sb = (await myLoggedIn()) ? hubClient() : null;
  if (!sb) { My.busy = false; myNote('허브에 먼저 로그인해 주세요 · 설정 › 허브 연결', true); myRender(); return false; }
  if (My.on) await myClose(true, true);
  const gen = My.gen, live = () => gen === My.gen && Hub.sb === sb;
  const room = myRoomName();
  const ch = sb.channel(room, { config: { broadcast: { self: false, ack: false } } });
  ch.on('broadcast', { event: 'p' }, m => { try { myOnMsg(m && m.payload); } catch (e) { console.warn('내 폰 메시지 처리 실패', e && e.message); } });
  // 먼저 붙어서 듣고, 그다음 열쇠 칸에 쓴다 (폰이 이름을 읽었을 때 이 화면이 이미 듣고 있게)
  const ok = await new Promise(res => {
    const t = setTimeout(() => res(false), 15000);
    ch.subscribe(st => {
      if (st === 'SUBSCRIBED') { clearTimeout(t); res(true); }
      else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { clearTimeout(t); res(false); }
    });
  });
  const put = ok && live() && (await mySlotSet(sb, room));
  if (!put || !live()) {
    try { await sb.removeChannel(ch); } catch {}
    if (put) { const cur = await mySlotGet(sb); if (cur.ok && cur.value === room) await mySlotSet(sb, ''); }   // 쓰는 사이에 끔·로그아웃
    My.busy = false;
    if (live()) myNote(ok ? '허브에 방을 알리지 못했어요. 다시 켜 주세요' : '방을 열지 못했어요. 인터넷을 확인하고 다시 켜 주세요', true);
    myRender();
    return false;
  }
  Object.assign(My, { on: true, busy: false, sb, ch, room, phones: new Map(), all: [], slotAt: Date.now(), last: '', lastAt: 0, songSig: '', songsAt: 0 });
  clearInterval(My.tick); My.tick = setInterval(myTick, 1000);
  myRender();
  return true;
}
// 끄기: 폰에 "닫힘"을 보내고 채널을 뗀 뒤 열쇠 칸을 비운다 (칸이 아직 이 방일 때만 — 다른 화면이 새로 켠 방은 그대로).
// 방 이름은 메모리에서도 지운다 (끈 방 이름으로는 다시 못 들어옴)
async function myClose(quiet, keepNote) {
  const { ch, sb, room } = My;
  clearInterval(My.tick); My.gen++;
  Object.assign(My, { on: false, sb: null, ch: null, room: null, phones: new Map(), all: [], tick: 0, last: '', lastAt: 0, songSig: '', songsAt: 0 });
  My.sending++; myRender();
  if (ch) {
    try { await ch.send({ type: 'broadcast', event: 'm', payload: { v: MY_V, t: 'closed' } }); } catch {}
    try { await (sb ? sb.removeChannel(ch) : ch.unsubscribe()); } catch {}
  }
  if (sb && room) {
    const cur = await mySlotGet(sb);
    if (cur.ok && cur.value === room) await mySlotSet(sb, '');
  }
  if (!quiet && !keepNote) myNote('');
  myRender();
}
async function mySetWant(on) {
  My.want = on; lsSet(MY_LS, on ? '1' : null);
  if (!on) return myClose();
  const ok = await myOpen();
  if (!ok && !My.on) { My.want = false; lsSet(MY_LS, null); }   // 못 켰으면 다음에 열 때도 꺼진 채로
  return ok;
}
// 노래방 화면을 닫거나 새로 고침하면 방도 끝난다 (폰에 "꺼졌어요"). 열쇠 칸은 다음에 켤 때 새 이름으로 바뀐다
// 잡기 단계(true)로 들어 supabase가 pagehide에서 소켓을 끊기 전에 보낸다. 못 닿아도 폰은 30초 소식이 없으면 꺼짐으로 본다
addEventListener('pagehide', () => { if (My.ch) try { My.ch.send({ type: 'broadcast', event: 'm', payload: { v: MY_V, t: 'closed' } }); } catch {} }, true);

/* ---------------- 폰 메시지 처리 ---------------- */
function myReply(m, body) {
  if (!My.ch) return;
  My.ch.send({ type: 'broadcast', event: 'm', payload: { v: MY_V, to: m.pid, ...(m.seq !== undefined ? { seq: m.seq } : {}), ...body } }).catch(() => {});
}
function myOnMsg(m) {
  if (!My.on) return;
  const now = Date.now();
  if (!guestRateOk(My.all, now, MY_ROOM_PER_SEC)) return;
  if (!myMsgOk(m)) return;                    // 모르는 종류·모르는 명령·4KB 넘음·모양 틀림 → 버림 (답도 안 함)
  let p = My.phones.get(m.pid);
  if (!p) {
    if (m.t !== 'hello') return;              // 들어오지 않은 표의 명령은 버림
    if (My.phones.size >= MY_MAX) return myReply(m, { t: 'full' });
    p = { rate: [], seen: now }; My.phones.set(m.pid, p);
    myRender();
  }
  if (!guestRateOk(p.rate, now, MY_PER_SEC)) return;   // 한 대 1초 8개까지
  p.seen = now;
  switch (m.t) {
    case 'hello':
      myReply(m, { t: 'welcome' });
      if (!My.songSig || m.have !== My.songSig) mySendSongs(false);   // 폰이 가진 곡 목록이 다를 때만 (2초에 한 번까지)
      return mySendState(true);
    case 'bye': My.phones.delete(m.pid); return myRender();
    case 'cmd': return myCmd(m);
  }
}
// 곡·예약·사용자가 이 화면에 정말 있는지 다시 본다 (없으면 실행하지 않고 'no')
function myCmdWhy(cmd, a) {
  a = a || {};
  switch (cmd) {
    case 'reserve': case 'fav': case 'now': return songById(a.id) ? '' : 'nosong';
    case 'unreserve': case 'top': return state.queue.includes(a.id) ? '' : 'gone';
    case 'reserveMany': return a.ids.some(id => songById(id)) ? '' : 'nosong';
    case 'profile': return liveProfiles().some(p => p.id === a.id) ? '' : 'noprofile';
  }
  return '';
}
function myCmd(m) {
  const why = myCmdWhy(m.cmd, m.args);
  if (why) return myReply(m, { t: 'no', why });
  let r;
  try { r = remoteRun({ cmd: m.cmd, args: m.args || {} }); }
  catch (e) { console.warn('내 폰 명령 실패', m.cmd, e && e.message); return myReply(m, { t: 'no', why: 'fail' }); }
  if (r && typeof r.catch === 'function') r.catch(e => console.warn('내 폰 명령 실패', m.cmd, e && e.message));
  myReply(m, { t: 'ok' });
  setTimeout(() => mySendState(true), 60);
}

/* ---------------- 상태 보내기 (remoteState 그대로) ---------------- */
function myStateNow() {
  const { songs, ...st } = remoteState();
  return { songs, st };
}
// 곡 목록: 표시(mySig)가 바뀌었거나 폰이 다른 목록을 가졌을 때만, 32KB 조각으로 나눠 천천히
async function mySendSongs(force, songs) {
  if (!My.on || !My.ch) return;
  const now = Date.now();
  if (!force && now - My.songsAt < MY_SONGS_GAP_MS) return;
  songs = songs || myStateNow().songs;
  const sig = mySig(songs), parts = mySongParts(songs), ch = My.ch, gen = ++My.sending;
  My.songSig = sig; My.songsAt = now;
  for (let i = 0; i < parts.length; i++) {
    if (gen !== My.sending || My.ch !== ch) return;     // 그사이 새 목록·끔
    ch.send({ type: 'broadcast', event: 'm', payload: { v: MY_V, t: 'songs', sig, i, n: parts.length, songs: parts[i] } }).catch(() => {});
    if (i < parts.length - 1) await new Promise(r => setTimeout(r, MY_PART_GAP_MS));
  }
}
// 나머지 상태: 바뀌었을 때와 10초마다. 폰이 없으면 보내지 않는다
function mySendState(force) {
  if (!My.on || !My.ch || !My.phones.size) return;
  const { songs, st } = myStateNow(), sig = mySig(songs);
  if (sig !== My.songSig) mySendSongs(true, songs);
  const body = JSON.stringify(st);
  if (!force && body === My.last && Date.now() - My.lastAt < MY_EVERY_MS) return;
  My.last = body; My.lastAt = Date.now();
  My.ch.send({ type: 'broadcast', event: 'm', payload: { v: MY_V, t: 'state', sig, st } }).catch(() => {});
}
async function myTick() {
  if (!My.on) return;
  if (typeof hubOn !== 'function' || !hubOn() || Hub.sb !== My.sb) { myClose(); return; }   // 허브 연결을 끊거나 바꿈 → 방도 끝
  const now = Date.now(); let gone = false;
  for (const [pid, p] of My.phones) if (now - p.seen > MY_SEEN_MS) { My.phones.delete(pid); gone = true; }
  if (gone) myRender();
  mySendState();
  if (now - My.slotAt < MY_SLOT_MS) return;
  My.slotAt = now;
  const sb = My.sb, room = My.room, cur = await mySlotGet(sb);
  if (!My.on || My.room !== room || !cur.ok) return;          // 못 닿음: 다음에 다시
  if (cur.value !== room) { await myClose(true, true); myNote('다른 노래방 화면에서 내 폰 리모컨을 켜서 여기는 껐어요', false); myRender(); }
}

/* ---------------- 허브 로그인·로그아웃과 같이 (hub.js가 부름) ---------------- */
// 로그인 상태가 바뀜: 칸 보이기/숨기기, 켜 둔 기기면 로그인한 뒤 새 방으로 다시 켠다
async function myHubChanged() {
  await myRender();
  if (My.want && !My.on && !My.busy && My.shown) myOpen();
}
// 로그아웃·연결 끊기 바로 전 (세션이 아직 있을 때): 방을 끄고 열쇠 칸을 비운다. 켜 둔 설정(nb-myremote)은 그대로
async function myHubLeaving() {
  if (My.on || My.busy) await Promise.race([myClose(true), new Promise(r => setTimeout(r, 4000))]);   // 허브가 느려도 로그아웃은 4초 안에
}

/* ---------------- TV 대기 화면 QR (CR-228 ④ L6: 기본 길) ---------------- */
// 켜 둔 동안(My.on), server.py 없이 연 화면(GitHub Pages·정적 서버)의 대기 화면 #remoteInfo에 내 폰 리모컨 QR + 글 + 옛 길 안내 한 줄.
// server.py로 연 화면(Remote.info 있음)은 옛 QR(주소·코드) 그대로 — 내 폰 리모컨을 켜도 건드리지 않는다 (옛 길 보존).
// QR에는 같은 곳의 remote.html 주소만 (core.js myRemoteUrl, `?`·`#` 없음 = 방 이름·코드·계정 0). 주소 글은 화면에 쓰지 않는다.
// 끄기·방 끝·로그아웃이면 바로 숨김 (myRender가 부름). 손님 QR이 보이면 숨는 것은 css `.tv-idle.guest-on .remote-info` 그대로.
let myTvShown = false;
function myTvRender() {
  if (typeof qrLoad !== 'function' || typeof myRemoteUrl !== 'function') return;   // 배포 직후 캐시로 옛 remote.js·core.js가 섞이면 QR 없이 (설정 칸은 그대로)
  const box = $('#remoteInfo'); if (!box || Remote.info) return;
  if (!My.on) { if (myTvShown) { myTvShown = false; box.hidden = true; box.textContent = ''; } return; }
  if (myTvShown) return;
  myTvShown = true; box.hidden = false; box.textContent = '';
  const t = el('div', 'my-tv');
  t.append(el('b', '', MY_TV_TEXT.title), el('span', '', MY_TV_TEXT.line), el('small', 'my-tv-old', MY_TV_TEXT.old));
  box.append(t);
  const url = myRemoteUrl(location.href);
  qrLoad().then(() => {
    if (!My.on || !myTvShown || Remote.info) return;   // 그사이 끔·server.py 옛 QR
    box.querySelector('.qr')?.remove();
    box.prepend(qrImage(url, MY_TV_TEXT.alt));
  }).catch(() => {});   // QR 라이브러리를 못 불러오면 글만 (인터넷이 없으면 방도 못 씀)
}

/* ---------------- 화면: 설정 › 더 보기 (고급) › 내 폰 리모컨 (허브) ---------------- */
function myNote(text, bad) {
  My.note = text; My.bad = !!bad;
  const m = $('#myRemoteMsg'); if (!m) return;
  m.textContent = text; m.hidden = !text; m.classList.toggle('err', !!bad);
}
// 허브에 로그인해 있을 때만 보인다 (고급 안, 옛 폰 리모컨 바로 위)
async function myRender() {
  myTvRender();
  const sec = $('#myRemoteSec'); if (!sec) return;
  const shown = My.on || (await myLoggedIn());
  My.shown = shown;
  sec.hidden = !shown;
  const sub = $('#advSubMy'); if (sub) sub.hidden = !shown;
  const sw = $('#myRemoteOn'), n = My.phones.size;
  sw.checked = My.on || My.busy; sw.disabled = My.busy;
  $('#myRemoteSub').textContent = My.busy ? '여는 중…' : My.on ? `켜짐 · 폰 ${n}대` : '꺼짐 · 노래방을 띄운 PC에서 켜요';
  // 받는 기기(켜 둔 PC)에서는 [이 기기에서 리모컨 열기]를 숨긴다: 같은 탭 링크라 누르면 이 화면을 떠나 방이 끝난다 (디자인실 K2). 폰(꺼짐)에서는 보임
  $('#myRemoteLink').parentElement.hidden = My.on || My.busy;
}
{
  const sw = $('#myRemoteOn');
  if (sw) sw.addEventListener('change', e => { mySetWant(e.target.checked); });
  const dlg = $('#cloudDialog');
  if (dlg) new MutationObserver(() => { if (dlg.open) myRender(); }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
}
// main.js가 켤 때 부름: 켜 둔 기기이고 로그인해 있으면 새 방으로
async function myInit() {
  await myRender();
  if (My.want && My.shown && !My.on) myOpen();
}
