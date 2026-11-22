// YT 노래방 · 무대 "자동 싱크" (CR-227 W6·W9·W10 일부): 시각이 없는 곡에 LRCLIB의 시각 붙은 가사를 찾아 넣는다
// - LRCLIB에는 곡 제목·가수(첫 이름)·MR 길이(유튜브 곡은 영상 길이)만 보낸다 (손님 이름·방 주소·허브 정보 0). 덧붙이는 머리글 없음.
// - 정확히 한 곡 찾는 /api/get 먼저, 없으면 곡 추가 창과 같은 /api/search (songs.js findLyrics + core.js chooseLyrics).
// - 찾으면 곡에 저장 → 허브를 쓰면 허브로 (hubTouch). "자동 싱크 · 확인해 주세요" 표시(W9)는 가사 맞추기(싱크 편집기)에서 저장하거나 가사를 고치면 사라진다.
// - 싱크 한 줄(디자인 S1·S2): 찾음 / 불러옴(다른 기기 설정) / 못 찾음 [직접 맞추기]. 무대(TV)에는 안 나온다. 글은 textContent로만.
// - 원곡 파일로 자동 싱크(CR-227 W8, mr.js alignStart): 맞추는 중 [그만두기] · 맞춤 · 오류 · 집 밖. 받은 결과는 alignApply가 넣는다.
// 순수 로직(lrclibGetParams·autoSyncPick·canAutoSync·canAlignSong·alignAsk·alignErrText)은 core.js, 테스트는 tests/core.test.js.
'use strict';

const AutoSync = { busy: false, hideTimer: 0, last: new Map() };
// 아이콘 (디자인 5-sync-line: 14px 선 아이콘, 색은 아이콘에만)
const SYNC_ICONS = {
  found: [['path', { d: 'M20 6L9 17l-5-5' }]],
  loaded: [['path', { d: 'M20 16.6A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25' }], ['path', { d: 'M12 12v9M8 17l4 4 4-4' }]],
  none: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M12 16v-4M12 8h.01' }]],
  busy: [['path', { d: 'M21 12a9 9 0 1 1-6.22-8.56' }]],
  away: [['path', { d: 'M2 2l20 20' }], ['path', { d: 'M8.5 16.5a5 5 0 0 1 7 0' }], ['path', { d: 'M5 12.9a10 10 0 0 1 5.2-2.8' }], ['path', { d: 'M19 12.9a10 10 0 0 0-2.3-1.6' }], ['circle', { cx: 12, cy: 20, r: 1 }]],
};
const SYNC_TEXT = {
  found: '가사 시각을 찾았어요 (LRCLIB)',
  loaded: '다른 기기에서 맞춘 설정을 불러왔어요',
  none: '가사 시각을 못 찾았어요',
  busy: '가사 시각을 찾는 중…',
  novoice: '목소리 없는 곡(연주곡)이라 가사를 넣지 않았어요',
  offline: '인터넷이 없어요 · 연결되면 다시 눌러 주세요',
  slow: '가사 서버(LRCLIB)가 바빠요 · 잠시 뒤 다시 눌러 주세요',
  aligning: '집 AI가 맞추는 중',
  aligned: '집 AI가 가사 시각을 맞췄어요',
  alignskip: '맞춘 가사 시각을 넣지 않았어요',
};
function syncIcon(kind) {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const [tag, at] of SYNC_ICONS[kind] || SYNC_ICONS.none) { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(at)) e.setAttribute(k, v); svg.append(e); }
  return svg;
}
// 한 줄 그리기. info = { kind:'found'|'loaded'|'none'|'busy', text, fix(직접 맞추기 단추), stop(그만두기 단추·점 3개), icon(아이콘만 다르게) }
function paintSyncLine(box, info, s) {
  if (!box) return;
  box.textContent = '';
  if (!info) { box.hidden = true; return; }
  box.dataset.state = info.kind;
  const dots = () => { const d = el('span', 'sl-dots'); d.setAttribute('aria-hidden', 'true'); d.append(el('i'), el('i'), el('i')); return d; };
  box.append(info.stop ? dots() : syncIcon(info.icon || info.kind), el('span', 'sl-text', info.text));
  if (info.fix && s) {
    const b = el('button', 'btn small sl-act', '직접 맞추기'); b.type = 'button';
    b.onclick = () => syncFixByHand(s);
    box.append(b);
  } else if (info.stop && s) {
    const b = el('button', 'btn small sl-act', '그만두기'); b.type = 'button';
    b.onclick = () => { if (typeof alignStop === 'function') alignStop(s); };
    box.append(b);
  }
  box.hidden = false;
}
// [직접 맞추기]: 가사가 있으면 가사 맞추기(싱크 편집기), 없으면 곡 수정 창(가사 넣기)
async function syncFixByHand(s) {
  if (!state.songs.includes(s)) return;
  if ($('#songDialog').open) $('#songDialog').close();
  if (state.song !== s) await selectSong(s);
  if (state.song !== s) return;
  if (parseLyrics(s.lyrics || '').lines.some(l => l.text)) enterSync(); else openSongDialog(s);
}
// 원곡 파일로 자동 싱크 한 줄: 맞추는 중(점 3개 + [그만두기]) · 오류(code → 노래방 말, 집 밖은 와이파이 끊김 아이콘·단추 없음)
const ALIGN_NO_FIX = ['unreachable', 'canceled', 'closed', 'blocked', 'no_align', 'noserver'];
function alignInfo(kind, code) {
  if (kind === 'aligning') return { kind: 'busy', text: SYNC_TEXT.aligning, stop: true };
  if (kind === 'aligned') return { kind: 'found', text: SYNC_TEXT.aligned };
  if (kind === 'alignskip') return { kind: 'none', text: SYNC_TEXT.alignskip, fix: true };
  return { kind: 'none', text: alignErrText(code), fix: !ALIGN_NO_FIX.includes(code), icon: code === 'unreachable' ? 'away' : '' };
}
// 곡의 마지막 싱크 소식을 S1(진행 막대 아래)에 보인다. 5초 뒤 사라지고, "못 찾음"만 남는다
// 원곡 자동 싱크(kind aligning·aligned·alignskip·alignfail)는 text 자리에 오류 코드 (alignfail)
function syncLineShow(kind, s, text) {
  if (!s || s.demo) return;
  const al = /^align/.test(kind);
  const info = al ? alignInfo(kind, text)
    : { kind: kind === 'novoice' || kind === 'offline' || kind === 'slow' ? 'none' : kind, text: text || SYNC_TEXT[kind] || '', fix: kind === 'none' || kind === 'slow' };
  if (info.kind !== 'busy') AutoSync.last.set(s.id, info); else if (al) AutoSync.last.delete(s.id);
  if (al && info.kind !== 'busy' && $('#songDialog')?.open && typeof editing !== 'undefined' && editing === s) paintSyncLine($('#syncLine2'), info, s);
  if (state.song !== s) return;
  clearTimeout(AutoSync.hideTimer);
  paintSyncLine($('#syncLine'), info, s);
  if (info.kind !== 'none' && info.kind !== 'busy') AutoSync.hideTimer = setTimeout(() => paintSyncLine($('#syncLine'), null), 5000);
  if (al) autoSyncUI();
}
// [그만두기] 뒤: 그 곡의 줄을 지운다
function syncLineClear(s) {
  if (!s) return;
  AutoSync.last.delete(s.id);
  if (state.song === s) { clearTimeout(AutoSync.hideTimer); paintSyncLine($('#syncLine'), null); }
  autoSyncUI();
}
// 곡을 바꾸면 S1을 지우고 단추를 다시 그린다 (songs.js computeLines가 부름)
function autoSyncUI() {
  const s = state.song, btn = $('#autoSyncBtn'), chk = $('#syncChkBtn');
  if (!btn) return;
  btn.hidden = !canAutoSync(s); btn.disabled = AutoSync.busy;
  if (chk) chk.hidden = !(s && !s.demo && s.syncChk && parseLyrics(s.lyrics || '').synced);
  const aligning = !!(s && typeof Align !== 'undefined' && Align.want.has(s.id));
  const ab = $('#alignBtn');
  if (ab) { ab.hidden = !canAlignSong(s, true); ab.disabled = aligning; }
  const line = $('#syncLine');
  if (line && line.dataset.song !== String(s && s.id)) {
    clearTimeout(AutoSync.hideTimer); paintSyncLine(line, null); line.dataset.song = String(s && s.id);
    if (aligning) paintSyncLine(line, alignInfo('aligning'), s);     // 맞추는 곡으로 돌아오면 "맞추는 중"을 다시
  }
}
// 곡 수정 창이 열릴 때 S2(가사 칸 아래)에 그 곡의 마지막 소식 한 줄 (songs.js openSongDialog가 부름)
function syncLineDialog(s) {
  const b2 = $('#alignBtn2'); if (b2) b2.hidden = !canAlignSong(s);    // [원곡 파일로 자동 싱크]: 가사가 있는 곡 수정 때만
  const box = $('#syncLine2'); if (!box) return;
  const info = s && AutoSync.last.get(s.id);
  paintSyncLine(box, info && info.kind !== 'busy' ? info : null, s);
}

/* LRCLIB /api/get: 제목·가수·길이로 정확히 한 곡. 없으면(404) null. 바쁘면(5xx·429) 간격을 두고 3번까지 */
async function lrclibGet(params) {
  const url = 'https://lrclib.net/api/get?' + new URLSearchParams(params), TRIES = 3;
  for (let i = 0; i < TRIES; i++) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.status === 404) return null;
      if (res.ok) { try { const j = await res.json(); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { return null; } }   // 글자로 온 답(잘못된 물음)은 못 찾음
      if (res.status < 500 && res.status !== 429) return null;
    } catch {}
    finally { clearTimeout(timer); }
    if (i < TRIES - 1) await sleep(400 + i * 600);
  }
  throw new Error('busy');
}

async function autoSync() {
  const s = state.song;
  if (!canAutoSync(s) || AutoSync.busy || state.sync) return;
  if (!navigator.onLine) { syncLineShow('offline', s); return; }
  AutoSync.busy = true; autoSyncUI(); syncLineShow('busy', s);
  const hint = { title: s.title, artist: s.artist };
  let pick = { why: 'none' }, slow = false;
  try {
    // 곡 길이: MR 파일, 유튜브 곡은 영상 길이(플레이어가 알려 준 s.ytDur, 아직 모르면 null = 길이 없이 예전처럼)
    hint.mrDur = (s.buffer && s.buffer.duration) || await mediaDuration(s.blob) || (isYtSong(s) && s.ytDur) || null;
    const p = lrclibGetParams(s.title, s.artist, hint.mrDur);
    let got = null;
    if (p) { try { got = await lrclibGet(p); } catch { slow = true; } }
    pick = autoSyncPick(got, null, hint);
    if (pick.why === 'none') {
      try { pick = autoSyncPick(null, await findLyrics(s.title, s.artist, () => {}), hint); slow = false; }
      catch { pick = { why: 'none' }; slow = true; }
    }
  } catch { pick = { why: 'none' }; }
  finally { AutoSync.busy = false; }
  if (!state.songs.includes(s)) { autoSyncUI(); return; }      // 찾는 사이에 지운 곡
  if (pick.lrc && canAutoSync(s)) {
    s.lyrics = pick.lrc; s.lyricOffset = 0; s.syncChk = 1;
    if (typeof hubTouch === 'function') hubTouch(s);
    await persistSong(s);
    if (state.song === s) { computeLines(); updateLyrOffUI(); }
    syncLineShow('found', s);
    if (state.song !== s) toast(`'${s.title}' ${SYNC_TEXT.found}`);
  } else {
    const kind = pick.why === 'novoice' ? 'novoice' : slow ? 'slow' : 'none';
    syncLineShow(kind, s);
    if (state.song !== s) toast(`'${s.title}' ${SYNC_TEXT[kind]}`);
  }
  autoSyncUI();
}
/* 원곡 파일로 자동 싱크 결과 넣기 (CR-227 W8, mr.js alignGot이 부름) */
// 시각이 많이 틀릴 수 있음(low)·이미 시각이 있는 가사면 먼저 묻는다. 기본(처음 초점·Esc·창 닫기)은 넣지 않음
function alignConfirm(s, ask) {
  const dlg = $('#alignDialog');
  if (!dlg) return Promise.resolve(false);
  const swap = ask.overwrite && !ask.low;
  $('#alignTitle').textContent = ask.low ? '가사 시각이 많이 틀릴 수 있어요. 넣을까요?' : '이미 시각이 있는 가사예요. 바꿀까요?';
  $('#alignTxt').textContent = `'${s.title}' · ` + (ask.low && ask.overwrite ? '지금 있는 가사 시각 대신 들어가요. ' : swap ? '집 AI가 맞춘 시각으로 바꿔요. ' : '') + '넣은 뒤에도 [가사 맞추기]에서 고칠 수 있어요';
  $('#alignYes').textContent = swap ? '바꾸기' : '넣기';
  $('#alignNo').textContent = swap ? '바꾸지 않기' : '넣지 않기';
  // 단추는 바로 답한다 (close 이벤트가 늦거나 안 올 때도). Esc·창 닫힘은 close로 = 넣지 않기
  return new Promise(res => {
    let done = false;
    const end = yes => {
      if (done) return;
      done = true;
      dlg.removeEventListener('close', onClose);
      $('#alignYes').onclick = $('#alignNo').onclick = null;
      if (dlg.open) dlg.close();
      res(yes);
    };
    const onClose = () => { if (!dlg.open) end(false); };   // 앞 물음의 늦은 close는 지나침 (창이 다시 열려 있음)
    $('#alignYes').onclick = () => end(true);
    $('#alignNo').onclick = () => end(false);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    $('#alignNo').focus();
  });
}
async function alignApply(s, m) {
  const ask = alignAsk(s, m.level);
  if (ask.low || ask.overwrite) {
    if (state.song !== s) toast(`'${s.title}' 집 AI가 맞춘 가사 시각이 왔어요`);
    const yes = await alignConfirm(s, ask);
    s = songById(s.id);                  // 묻는 사이 곡이 지워졌거나 (허브로) 바뀌었으면 지금 것
    if (!s) return;
    if (!yes) { syncLineShow('alignskip', s); return; }
  }
  s.lyrics = m.lrc; s.lyricOffset = 0; s.syncChk = 1;      // W9 "자동 싱크 · 확인해 주세요"
  if (typeof hubTouch === 'function') hubTouch(s);
  await persistSong(s);
  if (state.song === s) { computeLines(); updateLyrOffUI(); }
  syncLineShow('aligned', s);
  if (state.song !== s) toast(`'${s.title}' ${SYNC_TEXT.aligned}`);
}
// "자동 싱크 · 확인해 주세요" 표시 지우기 (가사 맞추기에서 저장했거나 가사를 손으로 고쳤을 때)
function clearSyncCheck(s) { if (s && s.syncChk) delete s.syncChk; }
{
  const on = (sel, ev, fn) => $(sel)?.addEventListener(ev, fn);
  on('#autoSyncBtn', 'click', autoSync);
  on('#syncChkBtn', 'click', () => { if (state.song && !state.song.demo) enterSync(); });
  // [원곡 파일로 자동 싱크] (mr.js alignStart): 무대 가사 타이밍 줄 · 곡 수정 창 가사 칸 위
  on('#alignBtn', 'click', () => { if (typeof alignStart === 'function' && !state.sync) alignStart(state.song); });
  on('#alignBtn2', 'click', () => {
    const s = typeof editing !== 'undefined' ? editing : null;
    if (!s || typeof alignStart !== 'function') return;
    if ($('#f-lyrics').value !== (s.lyrics || '')) { $('#dlgErr').textContent = '고친 가사를 먼저 저장한 뒤 눌러 주세요'; $('#dlgErr').hidden = false; return; }
    $('#songDialog').close();
    alignStart(s);
  });
}
