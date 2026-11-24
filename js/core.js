// YT 노래방 · 화면과 상관없는 핵심 로직: 가사 읽기, 검색, Drive 동기화 합치기, 파일 이름 해석·가사 찾기 결과 고르기, 백업 파일 형식, 지연 측정 계산, 녹음 파일 이름·작은 파일(m4a) 틀
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
// source·ytId·ytDur: 유튜브 곡 (CR-030). 유튜브 곡은 소리 파일이 없어서 글만 올라간다.
const SONG_FIELDS = ['id', 'no', 'title', 'artist', 'lyrics', 'lyricOffset', 'video', 'videoLyrics', 'createdAt', 'updatedAt', 'fileId', 'mime', 'size', 'deleted', 'source', 'ytId', 'ytDur'];
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
// 유튜브 곡은 올릴 파일이 없으니 글(영상 번호·제목·가사)만 바로 넣는다.
function buildLibrary({ songs, tombs, profiles, recs, recTombs }, now = Date.now()) {
  return {
    version: 1, app: 'YT 노래방', updatedAt: now,
    songs: [...songs.filter(s => !s.demo && (s.fileId || isYtSong(s))).map(s => pick(s, SONG_FIELDS)), ...tombs.map(t => ({ ...pick(t, SONG_FIELDS), deleted: true }))],
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
// 곡 목록의 "가사 없음": 데모곡이 아니고 가사가 비어 있는 곡 (동영상 곡도 센다).
// 유튜브 곡은 빼고 센다: 노래방 영상에는 보통 자막이 박혀 있어서 가사가 없어도 "영상만"으로 정상 (CR-030)
const lacksLyrics = s => !!s && !s.demo && !isYtSong(s) && !String(s.lyrics || '').trim();

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

/* ---------------- 유튜브 곡 (CR-030) ----------------
   유튜브 곡 = 소리 파일 없이 영상 번호(11자)만 가진 곡 줄 { source:'yt', ytId, ytDur? }.
   공식 IFrame 플레이어로 보이는 채로만 튼다 (내려받기·소리 빼기·녹화·Web Audio 연결 없음). */
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const isYtSong = s => !!s && s.source === 'yt' && YT_ID_RE.test(String(s.ytId || ''));
// 글 속에서 유튜브 링크를 찾아 영상 번호만 뽑는다. 없으면 null.
// youtu.be/ID · watch?v=ID · shorts/ID · embed/ID · live/ID · m.·music.youtube.com · youtube-nocookie.com
// 재생목록 링크(list=)는 그 안의 영상(v=) 하나만. 영상이 없는 재생목록·채널·검색 링크는 null.
function parseYouTubeId(text) {
  const s = String(text ?? '');
  const re = /(?<![\w.\-\/@])(?:https?:\/\/)?(?:[\w-]+\.)*(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\/[^\s<>"'()]*/ig;
  for (const m of s.matchAll(re)) {
    let u;
    try { u = new URL(/^https?:/i.test(m[0]) ? m[0] : 'https://' + m[0]); } catch { continue; }
    const host = u.hostname.toLowerCase();
    let id = null;
    if (host === 'youtu.be') id = u.pathname.split('/')[1] || null;
    else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
      id = u.searchParams.get('v');
      if (!id) { const p = u.pathname.match(/^\/(?:shorts|embed|live|v|e)\/([^/?#]+)/); id = p ? p[1] : null; }
    }
    if (id && YT_ID_RE.test(id)) return id;
  }
  return null;
}
const ytWatchUrl = id => 'https://www.youtube.com/watch?v=' + encodeURIComponent(id);
// 열쇠 없는 검색: 유튜브 검색 결과를 새 창으로 연다. 검색어에 "노래방"을 보탠다 (이미 노래방·MR·karaoke·inst가 있으면 그대로)
function ytSearchQuery(q) {
  const s = String(q ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return /노래방|karaoke|(?<![A-Za-z])inst/i.test(s) || /(?<![A-Za-z])(?:MR|mr)(?![A-Za-z.])/.test(s) ? s : s + ' 노래방';
}
const ytResultsUrl = q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(ytSearchQuery(q));
// 유튜브가 돌려주는 제목의 &amp; &#39; 같은 것을 글자로
const HTML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function htmlText(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return HTML_ENT[e.toLowerCase()] ?? m;
  }).replace(/\s+/g, ' ').trim();
}
// YouTube Data API search.list 답 → [{ id, title, channel }] (영상 번호가 맞는 것만)
function parseYtSearch(json) {
  const items = Array.isArray(json?.items) ? json.items : [];
  // 썸네일은 유튜브 그림 서버(i.ytimg.com)의 https 주소만 쓴다 (다른 곳 주소는 버림)
  const thumb = th => { const u = String(th?.medium?.url || th?.default?.url || ''); return /^https:\/\/i\.ytimg\.com\//.test(u) ? u : ''; };
  return items.map(it => ({ id: String(it?.id?.videoId || ''), title: htmlText(it?.snippet?.title), channel: htmlText(it?.snippet?.channelTitle), thumb: thumb(it?.snippet?.thumbnails) }))
    .filter(x => YT_ID_RE.test(x.id) && x.title);
}
// 영상 제목(+채널) → 곡 제목·가수. "[TJ노래방] 밤편지 - 아이유 / TJ Karaoke" → 밤편지 / 아이유
// 노래방 채널(TJ·KY·금영·노래방·karaoke) 이름은 가수로 쓰지 않는다. "아이유 - Topic" → 아이유
const KARAOKE_CHANNEL = /노래방|karaoke|(?<![A-Za-z])(TJ|KY|MR)(?![A-Za-z])|금영|entertainment|미디어/i;
function ytTitleParts(rawTitle, author) {
  let s = htmlText(rawTitle);
  s = s.replace(/\s*[\/|｜]\s*(?:TJ|KY|금영)[^\/|｜]*$/i, '');                     // 뒤의 " / TJ Karaoke"
  s = s.replace(/[(\[]\s*(?:karaoke|instrumental|노래방)(?:\s*(?:version|ver\.?|버전))?\s*[)\]]/ig, '');
  s = s.replace(/(?:\s+(?:노래방|karaoke|가사|lyrics?))+\s*$/i, '');               // 끝의 "노래방", "Karaoke"
  if (!s.trim()) return { title: '', artist: '' };
  const { title, artist } = titleFromFilename(s + '.mp4');
  let a = artist;
  const ch = htmlText(author).replace(/\s*-\s*Topic$/i, '').replace(/\s*(?:official|vevo|공식)\s*$/i, '').trim();
  if (!a && ch && !KARAOKE_CHANNEL.test(ch)) a = ch;
  return { title: title || '', artist: a || '' };
}
// 폰 유튜브 앱 [공유] → 주소 ?title=&text=&url= (manifest share_target). 공유가 아니면 null.
// 유튜브 앱은 보통 "제목 + 링크"를 text에 넣는다 → url·text·title 순으로 링크를 찾는다.
function shareParams(search) {
  const p = new URLSearchParams(search || '');
  if (!['title', 'text', 'url'].some(k => p.has(k))) return null;
  const title = (p.get('title') || '').trim(), text = (p.get('text') || '').trim(), url = (p.get('url') || '').trim();
  const id = parseYouTubeId(url) || parseYouTubeId(text) || parseYouTubeId(title);
  const name = (title || text.replace(/(?:https?:\/\/)?\S*(?:youtube\.com|youtu\.be)\/\S*/ig, '')).replace(/\s+/g, ' ').trim().slice(0, 200);
  return { id, title: name };
}
// 공유 칸만 지운 주소 뒷부분 (?tv=1 같은 다른 칸은 그대로)
function stripShareParams(search) {
  const p = new URLSearchParams(search || '');
  for (const k of ['title', 'text', 'url']) p.delete(k);
  const s = p.toString();
  return s ? '?' + s : '';
}
// 같은 영상이 이미 곡 목록에 있는가 (지운 곡 빼고)
const findYtSong = (songs, id) => (songs || []).find(s => !s.deleted && isYtSong(s) && s.ytId === id) || null;

/* 숨김 정리 (CR-229): 설정 창 "더 보기 (고급)"(이 기기 nb-advanced)와 음향 설정 접기(nb-deck).
   숨기는 것은 화면 칸뿐이라 다른 저장 값은 읽지도 쓰지도 않는다. 저장 값은 '1' = 켬/펼침, 그 밖(없음 포함) = 끔/접힘 */
const ADV_KEY = 'nb-advanced', DECK_KEY = 'nb-deck';
const advOn = v => v === '1';
// 음향 설정(F9)을 처음에 펼칠까: 고급이면 예전 규칙(PC는 펼침, 560px 이하는 접힘), 아니면 접힘이 기본이고 사람이 편 상태를 기억
const deckOpenAtStart = (adv, saved, narrow) => adv ? !narrow : saved === '1';
// 설정 창 "이 기기에 저장된 곡" 한 줄 요약 (누르면 자세히: 사용 중·남은 공간 막대·영구 저장)
function storeSummary(local, cloudOnly, freeTxt) {
  return `곡 ${local | 0}개` + (cloudOnly > 0 ? ` · Drive에만 ${cloudOnly | 0}개` : '') + (freeTxt ? ` · 남은 공간 약 ${freeTxt}` : '');
}

/* MR 만들기 (CR-089): 집 AI 서버의 "MR 만들기 창"을 새 탭으로 열고, 다 만든 MR을 창끼리(postMessage) 받는다.
   노래방은 서버에 직접 요청하지 않는다 (https 노래방 → http 서버는 막힘).
   서버 주소 (CR-231): 코드에는 주소가 없다 (공개 저장소). ① 이 기기 nb-mrserver ② 허브 열쇠 칸 mr_server(hub.js, 메모리) ③ 없음 '' */
const MR_DEFAULT_SERVER = '';
const MR_HUB_NAME = 'mr_server';        // 허브 0008 열쇠 칸 이름 (hub_secret / hub_secret_set, 앱 noraebang)
// 지금 쓸 주소 → { url, from: 'device'|'hub'|'' }. 모양이 틀린 값은 건너뛴다
function mrServerPick(local, hub) {
  for (const [v, from] of [[local, 'device'], [hub, 'hub']]) {
    if (!v) continue;
    const r = normalizeMrServer(v);
    if (r.ok) return { url: r.url, from };
  }
  return { url: '', from: '' };
}
// 허브 열쇠 칸에서 온 값 → 쓸 수 있는 주소 | null (글자 1~512자·제어 문자 없음·주소 모양)
function mrHubValueOk(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 512 || /[\u0000-\u001f\u007f]/.test(s)) return null;
  const r = normalizeMrServer(s);
  return r.ok ? r.url : null;
}
// 허브 값을 이 기기(nb-mrserver)에도 저장할까 → 저장할 주소 | null
// 이 기기에 쓸 수 있는 값이 이미 있으면 그대로 둔다 (이 기기 설정이 이김). 허브 값 모양이 틀리면 버린다
function mrHubFill(local, hub) {
  if (local && normalizeMrServer(local).ok) return null;
  return mrHubValueOk(hub);
}
// 설정 창 [저장] 결과 안내: hub = 허브에도 넣음 · device = 로그인 안 됨(이 기기만) · hubfail = 이 기기만 되고 허브는 실패 · saving = 허브에 넣는 중
const MR_SAVE_TEXT = {
  hub: '저장했어요 · 허브에도 넣어서 내 다른 기기도 이 주소를 써요',
  device: '이 기기에만 저장했어요 · 허브에 로그인한 뒤 다시 저장하면 내 다른 기기도 같이 써요',
  hubfail: '이 기기에는 저장했어요 · 허브에는 못 넣었어요 (다른 기기는 그대로예요). 인터넷을 확인하고 다시 [저장]을 눌러 주세요',
  saving: '저장했어요 · 허브에도 넣는 중…',
};
// [이 기기에서 지우기] 안내: 허브 값이 있으면 그것을 쓴다
const mrClearText = hasHub => hasHub ? '이 기기 주소를 지웠어요 · 허브에 있는 주소를 써요' : '이 기기 주소를 지웠어요 · 주소를 넣어야 MR 만들기를 쓸 수 있어요';
// 주소가 없을 때: 곡 목록 [MR 만들기] 안내·자동 맞추기 줄은 짧게 (옆 [주소 넣기]가 길을 대신함, CR-231 R6) · 단추가 없는 곳에 쓸 긴 글은 길을 › 로 (R4)
const MR_NOSERVER_SHORT = 'MR 만들기 서버 주소가 아직 없어요 · 한 번만 넣어 주세요';
const MR_NOSERVER_TEXT = 'MR 만들기 서버 주소가 아직 없어요 · 설정 › 더 보기 (고급) › MR 만들기 (집 AI 서버)에 한 번 넣어 주세요';
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
// 돌려주는 것: null(무시) | { type } | files면 { type:'files', files, lrc? } 또는 { type:'files', bad:true } (→ nack bad)
// 가사 정렬(CR-227 W7·W8)이 v:1에 더한 모양 (예전 창·예전 노래방은 모르는 칸·모르는 type을 그냥 지나친다):
//   files.lrc  [{name, lrc, score, level} | null]  files와 같은 수·같은 차례. 틀린 칸은 null (파일은 그대로 받음), 수가 다르면 lrc 통째로 뺌
//   lyrics_req {items:[{key, name, duration}]}      → { type, items } · 모양이 틀리면 null
//   aligned    {songId, lrc, score, level} | {songId, error}  → 그대로 · 모양이 틀리면 null
// isFile: 브라우저에서는 f => f instanceof File (Node 시험은 모양만 봄)
const MR_LRC_MAX = 64 * 1024, MR_LYR_MAX = 48 * 1024;
const MR_SONG_ID = /^[A-Za-z0-9_-]{1,64}$/, MR_KEY = /^[A-Za-z0-9_-]{1,40}$/, MR_ERR_CODE = /^[a-z_]{1,32}$/;
const MR_LEVELS = ['high', 'mid', 'low'];
// 집 AI가 맞춘 가사 한 곡 {lrc, score, level}: 글(64KB까지, 시각 붙은 LRC)·점수 0~1·높음/보통/낮음. 틀리면 null
function mrLrcOk(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  if (typeof x.lrc !== 'string' || !x.lrc || x.lrc.length > MR_LRC_MAX || !parseLyrics(x.lrc).synced) return null;
  if (typeof x.score !== 'number' || !(x.score >= 0 && x.score <= 1)) return null;
  if (!MR_LEVELS.includes(x.level)) return null;
  return { lrc: x.lrc, score: x.score, level: x.level };
}
function mrMessageOk(msg, from, want, isFile = f => !!f && typeof f.name === 'string' && typeof f.size === 'number') {
  if (!from || from.mine !== true || !want || from.origin !== want) return null;
  if (!msg || typeof msg !== 'object' || msg.app !== 'yena-mr' || msg.v !== 1 || typeof msg.type !== 'string') return null;
  if (msg.type === 'lyrics_req') {
    const items = Array.isArray(msg.items) ? msg.items : [];
    if (!items.length || items.length > MR_MAX_FILES) return null;
    const out = [];
    for (const it of items) {
      if (!it || typeof it !== 'object' || typeof it.key !== 'string' || !MR_KEY.test(it.key)) return null;
      if (typeof it.name !== 'string' || !it.name || it.name.length > 255) return null;
      const d = it.duration;
      if (d != null && !(typeof d === 'number' && d >= 0 && d <= 3600)) return null;
      out.push({ key: it.key, name: it.name, duration: d == null ? null : d });
    }
    return { type: 'lyrics_req', items: out };
  }
  if (msg.type === 'aligned') {
    if (typeof msg.songId !== 'string' || !MR_SONG_ID.test(msg.songId)) return null;
    if (msg.error != null) return typeof msg.error === 'string' && MR_ERR_CODE.test(msg.error) ? { type: 'aligned', songId: msg.songId, error: msg.error } : null;
    const r = mrLrcOk(msg);
    return r ? { type: 'aligned', songId: msg.songId, ...r } : null;
  }
  if (msg.type === 'hello') {
    // caps: 창이 알아듣는 새 메시지 (예전 창은 없음 → 원곡 파일 자동 싱크를 보내지 않음)
    const caps = Array.isArray(msg.caps) && msg.caps.length <= 10 ? msg.caps.filter(c => typeof c === 'string' && /^[a-z_]{1,20}$/.test(c)) : [];
    return caps.length ? { type: 'hello', caps } : { type: 'hello' };
  }
  if (msg.type !== 'files') return { type: msg.type };
  const files = Array.isArray(msg.files) ? msg.files : [];
  const ok = files.length > 0 && files.length <= MR_MAX_FILES && files.every(f => isFile(f) && f.size > 0 && f.size <= MR_MAX_BYTES && isMediaFile(f));
  if (!ok) return { type: 'files', bad: true };
  const out = { type: 'files', files };
  if (Array.isArray(msg.lrc) && msg.lrc.length === files.length) {
    // 이름이 그 차례 파일과 같아야 (다른 곡의 시각이 붙지 않게)
    const lrc = msg.lrc.map((x, i) => (x && x.name === files[i].name ? mrLrcOk(x) : null));
    if (lrc.some(Boolean)) out.lrc = lrc;
  }
  return out;
}
// 창의 lyrics_req에 노래방 곡으로 답할 것: 가사 글이 있는 곡이면 {synced, text}. 시각이 이미 있으면 글은 보내지 않음 (정렬 안 함)
function mrLyricsFor(s) {
  const t = s && typeof s.lyrics === 'string' ? s.lyrics : '';
  const p = parseLyrics(t);
  if (!p.lines.some(l => l.text)) return null;
  if (p.synced) return { synced: true, text: '' };
  return t.length <= MR_LYR_MAX ? { synced: false, text: t } : null;
}
// LRCLIB /api/get 답 → {synced, text}. 연주곡·없음이면 빈 글, 시각 가사가 있으면 synced (정렬하지 않음)
function mrLyricsFromLrclib(got) {
  if (!got || typeof got !== 'object' || got.instrumental) return { synced: false, text: '' };
  if (typeof got.syncedLyrics === 'string' && parseLyrics(got.syncedLyrics).synced) return { synced: true, text: '' };
  const t = typeof got.plainLyrics === 'string' ? got.plainLyrics : '';
  return { synced: false, text: t.trim() && t.length <= MR_LYR_MAX ? t : '' };
}
/* 원곡 파일로 자동 싱크 (CR-227 W8): 곡 가사를 집 AI에 보내 원곡 소리에 시각을 맞춘다 */
// 집 AI에 보낼 가사 글: 시각 없는 가사는 그대로(줄바꿈·[후렴] 같은 표시 포함), 시각이 있으면 시각을 뗀 줄 글만
function alignLyricsText(s) {
  const t = s && typeof s.lyrics === 'string' ? s.lyrics : '';
  const p = parseLyrics(t);
  if (!p.lines.some(l => l.text)) return '';
  const out = p.synced ? p.lines.map(l => l.text).filter(Boolean).join('\n') : t;
  return out.length <= MR_LYR_MAX ? out : '';
}
// 단추를 보일 곡: 데모곡 아님 · 가사 글 있음. 무대 단추(stage)는 시각이 없거나 "자동 싱크 · 확인해 주세요"인 곡만
const canAlignSong = (s, stage = false) => !!s && !s.demo && !!alignLyricsText(s) && (!stage || !parseLyrics(s.lyrics || '').synced || !!s.syncChk);
// 받은 결과를 넣기 전에 물을 것: low = 시각이 많이 틀릴 수 있음, overwrite = 이미 시각이 있는 가사 (기본은 넣지 않음)
const alignAsk = (s, level) => ({ low: level === 'low', overwrite: !!(s && parseLyrics(s.lyrics || '').synced) });
// 집 AI 오류 코드 → 노래방 안내 (yena-mr app/errors.py와 같은 뜻, 노래방 말로)
// 폰 412에서 오른쪽 단추와 한 줄에 들어가게 짧게 (디자인 W7 R3). 목소리 없음·소리 파일 아님은 옆에 [다른 파일로] (R1),
// 목소리 없음은 MR 창 제목과 같은 말 (R2), 주소 없음은 옆에 [주소 넣기] (CR-231 R6). 단추는 autosync.js alignInfo
const ALIGN_ERR_TEXT = {
  no_match: '가사와 노래 소리가 맞지 않아요',
  no_vocals: '목소리가 없는 파일이에요 (MR)',
  bad_lyrics: '가사 글을 읽지 못했어요',
  not_audio: '소리 파일이 아니거나 못 읽었어요',
  no_align: '집 AI가 아직 가사 시각 맞추기를 못 해요',
  unreachable: '집 AI에 닿지 않아요 · 집에 가면 다시 해요',
  canceled: 'MR 만들기 창에서 그만뒀어요',
  closed: 'MR 만들기 창이 닫혔어요 · 다시 누르면 이어서 해요',
  blocked: '새 창이 막혔어요 · 주소창에서 팝업을 허용해 주세요',
  changed: '맞추는 사이 가사가 바뀌어서 안 넣었어요',
  noserver: MR_NOSERVER_SHORT,     // CR-231: MR 만들기 서버 주소가 없음 (창을 열지 않음, 옆에 [주소 넣기])
};
const alignErrText = code => (Object.prototype.hasOwnProperty.call(ALIGN_ERR_TEXT, code) && ALIGN_ERR_TEXT[code]) || '가사 시각을 못 맞췄어요 · 잠시 뒤 다시 해 주세요';

/* ---------------- 허브: 곡 설정 맞추기 (CR-227) ----------------
   곡 설정(가사 LRC·전체 오프셋·곡 기본 키)을 회사 허브(묶음 noraebang · 모음 song_settings)에 곡 하나씩 통째로 둔다.
   곡 열쇠: MR 곡 'mr-' + 파일 SHA-256 앞 40자리 · 유튜브 곡 'yt-' + 영상 번호. 제목·가수는 힌트로만 같이 간다.
   두 기기가 같은 곡을 고치면 설정 고친 시각(settingsAt)이 늦은 쪽이 이긴다 (허브 hub_push도 같은 규칙). */
const HUB_URL_RE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const HUB_KEY_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const HUB_LRC_MAX = 48 * 1024;      // 가사 글 48KB까지 (넘으면 보내지 않고 "못 보낸 곡")
const HUB_PUSH_MAX = 200, HUB_PULL_MAX = 500;
const b64urlText = s => {
  const b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '==='.slice((b.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
};
const b64urlOf = text => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// 주소·키 짝이 쓸 만한가: 주소는 https://<20자>.supabase.co 하나, 키는 공개 키만 (sb_publishable_… 또는 role이 anon인 JWT).
// 비밀 키(sb_secret_…, service_role JWT)는 받지 않는다
function hubPairOk(u, k) {
  if (typeof u !== 'string' || !HUB_URL_RE.test(u)) return false;
  if (typeof k !== 'string' || !k || k.length > 2000 || !/^[A-Za-z0-9._-]+$/.test(k) || /^sb_secret_/i.test(k)) return false;
  const parts = k.split('.');
  if (parts.length === 3) { try { const p = JSON.parse(b64urlText(parts[1])); return !!p && p.role === 'anon'; } catch { return false; } }
  return parts.length === 1 && /^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(k);
}
// 연결 코드 읽기: hub.json 내용 {"url","anonKey"} 또는 nbhub1.<base64url(JSON {u,k})> (앞에 #hub= 가 붙어도 됨).
// 맞으면 { ok:true, u, k }, 아니면 { ok:false } (틀린 값은 돌려주지 않는다: 화면·기록에 찍히지 않게)
function hubCodeParse(text) {
  let t = String(text ?? '').trim();
  if (t.startsWith('#hub=')) t = t.slice(5);
  if (!t || t.length > 4000) return { ok: false };
  let o = null;
  try {
    if (/^nbhub1\./.test(t)) o = JSON.parse(b64urlText(t.slice(7)));
    else if (t[0] === '{') o = JSON.parse(t);
  } catch { return { ok: false }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false };
  const u = String(o.u ?? o.url ?? '').trim().replace(/\/+$/, ''), k = String(o.k ?? o.anonKey ?? '').trim();
  return hubPairOk(u, k) ? { ok: true, u, k } : { ok: false };
}
const hubCodeMake = (u, k) => 'nbhub1.' + b64urlOf(JSON.stringify({ u, k }));

// 곡 열쇠. MR 곡은 파일 해시(mrHash = 'mr-' + 40자리)를 한 번 계산해 곡 기록에 둔 것을 쓴다. 없으면 null (아직 못 맞춤)
const mrHashKey = hex => /^[0-9a-f]{40,}$/.test(String(hex)) ? 'mr-' + String(hex).slice(0, 40) : null;
function songSettingsKey(s) {
  if (!s || s.demo || s.deleted) return null;
  if (s.source === 'yt') return /^[A-Za-z0-9_-]{11}$/.test(String(s.ytId || '')) ? 'yt-' + s.ytId : null;
  return typeof s.mrHash === 'string' && /^mr-[0-9a-f]{40}$/.test(s.mrHash) ? s.mrHash : null;
}
const round1 = v => Math.round(v * 10) / 10;
// 곡의 설정 네 가지 (chk: 자동 싱크 결과라 "확인해 주세요"가 붙어 있음)
function settingsOf(s) {
  return { lrc: typeof s.lyrics === 'string' ? s.lyrics : '', offset: round1(clamp(+s.lyricOffset || 0, -30, 30)),
    key: clamp(Math.round(+s.baseKey || 0), -6, 6), chk: s.syncChk ? 1 : 0 };
}
const settingsSig = x => JSON.stringify([x.lrc || '', +x.offset || 0, x.key | 0, x.chk ? 1 : 0]);
const settingsHas = x => !!(x.lrc && x.lrc.trim()) || !!x.offset || !!x.key;
// 허브에서 온 data를 설정으로 (모양이 이상한 값은 기본값으로, v가 1이 아니면 null)
function settingsFromData(d) {
  if (!d || typeof d !== 'object' || d.v !== 1) return null;
  const n = (v, lo, hi, f) => Number.isFinite(+v) ? clamp(f(+v), lo, hi) : 0;
  return { lrc: typeof d.lrc === 'string' ? d.lrc : '', offset: n(d.offset, -30, 30, round1), key: n(d.key, -6, 6, Math.round), chk: d.chk ? 1 : 0 };
}
// 보낼 data: { v:1, src:'mr'|'yt', title, artist(각 100자), lrc, offset, key, chk? }. big = 가사가 48KB를 넘음 (보내지 않음)
function songSettingsData(s) {
  const x = settingsOf(s);
  const data = { v: 1, src: s.source === 'yt' ? 'yt' : 'mr', title: String(s.title || '').slice(0, 100), artist: String(s.artist || '').slice(0, 100), lrc: x.lrc, offset: x.offset, key: x.key };
  if (x.chk) data.chk = 1;
  return { data, sig: settingsSig(x), big: new TextEncoder().encode(x.lrc).length > HUB_LRC_MAX };
}
/* 곡 하나를 어떻게 할까 (나중 것이 이김).
   l = { k(열쇠), sig(지금 설정), has(설정 내용이 있음), syncK·syncSig(마지막으로 허브와 맞춘 열쇠·설정), settingsAt(이 기기에서 설정 고친 시각),
         updatedAt, createdAt, rej(거절된 설정 — 같은 내용은 다시 안 보냄) }
   r = 허브 사본 { sig, at(updated_at), del(지운 표시) } 또는 null
   → { act:'same' } 같음 · { act:'pull' } 허브 것을 넣음 · { act:'push', at } 보냄(updatedAt = at) · { act:'none' } 할 것 없음
   - 이 열쇠로 맞춘 적이 없고 이 기기에서 고친 적도 없으면(새 기기·처음 연결) 허브 것이 이긴다
   - 맞춘 뒤 Drive로 가사가 바뀐 곡(허브를 안 켠 기기에서 고침)은 곡 고친 시각으로 견준다 (허브의 옛 값이 덮지 않게)
   - 지운 표시는 "없음"으로 본다 (이 기기 곡은 그대로). 다시 보낼 때는 지운 시각보다 늦게 */
function hubPlan(l, r) {
  const live = !!r && !r.del;
  if (live && r.sig === l.sig) return { act: 'same' };
  const known = !!l.syncK && l.syncK === l.k;
  const changed = known ? l.sig !== l.syncSig : (!!l.has || !!l.settingsAt);
  if (!changed) return { act: live ? 'pull' : 'none' };
  // 고친 시각: 맞춘 뒤 바뀐 곡은 설정 고친 시각과 곡 고친 시각(Drive로 온 가사도 여기에 남음) 중 늦은 것, 처음 맞추는 곡은 설정 고친 시각만
  const lt = known ? Math.max(l.settingsAt || 0, l.updatedAt || 0) : (l.settingsAt || 0);
  if (live && r.at >= lt) return { act: 'pull' };
  if (l.rej && l.rej === l.sig) return { act: 'none' };
  let at = lt || l.updatedAt || l.createdAt || 1;
  if (r && at <= r.at) at = r.at + 1;
  return { act: 'push', at };
}
// 받은 줄(hub_pull)을 기기 사본에 넣는다. 사본 = { cursor(가장 큰 seq), songs: { 열쇠: { d, at, del } } }. 같은 열쇠는 늦은 것만
function hubMirrorAdd(mirror, rows) {
  const songs = { ...((mirror && mirror.songs) || {}) };
  let cursor = (mirror && +mirror.cursor) || 0, changed = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.id !== 'string' || !HUB_KEY_RE.test(r.id)) continue;
    if (+r.seq > cursor) cursor = +r.seq;
    const at = +r.updated_at || 0, cur = songs[r.id];
    if (cur && cur.at > at) continue;
    songs[r.id] = { d: r.data && typeof r.data === 'object' ? r.data : {}, at, del: r.deleted_at != null ? 1 : 0 };
    changed++;
  }
  return { cursor, songs, changed };
}
// 사본 한 줄 → hubPlan의 r (x = 설정)
function hubRemote(m) {
  if (!m) return null;
  const x = settingsFromData(m.d);
  return { sig: x ? settingsSig(x) : '', at: m.at || 0, del: m.del || !x ? 1 : 0, x };
}
// 보낼 줄 목록 nb-hub-out: [{ k, at, del? }] (열쇠마다 하나, 오프라인이면 쌓였다가 다음에)
function hubQueueAdd(q, k, at, del = false) {
  if (!HUB_KEY_RE.test(String(k))) return Array.isArray(q) ? q : [];
  const list = (Array.isArray(q) ? q : []).filter(x => x && x.k !== k);
  list.push(del ? { k, at, del: 1 } : { k, at });
  return list.slice(-2000);
}
const hubQueueDrop = (q, keys) => { const s = new Set(keys); return (Array.isArray(q) ? q : []).filter(x => x && !s.has(x.k)); };
// hub_push에 보낼 곡 한 줄 (updatedAt = 설정 고친 시각)
function hubRecord(s, at) {
  const { data } = songSettingsData(s);
  return { id: songSettingsKey(s), createdAt: Math.max(1, Math.min(s.createdAt || at, at)), updatedAt: at, deletedAt: null, data };
}

/* ---------------- 자동 싱크 (LRCLIB, CR-227 W6) ----------------
   LRCLIB에는 곡 제목·가수·길이만 보낸다. /api/get(정확히 한 곡)을 먼저, 없으면 /api/search(findLyrics + chooseLyrics) */
function lrclibGetParams(title, artist, dur) {
  const t = String(title || '').trim(), a = (artist ? artistNames(artist)[0] : '') || String(artist || '').trim();
  if (!t || !a) return null;
  const p = { track_name: t.slice(0, 200), artist_name: a.slice(0, 200) };
  if (dur >= 1 && dur <= 3600) p.duration = String(Math.round(dur));
  return p;
}
// get = /api/get 답(없으면 null), found = /api/search 결과(아직 안 찾았으면 null).
// → { lrc } 시각 가사를 찾음 · { why:'novoice' } 연주곡(목소리 없음) · { why:'none' } 못 찾음 (found가 null이면 search를 더 해 볼 것)
function autoSyncPick(get, found, { title, artist, mrDur } = {}) {
  if (get && get.instrumental) return { why: 'novoice' };
  if (get && get.syncedLyrics && parseLyrics(get.syncedLyrics).synced && (!mrDur || !get.duration || Math.abs(get.duration - mrDur) <= AUTO_SEC)) return { lrc: get.syncedLyrics, from: 'get' };
  if (Array.isArray(found)) { const c = chooseLyrics(found, { title, artist, mrDur }); if (c.auto && parseLyrics(c.auto.syncedLyrics).synced) return { lrc: c.auto.syncedLyrics, from: 'search' }; }
  return { why: 'none' };
}
// 무대 "자동 싱크" 단추를 보일 곡: 데모곡 아님 · 제목 있음 · 시각 붙은 가사가 아직 없음
const canAutoSync = s => !!s && !s.demo && !!String(s.title || '').trim() && !parseLyrics(s.lyrics || '').synced;

/* ---------------- 손님 방 (CR-228): 허브 Realtime 공개 broadcast 채널 하나 ----------------
   방장(노래방 화면, guesthost.js)이 열 때마다 새 방 이름으로 먼저 붙어 듣고, 손님 폰(guest.html)은 QR 주소의
   #r=<방 이름>&c=<연결 코드>로 같은 채널에 붙는다. 손님 → 방장 이벤트 'g', 방장 → 손님 이벤트 'h', 메시지는 모두 v:1.
   손님은 허브 표·RPC·로그인 0 (broadcast만). 방장이 확인·처리하고 결과만 돌려준다:
   검색 답은 번호·제목·가수·종류만 30개, 예약 목록은 제목만 10개. 누가 넣었는지(손님 표·이름)는 손님에게 보내지 않는다. */
const GUEST_V = 1;
const GUEST_MAX = 6, GUEST_PER_SEC = 4, GUEST_MAX_BYTES = 4096, GUEST_RESULTS = 30, GUEST_QUEUE_SHOW = 10, GUEST_NICK_MAX = 10, GUEST_MINE_MAX = 20;
const GUEST_TYPES = ['hello', 'search', 'reserve', 'unreserve', 'key', 'bye'];
const GUEST_ROOM_RE = /^nbr-[A-Za-z0-9_-]{43}$/;
const GUEST_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;
const GUEST_YT_RE = /^[A-Za-z0-9_-]{11}$/;
const b64urlBytes = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const guestRand = (n, rng) => { const b = new Uint8Array(n); (rng || crypto).getRandomValues(b); return b64urlBytes(b); };
// 방 이름: 열 때마다 새 32바이트(256비트) 난수 → 'nbr-' + base64url 43자. 이름을 모르면 그 방에 못 붙는다
const guestRoomName = rng => 'nbr-' + guestRand(32, rng);
// 손님 표(손님 폰이 만듦)·예약 표(방장이 만듦): 16바이트 난수 22자. 이름·기기 정보가 아님
const guestId = rng => guestRand(16, rng);
// QR 주소: <노래방 폴더>/guest.html#r=<방 이름>&c=<연결 코드>. 값은 # 뒤에만 (서버 기록·Referer에 안 남게), ? 없음
function guestUrl(base, room, code) {
  const b = String(base || '').replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  if (!/^https?:\/\/[^/?#]+\//.test(b) || !GUEST_ROOM_RE.test(String(room)) || !hubCodeParse(code).ok) return null;
  return b + 'guest.html#r=' + room + '&c=' + code;
}
// 손님 폰: 주소의 # 읽기. 맞으면 { ok:true, room, u, k }, 아니면 { ok:false } (틀린 값은 돌려주지 않는다)
function guestUrlParse(hash) {
  const h = String(hash ?? '').replace(/^#/, '');
  if (!h || h.length > 4000) return { ok: false };
  const p = new URLSearchParams(h), room = p.get('r') || '', c = hubCodeParse(p.get('c') || '');
  return GUEST_ROOM_RE.test(room) && c.ok ? { ok: true, room, u: c.u, k: c.k } : { ok: false };
}
const guestBytes = o => { try { return new TextEncoder().encode(JSON.stringify(o)).length; } catch { return Infinity; } };
const guestLen = s => [...String(s)].length;
const guestCut = (s, n) => { const a = [...String(s ?? '')]; return (a.length > n ? a.slice(0, n) : a).join(''); };
const guestNickOk = v => typeof v === 'string' && guestLen(v) <= GUEST_NICK_MAX && !/[\u0000-\u001f\u007f]/.test(v);
// 손님 메시지 모양 확인 (방장이 처리하기 전에). 모르는 종류·4KB 넘음·칸 모양이 틀리면 false → 방장은 그냥 버린다
function guestMsgOk(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  if (guestBytes(m) > GUEST_MAX_BYTES) return false;
  if (m.v !== GUEST_V || !GUEST_TYPES.includes(m.t) || typeof m.gid !== 'string' || !GUEST_ID_RE.test(m.gid)) return false;
  if (m.seq !== undefined && !(Number.isInteger(m.seq) && m.seq >= 0 && m.seq < 1e9)) return false;
  if (m.nick !== undefined && !guestNickOk(m.nick)) return false;
  switch (m.t) {
    case 'hello': case 'bye': return true;
    case 'search': return typeof m.q === 'string' && guestLen(m.q) <= 60 && (m.kind === undefined || m.kind === 'mr' || m.kind === 'yt');
    case 'reserve': return m.ytId === undefined ? Number.isInteger(m.no) && m.no > 0 && m.no < 1e6 : m.no === undefined && typeof m.ytId === 'string' && GUEST_YT_RE.test(m.ytId);
    case 'unreserve': return typeof m.rid === 'string' && GUEST_ID_RE.test(m.rid);
    case 'key': return Number.isInteger(m.k) && m.k >= -2 && m.k <= 2;
  }
  return false;
}
// 손님 한 사람(또는 방 전체) 1초에 perSec개까지. log는 최근 시각 배열 (고쳐 쓴다). 되면 true
function guestRateOk(log, now, perSec = GUEST_PER_SEC) {
  while (log.length && now - log[0] >= 1000) log.shift();
  if (log.length >= perSec) return false;
  log.push(now); return true;
}
const guestKind = s => s && (s.source === 'yt' || s.ytId) ? 'yt' : s && s.video ? 'video' : 'mr';
// 손님 검색 답: 번호·제목·가수·종류만, 30개까지 (♡·재생목록·녹음·점수·파일 정보 없음). total = 곡 창고 곡 수
function guestSearchResult(songs, q) {
  const all = (songs || []).filter(s => s && !s.deleted && Number.isInteger(s.no));
  const hit = searchIn(all, q);
  return { total: all.length, n: hit.length, items: hit.slice(0, GUEST_RESULTS).map(s => ({ no: s.no, title: guestCut(s.title, 80), artist: guestCut(s.artist, 60), kind: guestKind(s) })) };
}
// 예약 목록의 어느 줄이 손님 예약인지 짝짓기. res = [{ rid, gid, id, nick }] (먼저 넣은 것부터).
// 같은 곡이 여러 번 있으면 뒤에서부터 짝짓는다 (손님 예약은 보통 맨 뒤에 붙음). 짝이 없는 예약(이미 불렀거나 방장이 뺌)은 live에서 빠진다
function guestQueueMap(queue, res) {
  const at = queue.map(() => null), used = new Set();
  for (let i = queue.length - 1; i >= 0; i--) {
    for (let j = res.length - 1; j >= 0; j--) if (!used.has(j) && res[j].id === queue[i]) { at[i] = res[j]; used.add(j); break; }
  }
  return { at, live: res.filter((_, j) => used.has(j)) };
}
// 손님 모두에게 같이 가는 상태: 지금 곡(제목·가수·종류·진행·키)과 예약 목록 제목 10개.
// 손님 예약 줄에는 예약 표(r)만 붙는다 (10개 뒤의 손님 예약 표는 rest). 손님 폰은 자기가 받은 표만 "내 예약"으로 안다
function guestStateMsg({ now, playing, t, d, key, keyOk, queue, songOf, map, keyOn, yt }) {
  const row = (id, i) => { const s = songOf(id); const r = { title: guestCut(s?.title, 80), artist: guestCut(s?.artist, 60), kind: guestKind(s) }; if (map.at[i]) r.r = map.at[i].rid; return r; };
  return {
    v: GUEST_V, t: 'state',
    now: now ? { title: guestCut(now.title, 80), artist: guestCut(now.artist, 60), kind: guestKind(now), playing: !!playing, t: Math.max(0, Math.round(t || 0)), d: Math.max(0, Math.round(d || 0)), key: key | 0, keyOk: !!keyOk } : null,
    q: queue.slice(0, GUEST_QUEUE_SHOW).map(row), rest: map.at.slice(GUEST_QUEUE_SHOW).filter(Boolean).map(r => r.rid), n: queue.length, keyOn: !!keyOn, yt: !!yt,
  };
}
// 손님 QR 그림 크기 (CR-228 L2): 칸 하나가 정수 px가 되게 그림 한 변(칸 수 + 여백 8칸) px의 배수로. target 안에서 가장 크게,
// 그래도 min보다 작으면 min을 넘는 가장 작은 배수 (TV 카드 max(96px,16cqw), 시트 220px 칸)
function qrFitPx(target, px, min = 0) {
  if (!(px > 0) || !(target > 0)) return 0;
  let k = Math.max(1, Math.floor(target / px));
  if (k * px < min) k = Math.ceil(min / px);
  return k * px;
}

/* ---------------- 내 폰 리모컨 (CR-228 ③): 예나 계정만 아는 허브 Realtime 방 ----------------
   손님 방과 따로: 방 이름 'nbm-' + 256비트 난수 (손님 방은 'nbr-'), 폰 → PC 이벤트 'p', PC → 폰 이벤트 'm' (손님 방은 'g'·'h').
   방 이름은 QR·주소·화면·콘솔에 쓰지 않고 허브 열쇠 칸(0008 hub_secret, 이름 remote_room)으로만 건넨다 = 예나 계정으로 로그인한 기기만 읽음.
   명령은 옛 폰 리모컨(N13)과 같은 16가지. PC(js/myremote.js)가 확인한 뒤 remote.js remoteRun이 그대로 실행한다.
   상태는 remoteState() 그대로 (곡 목록은 바뀔 때만 조각으로, 나머지는 바뀔 때·10초마다). 폰 화면은 remote.html + js/myphone.js. */
const MY_V = 1;
const MY_HUB_NAME = 'remote_room';
const MY_ROOM_RE = /^nbm-[A-Za-z0-9_-]{43}$/;
const MY_MAX = 4, MY_PER_SEC = 8, MY_ROOM_PER_SEC = 20, MY_MAX_BYTES = 4096, MY_IDS_MAX = 100, MY_PART_BYTES = 32 * 1024, MY_LABEL_MAX = 200;
const MY_TYPES = ['hello', 'cmd', 'bye'];
const MY_CMDS = ['start', 'pause', 'cancel', 'jump', 'reserve', 'reserveMany', 'unreserve', 'top', 'now', 'mr', 'key', 'keyReset', 'profile', 'fav', 'tv', 'rec'];
const MY_SIG_RE = /^[a-z0-9]{1,16}$/;
// 방 이름: 켤 때마다 새 32바이트(256비트) 난수 → 'nbm-' + base64url 43자 (손님 방 이름과 모양이 달라 서로 못 섞인다)
const myRoomName = rng => 'nbm-' + guestRand(32, rng);
const myTextOk = (v, n) => typeof v === 'string' && v.length >= 1 && v.length <= n && !/[\u0000-\u001f\u007f]/.test(v);
const myNumOk = (v, max) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
// 명령 칸 모양 (실제로 있는 곡·사용자인지는 PC가 다시 본다)
function myArgsOk(cmd, a) {
  if (a !== undefined && (!a || typeof a !== 'object' || Array.isArray(a))) return false;
  const keys = a ? Object.keys(a) : [], only = (...ks) => keys.every(k => ks.includes(k));
  switch (cmd) {
    case 'start': case 'pause': case 'cancel': case 'jump': case 'keyReset': case 'tv': case 'rec': return !keys.length;
    case 'reserve': return !!a && myTextOk(a.id, 100) && (a.priority === undefined || typeof a.priority === 'boolean') && only('id', 'priority');
    case 'unreserve': case 'top': case 'now': case 'profile': case 'fav': return !!a && myTextOk(a.id, 100) && only('id');
    case 'reserveMany': return !!a && Array.isArray(a.ids) && a.ids.length >= 1 && a.ids.length <= MY_IDS_MAX && a.ids.every(x => myTextOk(x, 100))
      && (a.label === undefined || (typeof a.label === 'string' && a.label.length <= MY_LABEL_MAX)) && only('ids', 'label');
    case 'mr': return !!a && myNumOk(a.delta, 20) && only('delta');
    case 'key': return !!a && myNumOk(a.delta, 2) && only('delta');
  }
  return false;
}
// 폰 메시지 모양 확인 (PC가 처리하기 전에). 모르는 종류·모르는 명령·4KB 넘음·칸 모양이 틀리면 false → PC는 그냥 버린다
function myMsgOk(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  if (guestBytes(m) > MY_MAX_BYTES) return false;
  if (m.v !== MY_V || !MY_TYPES.includes(m.t) || typeof m.pid !== 'string' || !GUEST_ID_RE.test(m.pid)) return false;
  if (m.seq !== undefined && !(Number.isInteger(m.seq) && m.seq >= 0 && m.seq < 1e9)) return false;
  switch (m.t) {
    case 'hello': return m.have === undefined || (typeof m.have === 'string' && MY_SIG_RE.test(m.have));
    case 'bye': return true;
    case 'cmd': return Number.isInteger(m.seq) && MY_CMDS.includes(m.cmd) && myArgsOk(m.cmd, m.args);
  }
  return false;
}
// 폰이 받은 PC 메시지 확인: v:1 · 아는 종류 · 답(welcome·ok·no·full)은 내 폰 표(to)가 맞을 때만
const MY_IN_TYPES = ['welcome', 'songs', 'state', 'ok', 'no', 'full', 'closed'];
function myInOk(m, pid) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.v !== MY_V || !MY_IN_TYPES.includes(m.t)) return false;
  if (m.to !== undefined && m.to !== pid) return false;
  if (['welcome', 'ok', 'no', 'full'].includes(m.t) && m.to !== pid) return false;
  if (m.t === 'songs') return typeof m.sig === 'string' && MY_SIG_RE.test(m.sig) && Number.isInteger(m.n) && m.n >= 1 && m.n <= 500
    && Number.isInteger(m.i) && m.i >= 0 && m.i < m.n && Array.isArray(m.songs);
  if (m.t === 'state') return typeof m.sig === 'string' && MY_SIG_RE.test(m.sig) && !!m.st && typeof m.st === 'object' && !Array.isArray(m.st);
  return true;
}
// 곡 목록 표시 (같은 목록인지만 보면 된다): FNV-1a 32비트 → 36진수
function mySig(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return x.toString(36);
}
// 곡 목록을 조각으로 (한 조각 JSON이 maxBytes 안). 곡이 없어도 빈 조각 하나
function mySongParts(songs, maxBytes = MY_PART_BYTES) {
  const parts = [[]]; let size = 2;
  for (const s of songs || []) {
    const n = guestBytes(s) + 1;
    if (parts[parts.length - 1].length && size + n > maxBytes) { parts.push([]); size = 2; }
    parts[parts.length - 1].push(s); size += n;
  }
  return parts;
}
// "전체 예약" 곡이 많으면 4KB 안에 들게 나눠 보낸다 (조각마다 reserveMany 한 번)
function myChunkIds(ids, maxBytes = 3000) {
  const out = []; let cur = [], size = 2;
  for (const id of ids || []) {
    const n = guestBytes(id) + 1;
    if (cur.length && (size + n > maxBytes || cur.length >= MY_IDS_MAX)) { out.push(cur); cur = []; size = 2; }
    cur.push(id); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}
// 폰: 받은 곡·상태를 화면이 읽는 모양으로 다시 만든다 (모르는 칸은 버리고, 글은 글로·색은 #색만)
const myStr = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
const myColor = v => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : '';
function myCleanSongs(list) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || typeof s !== 'object' || !myTextOk(s.id, 100)) continue;
    out.push({ id: s.id, no: Number.isInteger(s.no) ? s.no : 0, title: myStr(s.title, 200), artist: myStr(s.artist, 200), video: !!s.video, local: !!s.local });
  }
  return out;
}
function myCleanState(st) {
  if (!st || typeof st !== 'object' || Array.isArray(st)) return null;
  const ids = v => Array.isArray(v) ? v.filter(x => myTextOk(x, 100)) : [];
  const n = st.now && typeof st.now === 'object' && !Array.isArray(st.now) ? st.now : null;
  const num = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return {
    now: n && myTextOk(n.id, 100) ? { id: n.id, no: Number.isInteger(n.no) ? n.no : 0, title: myStr(n.title, 200), artist: myStr(n.artist, 200), playing: !!n.playing, t: Math.max(0, num(n.t)), dur: Math.max(0, num(n.dur)), key: num(n.key) } : null,
    queue: ids(st.queue),
    profiles: (Array.isArray(st.profiles) ? st.profiles : []).filter(p => p && myTextOk(p.id, 100)).map(p => ({ id: p.id, name: myStr(p.name, 40) || '?', color: myColor(p.color) })),
    me: myTextOk(st.me, 100) ? st.me : '',
    favorites: ids(st.favorites),
    playlists: (Array.isArray(st.playlists) ? st.playlists : []).filter(p => p && myTextOk(p.id, 100)).map(p => ({ id: p.id, name: myStr(p.name, 80), songs: ids(p.songs) })),
    tv: !!st.tv, rec: !!st.rec, mrVol: typeof st.mrVol === 'number' && Number.isFinite(st.mrVol) ? st.mrVol : null,
  };
}
// remote.html: 어느 길로 이을까. /api/remote/info가 server.py 답이면(이 PC 200 · 휴대폰 403 'local only') 옛 길(코드) 그대로,
// 아니면(GitHub Pages·정적 서버 404, 못 닿음) 허브 길
function remoteModePick({ status, body } = {}) {
  const obj = !!body && typeof body === 'object' && !Array.isArray(body);
  if (status === 200 && obj) return 'server';
  if (status === 403 && obj && body.error === 'local only') return 'server';
  return 'hub';
}
// 옛 폰 리모컨 받아 오기 (server.py /api/remote/poll, CR-251 YT-r12): 검은 서버 창을 껐다 켜면 명령 번호가 0부터 다시 시작한다.
// prev = 화면이 가진 { since, boot }, res = 서버 답 { last, boot }. 서버 표(boot)가 바뀌었거나 번호가 줄었으면 restarted:
// 그 답의 명령은 실행하지 않고 since = 0으로 돌려 다음 번에 새 서버의 명령을 처음부터 받는다 (화면은 상태도 다시 올림)
function remotePollNext(prev, res) {
  const p = prev || {}, r = res || {}, since = Number.isInteger(p.since) && p.since >= 0 ? p.since : 0;
  const last = Number.isInteger(r.last) && r.last >= 0 ? r.last : since;
  const boot = typeof r.boot === 'string' && r.boot ? r.boot : (p.boot || null);
  const restarted = (!!p.boot && !!boot && boot !== p.boot) || last < since;
  return { since: restarted ? 0 : last, boot, restarted };
}
// TV 대기 화면 내 폰 리모컨 QR 주소 (CR-228 ④ L6): 노래방을 연 곳과 같은 곳의 remote.html.
// 방 이름·코드·계정은 넣지 않는다 (`?`·`#`·사용자 이름 없음). 방 이름은 폰이 허브 열쇠 칸에서 읽는다
function myRemoteUrl(href) {
  const u = new URL('remote.html', href);
  u.search = ''; u.hash = ''; u.username = ''; u.password = '';
  return u.href;
}

/* 녹음 나누기 (CR-031): 파일 이름 규칙 하나, 작은 파일(m4a) 틀, 기기에 따라 단추 고르기.
   m4a는 브라우저 AudioEncoder(WebCodecs)가 준 AAC 날 프레임을 MP4 틀에 넣은 것 (외부 코드·빌드 도구 없음) */
const REC_TITLE_MAX = 50;          // 파일 이름의 제목 부분 (날짜·확장자는 안 자름)
const SHARE_GESTURE_MS = 5000;     // 공유 창은 누른 뒤 이 시간 안에만 열린다 (브라우저 규칙). 넘으면 [보내기]로 한 번 더
const SMALL_BITRATE = 128000;      // AAC-LC 128kbps 스테레오 (4분 곡 약 3.7MB)
// 눈에 안 보이는 글자: 제어 글자(0~1F, 7F~9F), 소프트 하이픈, 폭 없는 공백·방향 표시(200B~200F, 2028~202E, 2060~206F), BOM(FEFF)
const INVISIBLE_CHARS = new RegExp('[' + [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
  .map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']', 'g');
// 녹음 파일 이름: 곡이름_YYYYMMDD-HHMM.확장자 (시각 = 녹음한 시각, 이 기기 시간). 한글 그대로.
// 풀어 쓴 한글(NFD) → 한 글자로(NFC), 눈에 안 보이는 제어 글자 빼기, \ / : * ? " < > | → _, 앞뒤 공백·점 빼기, 제목 50자, 빈 제목은 "녹음"
function recFileName(title, createdAt, ext) {
  let t = String(title ?? '').normalize('NFC')
    .replace(INVISIBLE_CHARS, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  const cps = [...t];
  if (cps.length > REC_TITLE_MAX) t = cps.slice(0, REC_TITLE_MAX).join('').replace(/[\s.]+$/, '');
  if (!t) t = '녹음';
  const d = new Date(createdAt), p = n => String(n).padStart(2, '0');
  return `${t}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}
// 파일 크기 글: 1MB 미만은 KB, 그 위는 MB 소수 한 자리 ("3.7MB")
const sizeLabel = b => b < 1e6 ? Math.max(1, Math.round(b / 1e3)) + 'KB' : (b / 1e6).toFixed(1) + 'MB';
// 나누기 단추 (기획안 "동작" 표). touch = 손가락 화면 (hover:none), share = 파일 공유 됨, small = 작은 파일을 만들 수 있음,
// legacy = 예전 방식(v1) 녹음 (이미 작은 파일이라 그대로 공유, PC에는 [다운로드]가 있어서 새 단추 없음)
// → { act:'share'|'save', file:'small'|'wav'|'orig' } 또는 null (단추 없음 = 지금과 같음)
function shareChoice({ touch, share, small, legacy = false }) {
  if (legacy) return touch && share ? { act: 'share', file: 'orig' } : null;
  if (touch && share) return { act: 'share', file: small ? 'small' : 'wav' };
  if (small) return { act: 'save', file: 'small' };
  return null;
}
// AAC-LC 설정 2바이트 (AudioSpecificConfig). 인코더가 설정을 안 줄 때 대신 쓴다. 표에 없는 샘플레이트는 null
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
function aacConfig(sampleRate, channels) {
  const i = AAC_RATES.indexOf(sampleRate);
  if (i < 0 || !(channels >= 1 && channels <= 7)) return null;
  return Uint8Array.from([(2 << 3) | (i >> 1), ((i & 1) << 7) | (channels << 3)]);
}
// AAC 프레임 → m4a 파일 조각들 [머리(ftyp + moov + mdat 머리), 프레임…] (브라우저는 new Blob(조각들)로 묶는다).
// moov가 mdat 앞이라 받자마자 재생된다. 프레임은 1초쯤씩 한 덩어리(chunk). 시간 단위 = 샘플레이트
function m4aParts({ frames, asc, sampleRate, channels, frameSamples = 1024 }) {
  const n = frames.length, total = n * frameSamples;
  let bytes = 0, maxSize = 0;
  for (const f of frames) { bytes += f.length; if (f.length > maxSize) maxSize = f.length; }
  const avg = total ? Math.round(bytes * 8 * sampleRate / total) : 0, peak = Math.round(maxSize * 8 * sampleRate / frameSamples);
  const per = Math.max(1, Math.round(sampleRate / frameSamples)), chunks = Math.ceil(n / per), last = n - (chunks - 1) * per;
  const u16 = v => [(v >>> 8) & 255, v & 255];
  const u32 = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const str = s => [...s].map(c => c.charCodeAt(0));
  const box = (type, ...parts) => { const body = parts.flat(Infinity); return [...u32(8 + body.length), ...str(type), ...body]; };
  const full = (type, flags, ...parts) => box(type, [0, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255], ...parts);
  const zeros = k => new Array(k).fill(0);
  const desc = (tag, body) => [tag, body.length, ...body];       // 길이 한 바이트 (127까지, 여기서는 늘 짧다)
  const matrix = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32);
  const esds = full('esds', 0, desc(3, [...u16(1), 0,
    ...desc(4, [0x40, 0x15, (maxSize >>> 16) & 255, (maxSize >>> 8) & 255, maxSize & 255, ...u32(peak), ...u32(avg), ...desc(5, [...asc])]),
    ...desc(6, [2])]));
  const mp4a = box('mp4a', zeros(6), u16(1), zeros(8), u16(channels), u16(16), u16(0), u16(0), u32((sampleRate > 65535 ? 0 : sampleRate) * 65536), esds);
  const stsc = !n ? [u32(0)] : (chunks === 1 || last === per) ? [u32(1), u32(1), u32(chunks === 1 ? n : per), u32(1)]
    : [u32(2), u32(1), u32(per), u32(1), u32(chunks), u32(last), u32(1)];
  const moov = offsets => box('moov',
    full('mvhd', 0, u32(0), u32(0), u32(sampleRate), u32(total), u32(0x00010000), u16(0x0100), zeros(10), matrix, zeros(24), u32(2)),
    box('trak',
      full('tkhd', 3, u32(0), u32(0), u32(1), u32(0), u32(total), zeros(8), u16(0), u16(0), u16(0x0100), u16(0), matrix, u32(0), u32(0)),
      box('mdia',
        full('mdhd', 0, u32(0), u32(0), u32(sampleRate), u32(total), u16(0x55c4), u16(0)),
        full('hdlr', 0, u32(0), str('soun'), zeros(12), str('SoundHandler'), [0]),
        box('minf',
          full('smhd', 0, u16(0), u16(0)),
          box('dinf', full('dref', 0, u32(1), full('url ', 1))),
          box('stbl',
            full('stsd', 0, u32(1), mp4a),
            full('stts', 0, n ? [u32(1), u32(n), u32(frameSamples)] : [u32(0)]),
            full('stsc', 0, stsc),
            full('stsz', 0, u32(0), u32(n), frames.map(f => u32(f.length))),
            full('stco', 0, u32(chunks), offsets.map(u32)))))));
  const ftyp = box('ftyp', str('M4A '), u32(0), str('M4A '), str('isom'), str('mp42'));
  const start = ftyp.length + moov(zeros(chunks)).length + 8;   // 첫 프레임 위치 (stco 길이는 값과 상관없음)
  const offsets = []; let at = start;
  for (let i = 0; i < n; i++) { if (i % per === 0) offsets.push(at); at += frames[i].length; }
  return [Uint8Array.from([...ftyp, ...moov(offsets), ...u32(8 + bytes), ...str('mdat')]), ...frames];
}
// 인코더가 ADTS 머리(7바이트, 검사 바이트가 있으면 9)를 붙여 줬으면 떼고 날 프레임만 (설정 바이트를 안 줬을 때만 쓴다)
function aacRawFrame(f) {
  if (f.length > 9 && f[0] === 0xff && (f[1] & 0xf6) === 0xf0) return f.subarray((f[1] & 1) ? 7 : 9);
  return f;
}

/* 작은 파일 형식은 기기에서 그때그때 고른다 (CR-031 데스크 결정 2026-11-24, 기획안 R3 대신):
   AAC 됨 → m4a · AAC 안 되고 Opus 됨 → Ogg Opus(.ogg) · 둘 다 안 됨 → WAV (안내 한 줄).
   share = 공유 창에 실을 파일 종류 후보 (앞에서부터 canShare가 통하는 것. 안드로이드 크롬 허용 목록의 m4a 이름은 audio/x-m4a) */
const SMALL_FORMATS = {
  m4a: { ext: 'm4a', mime: 'audio/mp4', share: ['audio/x-m4a', 'audio/mp4'] },
  ogg: { ext: 'ogg', mime: 'audio/ogg', share: ['audio/ogg'] },
  wav: { ext: 'wav', mime: 'audio/wav', share: ['audio/wav'] },
  webm: { ext: 'webm', mime: 'audio/webm', share: ['audio/webm'] },     // 예전 방식(v1) 녹음
};
const OPUS_FRAME_US = 20000;       // Opus 한 프레임 20ms (= 48kHz 960샘플)
function smallFormatPick({ aac, opus } = {}) { return aac ? 'm4a' : opus ? 'ogg' : 'wav'; }
// AudioEncoder 설정 (isConfigSupported와 configure가 같은 것을 쓴다). WAV는 인코더가 없다 → null
function smallEncoderConfig(fmt, sampleRate, numberOfChannels) {
  if (fmt === 'm4a') return { codec: 'mp4a.40.2', sampleRate, numberOfChannels, bitrate: SMALL_BITRATE, aac: { format: 'aac' } };
  if (fmt === 'ogg') return { codec: 'opus', sampleRate, numberOfChannels, bitrate: SMALL_BITRATE, opus: { format: 'opus', frameDuration: OPUS_FRAME_US } };
  return null;
}
// 예전 방식 녹음 파일의 확장자 (녹음할 때의 mime 그대로)
const recBlobExt = mime => (mime || '').includes('ogg') ? 'ogg' : (mime || '').includes('mp4') ? 'm4a' : 'webm';
// 만든 파일 기억 열쇠: 같은 녹음 · 같은 종류(small·wav·orig) · 같은 믹스 값일 때만 다시 쓴다 (믹스를 바꾸면 새로 만든다)
const MIX_KEYS = ['offset', 'vocal', 'mr', 'echo', 'reverb', 'mrStart'];
function shareKey(id, mix, file) { return `${id}|${file}|${MIX_KEYS.map(k => mix?.[k] ?? '').join(',')}`; }
// 다 만든 뒤 공유 창을 바로 열 수 있나: 누른 지 5초가 넘으면 브라우저가 막는다 → [보내기]로 한 번 더 (0.5초는 여유)
const SHARE_MARGIN_MS = 500;
const shareNeedsTap = elapsedMs => elapsedMs >= SHARE_GESTURE_MS - SHARE_MARGIN_MS;
// 단추 글: 평소 [공유]·[작은 파일 저장] / 만드는 중 "만드는 중 N초"(폰)·"저장 중 N초"(PC, 누른 단추 말) (경과 초만) / 다 만들고 기다림 [보내기]
// (CR-031 디자인 보기 K1: PC 줄에서 [삭제]가 2줄 안에 들어가게 짧은 이름 · K2: 세는 글도 짧게)
function shareBtnText({ act, busyMs = null, ready = false }) {
  if (busyMs != null) { const w = act === 'save' ? '저장 중' : '만드는 중'; return busyMs < 1000 ? `${w}…` : `${w} ${Math.floor(busyMs / 1000)}초`; }
  if (ready) return '보내기';
  return act === 'share' ? '공유' : '작은 파일 저장';
}

/* Ogg Opus 틀 (RFC 7845): 첫 쪽 OpusHead · 둘째 쪽 OpusTags · 그다음 소리 쪽들. 쪽마다 CRC.
   위치(granule)는 늘 48kHz 샘플 수이고 앞 건너뛰기(pre-skip)를 포함한다. 마지막 쪽은 실제 길이에 맞춰 끝을 자른다 */
const OGG_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = (r & 0x80000000) ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; }
  return t;
})();
function oggCrc(b) { let c = 0; for (let i = 0; i < b.length; i++) c = ((c << 8) ^ OGG_CRC[((c >>> 24) ^ b[i]) & 255]) >>> 0; return c; }
const oggLacing = n => { const l = []; for (; n >= 255; n -= 255) l.push(255); l.push(n); return l; };
// 한 쪽 (패킷은 쪽을 넘기지 않게 통째로만 담는다). type: 2 = 처음, 4 = 마지막
function oggPage(type, granule, serial, seq, packets) {
  const lace = packets.flatMap(p => oggLacing(p.length)), body = packets.reduce((a, p) => a + p.length, 0);
  const page = new Uint8Array(27 + lace.length + body), dv = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); page[5] = type;
  dv.setUint32(6, granule % 0x100000000, true); dv.setUint32(10, Math.floor(granule / 0x100000000), true);
  dv.setUint32(14, serial >>> 0, true); dv.setUint32(18, seq, true);
  page[26] = lace.length; page.set(lace, 27);
  let o = 27 + lace.length; for (const p of packets) { page.set(p, o); o += p.length; }
  dv.setUint32(22, oggCrc(page), true);
  return page;
}
function opusHead(channels, preSkip, sampleRate) {
  const h = new Uint8Array(19), dv = new DataView(h.buffer);
  h.set([...'OpusHead'].map(c => c.charCodeAt(0))); h[8] = 1; h[9] = channels;
  dv.setUint16(10, preSkip, true); dv.setUint32(12, sampleRate, true);
  return h;
}
function opusTags(vendor) {
  const v = new TextEncoder().encode(vendor), t = new Uint8Array(16 + v.length), dv = new DataView(t.buffer);
  t.set([...'OpusTags'].map(c => c.charCodeAt(0))); dv.setUint32(8, v.length, true); t.set(v, 12);
  return t;
}
// packets = 인코더가 준 Opus 패킷, head = 인코더가 준 설정(OpusHead 19바이트, 없으면 만듦), samples = 실제 소리 길이(입력 샘플레이트)
function oggOpusParts({ packets, head, channels, sampleRate, samples, serial = 0x4e425243, frameSamples48 = 960 }) {
  const okHead = head && head.length >= 19 && String.fromCharCode(...head.subarray(0, 8)) === 'OpusHead';
  const h = okHead ? Uint8Array.from(head) : opusHead(channels, 312, sampleRate);
  const preSkip = h[10] | (h[11] << 8), end = preSkip + Math.round(samples * 48000 / sampleRate);
  const pages = [oggPage(2, 0, serial, 0, [h]), oggPage(0, 0, serial, 1, [opusTags('YT noraebang')])];
  let cur = [], segs = 0, g = 0, prev = 0;
  const put = last => {
    const granule = last ? Math.max(prev, Math.min(g, end)) : g;
    pages.push(oggPage(last ? 4 : 0, granule, serial, pages.length, cur)); prev = granule; cur = []; segs = 0;
  };
  for (const p of packets) {
    const n = oggLacing(p.length).length;
    if (cur.length && (segs + n > 255 || cur.length >= 50)) put(false);    // 한 쪽에 1초(50개)쯤
    cur.push(p); segs += n; g += frameSamples48;
  }
  put(true);
  return pages;
}
