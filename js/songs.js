// YT 노래방 · 앱 상태, 곡 목록, 곡 추가/수정, 싱크 가사 찾기 (여러 곡 한 번에 넣기 창은 bulk.js)
'use strict';

/* ---------------- 상태 ---------------- */
const state = { songs: [], recs: [], song: null, lines: [], autoTimed: false, playing: false, offset: 0, when: 0, rate: 1,
  armed: false, seeking: false, tv: false, queue: [], tombs: [], recTombs: [], sync: null, micOn: false, score: null, frame: 0, active: -1 };
const dur = () => state.song?.buffer?.duration || 0;
const curTime = () => state.playing ? clamp(state.offset + (E.ctx.currentTime - state.when) * state.rate, 0, dur()) : state.offset;
const lyricOffset = () => state.sync ? 0 : (state.song?.lyricOffset || 0);

/* ---------------- 곡 목록 ---------------- */
const ICON_EDIT = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
const ICON_PL = '<svg viewBox="0 0 24 24"><path d="M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14 0v-3h-2v3h-3v2h3v3h2v-3h3v-2z"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

function renderSongs() {
  const ul = $('#songList'); ul.textContent = '';
  const offline = !navigator.onLine;
  // 가사가 빈 곡이 있으면 맨 위 "가사 없음 N곡 · 찾기" (bulk.js의 모아 찾기).
  // 배포 직후 브라우저 캐시로 예전 index.html(버튼 없음)과 새 JS가 섞여도 곡 목록은 그려지게, 버튼이 없으면 건너뛴다
  const mb = $('#missBtn');
  if (mb) { const miss = state.songs.filter(lacksLyrics).length; mb.hidden = !miss; mb.textContent = `가사 없음 ${miss}곡 · 찾기`; }
  for (const s of state.songs) {
    const li = document.createElement('li');
    li.className = 'song' + (state.song === s ? ' on' : '') + (!onDevice(s) && offline ? ' off' : '');
    li.tabIndex = 0;
    li.innerHTML = `<span class="no"></span><div class="meta"><div class="t"></div><div class="a"></div></div><div class="acts"></div>`;
    li.querySelector('.no').textContent = s.no;
    li.querySelector('.t').textContent = s.title;
    li.querySelector('.a').textContent = s.artist || '가수 미상';
    if (s.video) li.querySelector('.t').append(videoTag());
    const st = songStatus(s);
    if (st) { const tg = el('span', 'stag ' + st.cls, st.text); tg.dataset.dl = s.id; li.querySelector('.a').append(tg); }
    if (lacksLyrics(s)) li.querySelector('.a').append(el('span', 'stag nolyr', '가사 없음'));
    const acts = li.querySelector('.acts');
    const ib = (html, tip, cls, fn) => { const b = document.createElement('button'); b.className = 'icon-btn ' + cls; b.type = 'button'; b.title = tip; b.innerHTML = html; b.onclick = e => { e.stopPropagation(); fn(b); }; acts.append(b); return b; };
    const rb = el('button', 'btn small', '예약'); rb.type = 'button'; rb.title = '예약 목록에 추가';
    rb.onclick = e => { e.stopPropagation(); reserve(s, false); };
    acts.append(rb);
    const fav = isFav(s);
    ib(fav ? '♥' : '♡', fav ? '좋아요 취소' : '좋아요', 'fav-btn' + (fav ? ' on' : ''), () => toggleFav(s));
    ib('⋯', '더 보기', 'more-toggle', () => li.classList.toggle('expanded'));
    ib(ICON_PL, '재생목록에 넣기', 'more', () => openPlPick(s));
    if (!s.demo) {
      ib(ICON_EDIT, '수정', 'more', () => openSongDialog(s));
      ib(ICON_DEL, '삭제', 'more', b => confirmButton(b, () => deleteSong(s)));
    }
    li.onclick = () => selectSong(s);
    li.onkeydown = e => { if (e.key === 'Enter') selectSong(s); };
    ul.append(li);
  }
}
function confirmButton(btn, fn) {
  if (btn.dataset.armed) { fn(); return; }
  btn.dataset.armed = '1'; const old = btn.innerHTML, oldCls = btn.className;
  btn.textContent = '삭제?'; btn.className = 'btn small danger';
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.innerHTML = old; btn.className = oldCls; } }, 3000);
}

async function loadSongBuffer(s) {
  if (s.buffer) return s.buffer;
  if (!s._loading) s._loading = (async () => {
    ensureCtx();
    if (s.demo) { const r = await loadDemo(); s.guide = r.guide; s.buffer = r.mr; }
    else { await ensureMedia(s); s.buffer = await E.ctx.decodeAudioData(await s.blob.arrayBuffer()); }
    return s.buffer;
  })().finally(() => { s._loading = null; });
  return s._loading;
}

async function selectSong(s) {
  cancelNext();
  if (state.sync) await exitSync(false);
  stopPlayback();
  state.song = s; renderSongs(); hideScore();
  $('#songNo').textContent = s.no;
  $('#songTtl').innerHTML = ''; $('#songTtl').append(s.title, Object.assign(document.createElement('small'), { textContent: s.artist || '' }));
  $('#cardTitle').textContent = s.title; $('#cardArtist').textContent = s.artist || '';
  $('#guideKnob').hidden = !s.demo;
  setupVideo(s);
  for (const x of state.songs) if (x !== s) x.keyCache = null;
  state.key = 0; state.keyBufs = null; keyJob++; updateKeyUI();
  $('#syncBtn').hidden = !!s.demo;
  updateLyrOffUI();
  if (!s.buffer) {
    $('#loading').hidden = false;
    try { await loadSongBuffer(s); if (s.video) setupVideo(s); }
    catch (e) { toast(mediaErrText(e), 5000); }
    $('#loading').hidden = true;
    if (state.song !== s) return;
  }
  computeLines();
  updateTimeUI(0);
  if (s.buffer && keyOf(s)) setKey(keyOf(s), { save: false });
}
function resetLineCache() { for (const el of [$('#lineTop'), $('#lineBottom')]) el._key = null; }
function computeLines() {
  const s = state.song;
  if (s.demo) { state.lines = DEMO_LRC.map(l => ({ ...l })); state.autoTimed = false; }
  else {
    const p = parseLyrics(s.lyrics);
    state.lines = p.lines; state.autoTimed = !p.synced && p.lines.length > 0;
    if (state.autoTimed) {
      const d = dur() || 60, a = d * 0.06, step = (d * 0.92 - a) / p.lines.length;
      state.lines = p.lines.map((l, i) => ({ t: a + i * step, text: l.text })).concat([{ t: a + p.lines.length * step, text: '' }]);
    }
  }
  $('#autoBadge').hidden = !state.autoTimed;
  resetLineCache();
  renderLyrics(curTime());
}

async function deleteSong(s) {
  state.songs = state.songs.filter(x => x !== s);
  // Drive에 올라간 곡은 다른 기기에서도 지워지도록 '지움' 기록을 남긴다
  if (s.fileId || Cloud.connected) {
    const t = { ...pick(s, SONG_FIELDS), deleted: true, updatedAt: Date.now() };
    state.tombs.push(t);
    try { await DB.put('songs', t); } catch {}
    Cloud.schedule();
  } else { try { await DB.del('songs', s.id); } catch {} }
  renderQueue(); saveQueue();
  for (const r of state.recs) if (r.songId === s.id) recCache.delete(r.id);
  const n = state.recs.filter(r => r.songId === s.id).length;
  if (state.song === s) selectSong(state.songs[0]); else renderSongs();
  renderRecs();
  toast(n ? `'${s.title}' 삭제됨 · 이 곡의 녹음 ${n}개는 이제 목소리만 들려요` : `'${s.title}' 삭제됨`, 4000);
}

/* 가사 타이밍 (곡 전체를 한꺼번에 당기거나 미루기) */
let lyrSaveTimer;
function nudgeLyrics(d) {
  const s = state.song; if (!s || state.sync) return;
  s.lyricOffset = Math.round(((s.lyricOffset || 0) + d) * 10) / 10;
  updateLyrOffUI(); resetLineCache(); renderLyrics(curTime());
  clearTimeout(lyrSaveTimer); lyrSaveTimer = setTimeout(() => persistSong(s), 600);
}
function updateLyrOffUI() {
  const o = state.song?.lyricOffset || 0;
  $('#lyrOff').textContent = o === 0 ? '맞춤' : o > 0 ? `${o.toFixed(1)}초 빠르게` : `${(-o).toFixed(1)}초 늦게`;
}
for (const b of document.querySelectorAll('[data-lyr]')) b.onclick = () => nudgeLyrics(+b.dataset.lyr);

/* 곡 추가/수정 */
let editing = null;
function openSongDialog(s = null) {
  editing = s;
  $('#dlgTitle').textContent = s ? '곡 수정' : '곡 추가';
  $('#fileLbl').textContent = s ? 'MR 파일 (바꿀 때만 선택)' : 'MR 파일 (여러 개를 고르면 한 번에 넣어요)';
  $('#f-title').value = s?.title || ''; $('#f-artist').value = s?.artist || '';
  $('#f-lyrics').value = s?.lyrics || ''; $('#f-file').value = '';
  $('#f-file').multiple = !s;   // 여러 개 고르기는 새로 넣을 때만 (2개 이상이면 bulk.js 창)
  $('#videoOpts').hidden = !(s && (isVideoBlob(s.blob) || /^video\//.test(s.mime || '')));
  renderDeviceRow(s);
  $('#f-video').checked = s ? !!s.video : true; $('#f-videoLyrics').checked = !!s?.videoLyrics;
  $('#dlgErr').hidden = true; $('#lrcResults').hidden = true;
  $('#lrcStatus').textContent = 'LRCLIB 공개 가사 데이터베이스에서 찾아요';
  $('#songDialog').showModal();
}
$('#f-file').addEventListener('change', () => {
  const files = [...$('#f-file').files];
  // (예전 index.html이라 bulk.js가 없으면 첫 파일만 한 곡 넣기로)
  if (!editing && files.length > 1 && typeof openBulk === 'function') { $('#songDialog').close(); openBulk(files); return; }
  const f = files[0];
  $('#videoOpts').hidden = !(isVideoBlob(f) || (!f && editing && isVideoBlob(editing.blob)));
  if (f && !editing) $('#f-video').checked = true;
  // 제목·가수는 Drive 들여오기·여러 곡 넣기와 같은 규칙으로 (비어 있는 칸만 채운다)
  if (f) {
    const n = titleFromFilename(f.name);
    if (!$('#f-title').value.trim()) $('#f-title').value = n.title;
    if (!$('#f-artist').value.trim()) $('#f-artist').value = n.artist;
  }
});
$('#dlgCancel').onclick = () => $('#songDialog').close();
$('#songForm').addEventListener('submit', async e => {
  e.preventDefault();
  const title = $('#f-title').value.trim(), file = $('#f-file').files[0];
  const err = m => { $('#dlgErr').textContent = m; $('#dlgErr').hidden = false; };
  if (!title) return err('제목을 입력해 주세요.');
  if (!editing && !file) return err('MR 파일을 골라 주세요.');
  const s = editing || { id: uid(), no: nextSongNumbers(state.songs, 1)[0], createdAt: Date.now(), lyricOffset: 0 };
  const lyricsChanged = s.lyrics !== $('#f-lyrics').value;
  s.title = title; s.artist = $('#f-artist').value.trim(); s.lyrics = $('#f-lyrics').value;
  if (lyricsChanged) s.lyricOffset = 0;
  if (file) { s.blob = file; s.buffer = null; s.keyCache = null; s.mediaDirty = true; s.mime = file.type; s.size = file.size; for (const r of state.recs) if (r.songId === s.id) recCache.delete(r.id); }
  s.video = (isVideoBlob(s.blob) || (!s.blob && /^video\//.test(s.mime || ''))) && $('#f-video').checked; s.videoLyrics = $('#f-videoLyrics').checked;
  if (file) requestPersist();
  await persistSong(s);
  if (!editing) state.songs.push(s);
  $('#songDialog').close();
  if (state.song === s && !file) { renderSongs(); computeLines(); updateLyrOffUI(); setupVideo(s); $('#cardTitle').textContent = s.title; }
  else selectSong(s);
  toast(editing ? '수정했어요' : `${s.no}번 '${s.title}' 추가됨`);
});
$('#addSongBtn').onclick = () => openSongDialog();

/* 싱크 가사 찾기 (LRCLIB). 이 서버는 바쁘면 503을 자주 돌려줘서, 실패하면 간격을 두고 다시 시도한다 */
async function lrclibSearch(params, onRetry) {
  const url = 'https://lrclib.net/api/search?' + new URLSearchParams(params), TRIES = 6;
  for (let i = 0; i < TRIES; i++) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.ok) return await res.json();
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error('http'), { fatal: true, status: res.status });
    } catch (e) { if (e.fatal) throw e; }
    finally { clearTimeout(timer); }
    if (i < TRIES - 1) { onRetry(i + 2, TRIES); await sleep(400 + i * 600); }
  }
  throw new Error('busy');
}
// MR 길이(초): 원곡 길이와 비교해서 맞는 버전을 위로 올린다. 소리를 풀지 않고 길이 정보만 읽는다 (큰 파일 여러 개도 메모리를 적게).
// 4초 안에 못 읽으면 null
function mediaDuration(blob) {
  if (!blob) return Promise.resolve(null);
  return new Promise(res => {
    const el = document.createElement(isVideoBlob(blob) ? 'video' : 'audio'), u = URL.createObjectURL(blob);
    let over = false;
    const done = d => { if (over) return; over = true; URL.revokeObjectURL(u); el.removeAttribute('src'); res(isFinite(d) && d > 0 ? d : null); };
    el.preload = 'metadata'; el.onloadedmetadata = () => done(el.duration); el.onerror = () => done(null);
    setTimeout(() => done(null), 4000); el.src = u;
  });
}
function mrDurationForDialog() {
  const f = $('#f-file').files[0];
  return f ? mediaDuration(f) : Promise.resolve(editing?.buffer?.duration || null);
}
// 가사 찾기 (곡 추가 창과 여러 곡 넣기 창이 같이 씀). 요청은 많아야 3번:
// ① 제목 + 가수(괄호 앞 이름) ② 가수를 못 맞추면 괄호 안 이름으로 한 번 더 (AKMU(악뮤) → 악뮤) ③ 결과가 없으면 제목만
async function findLyrics(title, artist, onRetry, onStep = () => {}) {
  const [main, ...alts] = artist ? artistNames(artist) : [];
  let found = await lrclibSearch({ q: main ? `${title} ${main}` : title }, onRetry);
  if (alts.length && !found.some(x => artistMatches(artist, x.artistName))) {
    onStep(`'${alts[0]}'(으)로 다시 찾는 중…`);
    const seen = new Set(found.map(x => x.id));
    found = found.concat((await lrclibSearch({ q: `${title} ${alts[0]}` }, onRetry)).filter(x => !seen.has(x.id)));
  }
  if (!found.length && artist) { onStep('제목만으로 다시 찾는 중…'); found = await lrclibSearch({ q: title }, onRetry); }
  return found;
}
// 후보 한 줄 (곡 추가 창과 여러 곡 넣기 창이 같은 모양): 제목, 가수·앨범·길이, "싱크 있음/가사만 · 길이 비슷"
function lyricItem(it, mrDur, onPick) {
  const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button';
  b.innerHTML = '<span class="nm"></span><span class="s"></span><span class="tag"></span>';
  b.querySelector('.nm').textContent = it.trackName;
  b.querySelector('.s').textContent = `${it.artistName}${it.albumName ? ' · ' + it.albumName : ''} · ${fmt(it.duration)}`;
  const close = mrDur && Math.abs(it.duration - mrDur) <= AUTO_SEC;
  const tag = b.querySelector('.tag'); tag.textContent = (it.syncedLyrics ? '싱크 있음' : '가사만') + (close ? ' · 길이 비슷' : ''); if (!it.syncedLyrics) tag.classList.add('plain');
  b.onclick = () => onPick(it);
  li.append(b);
  return li;
}
$('#lrcFind').onclick = async () => {
  const title = $('#f-title').value.trim(), artist = $('#f-artist').value.trim();
  if (!title) { $('#lrcStatus').textContent = '제목을 먼저 입력해 주세요'; return; }
  const ul = $('#lrcResults'), st = $('#lrcStatus'), btn = $('#lrcFind');
  btn.disabled = true; st.textContent = '찾는 중…'; ul.hidden = true;
  const onRetry = (n, total) => { st.textContent = `가사 서버가 바빠서 다시 시도하는 중… (${n}/${total})`; };
  try {
    const [mrDur, found] = await Promise.all([mrDurationForDialog(), findLyrics(title, artist, onRetry, m => { st.textContent = m; })]);
    // 순서: 싱크 있음 > 가수 일치 > 제목 일치 > MR과 길이 비슷 (core.js rankLyrics)
    const items = rankLyrics(found, { title, artist, mrDur });
    if (!items.length) { st.textContent = '찾지 못했어요. 제목 철자를 확인하거나 영어 제목으로 찾아보세요. 가사를 직접 붙여넣어도 돼요'; return; }
    ul.textContent = '';
    for (const it of items) ul.append(lyricItem(it, mrDur, () => {
      $('#f-lyrics').value = it.syncedLyrics || it.plainLyrics;
      if (!$('#f-artist').value.trim()) $('#f-artist').value = it.artistName;
      ul.hidden = true;
      st.textContent = it.syncedLyrics
        ? `넣었어요. 원곡 길이(${fmt(it.duration)})와 MR 길이가 많이 다르면 '가사 타이밍'으로 조절하세요`
        : '시간 정보가 없는 가사예요. 저장한 뒤 가사 싱크 편집으로 맞춰 주세요';
    }));
    ul.hidden = false;
    const artistHit = !artist || items.some(x => artistMatches(artist, x.artistName));
    st.textContent = !artistHit
      ? `'${artist}' 곡은 못 찾았어요. 영어 제목·영어 가수명으로도 찾아보세요 (예: 좋은 날 → Good Day, 아이유 → IU)`
      : `${items.length}개 찾음. ` + (mrDur ? `MR 길이(${fmt(mrDur)})와 비슷한 순서예요` : '원곡 길이가 MR과 비슷한 걸 고르세요');
  } catch (e) {
    st.textContent = !navigator.onLine ? '인터넷 연결이 끊겨 있어요'
      : e.status ? `가사 서버 오류(${e.status})예요. 잠시 후 다시 눌러 보세요`
      : '가사 서버(LRCLIB)가 계속 바빠요. 1~2분 뒤에 다시 눌러 보세요. 가사를 직접 붙여넣어도 돼요';
  } finally { btn.disabled = false; }
};
