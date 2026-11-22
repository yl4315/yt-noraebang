// YT 노래방 · MR 만들기 (CR-089): 내 노래 파일 → 집 AI 서버가 목소리를 뺀 MR → "여러 곡 한 번에 넣기" 창
// 곡 목록 [내 노래 파일에서 MR 만들기]가 집 AI 서버의 "MR 만들기 창"(서버 주소 + '/')을 새 탭으로 연다.
// 파일 고르기·올리기·진행 표시는 그 창이 하고, 다 만든 MR 파일을 창끼리(postMessage) 넘겨 준다.
// 노래방은 서버에 직접 요청하지 않는다 (https 노래방 → http 서버는 브라우저가 막음). 받은 파일은 openBulk(CR-017) 그대로.
// 메시지 약속(yena-mr README): 모두 {app:'yena-mr', v:1, type}
//   창 → 노래방 hello · files{files}   /   노래방 → 창 welcome · ack{n} · nack{reason:'busy'|'bad'}
// 가사 정렬(CR-227 W7·W8)이 v:1에 더한 것 (예전 창·예전 노래방은 모르는 칸·type을 지나친다):
//   창 → 노래방 hello{caps} · lyrics_req{items} · files{files, lrc} · aligned{songId, lrc|error}
//   노래방 → 창 welcome{caps} · lyrics{items} · align_req{songId,title,artist,lyrics} · align_stop{songId} · ack{n,songId} · nack{reason,songId}
// 받는 규칙: 보낸 창이 내가 연 창(Mr.win)이고 보낸 주소가 설정한 서버 주소의 origin일 때만 (core.js mrMessageOk).
// 서버 주소 (CR-231, 코드에는 주소 없음): ① 이 기기 nb-mrserver ② 허브 열쇠 칸 mr_server (hub.js Hub.mrServer, 메모리) ③ 없음.
// 없으면 창을 열지 않고 "주소가 아직 없어요" 안내. Drive·백업 파일·허브 곡 기록·콘솔에는 안 들어간다.
'use strict';

const MR_HELLO_MS = 10000;     // 창이 이 안에 인사(hello)를 안 하면 "못 닿았어요"
const Mr = { win: null, origin: '', linked: false, timer: 0, helloMs: MR_HELLO_MS, caps: [] };

// 허브에서 읽은 주소 (hub.js가 로그인 뒤 한 번 읽어 메모리에 둔다. 허브를 안 쓰면 '')
const mrHubValue = () => (typeof Hub !== 'undefined' && Hub && typeof Hub.mrServer === 'string' ? Hub.mrServer : '');
// 지금 쓸 서버 주소: 이 기기 값 → 허브 값 → '' (core.js mrServerPick, 모양이 틀린 값은 건너뜀)
function mrServer() { return mrServerPick(lsGet('nb-mrserver'), mrHubValue()).url; }

/* ---------------- 곡 목록: 창 열기 ---------------- */
function mrShowMsg(text, retry, go = false) {
  const box = $('#mrMsg'); if (!box) return;
  $('#mrMsgTxt').textContent = text;
  $('#mrRetry').hidden = !retry;
  const g = $('#mrGo'); if (g) g.hidden = !go;
  box.hidden = false;
}
// [주소 넣기]: 설정 창 → 더 보기 (고급) → MR 만들기 주소 칸을 펴고 초점 (사람이 누르는 길과 같다: 고급은 이 기기에 켜짐으로 남음)
function mrGoSettings() {
  haptic(); mrHideMsg();
  if (typeof openCloudDialog !== 'function') return;
  if (!$('#cloudDialog').open) openCloudDialog();
  if (!document.documentElement.classList.contains('adv')) $('#advBtn')?.click();
  const d = $('#mrAddr'); if (d) d.open = true;
  const i = $('#mrServer'); if (!i) return;
  try { i.scrollIntoView({ block: 'center' }); } catch {}
  i.focus();
}
function mrHideMsg() { const box = $('#mrMsg'); if (box) box.hidden = true; }

// 클릭 안에서 바로 연다 (await 뒤에 열면 팝업으로 막힌다). 이름 있는 창이라 다시 눌러도 같은 탭, noopener는 쓰지 않는다 (쓰면 주고받을 길이 끊김)
function openMr() {
  haptic();
  // 이미 이어진 창이 열려 있으면 다시 열지 않는다 (올리는 중인 곡이 끊기지 않게)
  if (Mr.win && !Mr.win.closed && Mr.linked) {
    try { Mr.win.focus(); } catch {}
    mrHideMsg();
    toast('MR 만들기 창이 이미 열려 있어요 · 브라우저 탭에서 "MR 만들기"를 눌러 주세요', 4500);
    return;
  }
  const base = mrServer();
  if (!base) { mrShowMsg(MR_NOSERVER_TEXT, false, true); return; }     // 주소가 없음 (CR-231): 창을 열지 않는다
  if (navigator.onLine === false) { mrShowMsg('⟳ 인터넷이 끊겨 있어서 집 AI 서버에 닿을 수 없어요 · 연결되면 다시 눌러 주세요', true); return; }
  let w = null;
  try { w = window.open(base + '/', 'yena-mr'); } catch {}
  clearTimeout(Mr.timer);
  if (!w) { mrShowMsg('새 창이 막혔어요. 주소창 오른쪽에서 이 사이트의 팝업을 허용해 주세요', true); return; }
  Mr.win = w; Mr.origin = new URL(base).origin; Mr.linked = false;
  mrHideMsg();
  Mr.timer = setTimeout(() => { if (!Mr.linked) mrShowMsg('⟳ 집 AI 서버에 못 닿았어요 · Tailscale이 켜져 있는지 확인해 주세요', true); }, Mr.helloMs);
}

/* ---------------- 창 → 노래방 메시지 ---------------- */
// 다른 창·편집 중이면 받지 않는다 (열려 있던 창과 입력은 그대로, 창은 파일을 가진 채 [노래방으로 보내기])
const mrBusy = () => !!document.querySelector('dialog[open]') || !!state.tv || !!state.sync || !$('#bulkDialog');
addEventListener('message', ev => {
  if (!Mr.win) return;
  const m = mrMessageOk(ev.data, { origin: ev.origin, mine: ev.source === Mr.win }, Mr.origin, f => f instanceof File);
  if (!m) return;
  const reply = o => { try { Mr.win.postMessage({ app: 'yena-mr', v: 1, ...o }, Mr.origin); } catch {} };
  if (m.type === 'hello') {
    Mr.linked = true; clearTimeout(Mr.timer); mrHideMsg();
    Mr.caps = m.caps || [];
    reply({ type: 'welcome', caps: ['lyrics', 'align'] });   // 새 창만 읽음: 가사를 물어도 되고(lyrics_req), 원곡 자동 싱크를 받음
    for (const x of Align.want.values()) x.sent = false;     // 창을 다시 열었으면(인사를 또 함) 기다리는 요청을 다시 보낸다 (창은 같은 곡을 한 줄로)
    alignFlush();
    return;
  }
  if (m.type === 'lyrics_req') { mrAnswerLyrics(m.items).then(items => reply({ type: 'lyrics', items })); return; }
  if (m.type === 'aligned') { alignGot(m, reply); return; }
  if (m.type !== 'files') return;
  if (m.bad) { reply({ type: 'nack', reason: 'bad' }); return; }
  if (mrBusy()) {
    toast('열려 있는 창을 닫고 MR 만들기 창에서 [노래방으로 보내기]를 다시 눌러 주세요', 6000);
    reply({ type: 'nack', reason: 'busy' });
    return;
  }
  openBulk(m.files, `MR 만들기로 만든 곡 ${m.files.length}개예요. 제목·가수를 확인해 주세요`, m.lrc);
  if ($('#bulkDialog').open) { haptic('success'); reply({ type: 'ack', n: m.files.length }); }
  else reply({ type: 'nack', reason: 'bad' });
});

/* ---------------- 가사 정렬 (CR-227 W7·W8) ---------------- */
// W7: 창이 MR을 만들며 같이 맞출 가사를 물으면(lyrics_req) 곡마다 한 번 답한다.
//     노래방에 같은 곡(제목·가수)이 있으면 그 가사, 없으면 LRCLIB /api/get (제목·가수·길이만, autosync.js lrclibGet).
//     시각이 이미 있는 가사는 synced:true (창은 맞추지 않음). 가사 글은 집 AI(창)로만 간다.
// W8: [원곡 파일로 자동 싱크] → 같은 이름 창('yena-mr')을 열고 align_req → 창에서 원곡 파일 고르기 → aligned
//     받은 결과는 autosync.js alignApply (low·이미 시각 있음이면 묻고 넣음). 창 열기는 openMr와 같은 방법.
const MR_LRC_WAIT_MS = 8000;   // lyrics_req 한 곡의 LRCLIB 기다림 (창은 15초 기다림)
const Align = { want: new Map(), watch: 0, waitFrom: 0 };   // songId → { req, sent }
const mrReply = o => { try { Mr.win.postMessage({ app: 'yena-mr', v: 1, ...o }, Mr.origin); } catch {} };

async function mrAnswerLyrics(items) {
  const out = [];
  for (const it of items) {
    const n = titleFromFilename(it.name);
    const own = findSameSong(state.songs, n.title, n.artist);
    let a = own ? mrLyricsFor(own) : null;
    if (!a && navigator.onLine !== false && typeof lrclibGet === 'function') {
      const p = lrclibGetParams(n.title, n.artist, it.duration);
      if (p) {
        try { a = mrLyricsFromLrclib(await Promise.race([lrclibGet(p), sleep(MR_LRC_WAIT_MS).then(() => null)])); }
        catch { a = null; }
      }
    }
    out.push({ key: it.key, synced: !!(a && a.synced), text: a && !a.synced ? a.text : '' });
  }
  return out;
}

// W8 시작 (클릭 안에서 바로 창을 연다: await 뒤에 열면 팝업으로 막힘)
function alignStart(s) {
  haptic();
  if (!s || !state.songs.includes(s) || !canAlignSong(s)) return;
  if (typeof syncLineShow !== 'function') return;
  if (!mrServer()) { syncLineShow('alignfail', s, 'noserver'); return; }     // 주소가 없음 (CR-231): 창을 열지 않는다
  if (navigator.onLine === false) { syncLineShow('alignfail', s, 'unreachable'); return; }
  const req = { type: 'align_req', songId: s.id, title: String(s.title || '').slice(0, 200), artist: String(s.artist || '').slice(0, 200), lyrics: alignLyricsText(s) };
  Align.want.set(s.id, { req, sent: false });
  syncLineShow('aligning', s);
  if (Mr.win && !Mr.win.closed && Mr.linked) {
    try { Mr.win.focus(); } catch {}
    alignFlush(); alignWatch();
    return;
  }
  const base = mrServer();
  let w = null;
  try { w = window.open(base + '/', 'yena-mr'); } catch {}
  if (!w) { Align.want.delete(s.id); syncLineShow('alignfail', s, 'blocked'); return; }
  clearTimeout(Mr.timer); mrHideMsg();
  Mr.win = w; Mr.origin = new URL(base).origin; Mr.linked = false; Mr.caps = [];
  for (const x of Align.want.values()) x.sent = false;
  Align.waitFrom = Date.now();
  alignWatch();
}
// 이어진 창에 아직 안 보낸 요청을 보낸다. 예전 창(caps에 align_req 없음)이면 "아직 못 해요"
function alignFlush() {
  if (!Mr.win || Mr.win.closed || !Mr.linked) return;
  for (const [id, w] of [...Align.want]) {
    if (w.sent) continue;
    if (!Mr.caps.includes('align_req')) { Align.want.delete(id); const s = songById(id); if (s) syncLineShow('alignfail', s, 'no_align'); continue; }
    w.sent = true; mrReply(w.req);
  }
  alignWatch();
}
// 기다리는 동안 1초마다: 창이 닫혔거나, 열었는데 10초 안에 인사가 없으면 줄을 바꾼다
function alignWatch() {
  if (Align.watch && Align.want.size) return;
  clearInterval(Align.watch); Align.watch = 0;
  if (!Align.want.size) return;
  Align.watch = setInterval(() => {
    if (!Align.want.size) { clearInterval(Align.watch); Align.watch = 0; return; }
    const closed = !Mr.win || Mr.win.closed;
    if (Mr.linked) Align.waitFrom = 0; else if (!Align.waitFrom) Align.waitFrom = Date.now();
    const late = !closed && !Mr.linked && Date.now() - Align.waitFrom > Mr.helloMs;
    if (!closed && !late) return;
    for (const id of [...Align.want.keys()]) { Align.want.delete(id); const s = songById(id); if (s) syncLineShow('alignfail', s, closed ? 'closed' : 'unreachable'); }
    clearInterval(Align.watch); Align.watch = 0;
  }, 1000);
}
// [그만두기]: 창에 알리고(보낸 요청만) 줄을 지운다
function alignStop(s) {
  haptic();
  const w = s && Align.want.get(s.id);
  if (!w) return;
  Align.want.delete(s.id);
  if (w.sent) mrReply({ type: 'align_stop', songId: s.id });
  alignWatch();
  if (typeof syncLineClear === 'function') syncLineClear(s);
}
// 창 → aligned. 기다리지 않던 곡·지운 곡이면 ack{n:0} (창은 버림), 오류는 줄에, 결과는 바쁘면 nack busy (창이 [노래방으로 보내기])
function alignGot(m, reply) {
  const w = Align.want.get(m.songId), s = w && songById(m.songId);
  if (!w || !s) { if (!m.error) reply({ type: 'ack', n: 0, songId: m.songId }); return; }
  if (m.error) { Align.want.delete(s.id); alignWatch(); syncLineShow('alignfail', s, m.error); return; }
  if (alignLyricsText(s) !== w.req.lyrics) {          // 맞추는 사이에 가사를 고침: 옛 가사의 시각이라 넣지 않음
    Align.want.delete(s.id); alignWatch();
    reply({ type: 'ack', n: 0, songId: s.id });
    syncLineShow('alignfail', s, 'changed');
    return;
  }
  if (mrBusy()) {
    toast('열려 있는 창을 닫고 MR 만들기 창에서 [노래방으로 보내기]를 다시 눌러 주세요', 6000);
    reply({ type: 'nack', reason: 'busy', songId: s.id });
    return;
  }
  Align.want.delete(s.id); alignWatch();
  reply({ type: 'ack', n: 1, songId: s.id });
  haptic('success');
  if (typeof alignApply === 'function') alignApply(s, m);
}

/* ---------------- 설정 창: 서버 주소 (이 기기 + 로그인했으면 허브) ---------------- */
// 예시 주소는 자리 표시만 (실제 주소를 코드·화면에 쓰지 않는다)
const MR_WHY = {
  scheme: '주소는 http:// 또는 https://로 시작해야 해요 (예: http://(집 AI 이름):8765)',
  userinfo: '주소에 @(사용자 이름·비밀번호)는 넣지 않아요 (예: http://(집 AI 이름):8765)',
  bad: '주소 모양이 맞지 않아요 (예: http://(집 AI 이름):8765)',
};
let mrSaveSeq = 0;      // [저장]을 빨리 두 번 누르면 나중 것의 안내만
function mrSetMsg(text, err) {
  const m = $('#mrSetMsg'); if (!m) return;
  m.textContent = text || ''; m.hidden = !text; m.classList.toggle('err', !!err);
}
function mrFill() { const i = $('#mrServer'); if (i) i.value = mrServer(); mrSetMsg(''); }
// [저장]: 이 기기에 저장 → 허브에 로그인해 있으면 허브 열쇠 칸에도 (hub.js hubMrServerSet). 허브가 실패해도 이 기기 값은 그대로
async function mrSave() {
  const i = $('#mrServer'); if (!i) return;
  const v = i.value.trim();
  if (!v) { mrClearLocal(); return; }          // 비우고 저장하면 [이 기기에서 지우기]와 같다
  const r = normalizeMrServer(v);
  if (!r.ok) { haptic('warning'); mrSetMsg(MR_WHY[r.why] || MR_WHY.bad, true); return; }
  lsSet('nb-mrserver', r.url);
  i.value = r.url; haptic('success');
  const seq = ++mrSaveSeq;
  if (typeof hubMrServerSet !== 'function' || typeof hubOn !== 'function' || !hubOn()) { mrSetMsg(MR_SAVE_TEXT.device); return; }
  mrSetMsg(MR_SAVE_TEXT.saving);
  let res = 'fail';
  try { res = await hubMrServerSet(r.url); } catch { res = 'fail'; }
  if (seq !== mrSaveSeq) return;
  mrSetMsg(res === 'ok' ? MR_SAVE_TEXT.hub : res === 'off' ? MR_SAVE_TEXT.device : MR_SAVE_TEXT.hubfail, res === 'fail');
}
// [이 기기에서 지우기]: 이 기기 nb-mrserver만 지운다 (허브 값은 그대로). 칸에는 허브 값이 있으면 그것, 없으면 빈 칸
function mrClearLocal() {
  ++mrSaveSeq;
  lsSet('nb-mrserver', null); haptic();
  const hub = mrServerPick('', mrHubValue()).url;
  const i = $('#mrServer'); if (i) i.value = hub;
  mrSetMsg(mrClearText(!!hub));
}
// 허브에서 주소가 왔을 때 (hub.js가 부름): 설정 창이 열려 있고 칸이 비어 있으면(고치는 중이 아니면) 채운다
function mrHubArrived() {
  const i = $('#mrServer'); if (!i) return;
  if ($('#cloudDialog')?.open && (document.activeElement === i || i.value.trim())) return;
  i.value = mrServer();
}

// 버튼·칸 연결. 배포 직후 캐시로 화면(index.html)이 예전 것이면 요소가 없을 수 있어서, 없으면 건너뛴다
{
  const on = (sel, ev, fn) => $(sel)?.addEventListener(ev, fn);
  on('#mrBtn', 'click', openMr);
  on('#mrRetry', 'click', () => { Mr.linked = false; openMr(); });
  on('#mrGo', 'click', mrGoSettings);
  on('#mrSave', 'click', mrSave);
  on('#mrReset', 'click', mrClearLocal);
  on('#mrServer', 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); mrSave(); } });
  on('#cloudDialog', 'close', mrFill);     // 저장하지 않고 닫으면 다음에 열 때 저장된 주소로
  mrFill();
}
