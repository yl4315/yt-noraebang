// YT 노래방 · 사용자, 좋아요, 재생목록
'use strict';

/* ================= 사용자 · 좋아요 · 재생목록 ================= */
const AV_COLORS = ['#ff4fa3', '#40e0d0', '#ffbe3d', '#9d8cff', '#7ddc7a'];
const avColor = p => AV_COLORS[[...p.id].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
const Profiles = { list: [], cur: null };
const me = () => Profiles.cur;
const liveProfiles = () => Profiles.list.filter(p => !p.deleted);
function defaultProfile() { return { id: uid(), name: '나', favorites: [], playlists: [], updatedAt: Date.now(), auto: true }; }
function loadProfiles() {
  try { Profiles.list = JSON.parse(localStorage.getItem('nb-profiles') || '[]'); } catch { Profiles.list = []; }
  if (!liveProfiles().length) Profiles.list.push(defaultProfile());
  const want = localStorage.getItem('nb-profile');
  Profiles.cur = liveProfiles().find(p => p.id === want) || liveProfiles()[0];
}
// touched: 내용이 바뀐 사용자(Drive에 올릴 대상). 없으면 지금 고른 사용자만 저장
function saveProfiles(touched) {
  if (touched) { touched.updatedAt = Date.now(); delete touched.auto; Cloud.schedule(); }
  try { localStorage.setItem('nb-profiles', JSON.stringify(Profiles.list)); localStorage.setItem('nb-profile', me().id); } catch {}
}
function avatar(p) { const i = el('i', 'av', (p.name || '?').slice(0, 1)); i.style.background = avColor(p); return i; }
function renderProfileChip() {
  const av = $('#profAv'); av.textContent = me().name.slice(0, 1); av.style.background = avColor(me());
  $('#profName').textContent = me().name;
  $('#tvUserBtn').textContent = `사용자: ${me().name}`;
  renderIdleUser();
}
function renderIdleUser() {
  const box = $('#idleUser'); box.textContent = '';
  const keys = el('span', 'for-keys');      // 터치 화면에서는 키 안내를 숨긴다 (사용자 바꾸기는 조작 막대 "⋯ 더 보기")
  keys.append(' · ', el('kbd', '', 'M'), ' 내 목록 · ', el('kbd', '', 'U'), ' 사용자 바꾸기');
  box.append(avatar(me()), `${me().name} · ♥ ${me().favorites.filter(songById).length}곡`, keys);
}
function switchProfile(p) {
  Profiles.cur = p; saveProfiles();
  renderProfileChip(); renderSongs(); renderMine(); refreshOverlays(); renderBest();
  flash(`${p.name}님 차례예요`);
}
function cycleProfile() { const l = liveProfiles(); switchProfile(l[(l.indexOf(me()) + 1) % l.length]); }
const isFav = s => me().favorites.includes(s.id);
function toggleFav(s) {
  const p = me(), i = p.favorites.indexOf(s.id);
  if (i >= 0) p.favorites.splice(i, 1); else p.favorites.push(s.id);
  saveProfiles(p); renderSongs(); renderMine(); refreshOverlays(); renderIdleUser();
  flash(i >= 0 ? `좋아요 취소  ${s.title}` : `♥ 좋아요  ${s.title}`);
}
function reserveMany(ids, label) {
  const list = ids.map(songById).filter(Boolean);
  if (!list.length) { flash('예약할 곡이 없어요'); return; }
  const idle = state.tv && isIdle() && nextAt == null && $('#scoreOverlay').hidden;
  state.queue.push(...list.map(s => s.id)); saveQueue(); renderQueue();
  flash(`${label} · ${list.length}곡 예약`);
  if (idle) startNext();
}
function refreshOverlays() {
  if (!$('#searchOv').hidden) renderSearch();
  if (!$('#chartOv').hidden) renderChart();
  if (!$('#mineOv').hidden) renderMineOv();
}

/* 사용자 관리 창 */
let renamingId = null;
function openProfiles() { renamingId = null; renderProfileList(); $('#profileDialog').showModal(); }
function renderProfileList() {
  const ul = $('#profList'); ul.textContent = '';
  for (const p of liveProfiles()) {
    const li = el('li', 'prof-row' + (p === me() ? ' on' : '')), nm = el('div', 'nm'), acts = el('div', 'acts');
    let done = null;
    if (renamingId === p.id) {
      const inp = Object.assign(document.createElement('input'), { type: 'text', value: p.name, maxLength: 12, className: 'ren' });
      done = () => { const v = inp.value.trim(); if (v) { p.name = v; saveProfiles(p); renderProfileChip(); renderMine(); } renamingId = null; renderProfileList(); };
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(); } else if (e.key === 'Escape') { e.preventDefault(); renamingId = null; renderProfileList(); } };
      nm.append(inp); setTimeout(() => inp.focus(), 0);
    } else nm.append(el('b', '', p.name), el('small', '', `♥ ${p.favorites.length}곡 · 재생목록 ${p.playlists.length}개`));
    const mk = (t, cls, fn) => { const b = el('button', 'btn small ' + cls, t); b.type = 'button'; b.onclick = () => fn(b); acts.append(b); return b; };
    if (p === me()) mk('사용 중', 'ghost', () => {}).disabled = true;
    else mk('이 사용자로', 'primary', () => { switchProfile(p); renderProfileList(); });
    mk(done ? '저장' : '이름 바꾸기', '', () => { if (done) done(); else { renamingId = p.id; renderProfileList(); } });
    if (liveProfiles().length > 1) mk('삭제', 'ghost danger', b => confirmButton(b, () => {
      p.deleted = true; saveProfiles(p);
      if (p === me()) Profiles.cur = liveProfiles()[0];
      saveProfiles(); renderProfileChip(); renderSongs(); renderMine(); renderProfileList();
    }));
    li.append(avatar(p), nm, acts); ul.append(li);
  }
}
$('#profAdd').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#profNew').value.trim(); if (!name) return;
  const p = { id: uid(), name, favorites: [], playlists: [], updatedAt: Date.now() };
  Profiles.list.push(p); saveProfiles(p); $('#profNew').value = '';
  switchProfile(p); renderProfileList();
});
$('#profileBtn').onclick = openProfiles;
$('#profClose').onclick = () => $('#profileDialog').close();

/* 재생목록 */
function newPlaylist(name, firstSong) {
  const pl = { id: uid(), name, songs: firstSong ? [firstSong.id] : [] };
  me().playlists.push(pl); saveProfiles(me()); renderMine();
  return pl;
}
function togglePlaylistSong(pl, s) {
  const i = pl.songs.indexOf(s.id);
  if (i >= 0) pl.songs.splice(i, 1); else pl.songs.push(s.id);
  saveProfiles(me()); renderMine(); refreshOverlays();
}
let plFor = null;
function openPlPick(s) { plFor = s; $('#plSong').textContent = `${s.no} ${s.title}`; renderPlPick(); $('#plDialog').showModal(); }
function renderPlPick() {
  const ul = $('#plList'); ul.textContent = '';
  if (!me().playlists.length) ul.append(el('li', 'mine-empty', '아직 재생목록이 없어요. 아래에서 만들어 보세요'));
  for (const pl of me().playlists) {
    const li = document.createElement('li'), lb = document.createElement('label');
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: pl.songs.includes(plFor.id) });
    cb.onchange = () => { togglePlaylistSong(pl, plFor); renderPlPick(); };
    lb.append(cb, pl.name, el('small', 'hint', `${pl.songs.filter(songById).length}곡`));
    li.append(lb); ul.append(li);
  }
}
$('#plNewForm').addEventListener('submit', e => {
  e.preventDefault();
  const n = $('#plNewName').value.trim(); if (!n) return;
  newPlaylist(n, plFor); $('#plNewName').value = ''; renderPlPick();
});
$('#plClose').onclick = () => $('#plDialog').close();

/* 사이드 '내 목록' 탭 */
let plRenaming = null;
function renderMine() {
  const body = $('#mineBody'); body.textContent = '';
  $('#mineWho').textContent = `${me().name}님의 목록`;
  body.append(mineSection('♥ 좋아요', me().favorites, null));
  for (const pl of me().playlists) body.append(mineSection(pl.name, pl.songs, pl));
}
function mineSection(title, ids, pl) {
  const sec = el('div', 'mine-sec'), h = el('h4'), songs = ids.map(songById).filter(Boolean);
  const mk = (txt, cls, fn) => { const b = el('button', 'btn small ' + cls, txt); b.type = 'button'; b.onclick = e => { e.stopPropagation(); fn(b); }; h.append(b); return b; };
  if (pl && plRenaming === pl.id) {
    const inp = Object.assign(document.createElement('input'), { type: 'text', value: pl.name, maxLength: 30, className: 'ren' });
    const done = () => { const v = inp.value.trim(); if (v) { pl.name = v; saveProfiles(me()); } plRenaming = null; renderMine(); };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(); } else if (e.key === 'Escape') { plRenaming = null; renderMine(); } };
    h.append(inp); setTimeout(() => inp.focus(), 0);
    mk('저장', 'primary', done);
  } else {
    h.append(el('span', 'ttl', title), el('small', '', `${songs.length}곡`), el('span', 'grow'));
    mk('전체 예약', 'primary', () => reserveMany(ids, title));
    if (pl) {
      mk('이름', 'ghost', () => { plRenaming = pl.id; renderMine(); });
      mk('삭제', 'ghost danger', b => confirmButton(b, () => { me().playlists = me().playlists.filter(x => x !== pl); saveProfiles(me()); renderMine(); }));
    }
  }
  sec.append(h);
  if (!songs.length) sec.append(el('div', 'mine-empty', pl ? '곡 목록에서 ＋를 눌러 이 목록에 곡을 넣어요' : '곡 목록에서 ♡를 누르면 여기에 모여요'));
  for (const s of songs) {
    const row = el('div', 'mine-row'), t = el('span', 't', s.title), acts = el('span', 'acts');
    t.append(el('small', '', s.artist || ''));
    const ib = (txt, tip, fn, cls = 'icon-btn') => { const b = el('button', cls, txt); b.type = 'button'; b.title = tip; b.onclick = e => { e.stopPropagation(); fn(); }; acts.append(b); };
    ib('예약', '예약', () => reserve(s, false), 'btn small');
    if (pl && pl.songs.indexOf(s.id) > 0) ib('▲', '위로', () => {
      const j = pl.songs.indexOf(s.id); pl.songs.splice(j, 1); pl.songs.splice(j - 1, 0, s.id); saveProfiles(me()); renderMine();
    });
    ib('✕', pl ? '목록에서 빼기' : '좋아요 취소', () => pl ? togglePlaylistSong(pl, s) : toggleFav(s));
    row.append(el('span', 'no', s.no), t, acts);
    row.onclick = () => selectSong(s);
    sec.append(row);
  }
  return sec;
}
$('#newPlBtn').onclick = () => { $('#plInline').hidden = false; $('#plInlineName').focus(); };
$('#plInline').addEventListener('submit', e => {
  e.preventDefault();
  const n = $('#plInlineName').value.trim(); if (!n) return;
  newPlaylist(n); $('#plInlineName').value = ''; $('#plInline').hidden = true;
});

/* TV '내 목록' 창 */
let mineSel = 0, mineItems = [];
function openMineOv() { if (state.sync) return; closeOverlays(); mineSel = 0; $('#mineOv').hidden = false; renderMineOv(); }
function renderMineOv() {
  const ul = $('#mineList'); ul.textContent = '';
  $('#mineOvWho').textContent = `${me().name}님의 좋아요와 재생목록 · U로 사용자 바꾸기`;
  mineItems = [];
  for (const g of [{ title: '♥ 좋아요', ids: me().favorites }, ...me().playlists.map(pl => ({ title: pl.name, ids: pl.songs }))]) {
    const songs = g.ids.map(songById).filter(Boolean);
    mineItems.push({ head: g, songs });
    for (const s of songs) mineItems.push({ s });
  }
  mineSel = clamp(mineSel, 0, Math.max(0, mineItems.length - 1));
  mineItems.forEach((it, i) => {
    let li;
    if (it.head) {
      li = el('li', 'ov-row ov-head-row' + (i === mineSel ? ' sel' : ''));
      li.append(el('span', 'idx'), el('span', 'no'), el('span', 'nm', `${it.head.title} · ${it.songs.length}곡`), el('span', 'acts'));
      if (it.songs.length) { const b = el('button', 'btn primary', '전체 예약'); b.type = 'button'; b.onclick = e => { e.stopPropagation(); reserveMany(it.head.ids, it.head.title); }; li.lastChild.append(b); }
    } else li = songRow(it.s, '', i === mineSel, [['예약', 'primary', () => reserve(it.s, false)], ['우선예약', '', () => reserve(it.s, true)]]);
    li.onclick = () => { mineSel = i; renderMineOv(); };
    ul.append(li);
  });
  if (!mineItems.some(x => x.s)) ul.append(el('li', 'ov-empty', '♥를 누른 곡과 재생목록이 여기 보여요. 곡 검색(S)에서 ♡를 눌러 보세요'));
  ul.children[mineSel]?.scrollIntoView({ block: 'nearest' });
}
function mineKey(e) {
  const k = e.key, it = mineItems[mineSel];
  if (k === 'ArrowDown' || k === 'ArrowUp') { mineSel = clamp(mineSel + (k === 'ArrowDown' ? 1 : -1), 0, Math.max(0, mineItems.length - 1)); renderMineOv(); }
  else if (k === 'Enter' && it) it.head ? reserveMany(it.head.ids, it.head.title) : reserve(it.s, false);
  else if ((k === 'p' || k === 'P' || k === 'ㅔ') && it?.s) reserve(it.s, true);
  else if (k === 'u' || k === 'U' || k === 'ㅕ') cycleProfile();
  else if (k === 'Escape' || k === 'm' || k === 'M' || k === 'ㅡ') closeOverlays();
  else return;
  e.preventDefault();
}
$('#mineClose').onclick = () => closeOverlays();
