// YT 노래방 · 휴대폰 리모컨 중계
'use strict';

/* ================= 휴대폰 리모컨 (같은 와이파이) ================= */
// 이 PC에서 server.py로 열었을 때만 켜진다. 휴대폰은 remote.html에서 명령을 보내고, 이 화면이 받아서 실행한다.
const Remote = { on: false, since: 0, boot: null, info: null, last: '', polling: false };
async function remoteInit() {
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  try {
    const r = await fetch('/api/remote/info', { cache: 'no-store' });
    if (!r.ok) return;
    Remote.info = await r.json(); Remote.since = Remote.info.last || 0;
  } catch { return; }
  Remote.on = true; renderRemoteInfo();
  setInterval(remotePoll, 600); setInterval(remotePush, 1000);
}
async function remotePoll() {
  if (Remote.polling) return;      // 앞 요청이 끝나기 전에는 또 묻지 않는다 (CR-251 YT-r12)
  Remote.polling = true;
  try {
    const r = await fetch('/api/remote/poll?since=' + Remote.since, { cache: 'no-store' });
    if (!r.ok) return;
    const { cmds, last, boot } = await r.json();
    // 서버를 껐다 켬(번호가 0부터 다시): 번호를 맞추고 상태를 바로 다시 올린다. 이 답의 명령은 다음 번에 처음부터 받는다 (core.js remotePollNext)
    const nx = typeof remotePollNext === 'function' ? remotePollNext(Remote, { last, boot }) : { since: last, boot: null, restarted: false };
    Remote.since = nx.since; Remote.boot = nx.boot;
    if (nx.restarted) { Remote.last = ''; return; }
    for (const c of cmds || []) { try { remoteRun(c); } catch (e) { console.warn('remote', e); } }
  } catch {} finally { Remote.polling = false; }
}
function remoteState() {
  const s = state.song;
  return {
    now: s ? { id: s.id, no: s.no, title: s.title, artist: s.artist || '', playing: state.playing, t: Math.round(curTime()), dur: Math.round(dur()), key: state.key || 0 } : null,
    queue: state.queue.filter(songById),
    songs: state.songs.map(x => ({ id: x.id, no: x.no, title: x.title, artist: x.artist || '', video: !!x.video, local: onDevice(x) })),
    profiles: liveProfiles().map(p => ({ id: p.id, name: p.name, color: avColor(p) })),
    me: me().id, favorites: me().favorites, playlists: me().playlists.map(p => ({ id: p.id, name: p.name, songs: p.songs })),
    tv: state.tv, rec: state.armed, mrVol: settings.mrVol,
  };
}
async function remotePush() {
  const body = JSON.stringify(remoteState());
  if (body === Remote.last) return;
  // 못 올렸으면 기억을 비워, 서버가 다시 켜지면 같은 상태라도 다시 올린다 (CR-251 YT-r12)
  try { const r = await fetch('/api/remote/state', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }); Remote.last = r.ok ? body : ''; } catch { Remote.last = ''; }
}
function remoteRun(c) {
  const a = c.args || {}, qi = id => state.queue.indexOf(id);
  switch (c.cmd) {
    case 'start': return startKey();
    case 'pause': return state.playing ? pause() : (state.offset > 0.5 && play());
    case 'cancel': return cancelSong();
    case 'jump': return jumpInterlude();
    case 'reserve': return reserve(songById(a.id), !!a.priority);
    case 'reserveMany': return reserveMany((a.ids || []).filter(songById), String(a.label || '목록').slice(0, 30));
    case 'unreserve': return qi(a.id) >= 0 && unreserve(qi(a.id));
    case 'top': return qi(a.id) > 0 && moveToTop(qi(a.id));
    case 'now': { if (!songById(a.id)) return; if (qi(a.id) >= 0) state.queue.splice(qi(a.id), 1); state.queue.unshift(a.id); return startNext(); }
    case 'mr': return bumpSetting('mrVol', clamp(+a.delta || 0, -20, 20));
    case 'key': return setKey((state.key || 0) + clamp(+a.delta || 0, -2, 2));
    case 'keyReset': return setKey(0);
    case 'profile': { const p = liveProfiles().find(x => x.id === a.id); return p && switchProfile(p); }
    case 'fav': { const s = songById(a.id); return s && toggleFav(s); }
    case 'tv': return state.tv || enterTV();
    case 'rec': return setArmed(!state.armed);
  }
}
// QR 그림 (앱 안 사본 js/vendor/toqr-0.1.1.mjs, CR-251 YT-r16 — 전에는 cdnjs에 기대서 인터넷이 안 되면 QR이 안 나왔다):
// 옛 리모컨 QR과 TV 대기 화면 내 폰 리모컨 QR(myremote.js, CR-228 ④)이 같이 쓴다. 한 번만 불러온다 (못 불러오면 다음에 다시)
let qrLib = null, qrMake = null;
function qrLoad() {
  return (qrLib ||= import(new URL('js/vendor/toqr-0.1.1.mjs', document.baseURI).href)
    .then(m => { qrMake = m.toQR; }).catch(e => { qrLib = null; throw e; }));
}
function qrImage(text, alt) {
  const m = qrMake(text, 0), n = Math.round(Math.sqrt(m.length)), cell = 4, quiet = 2;   // 0 = M · 칸 4px · 둘레 2칸
  const cv = document.createElement('canvas'); cv.width = cv.height = (n + quiet * 2) * cell;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y * n + x]) g.fillRect((x + quiet) * cell, (y + quiet) * cell, cell, cell);
  const img = new Image(); img.src = cv.toDataURL('image/png'); img.alt = alt; img.className = 'qr';
  return img;
}
function renderRemoteInfo() {
  const i = Remote.info; if (!i) return;
  $('#remoteSec').hidden = false;   // 설정 창 "옛 폰 리모컨"은 PC 서버로 켰을 때만 (GitHub Pages에서는 아예 안 보임, CR-229)
  $('#advSubRemote').hidden = false;   // "더 보기 (고급)" 작은 글에도 그때만 (디자인 확인 CR-229 #1)
  for (const box of [$('#remoteInfo'), $('#remoteSet')]) {
    box.hidden = false; box.textContent = '';
    if (i.url) box.append(el('b', '', '옛 폰 리모컨'), el('span', '', `같은 와이파이에서 ${i.url.replace(/\?.*$/, '')} · 코드 ${i.pin}`));
    else box.append(el('b', '', '옛 폰 리모컨'), el('span', '', '꺼져 있어요. "YT 노래방 켜기"로 서버를 켜면 같은 와이파이의 폰에서 쓸 수 있어요'));
  }
  renderRemoteCtl();
  if (!i.url) return;
  // QR 코드: 휴대폰 카메라로 찍으면 코드까지 자동으로 들어간다 (인터넷이 안 되면 주소만 보여 준다)
  qrLoad().then(() => {
    // 그사이 "새 코드 만들기"로 다시 그렸으면 옛 코드 QR은 넣지 않는다
    if (Remote.info !== i) return;
    for (const box of [$('#remoteInfo'), $('#remoteSet')]) {
      box.querySelector('.qr')?.remove();
      box.prepend(qrImage(i.url, '옛 폰 리모컨 QR 코드'));
    }
  }).catch(() => {});
}

/* 리모컨 코드 설정 (설정 창): 코드는 기본으로 고정이라 한 번 연결한 휴대폰은 다음에도 바로 붙는다 */
// 같은 와이파이로 열어 둔(--lan) 서버일 때만 보인다. 휴대폰이 붙을 수 없으면 코드 버튼은 쓸 데가 없다.
function renderRemoteCtl() {
  const i = Remote.info, on = !!(Remote.on && i?.lan);
  $('#remoteCtl').hidden = !on; if (!on) return;
  $('#remoteNewEach').checked = i.fixed === false;
  $('#remotePinHint').textContent = i.fixed === false
    ? '서버를 켤 때마다 코드가 바뀌어요. 휴대폰은 그때마다 QR 코드를 다시 찍어야 해요.'
    : '코드가 바뀌지 않아서 한 번 연결한 휴대폰은 다음에도 바로 붙어요. 대신 같은 와이파이의 다른 사람도 이 코드를 계속 쓸 수 있어요. 걱정되면 "새 코드 만들기"를 누르세요.';
}
async function remoteSetPin(body) {
  const r = await fetch('/api/remote/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(r.status);
  Remote.info = await r.json(); renderRemoteInfo();
  return Remote.info;
}
// 설정 창은 화면 맨 위에 떠서 아래쪽 알림(toast)이 가려지니, 결과는 버튼 옆 글로 알려 준다
const showPinMsg = (text, bad) => { const m = $('#remotePinMsg'); m.textContent = text; m.classList.toggle('err', !!bad); };
const PIN_NOT_SAVED = '코드를 파일에 저장하지 못했어요. 서버를 다시 켜면 코드가 바뀔 수 있어요';
const PIN_NO_SERVER = '서버에 닿지 않았어요. 검은 서버 창이 켜져 있는지 확인해 주세요';
$('#remoteNewPin').onclick = async () => {
  const b = $('#remoteNewPin'); b.disabled = true;
  try {
    const i = await remoteSetPin({ action: 'new' });
    showPinMsg(i.saved === false ? PIN_NOT_SAVED : `새 코드로 바꿨어요: ${i.pin}. 휴대폰은 QR 코드를 다시 찍거나 새 코드를 넣어 주세요`, i.saved === false);
  } catch { showPinMsg('새 코드를 만들지 못했어요. ' + PIN_NO_SERVER, true); }
  b.disabled = false;
};
$('#remoteNewEach').addEventListener('change', async e => {
  const each = e.target.checked;
  try {
    const i = await remoteSetPin({ fixed: !each });
    showPinMsg(i.saved === false ? PIN_NOT_SAVED : each ? '다음에 서버를 켤 때부터 새 코드가 생겨요' : '코드를 고정했어요. 다음에 켜도 같은 코드예요', i.saved === false);
  } catch { e.target.checked = !each; showPinMsg('설정을 바꾸지 못했어요. ' + PIN_NO_SERVER, true); }
});
