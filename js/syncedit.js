// YT 노래방 · 가사 싱크 편집기
'use strict';

/* ---------------- 가사 싱크 편집 ---------------- */
function enterSync() {
  const s = state.song; if (!s || s.demo) return;
  const p = parseLyrics(s.lyrics);
  if (!p.lines.some(l => l.text)) { toast('먼저 곡 수정(연필 아이콘)에서 가사를 넣어 주세요', 3500); return; }
  stopPlayback(); hideScore();
  const off = s.lyricOffset || 0;
  let lines;
  if (p.synced) {
    lines = p.lines.map(l => ({ t: Math.max(0, l.t - off), text: l.text }));
    if (lines[lines.length - 1].text) lines.push({ t: Infinity, text: '' });
  } else {
    lines = p.lines.filter(l => l.text).map(l => ({ t: Infinity, text: l.text }));
    lines.push({ t: Infinity, text: '' });
  }
  const firstUnset = lines.findIndex(l => !isFinite(l.t));
  state.sync = { sel: firstUnset < 0 ? 0 : firstUnset, now: -2, history: [] };
  state.lines = lines; state.autoTimed = false;
  $('#autoBadge').hidden = true; $('#syncBadge').hidden = false;
  $('#syncPanel').hidden = false; $('#deck').hidden = true;
  resetLineCache(); renderSyncList(); updateTransportUI(); updateTimeUI(0);
  $('#syncPanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function renderSyncList() {
  const sy = state.sync, ol = $('#syList'); ol.textContent = '';
  state.lines.forEach((l, i) => {
    const li = document.createElement('li');
    li.className = 'sy-row' + (i === sy.sel ? ' sel' : '') + (i === state.active ? ' now' : '');
    li.innerHTML = '<button class="sy-time" type="button" title="이 부분부터 듣기"></button><button class="nud" type="button" title="0.1초 빠르게 (Shift: 1초)">◀</button><button class="nud" type="button" title="0.1초 늦게 (Shift: 1초)">▶</button><span class="sy-text"></span>';
    const [tb, minus, plus] = li.querySelectorAll('button'), tx = li.querySelector('.sy-text');
    const set = isFinite(l.t);
    tb.textContent = set ? fmtMs(l.t) : '--:--.--'; tb.classList.toggle('unset', !set);
    tx.textContent = l.text || (i === state.lines.length - 1 ? '(마지막 줄이 끝나는 곳)' : '(간주)');
    tx.classList.toggle('gap', !l.text);
    tb.onclick = e => { e.stopPropagation(); sy.sel = i; if (set) { seekTo(Math.max(0, l.t - 2)); if (!state.playing) play(); } renderSyncList(); };
    minus.onclick = e => { e.stopPropagation(); if (set) { l.t = Math.max(0, l.t - (e.shiftKey ? 1 : 0.1)); resetLineCache(); renderSyncList(); } };
    plus.onclick = e => { e.stopPropagation(); if (set) { l.t += e.shiftKey ? 1 : 0.1; resetLineCache(); renderSyncList(); } };
    li.onclick = () => { sy.sel = i; renderSyncList(); };
    ol.append(li);
  });
  const sel = ol.children[sy.sel];
  if (sel) { const top = sel.offsetTop - ol.offsetTop; if (top < ol.scrollTop || top > ol.scrollTop + ol.clientHeight - 40) ol.scrollTop = top - ol.clientHeight / 3; }
  sy.now = state.active;
  const n = state.lines.filter(l => l.text).length, done = state.lines.filter(l => l.text && isFinite(l.t)).length;
  $('#syStatus').textContent = `${done} / ${n}줄 맞춤` + (done < n ? ' · 시간이 없는 줄은 저장할 때 빠져요' : '');
  $('#syUndo').disabled = !sy.history.length;
}
function syncStamp() {
  const sy = state.sync; if (!sy || !state.playing) return;
  const t = Math.max(0, heardTime(curTime()) - 0.05), L = state.lines, l = L[sy.sel]; if (!l) return;
  sy.history.push({ times: L.map(x => x.t), sel: sy.sel });
  l.t = t;
  for (let j = sy.sel + 1; j < L.length; j++) if (isFinite(L[j].t) && L[j].t <= t) L[j].t = Infinity;
  for (let j = 0; j < sy.sel; j++) if (isFinite(L[j].t) && L[j].t >= t) L[j].t = Infinity;
  if (sy.sel < L.length - 1) sy.sel++;
  resetLineCache(); renderSyncList();
}
// 마지막으로 누른 걸 취소: 시간을 되돌리고 그 줄을 다시 고른 뒤 3초 앞부터 다시 들려준다
function syncUndo() {
  const sy = state.sync, h = sy?.history.pop(); if (!h) return;
  state.lines.forEach((l, i) => { l.t = h.times[i]; });
  sy.sel = h.sel;
  const t = curTime();
  seekTo(Math.max(0, t - 3));
  resetLineCache(); renderSyncList();
  toast('취소했어요. 그 줄이 시작될 때 다시 누르세요', 2000);
}
async function exitSync(save) {
  const sy = state.sync; if (!sy) return;
  stopPlayback();
  state.rate = 1; $('#sySpeed').value = '1';
  state.sync = null;
  $('#syncPanel').hidden = true; $('#deck').hidden = false; $('#syncBadge').hidden = true;
  const s = state.song;
  if (save) {
    const lines = state.lines.filter(l => isFinite(l.t)).sort((a, b) => a.t - b.t);
    s.lyrics = toLRC(lines); s.lyricOffset = 0;
    await persistSong(s);
    toast('가사 싱크를 저장했어요');
  }
  computeLines(); updateLyrOffUI(); updateTransportUI(); updateTimeUI(0);
}
$('#syncBtn').onclick = enterSync;
$('#syStamp').onclick = syncStamp;
$('#syUndo').onclick = syncUndo;
$('#syPlay').onclick = () => state.playing ? pause() : play();
$('#syBack').onclick = () => seekTo(Math.max(0, curTime() - 3));
function setSyncRate(r) {
  state.rate = r; $('#sySpeed').value = String(r);
  if (state.playing) seekTo(curTime());
  flash(`${r}배속`);
}
$('#sySpeed').onchange = e => setSyncRate(+e.target.value);
$('#sySave').onclick = () => exitSync(true);
$('#syCancel').onclick = () => exitSync(false);
