// YT 노래방 · 노래방 기능: 예약, 번호 입력, 검색, TV 화면, 단축키, 간주점프, 인기차트, 동영상
'use strict';

/* ---------------- 컨트롤 ---------------- */
for (const inp of document.querySelectorAll('.knob input[data-key]')) {
  inp.addEventListener('input', () => {
    settings[inp.dataset.key] = +inp.value;
    if (inp.dataset.key === 'recOffset') settings.recOffsetTouched = true;
    applySettings(); saveSettings();
  });
}
$('#t-monitor').addEventListener('change', e => { settings.monitor = e.target.checked; applySettings(); saveSettings(); if (settings.monitor && !state.micOn) enableMic(); });
$('#t-speakerMode').addEventListener('change', e => { settings.speakerMode = e.target.checked; saveSettings(); if (state.micOn) enableMic(); });
$('#micBtn').onclick = () => enableMic();

function showTab(which) {
  $('#minePanel').hidden = which !== 'mine'; $('#tabMine').classList.toggle('on', which === 'mine'); $('#tabMine').setAttribute('aria-selected', which === 'mine');
  if (which === 'mine') { renderMine(); $('#songsPanel').hidden = true; $('#recsPanel').hidden = true; $('#tabSongs').classList.remove('on'); $('#tabRecs').classList.remove('on'); return; }
  const songs = which === 'songs';
  $('#songsPanel').hidden = !songs; $('#recsPanel').hidden = songs;
  $('#tabSongs').classList.toggle('on', songs); $('#tabRecs').classList.toggle('on', !songs);
  $('#tabSongs').setAttribute('aria-selected', songs); $('#tabRecs').setAttribute('aria-selected', !songs);
}
$('#tabSongs').onclick = () => showTab('songs');
$('#tabRecs').onclick = () => showTab('recs');
$('#tabMine').onclick = () => showTab('mine');

/* ---------------- 예약 ---------------- */
const songById = id => state.songs.find(s => s.id === id);
const isIdle = () => !state.playing && state.offset < 0.5 && !state.sync;
function loadQueue() { try { return JSON.parse(localStorage.getItem('nb-queue') || '[]'); } catch { return []; } }
function saveQueue() { try { localStorage.setItem('nb-queue', JSON.stringify(state.queue)); } catch {} }
function reserve(s, priority) {
  if (!s) return;
  priority ? state.queue.unshift(s.id) : state.queue.push(s.id);
  saveQueue(); renderQueue();
  flash(`${priority ? '우선예약' : '예약'}  ${s.no}  ${s.title}`);
  // TV 대기 화면에서 예약하면 노래방처럼 바로 시작
  if (state.tv && isIdle() && nextAt == null && $('#scoreOverlay').hidden) startNext();
}
function unreserve(i) {
  const [id] = state.queue.splice(i, 1); saveQueue(); renderQueue();
  const s = songById(id); if (s) flash(`예약 취소  ${s.no}  ${s.title}`);
}
function moveToTop(i) {
  if (i <= 0) return;
  const [id] = state.queue.splice(i, 1); state.queue.unshift(id); saveQueue(); renderQueue();
  const s = songById(id); if (s) flash(`우선예약  ${s.no}  ${s.title}`);
}
async function startNext() {
  cancelNext();
  while (state.queue.length) {
    const s = songById(state.queue.shift()); saveQueue(); renderQueue();
    if (!s) continue;
    hideScore(); closeOverlays();
    await selectSong(s);
    if (state.song === s && s.buffer) { state.offset = 0; await play(); return; }
    flash(`${s.no} ${s.title} · 불러오지 못해 건너뛰었어요`);
  }
}
function togglePlay() {
  if (state.playing) return pause();
  if (state.offset > 0.5 || state.sync) return play();
  if (state.queue.length && (state.tv || state.queue[0] === state.song?.id)) return startNext();
  return play();
}
function renderQueue() {
  state.queue = state.queue.filter(id => songById(id));
  const q = state.queue.map(songById), el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text });
  const chips = $('#qChips'); chips.textContent = ''; chips.hidden = !q.length;
  if (q.length) {
    chips.append(el('span', 'lbl', '예약'));
    q.slice(0, 4).forEach(s => chips.append(el('span', 'chip', s.no)));
    if (q.length > 4) chips.append(el('span', 'more', `+${q.length - 4}`));
  }
  $('#qCount').textContent = q.length;
  const ol = $('#idleQueue'); ol.textContent = '';
  $('#idleEmpty').hidden = q.length > 0; $('#idleCount').textContent = q.length ? `${q.length}곡` : '';
  q.slice(0, 7).forEach((s, i) => {
    const li = document.createElement('li');
    const t = el('span', 't', s.title); t.append(el('small', '', s.artist || ''));
    li.append(el('span', 'i', i + 1), el('span', 'n', s.no), t); ol.append(li);
  });
  if (q.length > 7) { const li = document.createElement('li'); li.append(el('span', 'i', ''), el('span', 'n', ''), el('span', 't', `외 ${q.length - 7}곡`)); ol.append(li); }
  if (!$('#queueOv').hidden) renderQueueList();
  renderIdleChart();
}
function songRow(s, idx, sel, acts, extra) {
  const li = document.createElement('li'); li.className = 'ov-row' + (sel ? ' sel' : '');
  li.innerHTML = '<span class="idx"></span><span class="no"></span><span class="nm"></span><span class="acts"></span>';
  li.querySelector('.idx').textContent = idx;
  li.querySelector('.no').textContent = s.no;
  li.querySelector('.nm').append(s.title, Object.assign(document.createElement('small'), { textContent: s.artist || '' }));
  if (s.video) li.querySelector('.nm').append(videoTag());
  if (isFav(s)) li.querySelector('.nm').append(el('small', 'stat', '♥'));
  if (!onDevice(s)) li.querySelector('.nm').append(el('small', '', '☁'));
  if (extra) li.querySelector('.nm').append(Object.assign(document.createElement('small'), { className: 'stat', textContent: extra }));
  for (const [txt, cls, fn] of acts) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + cls; b.textContent = txt;
    b.onclick = e => { e.stopPropagation(); fn(); }; li.querySelector('.acts').append(b);
  }
  return li;
}

/* 곡 번호 입력 (리모컨 숫자 버튼) */
let numBuf = '', numTimer;
function numKey(d) { if (numBuf.length >= 5) numBuf = ''; numBuf += d; updateNumBox(); }
function updateNumBox() {
  clearTimeout(numTimer);
  const box = $('#numBox'); box.hidden = !numBuf; if (!numBuf) return;
  const dg = $('#numDigits'); dg.textContent = numBuf;
  if (numBuf.length < 5) dg.append(Object.assign(document.createElement('span'), { className: 'ph', textContent: '_'.repeat(5 - numBuf.length) }));
  const s = state.songs.find(x => String(x.no) === numBuf), ns = $('#numSong');
  ns.textContent = s ? `${s.title} · ${s.artist || '가수 미상'}` : numBuf.length >= 5 ? '없는 번호예요' : '번호를 마저 눌러 주세요';
  ns.classList.toggle('miss', !s);
  numTimer = setTimeout(() => { numBuf = ''; updateNumBox(); }, 7000);
}
function reserveByNumber(priority) {
  const s = state.songs.find(x => String(x.no) === numBuf);
  numBuf = ''; updateNumBox();
  if (s) reserve(s, priority); else flash('없는 번호예요');
}
let flashTimer;
function flash(text, ms = 2500) {
  const el = $('#flash'); el.textContent = text; el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(flashTimer); flashTimer = setTimeout(() => el.hidden = true, ms);
}
function bumpSetting(k, d) {
  settings[k] = clamp(settings[k] + d, 0, 100); applySettings(); saveSettings();
  flash(`${k === 'mrVol' ? '반주' : '마이크'} 볼륨 ${settings[k]}`);
}

/* 곡 검색: 제목·가수·번호·초성 */
const searchSongs = query => searchIn(state.songs, query);
let searchSel = 0, searchResults = [];
function openSearch() {
  if (state.sync) return;
  closeOverlays(); $('#searchOv').hidden = false;
  const inp = $('#searchInput'); inp.value = ''; runSearch(); inp.focus();
}
function runSearch() { searchResults = searchSongs($('#searchInput').value); searchSel = 0; renderSearch(); }
function renderSearch() {
  const ul = $('#searchList'); ul.textContent = '';
  if (!searchResults.length) { ul.innerHTML = '<li class="ov-empty">찾는 곡이 없어요. 관리 화면의 “곡 추가”로 MR을 넣어 주세요</li>'; return; }
  searchResults.forEach((s, i) => {
    const li = songRow(s, '', i === searchSel, [['예약', 'primary', () => reserve(s, false)], ['우선예약', '', () => reserve(s, true)], [isFav(s) ? '♥' : '♡', 'ghost', () => toggleFav(s)]]);
    li.onclick = () => { searchSel = i; renderSearch(); $('#searchInput').focus(); };
    li.ondblclick = () => reserve(s, false);
    ul.append(li);
  });
  ul.children[searchSel]?.scrollIntoView({ block: 'nearest' });
}
$('#searchInput').addEventListener('input', runSearch);
$('#searchInput').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); searchSel = clamp(searchSel + (e.key === 'ArrowDown' ? 1 : -1), 0, Math.max(0, searchResults.length - 1)); renderSearch();
  } else if (e.key === 'Enter') { e.preventDefault(); const s = searchResults[searchSel]; if (s) reserve(s, e.shiftKey); }
  else if (e.key === 'Escape') { e.preventDefault(); closeOverlays(); }
});
$('#searchClose').onclick = () => closeOverlays();

/* 예약 목록 창 */
let queueSel = 0;
function openQueue() { if (state.sync) return; closeOverlays(); queueSel = 0; $('#queueOv').hidden = false; renderQueueList(); }
function renderQueueList() {
  const ul = $('#queueList'), q = state.queue; ul.textContent = '';
  $('#queueHint').textContent = q.length ? `${q.length}곡 예약됨` : '';
  if (!q.length) { ul.innerHTML = '<li class="ov-empty">예약된 곡이 없어요. 번호를 누르거나 곡 검색에서 예약하세요</li>'; return; }
  queueSel = clamp(queueSel, 0, q.length - 1);
  q.forEach((id, i) => {
    const s = songById(id);
    const li = songRow(s, i + 1, i === queueSel, [
      ['지금 부르기', 'primary', () => { state.queue.splice(i, 1); state.queue.unshift(id); startNext(); }],
      ['맨 위로', '', () => moveToTop(i)],
      ['취소', 'ghost danger', () => unreserve(i)],
    ]);
    li.onclick = () => { queueSel = i; renderQueueList(); };
    ul.append(li);
  });
  ul.children[queueSel]?.scrollIntoView({ block: 'nearest' });
}
function queueKey(e) {
  const k = e.key, n = state.queue.length;
  if (k === 'ArrowDown' || k === 'ArrowUp') { queueSel = clamp(queueSel + (k === 'ArrowDown' ? 1 : -1), 0, Math.max(0, n - 1)); renderQueueList(); }
  else if ((k === 'Delete' || k === 'Backspace') && n) unreserve(queueSel);
  else if ((k === 'p' || k === 'P' || k === 'ㅔ') && n) { moveToTop(queueSel); queueSel = 0; renderQueueList(); }
  else if (k === 'Enter' && n) { const [id] = state.queue.splice(queueSel, 1); state.queue.unshift(id); startNext(); }
  else if (k === 'Escape' || k === 'l' || k === 'L' || k === 'ㅣ') closeOverlays();
  else return;
  e.preventDefault();
}
function closeOverlays() { for (const id of ['#searchOv', '#queueOv', '#chartOv', '#mineOv']) $(id).hidden = true; $('#searchInput').blur(); }
$('#queueClose').onclick = () => closeOverlays();
$('#openSearchBtn').onclick = openSearch;
$('#openQueueBtn').onclick = openQueue;

/* 다음 곡 자동 시작 */
let nextAt = null;
function scheduleNext(ms) {
  const s = songById(state.queue[0]); if (!s) return;
  nextAt = performance.now() + ms;
  $('#nextNo').textContent = s.no; $('#nextTitle').textContent = s.title + (s.artist ? ' · ' + s.artist : '');
  $('#nextCard').hidden = false; tickNext();
}
function tickNext() {
  if (nextAt == null) return;
  const left = nextAt - performance.now();
  if (left <= 0) { startNext(); return; }
  $('#nextSec').textContent = Math.ceil(left / 1000);
}
function cancelNext() { nextAt = null; $('#nextCard').hidden = true; }
$('#nextNow').onclick = () => startNext();
$('#nextCancel').onclick = cancelNext;

/* 점수 기록 */
const scores = (() => { try { return JSON.parse(localStorage.getItem('nb-scores') || '[]'); } catch { return []; } })();
function addScore(s, score) {
  scores.unshift({ id: s.id, no: s.no, title: s.title, score, at: Date.now(), who: me().name }); scores.splice(30);
  try { localStorage.setItem('nb-scores', JSON.stringify(scores)); } catch {}
}
function renderBest() {
  const box = $('#bestBox'), el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text });
  box.textContent = '';
  const today = new Date().toDateString(), td = scores.filter(x => new Date(x.at).toDateString() === today);
  const best = td.length ? td.reduce((a, b) => b.score > a.score ? b : a) : null;
  box.append(el('div', 'lbl', '오늘 최고 점수'), el('div', 'val', best ? `${best.score}점` : '–'));
  const ol = document.createElement('ol');
  if (best) ol.append(el('li', '', best.title));
  if (scores.length) scores.slice(0, 3).forEach(x => ol.append(el('li', '', `최근 · ${x.score}점 ${x.title}${x.who ? ` (${x.who})` : ''}`)));
  else ol.append(el('li', '', '마이크를 켜고 부르면 점수가 쌓여요'));
  box.append(ol);
}
function renderClock() {
  const d = new Date();
  $('#clock').firstChild.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  $('#clockDate').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`;
}
function updateScreens(t) {
  const idle = state.tv && isIdle() && $('#scoreOverlay').hidden;
  $('#tvIdle').hidden = !idle;
  if (idle) $('#tv').classList.remove('hide-ui');
  $('#stage').classList.toggle('idle', idle);
  $('#titleCard').hidden = !!state.sync || (state.tv ? !(state.playing && t < 4.5) : (state.playing || state.offset > 0.5));
  const prog = $('#tvProg'); prog.hidden = !state.tv || idle || !dur();
  if (!prog.hidden) { prog.firstElementChild.style.width = (t / dur() * 100).toFixed(2) + '%'; prog.lastElementChild.textContent = `${fmt(t)} / ${fmt(dur())}`; }
}

/* ---------------- TV 화면 ---------------- */
let stageHome = null, uiTimer;
async function enterTV() {
  if (state.tv) return;
  if (state.sync) await exitSync(false);
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  const st = $('#stage'); stageHome = { parent: st.parentNode, next: st.nextSibling };
  $('#tvScreen').append(st); $('#tv').hidden = false; document.body.style.overflow = 'hidden';
  state.tv = true; renderBest(); renderClock(); updateScreens(curTime()); pokeUI();
  try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch {}
}
function exitTV() {
  if (!state.tv) return;
  disarmFirstInputFullscreen();
  state.tv = false; closeOverlays();
  stageHome.parent.insertBefore($('#stage'), stageHome.next);
  $('#tv').hidden = true; document.body.style.overflow = '';
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  updateScreens(curTime());
}
function pokeUI() {
  $('#tv').classList.remove('hide-ui'); clearTimeout(uiTimer);
  uiTimer = setTimeout(() => { if (state.playing) $('#tv').classList.add('hide-ui'); }, 3000);
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => toast('전체 화면을 열 수 없어요'));
}

/* 켜자마자 TV 화면 (주소에 ?tv=1 — "YT 노래방 TV로 켜기") */
// 브라우저는 사용자가 아무것도 누르지 않았을 때 전체 화면을 막는다(requestFullscreen이 실패한다).
// 그래서 아직 전체 화면이 아니면 처음 누르는 키나 클릭 한 번에 전체 화면을 시도한다. 그 키의 원래 동작은 그대로 한다.
const FS_HINT = '아무 키나 누르면 전체 화면이 돼요 · F 키도 돼요';
let fsArmed = null;
function screenCovered() {
  return !!document.fullscreenElement || matchMedia('(display-mode: fullscreen)').matches ||
    fillsScreen({ innerWidth, innerHeight, outerWidth, outerHeight }, { width: screen.width, height: screen.height });
}
async function startInTV() {
  await enterTV();
  // 크롬 --start-fullscreen으로 이미 창이 화면을 다 덮었으면 안내도 시도도 하지 않는다
  if (!state.tv || screenCovered() || !document.documentElement.requestFullscreen) return;
  armFirstInputFullscreen();
  flash(FS_HINT, 6000);
}
function armFirstInputFullscreen() {
  if (fsArmed) return;
  const go = () => {
    disarmFirstInputFullscreen();
    if (!state.tv || screenCovered()) return;
    document.documentElement.requestFullscreen()
      .then(() => { if ($('#flash').textContent === FS_HINT) $('#flash').hidden = true; })
      .catch(() => { if (state.tv && !document.fullscreenElement) armFirstInputFullscreen(); });   // 이 키로는 안 됐으면 다음 키에 다시
  };
  const onKey = e => {
    if (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'HangulMode', 'HanjaMode', 'Process'].includes(e.key)) return;
    if (e.key === 'Escape') return;                              // Esc로는 전체 화면을 켤 수 없다 (L11 순서는 그대로)
    if (['f', 'F', 'ㄹ', 't', 'T', 'ㅅ'].includes(e.key)) return disarmFirstInputFullscreen();   // F는 스스로 전체 화면, T는 TV에서 나가기
    go();
  };
  const onClick = e => {
    if (e.target.closest?.('[data-act="fs"],[data-act="exit"]')) return disarmFirstInputFullscreen();   // 전체 화면·나가기 버튼은 그 버튼대로
    go();
  };
  fsArmed = { onKey, onClick };
  addEventListener('keydown', onKey, true); addEventListener('click', onClick, true);
}
function disarmFirstInputFullscreen() {
  if (!fsArmed) return;
  removeEventListener('keydown', fsArmed.onKey, true); removeEventListener('click', fsArmed.onClick, true);
  fsArmed = null;
}
document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement) disarmFirstInputFullscreen(); });
function stopKey() {
  if (!$('#searchOv').hidden || !$('#queueOv').hidden) return closeOverlays();
  if (numBuf) { numBuf = ''; updateNumBox(); return; }
  if (nextAt != null) return cancelNext();
  if (!$('#scoreOverlay').hidden) return hideScore();
  if (state.playing || state.offset > 0.5) return cancelSong();
  if (state.tv) exitTV();
}
$('#tv').addEventListener('mousemove', pokeUI);
$('#tvBtn').onclick = enterTV;
$('#tvRemote').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  ({
    start: startKey, pause: () => state.playing ? pause() : (state.offset > 0.5 && play()), cancel: cancelSong,
    jump: jumpInterlude, search: openSearch, queue: openQueue, chart: openChart, mine: openMineOv, user: cycleProfile,
    'key-': () => setKey((state.key || 0) - 1), 'key+': () => setKey((state.key || 0) + 1),
    rec: () => setArmed(!state.armed), 'mr-': () => bumpSetting('mrVol', -5), 'mr+': () => bumpSetting('mrVol', 5),
    mic: () => enableMic(), fs: toggleFullscreen, exit: exitTV,
  })[b.dataset.act]?.();
  b.blur();
});

document.addEventListener('keydown', e => {
  if (e.target.closest?.('input[type=text],input[type=search],textarea,select,dialog')) return;
  const sy = state.sync, k = e.key, is = (...keys) => keys.includes(k);
  if (sy) {
    if (k === 'Backspace' || ((e.ctrlKey || e.metaKey) && is('z', 'Z', 'ㅋ'))) { e.preventDefault(); syncUndo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); state.playing ? syncStamp() : play(); }
    else if (k === 'Enter') { e.preventDefault(); state.playing ? pause() : play(); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); sy.sel = clamp(sy.sel + (k === 'ArrowUp' ? -1 : 1), 0, state.lines.length - 1); renderSyncList(); }
    else if (/^[1-4]$/.test(k)) { e.preventDefault(); setSyncRate(+k); }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('#mineOv').hidden) { mineKey(e); return; }
  if (!$('#queueOv').hidden) { queueKey(e); return; }
  if (!$('#chartOv').hidden) { chartKey(e); return; }
  if (/^[0-9]$/.test(k)) { e.preventDefault(); numKey(k); return; }
  if (numBuf) {
    if (k === 'Enter') { e.preventDefault(); reserveByNumber(false); return; }
    if (is('p', 'P', 'ㅔ')) { e.preventDefault(); reserveByNumber(true); return; }
    if (k === 'Backspace') { e.preventDefault(); numBuf = numBuf.slice(0, -1); updateNumBox(); return; }
  }
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (k === 'Enter') { if (e.target.closest?.('button,a,[tabindex]')) return; e.preventDefault(); togglePlay(); }
  else if (k === 'Escape') stopKey();
  else if (is('s', 'S', 'ㄴ', '/')) { e.preventDefault(); openSearch(); }
  else if (is('l', 'L', 'ㅣ')) openQueue();
  else if (is('c', 'C', 'ㅊ')) openChart();
  else if (is('m', 'M', 'ㅡ')) openMineOv();
  else if (is('u', 'U', 'ㅕ')) cycleProfile();
  else if (is('j', 'J', 'ㅓ')) jumpInterlude();
  else if (is('v', 'V', 'ㅍ')) toggleVideoLyrics();
  else if (is('r', 'R', 'ㄱ')) setArmed(!state.armed);
  else if (is('t', 'T', 'ㅅ')) state.tv ? exitTV() : enterTV();
  else if (is('f', 'F', 'ㄹ')) { if (state.tv) toggleFullscreen(); }
  else if (k === '{') nudgeLyrics(-1);
  else if (k === '}') nudgeLyrics(1);
  else if (k === ',' || k === '<') setKey((state.key || 0) - 1);
  else if (k === '.' || k === '>') setKey((state.key || 0) + 1);
  else if (k === '[') nudgeLyrics(-0.1);
  else if (k === ']') nudgeLyrics(0.1);
  else if (k === '-') bumpSetting('mrVol', -5);
  else if (is('=', '+')) bumpSetting('mrVol', 5);
});

/* ---------------- 간주점프 ---------------- */
function jumpInterlude() {
  if (!state.song?.buffer || state.sync) return;
  if (!state.playing) { flash('노래가 나올 때 쓸 수 있어요'); return; }
  const L = state.lines, off = lyricOffset(), t = curTime(), lt = heardTime(t) + off;
  if (!L.some(l => l.text)) { flash('가사가 없어서 점프할 곳을 몰라요'); return; }
  const a = activeIndex(lt);
  if (a >= 0 && L[a].text) {
    const next = L[a + 1]?.t, end = isFinite(next) ? next : L[a].t + 5;
    if (lt < L[a].t + Math.min((end - L[a].t) * 0.92, 7)) { flash('간주 때만 점프할 수 있어요'); return; }
  }
  const n = L.findIndex((l, i) => i > a && l.text && isFinite(l.t));
  if (n >= 0) {
    const target = L[n].t - off - 3;
    if (target - t < 2) { flash('곧 가사가 나와요'); return; }
    seekTo(target);
  } else seekTo(Math.max(t, dur() - 0.3));
  flash('간주점프');
}

/* ---------------- 인기차트: 이 노래방에서 많이 부른 곡 ---------------- */
const plays = (() => { try { return JSON.parse(localStorage.getItem('nb-plays') || '{}'); } catch { return {}; } })();
function countPlay(s) {
  const p = plays[s.id] || (plays[s.id] = { n: 0, last: 0 });
  p.n++; p.last = Date.now();
  try { localStorage.setItem('nb-plays', JSON.stringify(plays)); } catch {}
  renderIdleChart();
}
const playsOf = s => plays[s.id]?.n || 0;
function chartSongs() {
  return state.songs.slice().sort((a, b) => playsOf(b) - playsOf(a) || (plays[b.id]?.last || 0) - (plays[a.id]?.last || 0) || a.no - b.no);
}
function bestScoreOf(s) { let b = null; for (const x of scores) if ((x.id ? x.id === s.id : x.no === s.no) && (b == null || x.score > b)) b = x.score; return b; }
function chartStat(s) {
  const n = playsOf(s), best = bestScoreOf(s);
  return n ? `${n}회 부름${best != null ? ` · 최고 ${best}점` : ''}` : '아직 안 부름';
}
let chartSel = 0, chartItems = [];
function openChart() { if (state.sync) return; closeOverlays(); chartSel = 0; $('#chartOv').hidden = false; renderChart(); }
function renderChart() {
  const ul = $('#chartList'); ul.textContent = '';
  chartItems = chartSongs();
  chartItems.forEach((s, i) => {
    const li = songRow(s, i + 1, i === chartSel, [['예약', 'primary', () => reserve(s, false)], ['우선예약', '', () => reserve(s, true)]], chartStat(s));
    if (i < 3 && playsOf(s)) li.classList.add('top');
    li.onclick = () => { chartSel = i; renderChart(); };
    ul.append(li);
  });
  ul.children[chartSel]?.scrollIntoView({ block: 'nearest' });
}
function chartKey(e) {
  const k = e.key, n = chartItems.length;
  if (k === 'ArrowDown' || k === 'ArrowUp') { chartSel = clamp(chartSel + (k === 'ArrowDown' ? 1 : -1), 0, Math.max(0, n - 1)); renderChart(); }
  else if (k === 'Enter' && n) reserve(chartItems[chartSel], false);
  else if ((k === 'p' || k === 'P' || k === 'ㅔ') && n) reserve(chartItems[chartSel], true);
  else if (k === 'Escape' || k === 'c' || k === 'C' || k === 'ㅊ') closeOverlays();
  else return;
  e.preventDefault();
}
function renderIdleChart() {
  const top = chartSongs().filter(playsOf).slice(0, 5), box = $('#idleChart'), ol = $('#idleChartList');
  box.hidden = !top.length || state.queue.length > 3;
  ol.textContent = '';
  const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text });
  top.forEach((s, i) => {
    const li = document.createElement('li'), t = el('span', 't', s.title);
    t.append(el('small', '', `${playsOf(s)}회`));
    li.append(el('span', 'i', i + 1), el('span', 'n', s.no), t); ol.append(li);
  });
}
function startKey() { if (state.playing) flash('지금 부르는 중이에요'); else togglePlay(); }
function cancelSong() {
  if (!(state.playing || state.offset > 0.5)) { if (nextAt != null) cancelNext(); return; }
  stopPlayback(); flash('취소');
  if (state.tv && state.queue.length) scheduleNext(3000);
}
$('#chartClose').onclick = () => closeOverlays();
$('#openChartBtn').onclick = openChart;
$('#jumpBtn').onclick = jumpInterlude;

/* ---------------- 동영상 곡: 영상은 화면에만, 소리는 반주 엔진에서 ---------------- */
const isVideoBlob = b => /^video\//.test(b?.type || '');
let videoUrl = null;
const videoOn = () => !!(state.song?.video && state.song.blob);
function setupVideo(s) {
  const v = $('#stageVideo');
  if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = null; }
  const on = !!(s?.video && s.blob);
  v.hidden = !on;
  if (on) { videoUrl = URL.createObjectURL(s.blob); v.src = videoUrl; }
  else { v.removeAttribute('src'); v.load(); }
  applyVideoClasses();
}
function applyVideoClasses() {
  const on = videoOn();
  $('#stage').classList.toggle('has-video', on);
  $('#stage').classList.toggle('show-lyrics', !on || !!state.song?.videoLyrics);
}
// 매 프레임 영상을 반주 시계에 맞춘다. 조금 어긋나면 속도로, 많이 어긋나면 위치를 옮겨서.
function videoFollow() {
  if (!videoOn()) return;
  const v = $('#stageVideo');
  if (v.readyState < 1) return;
  if (state.playing) {
    const target = heardTime(curTime()), drift = v.currentTime - target;
    if (Math.abs(drift) > 0.3 && !v.seeking) { v.currentTime = target; v.playbackRate = state.rate; }
    else v.playbackRate = state.rate * (1 - clamp(drift, -0.1, 0.1) * 0.5);
    if (v.paused) v.play().catch(() => {});
  } else {
    if (!v.paused) v.pause();
    if (!v.seeking && Math.abs(v.currentTime - state.offset) > 0.05) v.currentTime = state.offset;
  }
}
function toggleVideoLyrics() {
  const s = state.song; if (!videoOn()) return;
  s.videoLyrics = !s.videoLyrics; applyVideoClasses(); persistSong(s);
  flash(s.videoLyrics ? '영상 위에 가사 보이기' : '영상 가사만 보기');
}
const videoTag = () => Object.assign(document.createElement('span'), { className: 'vtag', textContent: '영상' });
