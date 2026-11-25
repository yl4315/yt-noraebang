// YT 노래방 · 손님 방 (방장 쪽, CR-228): 같이 있는 사람이 폰으로 QR을 찍어 로그인 없이 곡을 찾고 예약한다
'use strict';
// 허브 Realtime 공개 broadcast 채널 하나. 방 이름은 열 때마다 새 256비트 난수 (core.js guestRoomName).
// 방장(이 화면)이 먼저 붙어 듣고, 손님 메시지(이벤트 'g')를 확인(guestMsgOk)·처리한 뒤 결과만 돌려준다(이벤트 'h').
// 손님 화면은 guest.html + js/guest.js. 손님은 허브 표·RPC·로그인 0.
// 방 이름·연결 코드·허브 주소·키는 콘솔·기록·화면 글에 찍지 않는다 (QR 그림 안에만).
// 지키는 것: 손님 6명까지 · 한 사람 1초 4개 · 4KB 넘는 메시지 버림 · 손님·곡 글은 textContent로만.

const Guest = {
  on: false, busy: false, sb: null, ch: null, room: null, url: null, qr: null, qrPx: 0,   // qrPx: QR 그림 한 변 칸 수(여백 포함) = 그림 px (CR-228 L2)
  guests: new Map(),     // 손님 표 → { rate: [시각…], seen, nick }
  res: [],               // 손님 예약 [{ rid, gid, id, nick }] (core.js guestQueueMap으로 예약 목록 줄과 짝지음)
  all: [], last: '', lastAt: 0, tick: 0, note: '',
  nowRes: null,          // 지금 예약 차례로 시작한 곡의 손님 예약 표 (처음 못 튼 유튜브 영상도 그 손님에게 알림, CR-251 YT-01)
  empty: 0,              // 손님이 0명이 된 시각 (0 = 손님 있음). 0명으로 GUEST_IDLE_MS가 지나면 방을 닫는다 (CR-251 YT-19)
  tvQr: lsGet('nb-guest-tv') !== '0',     // TV 대기 화면에 QR 보이기 (이 기기 설정)
  keyOn: lsGet('nb-guest-key') !== '0',   // 손님이 지금 곡 키 바꾸기 (−2~+2)
};
const GUEST_ROOM_PER_SEC = 30;     // 방 전체 1초 30개까지 (손님이 아닌 표가 보내는 hello도 셈)
const GUEST_SEEN_MS = 60000;       // 손님 폰은 20초마다 hello. 60초 소식이 없으면 나간 것으로 셈
const GUEST_EVERY_MS = 20000;      // 상태가 안 바뀌어도 20초마다 한 번 (손님 폰은 60초 동안 소식이 없으면 끊김으로 봄)
const GUEST_IDLE_MS = 2 * 3600e3;  // 손님 0명으로 2시간이면 방을 저절로 닫음 (CR-251 YT-19: QR 사진이 퍼져도 방이 계속 열려 있지 않게)
// 손님 QR 바탕 주소 (CR-251 YT-06): 이 화면을 localhost·사설 IP·http로 열었으면 손님 폰이 못 들어오니 공개 Pages 주소로 (core.js guestUrl).
// 화면 점검(tests/ui/checks/guest.mjs)은 가짜 서버로 열려고 이 값을 바꾼다
let GUEST_PUBLIC_BASE = 'https://yl4315.github.io/yt-noraebang/';
const guestYtOn = () => typeof ytReserve === 'function';   // 유튜브 곡 예약 (CR-030 yt.js가 있을 때만)

/* ---------------- QR 그림 (js/vendor/toqr-0.1.1.mjs, 이 저장소 안 사본) ---------------- */
let toqrMod = null;
const toqrLoad = () => (toqrMod ||= import(new URL('js/vendor/toqr-0.1.1.mjs', document.baseURI).href));
async function guestQrMake(text) {
  const { toQR } = await toqrLoad();
  const m = toQR(text, text.length > 300 ? 1 : 0);   // 0 = M, 긴 주소(긴 키)는 1 = L로 칸을 줄인다
  const n = Math.round(Math.sqrt(m.length)), quiet = 4, cv = document.createElement('canvas');
  cv.width = cv.height = n + quiet * 2;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y * n + x]) g.fillRect(x + quiet, y + quiet, 1, 1);
  return { src: cv.toDataURL('image/png'), px: cv.width };     // 칸 하나 = 1px 그림 (화면에서는 guestQrFit이 정수배로 키움)
}
// QR을 칸당 정수 px로 (CR-228 L2): CSS가 정한 크기(--qr-px를 뗀 크기) 안에서 그림 px의 배수로. TV 카드는 96px 아래로 줄이지 않음.
// 보이지 않으면(크기 0) CSS 크기 그대로 두고, 대기 화면 크기가 바뀌거나 보이게 되면 다시 (아래 ResizeObserver)
function guestQrFit() {
  const px = Guest.qrPx;
  for (const [sel, min] of [['#guestQrImg', 0], ['#guestCardQr', 96]]) {
    const img = $(sel); if (!img) continue;
    img.style.removeProperty('--qr-px');
    if (!px || img.hidden) continue;
    const w = img.getBoundingClientRect().width;
    if (w > 0) img.style.setProperty('--qr-px', qrFitPx(w, px, min) + 'px');
  }
}

/* ---------------- 방 열기·닫기 ---------------- */
async function guestOpen() {
  if (Guest.busy) return false;
  const sb = typeof hubOn === 'function' && hubOn() && typeof hubClient === 'function' ? hubClient() : null;
  if (!sb || !Hub.conf) { guestNote('허브를 먼저 연결해 주세요 · 설정 › 허브 연결', true); return false; }
  Guest.busy = true; guestNote(''); guestRender();
  if (Guest.on) await guestClose(true);
  const room = guestRoomName();
  const ch = sb.channel(room, { config: { broadcast: { self: false, ack: false } } });
  ch.on('broadcast', { event: 'g' }, m => { try { guestOnMsg(m && m.payload); } catch (e) { console.warn('손님 메시지 처리 실패', e && e.message); } });
  const ok = await new Promise(res => {
    const t = setTimeout(() => res(false), 15000);
    ch.subscribe(st => {
      if (st === 'SUBSCRIBED') { clearTimeout(t); res(true); }
      else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { clearTimeout(t); res(false); }
    });
  });
  if (!ok) {
    try { await sb.removeChannel(ch); } catch {}
    Guest.busy = false; guestNote('방을 열지 못했어요. 인터넷을 확인하고 다시 눌러 주세요', true); guestRender();
    return false;
  }
  Object.assign(Guest, { on: true, busy: false, sb, ch, room, qr: null, qrPx: 0, guests: new Map(), res: [], all: [], last: '', lastAt: 0,
    empty: Date.now(), url: guestUrl(location.href, room, hubCodeMake(Hub.conf.u, Hub.conf.k), GUEST_PUBLIC_BASE) });
  clearInterval(Guest.tick); Guest.tick = setInterval(guestTick, 1000);
  guestRender(); guestSendState(true);
  const url = Guest.url;
  try { const qr = await guestQrMake(url); if (Guest.url === url) { Guest.qr = qr.src; Guest.qrPx = qr.px; } }
  catch { if (Guest.url === url) guestNote('QR 그림을 못 만들었어요. 새 QR 만들기를 눌러 주세요', true); }
  guestRender();
  return true;
}
// 닫기: 손님에게 "닫힘"을 보내고 채널을 뗀다. 방 이름·손님 이름·예약 표는 메모리에서도 지운다 (닫은 방 이름으로는 다시 못 들어옴)
async function guestClose(quiet) {
  const { ch, sb } = Guest;
  clearInterval(Guest.tick);
  Object.assign(Guest, { on: false, sb: null, ch: null, room: null, url: null, qr: null, qrPx: 0, guests: new Map(), res: [], all: [], last: '', lastAt: 0, tick: 0, empty: 0, nowRes: null });
  if (ch) {
    try { await ch.send({ type: 'broadcast', event: 'h', payload: { v: GUEST_V, t: 'closed' } }); } catch {}
    try { await (sb ? sb.removeChannel(ch) : ch.unsubscribe()); } catch {}
  }
  if (!quiet) guestNote('');
  renderQueue(); guestRender();
}
// 노래방 화면을 닫거나 새로 고침하면 방도 끝난다 (손님 화면에 "방이 닫혔어요")
addEventListener('pagehide', () => { if (Guest.ch) try { Guest.ch.send({ type: 'broadcast', event: 'h', payload: { v: GUEST_V, t: 'closed' } }); } catch {} });

/* ---------------- 손님 메시지 처리 ---------------- */
function guestReply(m, body) {
  if (!Guest.ch) return;
  Guest.ch.send({ type: 'broadcast', event: 'h', payload: { v: GUEST_V, to: m.gid, ...(m.seq !== undefined ? { seq: m.seq } : {}), ...body } }).catch(() => {});
}
function guestOnMsg(m) {
  if (!Guest.on) return;
  const now = Date.now();
  if (!guestRateOk(Guest.all, now, GUEST_ROOM_PER_SEC)) return;
  if (!guestMsgOk(m)) return;                 // 모르는 종류·4KB 넘음·모양 틀림 → 버림 (답도 안 함)
  let g = Guest.guests.get(m.gid), fresh = false;
  if (!g) {
    if (m.t !== 'hello') return;              // 들어오지 않은 표의 메시지는 버림
    if (Guest.guests.size >= GUEST_MAX) return guestReply(m, { t: 'full' });
    g = { rate: [], seen: now, nick: '' }; Guest.guests.set(m.gid, g); fresh = true;
    guestRender();
  }
  if (!guestRateOk(g.rate, now)) return;      // 한 사람 1초 4개까지
  g.seen = now;
  if (typeof m.nick === 'string' && m.nick.trim() !== g.nick) { g.nick = m.nick.trim(); renderQueue(); }
  switch (m.t) {
    case 'hello': guestReply(m, { t: 'welcome' }); return fresh ? guestSendState(true) : undefined;   // 20초마다 오는 "있어요"에는 welcome만
    case 'bye': Guest.guests.delete(m.gid); return guestRender();
    case 'search': return m.kind === 'yt' ? guestYtSearch(m) : guestReply(m, { t: 'found', kind: 'mr', ...guestSearchResult(state.songs, m.q) });
    case 'reserve': return guestReserve(m, g);
    case 'unreserve': return guestUnreserve(m);
    case 'key': return guestKey(m);
  }
}
const guestMine = gid => guestQueueMap(state.queue, Guest.res).live.filter(r => r.gid === gid).length;
function guestReserve(m, g) {
  if (guestMine(m.gid) >= GUEST_MINE_MAX) return guestReply(m, { t: 'no', why: 'many' });
  if (m.ytId !== undefined) return guestYtReserve(m, g);
  const s = state.songs.find(x => x.no === m.no && !x.deleted);   // 번호가 진짜 있는지 방장이 다시 확인
  if (!s) return guestReply(m, { t: 'no', why: 'nosong' });
  const rid = guestId();
  Guest.res.push({ rid, gid: m.gid, id: s.id, nick: g.nick });   // reserve()가 예약 목록을 그릴 때 이름이 보이게 먼저 넣는다
  reserve(s, false);
  const i = state.queue.lastIndexOf(s.id);    // 대기 화면이면 바로 시작해서 목록에 없을 수 있음 → 0 = 바로 시작
  guestReply(m, { t: 'ok', rid, pos: i + 1 });
  guestSendState();
}
async function guestYtReserve(m, g) {
  if (!guestYtOn()) return guestReply(m, { t: 'no', why: 'yt' });
  let s = null;
  try { s = await ytReserve(m.ytId); } catch {}
  if (!Guest.on) return;
  if (!s || !s.id) return guestReply(m, { t: 'no', why: 'yt' });
  const rid = guestId();
  Guest.res.push({ rid, gid: m.gid, id: s.id, nick: g.nick }); renderQueue();
  guestReply(m, { t: 'ok', rid, pos: state.queue.lastIndexOf(s.id) + 1 });
  if (ytBlocked(s) && !state.queue.includes(s.id)) guestTellSkip({ gid: m.gid }, s);   // TV 대기 화면에서 바로 차례가 와서 건너뜀 (예약 표를 넣기 전이라 startNext가 손님을 모름, CR-251 YT-01)
  guestSendState();
}
async function guestYtSearch(m) {
  let items = [];
  if (typeof ytGuestSearch === 'function') {
    try { items = ((await ytGuestSearch(m.q)) || []).filter(x => x && typeof x.ytId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(x.ytId)); } catch {}
  }
  if (!Guest.on) return;
  items = items.slice(0, GUEST_RESULTS).map(x => ({ ytId: x.ytId, title: String(x.title || '').slice(0, 80), artist: String(x.artist || '').slice(0, 60), kind: 'yt', ...guestBlock(findYtSong(state.songs, x.ytId)) }));
  guestReply(m, { t: 'found', kind: 'yt', n: items.length, items });
}
function guestUnreserve(m) {
  const map = guestQueueMap(state.queue, Guest.res);
  const i = map.at.findIndex(r => r && r.rid === m.rid && r.gid === m.gid);   // 내가 넣은 곡만 뺄 수 있다
  if (i < 0) return guestReply(m, { t: 'no', why: 'gone' });
  Guest.res = Guest.res.filter(r => r.rid !== m.rid);
  unreserve(i);
  guestReply(m, { t: 'ok', rid: m.rid, gone: true });
  guestSendState();
}
const guestNow = () => { const s = state.song; return s && (state.playing || state.offset > 0.5) ? s : null; };
const guestKeyOk = s => !!s && !!s.buffer && guestKind(s) !== 'yt' && !state.sync;
function guestKey(m) {
  if (!Guest.keyOn) return guestReply(m, { t: 'no', why: 'keyoff' });
  const s = guestNow();
  if (!guestKeyOk(s)) return guestReply(m, { t: 'no', why: 'nokey' });
  setKey(m.k, { save: false });     // 지금 곡에만 (내 키 기억·허브 곡 기본 키는 그대로)
  setTimeout(() => guestSendState(), 50);
}

/* ---------------- 상태 보내기 ---------------- */
function guestStateNow() {
  const map = guestQueueMap(state.queue, Guest.res), now = guestNow();
  return guestStateMsg({ now, playing: state.playing, t: now ? curTime() : 0, d: now ? dur() : 0, key: state.key || 0, keyOk: guestKeyOk(now),
    queue: state.queue, songOf: songById, map, keyOn: Guest.keyOn, yt: guestYtOn() });
}
// 바뀌었을 때(진행 시각은 빼고 비교)와 20초마다. 손님 폰은 받은 시각부터 진행 막대를 혼자 움직인다
function guestSendState(force) {
  if (!Guest.on || !Guest.ch) return;
  const st = guestStateNow(), sig = JSON.stringify({ ...st, now: st.now && { ...st.now, t: 0 } });
  if (!force && sig === Guest.last && Date.now() - Guest.lastAt < GUEST_EVERY_MS) return;
  Guest.last = sig; Guest.lastAt = Date.now();
  Guest.ch.send({ type: 'broadcast', event: 'h', payload: st }).catch(() => {});
}
function guestTick() {
  if (!Guest.on) return;
  if (typeof hubOn !== 'function' || !hubOn() || Hub.sb !== Guest.sb) { guestClose(); return; }   // 허브 연결을 끊거나 바꿈 → 방도 닫음
  const now = Date.now(); let gone = false;
  for (const [gid, g] of Guest.guests) if (now - g.seen > GUEST_SEEN_MS) { Guest.guests.delete(gid); gone = true; }
  Guest.res = guestQueueMap(state.queue, Guest.res).live;    // 이미 부른 곡·방장이 뺀 곡의 손님 예약은 잊는다
  const idle = guestIdleStep(Guest.empty, Guest.guests.size, now, GUEST_IDLE_MS); Guest.empty = idle.emptySince;
  if (idle.close) {   // CR-251 YT-19: 손님 0명으로 2시간 → 방을 닫음 (다시 켜면 새 방·새 QR)
    const msg = '손님이 2시간 동안 없어서 손님 방을 닫았어요 · 다시 켜려면 [손님 QR 켜기]';
    guestClose(true); guestNote(msg); toast(msg, 6000); return;
  }
  if (gone) guestRender();
  guestSendState();
}
// 노래방에서 안 틀어지는 유튜브 곡 (CR-251 YT-01): 손님이 예약한 곡이 그래서 넘어가면 그 손님 폰에만 "OO 곡은 노래방에서 안 틀어져서 넘어갔어요" (guest.js 'skip').
// guestResAt: 예약 목록 i번째 줄의 손님 예약 표 (karaoke.js startNext가 곡을 빼기 전에 부름) · guestStarted: 차례로 시작한 곡의 표를 기억 ·
// guestTellNow: 그 곡이 처음으로 못 튼 영상이면(yt.js ytMarkBlocked) 기억한 손님에게 알림
function guestResAt(i) {
  if (!Guest.on || !Guest.res.length) return null;
  return guestQueueMap(state.queue, Guest.res).at[i] || null;
}
function guestTellSkip(r, s) {
  if (!r || !s) return;
  const gid = r.gid, title = guestCut(s.title, 80);
  // 한 박자 뒤에 보낸다: TV 대기 화면이면 예약하자마자 차례가 와서 건너뛰는데, 그때 "예약했어요" 답보다 먼저 가면 손님 폰 알림이 덮인다
  setTimeout(() => { if (Guest.on && Guest.guests.has(gid)) guestReply({ gid }, { t: 'skip', title }); }, 0);
}
function guestStarted(r, s) { Guest.nowRes = r && s ? { gid: r.gid, rid: r.rid, id: s.id } : null; }
function guestTellNow(s) {
  const r = Guest.nowRes;
  if (!r || !s || r.id !== s.id) return;
  Guest.nowRes = null; guestTellSkip(r, s);
}
// 예약 목록 줄의 손님 이름 (karaoke.js renderQueue·renderQueueList가 부름). 방이 닫혀 있으면 ''
function guestNickAt(i) {
  if (!Guest.on || !Guest.res.length) return '';
  const r = guestQueueMap(state.queue, Guest.res).at[i];
  return r ? (r.nick || '손님') : '';
}

/* ---------------- 화면: 설정 "손님" · 손님 초대 QR 시트 · TV 대기 카드 ---------------- */
function guestNote(text, bad) {
  Guest.note = text;
  for (const id of ['#guestMsg', '#guestSetMsg']) { const m = $(id); if (!m) continue; m.textContent = text; m.hidden = !text; m.classList.toggle('err', !!bad); }
}
function guestRender() {
  const n = Guest.guests.size, on = Guest.on;
  const sub = $('#guestRowSub'); if (sub) sub.textContent = on ? `켜짐 · 손님 ${n}명` : '로그인 없이 폰으로 예약';
  const off = $('#guestOff'), box = $('#guestOnBox');
  if (off) { off.hidden = on; $('#guestOpenBtn').disabled = Guest.busy; $('#guestOpenBtn').textContent = Guest.busy ? '방 여는 중…' : '손님 QR 켜기'; }
  if (box) {
    box.hidden = !on;
    const img = $('#guestQrImg'); img.hidden = !Guest.qr; if (Guest.qr && img.src !== Guest.qr) img.src = Guest.qr;
    $('#guestTvQr').checked = Guest.tvQr; $('#guestKeyOn').checked = Guest.keyOn;
    $('#guestCount').textContent = `들어온 손님 ${n}명`;
    $('#guestNewBtn').disabled = Guest.busy;
  }
  // TV 대기 화면 오른쪽 아래 카드: 방이 열려 있으면 QR, 닫혀 있으면(허브 연결이 있을 때만) [손님 QR 켜기]. 옛 리모컨 QR(L6)과는 둘 중 하나만
  const card = $('#guestCard'); if (!card) return;
  const showQr = on && Guest.tvQr && !!Guest.qr, showBtn = !on && typeof hubOn === 'function' && hubOn();
  card.hidden = !(showQr || showBtn);
  $('#tvIdle').classList.toggle('guest-on', showQr);
  const cq = $('#guestCardQr'); cq.hidden = !showQr; if (showQr && cq.src !== Guest.qr) cq.src = Guest.qr;
  $('#guestCardLine').textContent = showQr ? '폰 카메라로 찍으면 곡을 찾아 예약할 수 있어요' : '같이 있는 사람이 폰으로 곡을 찾아 예약해요';
  $('#guestCardSub').textContent = `로그인 없음 · 손님 ${n}명`; $('#guestCardSub').hidden = !showQr;
  const cb = $('#guestCardBtn'); cb.hidden = !showBtn; cb.disabled = Guest.busy;
  const cc = $('#guestCardClose'); if (cc) { cc.hidden = !showQr; cc.disabled = Guest.busy; }   // TV에서 바로 방 닫기 (CR-251 YT-19)
  guestQrFit();
}
function guestSheet() {
  const d = $('#guestDialog'); if (!d) return;
  if (!d.open) d.showModal();
  guestRender();
  if (!Guest.on && !Guest.busy && typeof hubOn === 'function' && hubOn()) guestOpen();   // 처음 열면 바로 QR
  else if (!Guest.on && !(typeof hubOn === 'function' && hubOn())) guestNote('허브를 먼저 연결해 주세요 · 설정 › 허브 연결', true);
}
{
  const on = (sel, ev, fn) => $(sel)?.addEventListener(ev, fn);
  on('#guestRow', 'click', guestSheet);
  // TV 대기 화면이 보이게 되거나 크기가 바뀌면 카드 QR을 다시 정수배로 (대기 화면 크기는 카드 QR 크기와 상관없어서 되풀이 없음)
  const idle = $('#tvIdle');
  if (idle && typeof ResizeObserver === 'function') new ResizeObserver(() => guestQrFit()).observe(idle);
  else window.addEventListener('resize', guestQrFit);
  on('#guestOpenBtn', 'click', () => guestOpen());
  on('#guestNewBtn', 'click', () => guestOpen());          // 새 QR = 새 방 (지금 손님은 "방이 닫혔어요")
  on('#guestCloseBtn', 'click', () => guestClose());
  on('#guestDlgClose', 'click', () => $('#guestDialog').close());
  on('#guestCardBtn', 'click', () => guestOpen());
  on('#guestCardClose', 'click', () => guestClose());
  on('#guestTvQr', 'change', e => { Guest.tvQr = e.target.checked; lsSet('nb-guest-tv', Guest.tvQr ? null : '0'); guestRender(); });
  on('#guestKeyOn', 'change', e => { Guest.keyOn = e.target.checked; lsSet('nb-guest-key', Guest.keyOn ? null : '0'); guestSendState(true); });
  on('#guestDialog', 'close', () => { if (!Guest.on) guestNote(''); });
  const dlg = $('#cloudDialog');
  // 설정 창을 열고 닫을 때마다 다시 그린다 (허브를 이으면 TV 대기 카드에 [손님 QR 켜기]가 생기고, 끊으면 없어진다)
  if (dlg) new MutationObserver(() => { guestRender(); if (dlg.open && !Guest.on) guestNote(''); }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
}
function guestInit() { guestRender(); }   // main.js가 켤 때 부름
