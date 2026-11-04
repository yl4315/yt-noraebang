// YT 노래방 · MR 만들기 (CR-089): 내 노래 파일 → 집 AI 서버가 목소리를 뺀 MR → "여러 곡 한 번에 넣기" 창
// 곡 목록 [내 노래 파일에서 MR 만들기]가 집 AI 서버의 "MR 만들기 창"(서버 주소 + '/')을 새 탭으로 연다.
// 파일 고르기·올리기·진행 표시는 그 창이 하고, 다 만든 MR 파일을 창끼리(postMessage) 넘겨 준다.
// 노래방은 서버에 직접 요청하지 않는다 (https 노래방 → http 서버는 브라우저가 막음). 받은 파일은 openBulk(CR-017) 그대로.
// 메시지 약속(yena-mr README): 모두 {app:'yena-mr', v:1, type}
//   창 → 노래방 hello · files{files}   /   노래방 → 창 welcome · ack{n} · nack{reason:'busy'|'bad'}
// 받는 규칙: 보낸 창이 내가 연 창(Mr.win)이고 보낸 주소가 설정한 서버 주소의 origin일 때만 (core.js mrMessageOk).
// 서버 주소는 이 기기만 (nb-mrserver, 기본값과 같으면 지움). Drive·백업 파일에는 안 들어간다.
'use strict';

const MR_HELLO_MS = 10000;     // 창이 이 안에 인사(hello)를 안 하면 "못 닿았어요"
const Mr = { win: null, origin: '', linked: false, timer: 0, helloMs: MR_HELLO_MS };

// 지금 쓸 서버 주소 (설정 값이 틀렸으면 기본값)
function mrServer() {
  const v = lsGet('nb-mrserver'), r = v ? normalizeMrServer(v) : null;
  return r && r.ok ? r.url : MR_DEFAULT_SERVER;
}

/* ---------------- 곡 목록: 창 열기 ---------------- */
function mrShowMsg(text, retry) {
  const box = $('#mrMsg'); if (!box) return;
  $('#mrMsgTxt').textContent = text;
  $('#mrRetry').hidden = !retry;
  box.hidden = false;
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
  if (navigator.onLine === false) { mrShowMsg('⟳ 인터넷이 끊겨 있어서 집 AI 서버에 닿을 수 없어요 · 연결되면 다시 눌러 주세요', true); return; }
  const base = mrServer();
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
    reply({ type: 'welcome' });
    return;
  }
  if (m.type !== 'files') return;
  if (m.bad) { reply({ type: 'nack', reason: 'bad' }); return; }
  if (mrBusy()) {
    toast('열려 있는 창을 닫고 MR 만들기 창에서 [노래방으로 보내기]를 다시 눌러 주세요', 6000);
    reply({ type: 'nack', reason: 'busy' });
    return;
  }
  openBulk(m.files, `MR 만들기로 만든 곡 ${m.files.length}개예요. 제목·가수를 확인해 주세요`);
  if ($('#bulkDialog').open) { haptic('success'); reply({ type: 'ack', n: m.files.length }); }
  else reply({ type: 'nack', reason: 'bad' });
});

/* ---------------- 설정 창: 서버 주소 (이 기기만) ---------------- */
const MR_WHY = {
  scheme: '주소는 http:// 또는 https://로 시작해야 해요 (예: http://dgxspark-yena:8765)',
  userinfo: '주소에 @(사용자 이름·비밀번호)는 넣지 않아요 (예: http://dgxspark-yena:8765)',
  bad: '주소 모양이 맞지 않아요 (예: http://dgxspark-yena:8765)',
};
function mrSetMsg(text, err) {
  const m = $('#mrSetMsg'); if (!m) return;
  m.textContent = text || ''; m.hidden = !text; m.classList.toggle('err', !!err);
}
function mrFill() { const i = $('#mrServer'); if (i) i.value = mrServer(); mrSetMsg(''); }
function mrSave() {
  const i = $('#mrServer'); if (!i) return;
  const v = i.value.trim();
  if (!v) { mrReset(); return; }          // 비우고 저장하면 기본값
  const r = normalizeMrServer(v);
  if (!r.ok) { haptic('warning'); mrSetMsg(MR_WHY[r.why] || MR_WHY.bad, true); return; }
  lsSet('nb-mrserver', r.url === MR_DEFAULT_SERVER ? null : r.url);
  i.value = r.url; haptic('success');
  mrSetMsg('저장했어요. [MR 만들기]를 누르면 이 주소로 열어요');
}
function mrReset() {
  lsSet('nb-mrserver', null); haptic();
  const i = $('#mrServer'); if (i) i.value = MR_DEFAULT_SERVER;
  mrSetMsg('기본값으로 돌렸어요');
}

// 버튼·칸 연결. 배포 직후 캐시로 화면(index.html)이 예전 것이면 요소가 없을 수 있어서, 없으면 건너뛴다
{
  const on = (sel, ev, fn) => $(sel)?.addEventListener(ev, fn);
  on('#mrBtn', 'click', openMr);
  on('#mrRetry', 'click', () => { Mr.linked = false; openMr(); });
  on('#mrSave', 'click', mrSave);
  on('#mrReset', 'click', mrReset);
  on('#mrServer', 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); mrSave(); } });
  on('#cloudDialog', 'close', mrFill);     // 저장하지 않고 닫으면 다음에 열 때 저장된 주소로
  mrFill();
}
