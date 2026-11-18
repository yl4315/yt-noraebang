// YT 노래방 · 무대 "자동 싱크" (CR-227 W6·W9·W10 일부): 시각이 없는 곡에 LRCLIB의 시각 붙은 가사를 찾아 넣는다
// - LRCLIB에는 곡 제목·가수(첫 이름)·MR 길이만 보낸다 (손님 이름·방 주소·허브 정보 0). 덧붙이는 머리글 없음.
// - 정확히 한 곡 찾는 /api/get 먼저, 없으면 곡 추가 창과 같은 /api/search (songs.js findLyrics + core.js chooseLyrics).
// - 찾으면 곡에 저장 → 허브를 쓰면 허브로 (hubTouch). "자동 싱크 · 확인해 주세요" 표시(W9)는 싱크 편집에서 저장하거나 가사를 고치면 사라진다.
// - 싱크 한 줄(디자인 S1·S2): 찾음 / 불러옴(다른 기기 설정) / 못 찾음 [직접 맞추기]. 무대(TV)에는 안 나온다. 글은 textContent로만.
// 순수 로직(lrclibGetParams·autoSyncPick·canAutoSync)은 core.js, 테스트는 tests/core.test.js.
'use strict';

const AutoSync = { busy: false, hideTimer: 0, last: new Map() };
// 아이콘 (디자인 5-sync-line: 14px 선 아이콘, 색은 아이콘에만)
const SYNC_ICONS = {
  found: [['path', { d: 'M20 6L9 17l-5-5' }]],
  loaded: [['path', { d: 'M20 16.6A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25' }], ['path', { d: 'M12 12v9M8 17l4 4 4-4' }]],
  none: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M12 16v-4M12 8h.01' }]],
  busy: [['path', { d: 'M21 12a9 9 0 1 1-6.22-8.56' }]],
};
const SYNC_TEXT = {
  found: '가사 시각을 찾았어요 (LRCLIB)',
  loaded: '다른 기기에서 맞춘 설정을 불러왔어요',
  none: '가사 시각을 못 찾았어요',
  busy: '가사 시각을 찾는 중…',
  novoice: '목소리 없는 곡(연주곡)이라 가사를 넣지 않았어요',
  offline: '인터넷이 없어요 · 연결되면 다시 눌러 주세요',
  slow: '가사 서버(LRCLIB)가 바빠요 · 잠시 뒤 다시 눌러 주세요',
};
function syncIcon(kind) {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const [tag, at] of SYNC_ICONS[kind] || SYNC_ICONS.none) { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(at)) e.setAttribute(k, v); svg.append(e); }
  return svg;
}
// 한 줄 그리기. info = { kind:'found'|'loaded'|'none'|'busy', text, fix(직접 맞추기 단추) }
function paintSyncLine(box, info, s) {
  if (!box) return;
  box.textContent = '';
  if (!info) { box.hidden = true; return; }
  box.dataset.state = info.kind;
  box.append(syncIcon(info.kind), el('span', 'sl-text', info.text));
  if (info.fix && s) {
    const b = el('button', 'btn small sl-act', '직접 맞추기'); b.type = 'button';
    b.onclick = () => syncFixByHand(s);
    box.append(b);
  }
  box.hidden = false;
}
// [직접 맞추기]: 가사가 있으면 싱크 편집, 없으면 곡 수정 창(가사 넣기)
async function syncFixByHand(s) {
  if (!state.songs.includes(s)) return;
  if ($('#songDialog').open) $('#songDialog').close();
  if (state.song !== s) await selectSong(s);
  if (state.song !== s) return;
  if (parseLyrics(s.lyrics || '').lines.some(l => l.text)) enterSync(); else openSongDialog(s);
}
// 곡의 마지막 싱크 소식을 S1(진행 막대 아래)에 보인다. 5초 뒤 사라지고, "못 찾음"만 남는다
function syncLineShow(kind, s, text) {
  if (!s || s.demo) return;
  const info = { kind: kind === 'novoice' || kind === 'offline' || kind === 'slow' ? 'none' : kind, text: text || SYNC_TEXT[kind] || '', fix: kind === 'none' || kind === 'slow' };
  if (kind !== 'busy') AutoSync.last.set(s.id, info);
  if (state.song !== s) return;
  clearTimeout(AutoSync.hideTimer);
  paintSyncLine($('#syncLine'), info, s);
  if (info.kind !== 'none' && kind !== 'busy') AutoSync.hideTimer = setTimeout(() => paintSyncLine($('#syncLine'), null), 5000);
}
// 곡을 바꾸면 S1을 지우고 단추를 다시 그린다 (songs.js computeLines가 부름)
function autoSyncUI() {
  const s = state.song, btn = $('#autoSyncBtn'), chk = $('#syncChkBtn');
  if (!btn) return;
  btn.hidden = !canAutoSync(s); btn.disabled = AutoSync.busy;
  if (chk) chk.hidden = !(s && !s.demo && s.syncChk && parseLyrics(s.lyrics || '').synced);
  const line = $('#syncLine');
  if (line && line.dataset.song !== String(s && s.id)) { clearTimeout(AutoSync.hideTimer); paintSyncLine(line, null); line.dataset.song = String(s && s.id); }
}
// 곡 수정 창이 열릴 때 S2(가사 칸 아래)에 그 곡의 마지막 소식 한 줄 (songs.js openSongDialog가 부름)
function syncLineDialog(s) {
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
    hint.mrDur = (s.buffer && s.buffer.duration) || await mediaDuration(s.blob);
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
// "자동 싱크 · 확인해 주세요" 표시 지우기 (싱크 편집에서 저장했거나 가사를 손으로 고쳤을 때)
function clearSyncCheck(s) { if (s && s.syncChk) delete s.syncChk; }
{
  const on = (sel, ev, fn) => $(sel)?.addEventListener(ev, fn);
  on('#autoSyncBtn', 'click', autoSync);
  on('#syncChkBtn', 'click', () => { if (state.song && !state.song.demo) enterSync(); });
}
