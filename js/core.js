// YT 노래방 · 화면과 상관없는 핵심 로직: 가사 읽기, 검색, Drive 동기화 합치기, 파일 이름 해석·가사 찾기 결과 고르기, 백업 파일 형식, 지연 측정 계산
// 자동 테스트(tests/)가 이 파일과 util.js를 브라우저 없이 불러서 검사한다. 여기에는 화면(DOM)을 건드리는 코드를 넣지 않는다.
'use strict';

/* ---------------- 가사 (LRC) ---------------- */
// "[01:02.50]가사" 형식이면 시간까지 읽고, 시간이 없으면 줄만 읽는다
function parseLyrics(text) {
  const timed = [], plain = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    const body = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (tags.length) for (const m of tags) timed.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text: body });
    else if (body) plain.push({ t: null, text: body });
  }
  if (timed.length) return { synced: true, lines: timed.sort((a, b) => a.t - b.t) };
  return { synced: false, lines: plain };
}
const toLRC = lines => lines.map(l => `[${fmtMs(l.t)}]${l.text}`).join('\n');

/* ---------------- 곡 검색: 번호 > 제목 시작 > 제목 포함 > 가수 > 번호 시작 > 초성 ---------------- */
function searchIn(list, query) {
  const q = norm(query);
  if (!q) return list.slice();
  const onlyCho = /^[ㄱ-ㅎ]+$/.test(q);
  return list.map(s => {
    const t = norm(s.title), a = norm(s.artist), no = String(s.no);
    let r = 99;
    if (no === q) r = 0; else if (t.startsWith(q)) r = 1; else if (t.includes(q)) r = 2; else if (a.includes(q)) r = 3;
    else if (no.startsWith(q)) r = 4; else if (onlyCho && (chosung(t).includes(q) || chosung(a).includes(q))) r = 5;
    return { s, r };
  }).filter(x => x.r < 99).sort((x, y) => x.r - y.r || x.s.no - y.s.no).map(x => x.s);
}

/* ---------------- Drive 동기화: 합치기 규칙 ---------------- */
// Drive의 library.json에 올리는 칸. 기기 전용 값(파일 자체, 재생용 소리)은 넣지 않는다.
const SONG_FIELDS = ['id', 'no', 'title', 'artist', 'lyrics', 'lyricOffset', 'video', 'videoLyrics', 'createdAt', 'updatedAt', 'fileId', 'mime', 'size', 'deleted'];
const REC_FIELDS = ['id', 'v', 'title', 'artist', 'songId', 'createdAt', 'updatedAt', 'duration', 'score', 'sr', 'parts', 'mix', 'mime', 'fileId', 'deleted'];

// Drive 목록(remote)을 이 기기 목록(live: 살아 있는 것, tombs: 지운 기록)에 합친다. 더 나중에 바뀐 쪽이 이긴다.
//  opts.mediaKey: 곡처럼 기기에 파일을 따로 두는 경우 그 칸 이름('blob'). Drive 파일이 바뀌면 기기 파일을 비운다.
//                 단, 이 기기에서 새 파일을 아직 못 올렸으면(mediaDirty) 기기 파일과 파일 id를 지킨다.
//  opts.createdAtFallback: 수정 시각이 없으면 만든 시각으로 비교 (녹음)
// 기존 항목은 같은 객체를 고쳐서 쓰고(화면이 그 객체를 들고 있으니까), 새 배열과 바뀐 id 목록을 돌려준다.
function mergeRemoteInto(live, tombs, remoteList, fields, opts = {}) {
  const stamp = x => x.updatedAt || (opts.createdAtFallback ? x.createdAt : 0) || 0;
  const byId = new Map();
  for (const x of live) byId.set(x.id, x);
  for (const t of tombs) byId.set(t.id, t);
  live = live.slice(); tombs = tombs.slice();
  const touched = new Set(), mediaChanged = new Set();
  for (const r of remoteList || []) {
    const l = byId.get(r.id);
    if (l && stamp(l) >= (r.updatedAt || 0)) continue;
    touched.add(r.id);
    if (r.deleted) {
      if (l && !l.deleted) live = live.filter(x => x !== l);
      tombs = tombs.filter(x => x.id !== r.id);
      tombs.push({ ...pick(r, fields), deleted: true, trashed: true });
    } else if (!l || l.deleted) {
      tombs = tombs.filter(x => x.id !== r.id);
      const n = pick(r, fields); delete n.deleted;
      if (opts.mediaKey) n[opts.mediaKey] = null;
      live.push(n);
    } else {
      const keepFile = !!(opts.mediaKey && l.mediaDirty);
      const changed = !!(opts.mediaKey && r.fileId && r.fileId !== l.fileId && !keepFile);
      Object.assign(l, pick(r, fields.filter(k => !(k === 'fileId' && keepFile))));
      if (changed) { l[opts.mediaKey] = null; mediaChanged.add(l.id); }
    }
  }
  return { live, tombs, touched, mediaChanged };
}

// 사용자 목록 합치기: 사용자마다 더 나중에 바뀐 쪽. 이 기기에서 처음에 자동으로 만든 빈 '나'는
// Drive에 사용자가 이미 있으면 버린다 (기기마다 '나'가 하나씩 늘어나지 않게).
function mergeProfileLists(local, remote) {
  if (!remote || !remote.length) return local.slice();
  const map = new Map(local.map(p => [p.id, p]));
  for (const rp of remote) { const lp = map.get(rp.id); if (!lp || (rp.updatedAt || 0) > (lp.updatedAt || 0)) map.set(rp.id, rp); }
  let list = [...map.values()];
  if (remote.some(p => !p.deleted)) list = list.filter(p => !(p.auto && !p.favorites.length && !p.playlists.length));
  return list;
}

// 두 기기에서 동시에 같은 곡 번호를 쓴 경우, 나중에 만든 곡에 새 번호를 준다. 번호를 바꾼 곡 id를 돌려준다.
function renumberDuplicates(songs, now = Date.now()) {
  const seen = new Set(), changed = new Set();
  for (const s of [...songs].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
    if (seen.has(+s.no)) { s.no = Math.max(...songs.map(x => +x.no)) + 1; s.updatedAt = now; changed.add(s.id); }
    seen.add(+s.no);
  }
  return changed;
}

// Drive에 쓸 library.json. 아직 파일을 못 올린 곡·녹음은 다른 기기에서 받을 수 없으니 빼 둔다.
function buildLibrary({ songs, tombs, profiles, recs, recTombs }, now = Date.now()) {
  return {
    version: 1, app: 'YT 노래방', updatedAt: now,
    songs: [...songs.filter(s => !s.demo && s.fileId).map(s => pick(s, SONG_FIELDS)), ...tombs.map(t => ({ ...pick(t, SONG_FIELDS), deleted: true }))],
    profiles: profiles.map(({ auto, ...p }) => p),
    recs: [...recs.filter(r => r.fileId).map(r => pick(r, REC_FIELDS)), ...recTombs.map(t => ({ ...pick(t, REC_FIELDS), deleted: true }))],
  };
}
// 내용이 같으면 Drive에 다시 쓰지 않으려고 비교용 문자열을 만든다 (순서는 무시)
const byIdSort = a => [...(a || [])].sort((x, y) => x.id < y.id ? -1 : 1);
const librarySig = l => JSON.stringify([byIdSort(l.songs), byIdSort(l.profiles), byIdSort(l.recs)]);

/* ---------------- 파일 이름 → 제목·가수 (곡 추가 창, 여러 곡 한 번에 넣기, Drive 폴더 들여오기가 같이 씀) ---------------- */
// 예: "[TJ노래방] 200% - AKMU(악뮤) _ TJ Karaoke.mp3" → { title: '200%', artist: 'AKMU(악뮤)' }
//     "밤편지 - 아이유 (MR).mp3" → 밤편지 / 아이유,  "01 밤편지.mp3" → 밤편지 (앞 트랙 번호를 뺌)
//     "좋은 날_아이유_MR.mp3" → 좋은 날 / 아이유 (" - "가 없으면 밑줄로 나눈다. 두 조각일 때만, 아니면 밑줄은 띄어쓰기)
// "아이유 - 밤편지"처럼 제목·가수가 뒤집힌 이름은 여기서는 알 수 없다 → 가사를 찾을 때 뒤집어서도 맞춰 본다 (chooseLyrics)
function titleFromFilename(name) {
  let s = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  s = s.replace(/^\s*[\[【][^\]】]*[\]】]\s*/, '');                       // 앞의 [TJ노래방] 같은 꼬리표
  s = s.replace(/[\s_\-–]*(TJ|KY|금영)\s*(Karaoke|노래방|미디어)[^]*$/i, ''); // 뒤의 "_ TJ Karaoke - (320 Kbps)" 같은 것
  s = s.replace(/[(\[]\s*(TJ|KY|금영)[\s.#:-]*\d+\s*[)\]]/ig, '');          // (KY.12345) 같은 노래방 번호
  s = s.replace(/\(\s*\d+\s*kbps\s*\)/ig, '').replace(/[(\[]\s*반주\s*[)\]]/g, '');
  // MR은 대문자·소문자만 ("Mr. Chu"의 Mr는 지키려고), Inst.·Instrumental은 대소문자 상관없이. 밑줄 옆도 뺀다 ("_MR")
  s = s.replace(/(?<![A-Za-z0-9])(?:MR|mr)(?![A-Za-z0-9.])/g, '').replace(/(?<![A-Za-z0-9])inst(?:rumental)?\.?(?![A-Za-z0-9])/ig, '');
  s = s.replace(/[(\[]\s*[)\]]/g, '');                                    // 위에서 비워진 () []
  const noTrack = s.replace(/^\s*(?:0\d[\s.\-_)]+|\d{1,3}[.\-_)](?!\d)\s*)/, ''); // "01 ", "1. " 같은 트랙 번호 ("10 Minutes"·"1-800-273-8255"는 그대로)
  if (noTrack.trim()) s = noTrack;
  s = s.replace(/\s+[–—]\s+/g, ' - ').replace(/^[\s_\-–]+|[\s_\-–]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  const i = s.lastIndexOf(' - ');
  if (i > 0) return { title: s.slice(0, i).trim(), artist: s.slice(i + 3).trim() };
  const parts = s.split(/\s*_+\s*/).filter(Boolean);
  if (parts.length === 2) return { title: parts[0], artist: parts[1] };
  s = parts.join(' ');
  return { title: s || String(name || '제목 없음'), artist: '' };
}

/* ---------------- Drive 폴더에 직접 넣은 MR 들여오기 ---------------- */
// 폴더 파일 중 아직 어떤 곡과도 이어지지 않은 것을 새 곡으로 만든다. 곡 id를 파일 id로 정해서,
// 두 기기가 같은 파일을 동시에 들여와도 한 곡으로 합쳐진다.
function songsFromFolderFiles(files, knownFileIds, startNo, now = Date.now()) {
  const out = [];
  let no = startNo;
  for (const f of files) {
    if (knownFileIds.has(f.id)) continue;
    const { title, artist } = titleFromFilename(f.name);
    const s = { id: 'drive-' + f.id, no: no++, title, artist, lyrics: '', lyricOffset: 0, createdAt: now, updatedAt: now, fileId: f.id, mime: f.mimeType || '', video: /^video\//.test(f.mimeType || ''), blob: null };
    if (+f.size) s.size = +f.size;
    out.push(s);
  }
  return out;
}

/* ---------------- 곡 넣기 자동화: 여러 MR 한 번에 + 가사 자동 찾기 (CR-017) ---------------- */
// MR로 넣을 수 있는 파일인지: 음악·동영상 형식이거나(파일 형식을 모르는 기기도 있어서) 확장자로 본다
const MEDIA_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|mp4|m4v|mov|3gp)$/i;
const isMediaFile = f => !!f && (/^(audio|video)\//.test(f.type || '') || MEDIA_EXT.test(f.name || ''));
// 파일 이름 순서 (숫자는 크기대로: "2 …"가 "10 …"보다 앞). 고른 순서는 기기마다 달라서 번호는 이 순서로 붙인다
const byFileName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko', { numeric: true, sensitivity: 'base' });
// 새 곡 번호 n개: 가장 큰 번호 + 1부터 차례로 (데모곡 10001만 있으면 10002부터)
function nextSongNumbers(songs, n) {
  const top = Math.max(10001, ...(songs || []).map(s => +s.no).filter(Number.isFinite));
  return Array.from({ length: n }, (_, i) => top + 1 + i);
}
// 제목·가수가 같은 곡 (띄어쓰기·대소문자 무시, 데모곡 빼고). 없으면 null
function findSameSong(songs, title, artist) {
  const t = norm(title), a = norm(artist);
  return (songs || []).find(s => !s.demo && !s.deleted && norm(s.title) === t && norm(s.artist) === a) || null;
}
// 곡 목록의 "가사 없음": 데모곡이 아니고 가사가 비어 있는 곡 (동영상 곡도 센다)
const lacksLyrics = s => !!s && !s.demo && !String(s.lyrics || '').trim();

// 가수 이름 → 비교·검색에 쓸 이름들. 괄호 앞 이름이 먼저, 괄호 안 이름이 다음. "Feat." 뒤는 뺀다.
// "AKMU(악뮤)" → ['AKMU', '악뮤'], "잔나비(Feat.카리나 of aespa)" → ['잔나비'], "(G)I-DLE" → ['I-DLE'] (한 글자 괄호는 버림)
function artistNames(name) {
  const s = String(name || '').replace(/[(\[]?\s*(?<![a-z])(?:feat\.?|ft\.|featuring)(?![a-z])[^]*$/i, '');
  const inner = [...s.matchAll(/[(\[]([^()\[\]]*)[)\]]/g)].map(m => m[1].replace(/\s+/g, ' ').trim());
  const main = s.replace(/[(\[][^()\[\]]*[)\]]/g, ' ').replace(/[()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const x of [main, ...inner]) if (x && (x === main || norm(x).length >= 2) && !out.some(o => norm(o) === norm(x))) out.push(x);
  return out;
}
// 찾기 결과의 가수(cand)가 내 가수(artist)와 같은지: 결과 가수 이름 안에 내 가수 이름(괄호 앞·괄호 안 아무거나)이 들어 있으면 같음.
// 괄호 없는 가수는 예전 규칙("결과 가수가 내 가수를 포함")과 같다.
function artistMatches(artist, cand) {
  const hay = norm(cand);
  return !!hay && artistNames(artist).some(n => hay.includes(norm(n)));
}
// 제목 맞음 정도: 0 같음("Through the Night (밤편지)"·괄호 뺀 제목도 같음으로) · 30 포함 · 60 다름
function titleRank(candTitle, title) {
  const nt = norm(title), tn = norm(candTitle);
  if (tn === nt || tn.includes(`(${nt})`) || tn.replace(/\(.*?\)/g, '') === nt) return 0;
  return tn.includes(nt) ? 30 : 60;
}
// LRCLIB 찾기 결과 → 고르기 쉬운 순서 15개: 싱크 있음 > 가수 같음 > 제목 같음 > MR과 길이 비슷. 가사가 없는 결과는 뺀다.
function rankLyrics(found, { title, artist, mrDur } = {}) {
  return (found || []).filter(x => x && (x.syncedLyrics || x.plainLyrics))
    .map(x => ({ x, rank: (x.syncedLyrics ? 0 : 1000) + (artist && !artistMatches(artist, x.artistName) ? 200 : 0) + titleRank(x.trackName, title)
      + (mrDur ? (Number.isFinite(x.duration) ? Math.min(29, Math.abs(x.duration - mrDur) / 2) : 29) : 0) }))
    .sort((a, b) => a.rank - b.rank).slice(0, 15).map(o => o.x);
}
// 가사를 저절로 넣을지 정한다. 맨 위 후보가 네 가지를 다 맞을 때만 자동: 싱크 있음 + 제목 같음 + 가수 같음 + MR 길이와 3초 안.
// 가수나 MR 길이를 모르면 자동으로 넣지 않는다. 파일 이름의 제목·가수가 뒤집혀 있으면(후보 제목 = 내 가수, 후보 가수 = 내 제목)
// 뒤집어서 본다. 돌려주는 값: { items: 고를 후보(정렬), auto: 넣을 후보 또는 null, why: 자동이 아닌 이유, swapped, title, artist }
// why: 'none' 결과 없음 · 'plain' 싱크 없음 · 'title' 제목 다름 · 'noartist' 가수 모름 · 'artist' 가수 다름 · 'nodur' MR 길이 모름 · 'duration' 길이 다름
const AUTO_SEC = 3;
function chooseLyrics(found, { title, artist, mrDur } = {}) {
  const fits = (x, t, a) => titleRank(x.trackName, t) === 0 && !!a && artistMatches(a, x.artistName);
  let t = title || '', a = artist || '', swapped = false, items = rankLyrics(found, { title: t, artist: a, mrDur });
  if (a && !items.some(x => fits(x, t, a))) {
    const alt = rankLyrics(found, { title: a, artist: t, mrDur });
    if (alt.some(x => fits(x, a, t))) { swapped = true; [t, a] = [a, t]; items = alt; }
  }
  const top = items[0];
  const why = !top ? 'none' : !top.syncedLyrics ? 'plain' : titleRank(top.trackName, t) !== 0 ? 'title' : !a ? 'noartist'
    : !artistMatches(a, top.artistName) ? 'artist' : !mrDur ? 'nodur' : !(Math.abs(top.duration - mrDur) <= AUTO_SEC) ? 'duration' : '';
  return { items, auto: why ? null : top, why, swapped, title: t, artist: a };
}

/* ---------------- TV로 켜기 (?tv=1) ---------------- */
// 주소에 tv 값이 있으면 켜자마자 TV 화면으로. ?tv=1, ?tv(값 없이)는 켜기, ?tv=0·false·no·off는 끄기
function tvParam(search) {
  const v = new URLSearchParams(search || '').get('tv');
  return v != null && !/^(0|false|no|off)$/i.test(v.trim());
}
// 창이 이미 화면을 다 덮고 있는지 (크롬 --start-fullscreen은 F11처럼 제목 줄·테두리 없이 화면 전체를 쓴다).
// 그럴 때는 "아무 키나 누르면 전체 화면" 안내를 띄우지 않는다.
// - outer(창 바깥 크기)는 화면(screen)과 같은 단위라서 화면 크기와 바로 비교한다. 최대화한 창은 작업 표시줄만큼
//   작거나 테두리만큼 커서 여기서 걸러진다.
// - inner(보이는 영역)는 페이지 확대(줌)만큼 작아지므로 outer/inner 너비 비율로 줌을 덜어 낸 뒤, 위에 제목 줄이
//   없는지(높이가 outer와 같은지) 본다. 작업 표시줄을 숨긴 PC에서 최대화한 앱 창은 제목 줄 때문에 걸러진다.
function fillsScreen(win, scr, tol = 4) {
  const { innerWidth: iw, innerHeight: ih, outerWidth: ow, outerHeight: oh } = win || {};
  const { width: sw, height: sh } = scr || {};
  if (!(iw > 0 && ih > 0 && ow > 0 && oh > 0 && sw > 0 && sh > 0)) return false;
  const near = (a, b) => Math.abs(a - b) <= tol;
  return near(ow, sw) && near(oh, sh) && near(ih * (ow / iw), oh);
}

/* ---------------- 지연 시간 자동 측정 (딸깍 소리) ---------------- */
// 스피커로 딸깍을 clicks번, gap초 간격으로 내고, 딸깍마다 win초 안에 마이크로 처음 큰 소리가 들어온 때를 찾는다.
// 블루투스 스피커·무선 화면 복제는 지연이 길어서(0.4초 넘게), 예전 0.45초 간격·0.42초 창으로는 앞 딸깍 소리를
// 잡아 아주 작은 값이 저장될 수 있었다. 그래서 간격을 1초로 늘리고, 창(0.9초)이 다음 딸깍 전에 끝나게 했다.
// lead = 첫 딸깍까지 기다리는 시간, maxMs = 녹음 기본 싱크 슬라이더 끝, unevenMs = "값이 고르지 않아요" 기준
const MEASURE = { clicks: 6, gap: 1, win: 0.9, lead: 0.7, maxMs: 600, unevenMs: 60 };

// pcm: 마이크로 받은 소리(Float32Array), sr: 샘플레이트, f0: pcm[0]의 오디오 시계 프레임 번호,
// clicks: 딸깍을 낸 시각(초, 오디오 시계). 돌려주는 값: 들은 딸깍마다 지연(초) 목록 (못 들은 딸깍은 빠짐).
// 첫 딸깍 전 0.4초 동안의 잡음보다 3배(최소 0.02) 큰 소리를 딸깍으로 본다.
function findClickDelays(pcm, sr, f0, clicks, win = MEASURE.win) {
  const n = pcm ? pcm.length : 0, idx = t => Math.round(t * sr) - f0, out = [];
  if (!n || !clicks || !clicks.length) return out;
  let floor = 0;
  for (let i = Math.max(0, idx(clicks[0] - 0.4)); i < Math.min(n, idx(clicks[0])); i++) floor = Math.max(floor, Math.abs(pcm[i]));
  const thr = Math.max(0.02, floor * 3);
  for (const t of clicks) {
    const s = idx(t), e = Math.min(n, idx(t + win));
    for (let i = Math.max(0, s); i < e; i++) if (Math.abs(pcm[i]) > thr) { out.push((i - s) / sr); break; }
  }
  return out;
}
// 지연 목록 → 저장할 값. 3번 미만이면 못 들은 것(ok: false). 가운데 값을 쓰고, 슬라이더 끝(600ms)보다 길면
// 600으로 두고 tooLong으로 알린다. 가장 큰 값·작은 값을 하나씩 뺀 나머지끼리 60ms 넘게 차이 나면 uneven.
function summarizeDelays(lat, maxMs = MEASURE.maxMs, unevenMs = MEASURE.unevenMs) {
  if (!lat || lat.length < 3) return { ok: false, heard: lat ? lat.length : 0 };
  const ms = lat.map(x => x * 1000).sort((a, b) => a - b), mid = Math.round(ms[Math.floor(ms.length / 2)]);
  const core = ms.length >= 5 ? ms.slice(1, -1) : ms;
  return { ok: true, heard: ms.length, raw: mid, ms: clamp(mid, 0, maxMs), tooLong: mid > maxMs, uneven: core[core.length - 1] - core[0] > unevenMs };
}

/* ---------------- 방향키로 버튼 고르기 (TV 화면 숫자판) ---------------- */
// items: 버튼 가운데 좌표 [{x, y}], from: 지금 고른 버튼 번호, dir: 'ArrowUp'·'ArrowDown'·'ArrowLeft'·'ArrowRight'.
// 그 방향(45도 안)에 있는 버튼 중 가장 가까운 것(옆으로 벗어난 거리는 2배로 친다)의 번호. 그 방향에 없으면 from 그대로.
// 아직 고른 버튼이 없으면(from이 없는 번호) 첫 버튼.
function pickByArrow(items, from, dir) {
  const c = items && items[from];
  if (!c) return items && items.length ? 0 : -1;
  const h = dir === 'ArrowLeft' || dir === 'ArrowRight', sign = dir === 'ArrowRight' || dir === 'ArrowDown' ? 1 : -1;
  let best = from, bd = Infinity;
  items.forEach((p, i) => {
    if (i === from) return;
    const along = (h ? p.x - c.x : p.y - c.y) * sign, across = Math.abs(h ? p.y - c.y : p.x - c.x);
    if (along <= 0.5 || across > along) return;   // 옆으로 더 벗어난 버튼(45도 밖)은 그 방향이 아니다 (맨 아래 오른쪽에서 → 가 위 ✕로 가지 않게)
    const d = along + across * 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/* ---------------- 백업 파일 (.ytbackup) ---------------- */
// 형식: "YTNB1\n" + 머리말 길이(4바이트) + 머리말 JSON + 파일들을 차례로 이어 붙임
const BK_MAGIC = 'YTNB1\n';
function packBackup(head, blobs) {
  const full = { ...head, blobs: blobs.map(b => ({ size: b.size, type: b.type })) };
  const hb = new TextEncoder().encode(JSON.stringify(full)), len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, hb.length, true);
  return new Blob([BK_MAGIC, len, hb, ...blobs], { type: 'application/octet-stream' });
}
// 파일 전체를 메모리에 올리지 않고, 필요한 부분만 잘라서(slice) 돌려준다
async function unpackBackup(file) {
  if (await file.slice(0, BK_MAGIC.length).text() !== BK_MAGIC) throw new Error('YT 노래방 백업 파일이 아니에요');
  const at = BK_MAGIC.length, hl = new DataView(await file.slice(at, at + 4).arrayBuffer()).getUint32(0, true);
  const head = JSON.parse(await file.slice(at + 4, at + 4 + hl).text());
  let off = at + 4 + hl;
  const blobAt = (head.blobs || []).map(b => { const x = file.slice(off, off + b.size, b.type); off += b.size; return x; });
  if (off > file.size) throw new Error('백업 파일이 잘렸어요');
  return { head, blobAt };
}

/* ---------------- 기기 맞추기 (CR-039): 점수·부른 횟수를 기기마다 세고 화면에서 합친다 ---------------- */
// 기기마다 Drive 'YT 노래방' 폴더에 stats-<기기 id>.json 하나씩. 자기 파일만 쓰고 남의 파일은 읽기만 해서 쓰기 충돌이 없다.
// 이 기기 기록(nb-plays·nb-scores)에는 남의 기록을 섞지 않는다. 합계는 보여 줄 때만 더한다.
const STATS_CAP = 30;                                  // 점수는 기기마다 최근 30개 (지금 규칙 그대로)
const statsFileName = dev => `stats-${dev}.json`;
const okNum = v => typeof v === 'number' && isFinite(v) && v >= 0;
// 부른 횟수 칸 { 곡 id: { n, last } } 에서 모양이 틀린 줄을 뺀다
function cleanPlays(o) {
  const out = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const [id, p] of Object.entries(o)) if (p && okNum(p.n)) out[id] = { n: Math.floor(p.n), last: okNum(p.last) ? p.last : 0 };
  return out;
}
function cleanScores(a) {
  return Array.isArray(a) ? a.filter(x => x && typeof x === 'object' && okNum(x.score) && okNum(x.at) && (x.id || x.no != null)) : [];
}
// 횟수 합치기 (같은 기기의 두 사본): 곡마다 큰 n, 늦은 last → 순서를 바꿔도·두 번 해도 같고 줄지 않는다
function mergePlays(a, b) {
  const out = cleanPlays(a);
  for (const [id, p] of Object.entries(cleanPlays(b))) {
    const o = out[id];
    out[id] = o ? { n: Math.max(o.n, p.n), last: Math.max(o.last, p.last) } : p;
  }
  return out;
}
const scoreKey = x => `${x.at}|${x.id || x.no}|${x.score}`;
// 점수 합치기: 합집합 (시각·곡·점수가 같으면 한 번), 최근 순, cap개까지 (0이면 제한 없음)
function mergeScores(a, b, cap = STATS_CAP) {
  const seen = new Set(), out = [];
  for (const x of [...cleanScores(a), ...cleanScores(b)]) { const k = scoreKey(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  out.sort((x, y) => y.at - x.at);
  return cap ? out.slice(0, cap) : out;
}
// 보이는 합계 = 이 기기 + 다른 기기 사본들 (내 id의 사본은 빼서 두 번 세지 않음)
// mine = { plays, scores }, others = { 기기 id: { mt, plays, scores } } → { plays: { 곡 id: { n, last } }, scores: [...], devices }
function statsTotals(mine, others, myId) {
  const plays = {}, add = src => {
    for (const [id, p] of Object.entries(cleanPlays(src))) {
      const o = plays[id] || (plays[id] = { n: 0, last: 0 });
      o.n += p.n; o.last = Math.max(o.last, p.last);
    }
  };
  add(mine?.plays);
  let scores = cleanScores(mine?.scores), devices = 0;
  for (const [dev, c] of Object.entries(others && typeof others === 'object' ? others : {})) {
    if (dev === myId || !c || typeof c !== 'object') continue;
    devices++; add(c.plays); scores = scores.concat(cleanScores(c.scores));
  }
  return { plays, scores: mergeScores(scores, [], 0), devices };
}
// 올릴 내용의 비교값 (키 순서가 달라도 같음) → 같으면 다시 쓰지 않는다
function statsSig({ plays, scores }) {
  const p = cleanPlays(plays);
  return JSON.stringify([Object.keys(p).sort().map(k => [k, p[k].n, p[k].last]), mergeScores(scores, [], 0).map(scoreKey)]);
}
function buildStatsFile(device, plays, scores, now = Date.now()) {
  return { v: 1, app: 'YT 노래방', device, updatedAt: now, plays: cleanPlays(plays), scores: mergeScores(scores, [], STATS_CAP) };
}
// Drive에서 읽은 파일 → { device, plays, scores } (모양이 틀리면 null: 그 기기 사본은 지난번 값 그대로)
function parseStatsFile(o) {
  if (!o || typeof o !== 'object' || typeof o.v !== 'number' || typeof o.device !== 'string' || !o.device) return null;
  return { device: o.device, plays: cleanPlays(o.plays), scores: cleanScores(o.scores) };
}
// 폴더의 JSON 파일 목록 [{ id, name, modifiedTime }] → 내 파일 하나 + 다른 기기 파일들 (같은 이름이 둘이면 나중에 고친 것)
function pickStatsFiles(files, myId) {
  const byDev = new Map();
  for (const f of files || []) {
    const m = /^stats-(.+)\.json$/.exec(f?.name || ''); if (!m || !f.id) continue;
    const mt = Date.parse(f.modifiedTime) || 0, cur = byDev.get(m[1]);
    if (!cur || mt > cur.mt) byDev.set(m[1], { id: f.id, device: m[1], mt });
  }
  const mine = myId ? byDev.get(myId) || null : null;
  return { mine, others: [...byDev.values()].filter(x => x.device !== myId) };
}
// 백업 파일의 점수·횟수 (Q2): device가 있고 내 id와 다르면 그 기기 사본에 합친다 (Drive에서 같은 기기 파일이 와도 같은 칸이라
// 두 번 세지 않음). device가 없는 옛 백업이나 내 id와 같으면 예전 규칙 그대로 (점수 합집합 최근 30개, 횟수는 큰 쪽).
function mergeBackupStats(head, myId, mine, others) {
  const dev = typeof head?.device === 'string' && head.device ? head.device : null;
  if (dev && dev !== myId) {
    const c = others[dev] || {};
    return { target: 'other', device: dev, plays: mine.plays, scores: mine.scores,
      others: { ...others, [dev]: { mt: c.mt || 0, plays: mergePlays(c.plays, head.plays), scores: mergeScores(c.scores, head.scores) } } };
  }
  const scores = mine.scores.slice();
  for (const x of head?.scores || []) if (!scores.some(y => y.at === x.at && y.title === x.title)) scores.push(x);
  scores.sort((a, b) => b.at - a.at); scores.splice(STATS_CAP);
  const plays = { ...mine.plays };
  for (const [id, pl] of Object.entries(head?.plays || {})) if (!plays[id] || pl.n > plays[id].n) plays[id] = pl;
  return { target: 'mine', device: dev, plays, scores, others };
}

/* 여행 준비 (CR-039): 무엇을 어떤 순서로 받을지, 다 됐는지 */
const needsDownload = s => !!s && !s.demo && !s.blob && !!s.fileId;
// 많이 부른 곡 → 누구든 좋아요한 곡 → 번호 순. 공간이 모자라 멈춰도 중요한 곡은 이미 받아져 있다.
// free = 남은 공간(바이트, 모르면 null), margin = 여유(10%, 기기 시험으로 조정)
function planDownload({ songs, plays = {}, favorites = [], free = null, skipVideo = false, margin = 0.1 }) {
  const fav = new Set(favorites), n = s => plays[s.id]?.n || 0;
  const all = (songs || []).filter(needsDownload);
  const list = all.filter(s => !(skipVideo && s.video)).sort((a, b) =>
    n(b) - n(a) || (plays[b.id]?.last || 0) - (plays[a.id]?.last || 0) || (fav.has(b.id) - fav.has(a.id)) || a.no - b.no);
  const sized = list.filter(s => okNum(s.size) && s.size > 0);
  const need = sized.reduce((t, s) => t + s.size, 0);
  const videos = all.filter(s => s.video), videoBytes = videos.reduce((t, s) => t + (okNum(s.size) ? s.size : 0), 0);
  return { list, need, unknown: list.length - sized.length, fits: free == null || need * (1 + margin) <= free,
    video: skipVideo ? 0 : list.filter(s => s.video).length, skippedVideo: skipVideo ? videos.length : 0, videoBytes };
}
// 준비 끝 판정 (저장해 둔 표시가 아니라 지금 상태로): Drive에만 있는 곡 0곡 + 앱 화면 저장됨 → 끝.
// 영구 저장이 꺼져 있어도 끝으로 치되 경고. 이 기기에서 넣고 아직 Drive에 안 올라간 곡 수도 같이 (PC용).
function travelStatus({ songs, connected = true, persisted = false, shellCached = false }) {
  const real = (songs || []).filter(s => !s.demo);
  const cloudOnly = real.filter(needsDownload).length, local = real.filter(s => !!s.blob).length;
  const pendingUpload = connected ? real.filter(s => s.blob && (!s.fileId || s.mediaDirty)).length : 0;
  const done = connected && cloudOnly === 0 && shellCached;
  const why = !connected ? 'connect' : cloudOnly ? 'songs' : !shellCached ? 'shell' : null;
  return { done, why, cloudOnly, local, pendingUpload, warnPersist: done && !persisted };
}

/* MR 만들기 (CR-089): 집 AI 서버의 "MR 만들기 창"을 새 탭으로 열고, 다 만든 MR을 창끼리(postMessage) 받는다.
   노래방은 서버에 직접 요청하지 않는다 (https 노래방 → http 서버는 막힘). 주소는 짧은 기계 이름만 (tailnet 뒷부분·IP 없음) */
const MR_DEFAULT_SERVER = 'http://dgxspark-yena:8765';
const MR_MAX_FILES = 30, MR_MAX_BYTES = 120 * 1024 * 1024;
// 서버 주소 다듬기·검사 → { ok:true, url, origin } | { ok:false, why:'empty'|'scheme'|'userinfo'|'bad' }
// http:// 또는 https://로 시작, 사용자·비밀번호(@) 없음, ?·# 없음, 끝 / 는 뗀다 (창은 url + '/'로 연다)
function normalizeMrServer(input) {
  const s = String(input ?? '').trim();
  if (!s) return { ok: false, why: 'empty' };
  if (!/^https?:\/\/[^/]/i.test(s)) return { ok: false, why: 'scheme' };
  if (s.includes('@')) return { ok: false, why: 'userinfo' };
  if (/[\s?#\\]/.test(s)) return { ok: false, why: 'bad' };
  let u;
  try { u = new URL(s); } catch { return { ok: false, why: 'bad' }; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname) return { ok: false, why: 'bad' };
  return { ok: true, url: u.origin + u.pathname.replace(/\/+$/, ''), origin: u.origin };
}
// 받은 메시지가 믿을 만한가. from = { origin(보낸 주소), mine(내가 연 창에서 왔나) }, want = 설정한 서버 주소의 origin
// 돌려주는 것: null(무시) | { type } | files면 { type:'files', files } 또는 { type:'files', bad:true } (→ nack bad)
// isFile: 브라우저에서는 f => f instanceof File (Node 시험은 모양만 봄)
function mrMessageOk(msg, from, want, isFile = f => !!f && typeof f.name === 'string' && typeof f.size === 'number') {
  if (!from || from.mine !== true || !want || from.origin !== want) return null;
  if (!msg || typeof msg !== 'object' || msg.app !== 'yena-mr' || msg.v !== 1 || typeof msg.type !== 'string') return null;
  if (msg.type !== 'files') return { type: msg.type };
  const files = Array.isArray(msg.files) ? msg.files : [];
  const ok = files.length > 0 && files.length <= MR_MAX_FILES && files.every(f => isFile(f) && f.size > 0 && f.size <= MR_MAX_BYTES && isMediaFile(f));
  return ok ? { type: 'files', files } : { type: 'files', bad: true };
}
