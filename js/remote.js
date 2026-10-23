// YT 노래방 · 휴대폰 리모컨 중계
'use strict';

/* ================= 휴대폰 리모컨 (같은 와이파이) ================= */
// 이 PC에서 server.py로 열었을 때만 켜진다. 휴대폰은 remote.html에서 명령을 보내고, 이 화면이 받아서 실행한다.
const Remote = { on: false, since: 0, info: null, last: '' };
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
  try {
    const r = await fetch('/api/remote/poll?since=' + Remote.since, { cache: 'no-store' });
    if (!r.ok) return;
    const { cmds, last } = await r.json(); Remote.since = last;
    for (const c of cmds) { try { remoteRun(c); } catch (e) { console.warn('remote', e); } }
  } catch {}
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
  try { const r = await fetch('/api/remote/state', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }); if (r.ok) Remote.last = body; } catch {}
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
let qrLib = null;
function renderRemoteInfo() {
  const i = Remote.info; if (!i) return;
  for (const box of [$('#remoteInfo'), $('#remoteSet')]) {
    box.hidden = false; box.textContent = '';
    if (i.url) box.append(el('b', '', '휴대폰 리모컨'), el('span', '', `같은 와이파이에서 ${i.url.replace(/\?.*$/, '')} · 코드 ${i.pin}`));
    else box.append(el('b', '', '휴대폰 리모컨'), el('span', '', '꺼져 있어요. "YT 노래방 켜기"로 서버를 켜면 같은 와이파이의 휴대폰에서 쓸 수 있어요'));
  }
  if (!i.url) return;
  // QR 코드: 휴대폰 카메라로 찍으면 코드까지 자동으로 들어간다 (인터넷이 안 되면 주소만 보여 준다)
  (qrLib ||= new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
    sc.onload = res; sc.onerror = rej; document.head.append(sc);
  })).then(() => {
    const q = qrcode(0, 'M'); q.addData(i.url); q.make();
    for (const box of [$('#remoteInfo'), $('#remoteSet')]) { const img = new Image(); img.src = q.createDataURL(4, 2); img.alt = '휴대폰 리모컨 QR 코드'; img.className = 'qr'; box.prepend(img); }
  }).catch(() => {});
}
