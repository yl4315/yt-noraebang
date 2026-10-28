// YT 노래방 · 여러 곡 한 번에 넣기 (MR 여러 개 + 가사 자동 찾기)와 "가사 없음" 곡 모아 찾기 (CR-017)
// 여는 곳: 곡 추가 창에서 MR을 2개 이상 고르기, PC에서 곡 목록에 끌어다 놓기, 곡 목록 위 "가사 없음 N곡 · 찾기".
// 가사는 LRCLIB에 한 번에 한 곡씩(곡 사이 0.5초) 찾고, 확실한 것(core.js chooseLyrics)만 저절로 넣는다.
// "가사 자동" 표시는 이 창과 저장 알림에서만 쓰고 곡에는 저장하지 않는다 (Drive library.json 칸을 늘리지 않으려고).
// 창을 닫으면(취소·✕·Esc·TV 화면) 아무것도 저장하지 않고 찾기도 멈춘다.
'use strict';

const Bulk = { mode: 'add', rows: [], sess: 0, running: false, saving: false, queue: [], busyRun: 0, note: '' };
const BULK_GAP = 500;                        // 곡 사이 쉼 (ms)
const BULK_FAIL = ['busy', 'offline', 'err'];  // 위쪽 "다시 찾기"로 다시 찾는 상태

function bulkRow(o) {
  return { file: null, song: null, no: null, title: '', artist: '', checked: true, dup: false, touched: false, mrDur: undefined,
    st: 'wait', items: [], pick: null, why: '', retry: '', code: 0, swapped: false, open: false, el: null, ...o };
}
// 파일들 → 새 곡 줄 (MR이 아닌 파일은 빼고, 파일 이름 순서). 제목·가수가 같은 곡이 이미 있으면 체크를 끈다
function openBulk(files) {
  const all = [...(files || [])], media = all.filter(isMediaFile).sort(byFileName), skipped = all.length - media.length;
  if (!media.length) { toast('MR 파일(음악·동영상)이 아니라서 넣지 않았어요. mp3·m4a·wav·mp4 같은 파일을 골라 주세요', 4500); return; }
  Bulk.mode = 'add';
  Bulk.rows = media.map(f => {
    const { title, artist } = titleFromFilename(f.name), dup = !!findSameSong(state.songs, title, artist);
    return bulkRow({ file: f, title, artist, dup, checked: !dup });
  });
  showBulk(skipped ? `${skipped}개는 MR 파일(음악·동영상)이 아니라서 뺐어요` : '');
}
// 가사가 빈 곡 모아 찾기. MR 길이는 기기에 있는 파일에서 읽고, Drive에만 있으면 모름(→ 저절로 넣지 않음)
function openMissing() {
  const list = state.songs.filter(lacksLyrics);
  if (!list.length) return;
  Bulk.mode = 'missing';
  Bulk.rows = list.map(s => bulkRow({ song: s, no: s.no, title: s.title || '', artist: s.artist || '', mrDur: s.buffer?.duration || (s.blob ? undefined : null) }));
  showBulk('');
}
function showBulk(info) {
  Bulk.sess++; Bulk.running = false; Bulk.saving = false; Bulk.queue = []; Bulk.busyRun = 0; Bulk.note = '';
  const add = Bulk.mode === 'add';
  $('#blkTitle').textContent = add ? '여러 곡 한 번에 넣기' : '가사 없는 곡 가사 찾기';
  $('#blkHint').textContent = '줄을 누르면 제목·가수를 고치고 가사를 고를 수 있어요' + (add ? '' : '. 가사를 넣은 곡만 저장돼요');
  $('#blkInfo').textContent = info; $('#blkInfo').hidden = !info;
  $('#blkErr').hidden = true; $('#blkCancel').disabled = false;
  const ul = $('#blkList'); ul.textContent = '';
  for (const r of Bulk.rows) ul.append(buildRow(r));
  renumber(); paintAll();
  $('#bulkDialog').showModal();
  ul.scrollTop = 0;
  bulkRun();
}

/* ---------------- 줄 ---------------- */
function buildRow(r) {
  const li = el('li', 'bk-row');
  li.innerHTML = `<label class="bk-chk"><input type="checkbox"></label>
    <button type="button" class="bk-main" aria-expanded="false"><span class="no"></span><span class="bk-name"><b class="t"></b><span class="a"></span></span><span class="bk-st"></span></button>
    <div class="bk-more" hidden>
      <div class="two"><label class="field"><span>제목</span><input type="text" class="f-t" maxlength="80"></label><label class="field"><span>가수</span><input type="text" class="f-a" maxlength="60"></label></div>
      <div class="lrc-row"><button class="btn small bk-find" type="button">다시 찾기</button><button class="btn small ghost bk-skip" type="button"></button></div>
      <p class="hint bk-msg"></p>
      <ul class="lrc-results" hidden></ul>
    </div>`;
  r.el = li;
  const q = s => li.querySelector(s), chk = q('.bk-chk input');
  chk.setAttribute('aria-label', Bulk.mode === 'add' ? '이 곡 넣기' : '이 곡 가사 저장');
  chk.onchange = () => { r.checked = chk.checked; r.touched = true; renumber(); paintAll(); if (r.checked && r.st === 'wait') bulkRun(); };
  q('.bk-main').onclick = () => { r.open = !r.open; paintRow(r); };
  q('.f-t').value = r.title; q('.f-a').value = r.artist;
  q('.f-t').oninput = () => { r.title = q('.f-t').value; paintRow(r, true); };
  q('.f-a').oninput = () => { r.artist = q('.f-a').value; paintRow(r, true); };
  for (const inp of [q('.f-t'), q('.f-a')]) inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); retryRow(r); } };
  q('.bk-find').onclick = () => retryRow(r);
  q('.bk-skip').onclick = () => { r.pick = null; r.st = 'skip'; r.open = false; paintRow(r); paintHead(); };
  return li;
}
const pickTags = r => (r.pick.syncedLyrics ? '싱크' : '가사만') + (r.mrDur && Math.abs(r.pick.duration - r.mrDur) <= AUTO_SEC ? ' · 길이 비슷' : '');
// 줄 오른쪽(폰은 아래 줄) 상태: [모양, 글]
function rowState(r) {
  if (!r.checked) return Bulk.mode === 'add' && r.dup ? ['dup', '이미 같은 곡이 있어요'] : ['dup', Bulk.mode === 'add' ? '넣지 않음' : '저장 안 함'];
  switch (r.st) {
    case 'wait': return ['', '대기'];
    case 'search': return ['busy', r.retry ? `서버가 바빠서 다시 시도 ${r.retry}` : '… 찾는 중'];
    case 'auto': return ['ok', '✔ 가사 자동 · ' + pickTags(r)];
    case 'picked': return ['ok', '✔ 고름 · ' + pickTags(r)];
    case 'ask': return ['ask', `? 골라 주세요 (${r.items.length}개)`];
    case 'none': return ['fail', '✕ 못 찾음 · 다시 찾기'];
    case 'busy': return ['fail', '서버가 바빠요 · 다시 찾기'];
    case 'offline': return ['fail', '인터넷 끊김'];
    case 'err': return ['fail', `가사 서버 오류(${r.code}) · 다시 찾기`];
    case 'skip': return ['', '가사 없이'];
  }
  return ['', ''];
}
// 자동으로 넣지 않은 이유 (core.js chooseLyrics의 why)
const BULK_WHY = {
  plain: () => '싱크 있는 가사가 없어요. 고르면 시간 없이 들어가요 (저장한 뒤 가사 싱크 편집으로 맞춰요)',
  title: () => '제목이 똑같은 결과가 없어요. 맞는 걸 고르세요',
  noartist: () => '가수를 몰라서 저절로 넣지 않았어요. 맞는 걸 고르세요',
  artist: r => `'${r.artist.trim()}' 곡은 못 찾았어요. 맞는 게 없으면 영어 가수명으로 다시 찾아보세요 (예: 아이유 → IU)`,
  nodur: r => `MR 길이를 몰라서${r.song && !r.song.blob ? ' (Drive에만 있는 곡)' : ''} 저절로 넣지 않았어요. 원곡 길이가 MR과 비슷한 걸 고르세요`,
  duration: r => `MR 길이(${fmt(r.mrDur)})와 원곡 길이가 3초 넘게 달라요. 맞는 버전을 고르세요`,
};
function rowMsg(r) {
  const add = Bulk.mode === 'add', out = [];
  if (add && r.dup) out.push(r.checked ? '같은 제목·가수의 곡이 이미 있어요' : '같은 제목·가수의 곡이 이미 있어요. 그래도 넣으려면 체크를 켜세요');
  if (r.swapped) out.push('파일 이름의 제목과 가수가 바뀌어 있어서 바꿔 넣었어요');
  const m = {
    wait: r.checked ? '차례가 되면 가사를 찾아요' : '',
    search: '가사를 찾는 중이에요…',
    auto: '싱크·제목·가수·길이가 다 맞아서 저절로 넣었어요. 다른 걸 고르려면 아래에서 누르세요',
    picked: '고른 가사를 넣어요. 바꾸려면 아래에서 다른 걸 누르세요',
    ask: (BULK_WHY[r.why] || (() => '맞는 걸 고르세요'))(r),
    none: r.title.trim() ? '찾지 못했어요. 제목 철자를 확인하거나 영어 제목·영어 가수명으로 고쳐서 다시 찾아보세요 (예: 좋은 날 → Good Day, 아이유 → IU)' : '제목을 넣고 다시 찾아 주세요',
    busy: '가사 서버(LRCLIB)가 계속 바빠요. 1~2분 뒤에 다시 찾아 주세요',
    offline: '인터넷 연결이 끊겨 있어요. 연결되면 다시 찾아 주세요. ' + (add ? '지금 저장하면 가사 없이 들어가요' : '저장하면 가사를 고른 곡만 들어가요'),
    err: `가사 서버 오류(${r.code})예요. 잠시 후 다시 찾아 주세요`,
    skip: add ? "가사 없이 넣어요. 나중에 곡 목록 위 '가사 없음 · 찾기'로 넣을 수 있어요" : '이번에는 가사를 넣지 않아요',
  }[r.st];
  if (m) out.push(m);
  return out.join(' · ');
}
// light: 글자만 (입력 중에 후보 목록을 다시 그리지 않게)
function paintRow(r, light) {
  const li = r.el; if (!li) return;
  const q = s => li.querySelector(s);
  li.className = 'bk-row' + (r.open ? ' open' : '') + (r.checked ? '' : ' off');
  q('.no').textContent = r.no ?? '—';
  q('.t').textContent = r.title.trim() || '(제목 없음)';
  q('.a').textContent = r.artist.trim() || '(가수 없음)';
  const [cls, txt] = rowState(r), st = q('.bk-st');
  st.className = 'bk-st ' + cls; st.textContent = txt;
  q('.bk-chk input').checked = r.checked;
  q('.bk-main').setAttribute('aria-expanded', String(r.open));
  if (light) return;
  q('.bk-more').hidden = !r.open;
  if (document.activeElement !== q('.f-t')) q('.f-t').value = r.title;
  if (document.activeElement !== q('.f-a')) q('.f-a').value = r.artist;
  q('.bk-find').disabled = r.st === 'search';
  const skip = q('.bk-skip'); skip.hidden = r.st === 'skip' || r.st === 'search'; skip.textContent = Bulk.mode === 'add' ? '가사 없이 넣기' : '가사 없이 두기';
  q('.bk-msg').textContent = rowMsg(r);
  const ul = q('.lrc-results'); ul.textContent = '';
  if (r.open) for (const it of r.items) {
    const item = lyricItem(it, r.mrDur, () => pickRow(r, it));
    if (it === r.pick) item.classList.add('on');
    ul.append(item);
  }
  ul.hidden = !ul.children.length;
}
function paintHead() {
  const add = Bulk.mode === 'add', rows = Bulk.rows, on = rows.filter(r => r.checked);
  const n = st => on.filter(r => r.st === st).length;
  const todo = on.filter(r => r.st === 'wait' || r.st === 'search').length, fail = on.filter(r => BULK_FAIL.includes(r.st)).length;
  // 위쪽 "다시 찾기"가 다시 찾는 곡 = 바빠요·끊김·오류 + 멈춰서 아직 차례가 안 온 곡. 머리 줄과 위쪽 알림이 같은 숫자를 쓴다
  // ("못 찾음"은 찾아봤는데 결과가 없는 곡만. 제목을 고쳐 줄에서 다시 찾는다)
  const left = fail + (Bulk.running ? 0 : n('wait'));
  let sum = `${rows.length}곡`;
  if (Bulk.running && todo) sum += ` · 가사 찾는 중 ${on.length - todo + 1}/${on.length}`;
  else {
    const bits = [];
    if (n('auto')) bits.push(`가사 자동 ${n('auto')}`);
    if (n('picked')) bits.push(`고름 ${n('picked')}`);
    if (n('ask')) bits.push(`골라 주세요 ${n('ask')}`);
    if (n('none')) bits.push(`못 찾음 ${n('none')}`);
    if (left) bits.push(`다시 찾을 곡 ${left}`);
    if (bits.length) sum += ' · ' + bits.join(' · ');
  }
  $('#blkSum').textContent = sum;
  const note = Bulk.note === 'busy' ? "가사 서버(LRCLIB)가 계속 바빠서 찾기를 멈췄어요. 1~2분 뒤 '다시 찾기'를 눌러 주세요"
    : Bulk.note === 'offline' ? "인터넷이 끊겨 있어요. 연결되면 '다시 찾기'를 눌러 주세요. " + (add ? '지금 저장하면 가사 없이 들어가요' : '저장하면 가사를 고른 곡만 들어가요')
    : !Bulk.running && left ? `아직 가사를 못 찾은 곡이 ${left}곡 있어요. '다시 찾기'로 다시 찾아요` : '';
  $('#blkNote').hidden = !note; $('#blkNoteTxt').textContent = note;
  const save = add ? on.length : on.filter(r => r.pick).length;
  $('#blkSave').textContent = add ? `${save}곡 저장` : `가사 ${save}곡 저장`;
  $('#blkSave').disabled = !save || Bulk.saving;
}
function paintAll() { for (const r of Bulk.rows) paintRow(r); paintHead(); }
// 번호: 체크한 곡만, 목록 순서대로 "가장 큰 번호 + 1"부터 (저장할 때 붙는 번호와 같다)
function renumber() {
  if (Bulk.mode !== 'add') return;
  const on = Bulk.rows.filter(r => r.checked), nos = nextSongNumbers(state.songs, on.length);
  for (const r of Bulk.rows) r.no = null;
  on.forEach((r, i) => { r.no = nos[i]; });
}
function checkDup(r) {
  if (Bulk.mode !== 'add') return;
  r.dup = !!findSameSong(state.songs, r.title, r.artist);
  if (r.dup && r.checked && !r.touched) { r.checked = false; renumber(); paintAll(); }
}
function pickRow(r, it) {
  if (r.pick !== it || r.st !== 'auto') { r.pick = it; r.st = 'picked'; }
  if (!r.artist.trim()) r.artist = it.artistName;   // 곡 추가 창과 같이: 가수가 비었으면 채운다
  r.open = false; paintRow(r); paintHead();
}
function retryRow(r) {
  if (r.st === 'search') return;
  Object.assign(r, { st: 'wait', pick: null, items: [], why: '', swapped: false });
  if (!r.checked) { r.checked = true; r.touched = true; renumber(); }
  Bulk.queue = [r, ...Bulk.queue.filter(x => x !== r)];   // 손으로 다시 찾은 곡이 먼저
  Bulk.note = ''; Bulk.busyRun = 0;
  paintAll(); bulkRun();
}

/* ---------------- 차례로 찾기 (한 번에 한 곡) ---------------- */
function nextRow() {
  Bulk.queue = Bulk.queue.filter(r => r.checked && r.st === 'wait');
  return Bulk.queue[0] || Bulk.rows.find(r => r.checked && r.st === 'wait') || null;
}
function markOffline() {
  Bulk.note = 'offline';
  for (const r of Bulk.rows) if (r.checked && r.st === 'wait') { r.st = 'offline'; paintRow(r); }
}
async function bulkRun() {
  if (Bulk.running || Bulk.saving) return;
  const my = Bulk.sess;
  Bulk.running = true; paintHead();
  try {
    for (let r; my === Bulk.sess && (r = nextRow());) {
      if (!navigator.onLine) { markOffline(); break; }
      await searchRow(r, my);
      if (my !== Bulk.sess) return;
      if (r.st === 'offline') { markOffline(); break; }
      // 두 곡 연달아 "바빠요"면 남은 곡은 멈춘다 (위쪽 "다시 찾기")
      Bulk.busyRun = r.st === 'busy' ? Bulk.busyRun + 1 : 0;
      if (Bulk.busyRun >= 2) { Bulk.note = 'busy'; break; }
      if (nextRow()) await sleep(BULK_GAP);
    }
  } finally {
    if (my === Bulk.sess) { Bulk.running = false; paintHead(); }
  }
}
async function searchRow(r, my) {
  const title = r.title.trim(), artist = r.artist.trim();
  Object.assign(r, { st: 'search', retry: '', items: [], pick: null, why: '', swapped: false });
  paintRow(r); paintHead();
  if (!title) { r.st = 'none'; paintRow(r); paintHead(); return; }
  const live = () => my === Bulk.sess && r.st === 'search';
  try {
    const durP = r.mrDur !== undefined ? Promise.resolve(r.mrDur) : mediaDuration(r.file || r.song?.blob || null);
    const onRetry = (n, total) => { if (live()) { r.retry = `${n}/${total}`; paintRow(r, true); } };
    const [d, found] = await Promise.all([durP, findLyrics(title, artist, onRetry)]);
    if (!live()) return;
    r.mrDur = d;
    const c = chooseLyrics(found, { title, artist, mrDur: d });
    Object.assign(r, { items: c.items, why: c.why, retry: '', pick: c.auto, st: c.auto ? 'auto' : c.items.length ? 'ask' : 'none' });
    if (c.swapped) { r.title = c.title; r.artist = c.artist; r.swapped = true; checkDup(r); }
  } catch (e) {
    if (!live()) return;
    Object.assign(r, { retry: '', code: e.status || 0, st: !navigator.onLine ? 'offline' : e.status ? 'err' : 'busy' });
  }
  paintRow(r); paintHead();
}

/* ---------------- 저장 ---------------- */
async function bulkSave() {
  const add = Bulk.mode === 'add', rows = Bulk.rows.filter(r => r.checked && (add || r.pick));
  if (!rows.length || Bulk.saving) return;
  Bulk.saving = true; Bulk.sess++; Bulk.running = false;   // 찾기를 멈춘다 (아직 찾는 중인 곡은 가사 없이 저장)
  $('#blkCancel').disabled = true; paintHead();
  let fail = 0, lyr = 0, auto = 0;
  const done = [];
  try {
    if (add) {
      const nos = nextSongNumbers(state.songs, rows.length);
      for (const [i, r] of rows.entries()) {
        const f = r.file, text = r.pick ? (r.pick.syncedLyrics || r.pick.plainLyrics) : '';
        // 곡 모양은 곡 추가 창과 같다 (동영상은 "영상 보여주기" 켬, "영상 위 가사" 끔)
        const s = { id: uid(), no: nos[i], createdAt: Date.now(), lyricOffset: 0, title: r.title.trim() || titleFromFilename(f.name).title, artist: r.artist.trim(),
          lyrics: text, blob: f, buffer: null, keyCache: null, mediaDirty: true, mime: f.type, size: f.size, video: isVideoBlob(f), videoLyrics: false };
        if (!await persistSong(s, true, true)) fail++;
        state.songs.push(s); done.push(s);
        if (text) { lyr++; if (r.st === 'auto') auto++; }
      }
      if (done.length) requestPersist();
    } else {
      for (const r of rows) {
        const s = r.song;
        if (!state.songs.includes(s)) continue;   // 창을 연 사이에 다른 기기에서 지운 곡
        s.lyrics = r.pick.syncedLyrics || r.pick.plainLyrics; s.lyricOffset = 0;
        s.title = r.title.trim() || s.title; s.artist = r.artist.trim();
        if (!await persistSong(s, true, true)) fail++;
        done.push(s); lyr++; if (r.st === 'auto') auto++;
      }
    }
  } finally {
    Bulk.saving = false;
    $('#bulkDialog').close();
  }
  renderSongs();
  const autoTxt = auto ? ` (자동 ${auto}곡)` : '';
  const failTxt = fail ? ` · ${fail}곡을 이 기기에 저장하지 못했어요. 저장 공간을 확인해 주세요 (새로고침하면 사라질 수 있어요)` : '';
  if (add) {
    // 무대의 곡은 그대로 두고 목록만 첫 새 곡으로 (큰 MR 여러 개를 바로 풀지 않게)
    const li = $('#songList').children[state.songs.indexOf(done[0])];
    if (li) { li.scrollIntoView({ block: 'center', behavior: 'smooth' }); li.classList.add('fresh'); }
    toast(`${done.length}곡 추가됨 · 가사 ${lyr}곡${autoTxt} · 가사 없음 ${done.length - lyr}곡` + failTxt, fail ? 8000 : 5000);
  } else {
    const s = state.song;
    if (s && done.includes(s)) {
      if (!state.sync) computeLines();
      updateLyrOffUI();
      $('#cardTitle').textContent = s.title; $('#cardArtist').textContent = s.artist || '';
      $('#songTtl').innerHTML = ''; $('#songTtl').append(s.title, Object.assign(document.createElement('small'), { textContent: s.artist || '' }));
    }
    const left = state.songs.filter(lacksLyrics).length;
    toast(`가사 ${lyr}곡 넣음${autoTxt}` + (left ? ` · 가사 없음 ${left}곡 남음` : '') + failTxt, fail ? 8000 : 4000);
  }
}

// 버튼·창 연결. 배포 직후 캐시로 화면(index.html)이 예전 것이면 요소가 없을 수 있어서, 없으면 건너뛴다 (시작이 멈추지 않게)
const bulkOn = (sel, ev, fn) => $(sel)?.addEventListener(ev, fn);
bulkOn('#missBtn', 'click', openMissing);
bulkOn('#blkSave', 'click', bulkSave);
for (const sel of ['#blkX', '#blkCancel']) bulkOn(sel, 'click', () => { if (!Bulk.saving) $('#bulkDialog').close(); });
bulkOn('#blkRetry', 'click', () => {
  for (const r of Bulk.rows) if (r.checked && BULK_FAIL.includes(r.st)) r.st = 'wait';
  Bulk.note = ''; Bulk.busyRun = 0;
  paintAll(); bulkRun();
});
bulkOn('#bulkDialog', 'cancel', e => { if (Bulk.saving) e.preventDefault(); });
// 닫히면(취소·✕·Esc·TV 화면이 닫음·저장 끝) 찾기를 멈추고 고른 파일을 놓아 준다
bulkOn('#bulkDialog', 'close', () => {
  if ($('#bulkDialog').open) return;   // 닫힘 알림은 조금 늦게 온다: 그 사이에 다시 연 창은 건드리지 않는다
  Bulk.sess++; Bulk.running = false; Bulk.queue = []; Bulk.rows = [];
  $('#blkList').textContent = '';
});

/* ---------------- PC: 곡 목록에 MR 파일 끌어다 놓기 ---------------- */
{
  const panel = $('#songsPanel'), hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  panel?.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; panel.classList.add('drop'); });
  panel?.addEventListener('dragleave', e => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('drop'); });
  panel?.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation(); panel.classList.remove('drop');
    if (!document.querySelector('dialog[open]') && $('#bulkDialog')) openBulk(e.dataTransfer.files);
  });
  // 곡 목록 밖에 놓으면 브라우저가 파일을 열어 노래방 화면이 사라진다 → 막는다 (커서가 "안 됨" 표시).
  // 단, 파일 칸(곡 추가 창의 MR 파일 칸 등) 위에서는 브라우저가 원래대로 파일을 칸에 넣게 둔다
  const fileInput = e => e.target?.closest?.('input[type=file]');
  addEventListener('dragover', e => { if (hasFiles(e) && !fileInput(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
  addEventListener('drop', e => { if (hasFiles(e) && !fileInput(e)) e.preventDefault(); });
}
