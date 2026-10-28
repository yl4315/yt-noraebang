// YT 노래방 핵심 로직 테스트: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore, plain } = require('./load-core');

const C = loadCore();
const same = (actual, expected) => assert.deepEqual(plain(actual), plain(expected));

test('시간 표시: 소수점이 올라가도 "00:60.00"이 되지 않는다', () => {
  assert.equal(C.fmtMs(0), '00:00.00');
  assert.equal(C.fmtMs(65.5), '01:05.50');
  assert.equal(C.fmtMs(59.999), '01:00.00');
  assert.equal(C.fmtMs(119.996), '02:00.00');
});

test('가사: LRC 시간 읽기, 한 줄에 시간 여러 개, 정보 줄 무시', () => {
  const p = C.parseLyrics('[ar:아이유]\n[00:05.00]첫 줄\n[00:10.50][00:30.00]후렴\n[00:20.25]둘째 줄\n[00:40.00]');
  assert.equal(p.synced, true);
  same(plain(p.lines), [
    { t: 5, text: '첫 줄' }, { t: 10.5, text: '후렴' }, { t: 20.25, text: '둘째 줄' }, { t: 30, text: '후렴' }, { t: 40, text: '' },
  ]);
});

test('가사: [분:초:백분초] 형식도 읽는다', () => {
  assert.equal(C.parseLyrics('[01:02:50]가사').lines[0].t, 62.5);
});

test('가사: 시간이 없으면 줄만 읽고 빈 줄은 뺀다', () => {
  const p = C.parseLyrics('첫 줄\n\n  둘째 줄  \r\n');
  assert.equal(p.synced, false);
  same(plain(p.lines), [{ t: null, text: '첫 줄' }, { t: null, text: '둘째 줄' }]);
});

test('가사: LRC로 썼다가 다시 읽으면 같은 시간', () => {
  const lines = [{ t: 3.456, text: '하나' }, { t: 61.2, text: '둘' }];
  const back = C.parseLyrics(C.toLRC(lines)).lines;
  same(plain(back), [{ t: 3.46, text: '하나' }, { t: 61.2, text: '둘' }]);
});

test('검색: 번호, 제목, 가수, 초성, 띄어쓰기 무시', () => {
  const songs = [
    { id: 'a', no: 10001, title: '작은 방의 노래', artist: 'YT 노래방' },
    { id: 'b', no: 10002, title: '밤편지', artist: '아이유' },
    { id: 'c', no: 10003, title: '너의 의미', artist: '산울림' },
    { id: 'd', no: 10004, title: '좋은 날', artist: '아이유' },
  ];
  const ids = q => C.searchIn(songs, q).map(s => s.id);
  same(ids('10003'), ['c']);
  same(ids('ㅂㅍㅈ'), ['b']);
  same(ids('아이유'), ['b', 'd']);
  same(ids('너의의미'), ['c']);
  same(ids('ㅈㅇ'), ['a', 'd']);       // 작은 → ㅈㅇ, 좋은 → ㅈㅇ
  assert.equal(ids('').length, 4);
  same(ids('없는곡'), []);
});

/* ---------------- 동기화 합치기 ---------------- */
const song = (id, extra = {}) => ({ id, no: 10002, title: id, updatedAt: 100, createdAt: 1, fileId: 'f-' + id, blob: { bytes: 1 }, ...extra });

test('동기화: Drive에만 있는 곡은 "기기에 없음" 상태로 들어온다', () => {
  const r = C.mergeRemoteInto([], [], [{ id: 'x', no: 10002, title: '새 곡', updatedAt: 5, fileId: 'fx' }], C.SONG_FIELDS, { mediaKey: 'blob' });
  assert.equal(r.live.length, 1);
  assert.equal(r.live[0].blob, null);
  assert.equal(r.live[0].fileId, 'fx');
  assert.ok(r.touched.has('x'));
});

test('동기화: 기기 쪽이 더 최신이면 Drive 내용을 무시한다', () => {
  const l = song('a', { title: '기기에서 고침', updatedAt: 200 });
  const r = C.mergeRemoteInto([l], [], [{ ...song('a'), title: 'Drive 예전 제목', updatedAt: 150 }], C.SONG_FIELDS, { mediaKey: 'blob' });
  assert.equal(r.live[0].title, '기기에서 고침');
  assert.equal(r.touched.size, 0);
});

test('동기화: Drive 쪽이 더 최신이면 같은 객체를 고친다 (화면이 들고 있는 객체 유지)', () => {
  const l = song('a');
  const r = C.mergeRemoteInto([l], [], [{ id: 'a', no: 10002, title: '새 제목', lyrics: '[00:01.00]가사', updatedAt: 300, fileId: 'f-a' }], C.SONG_FIELDS, { mediaKey: 'blob' });
  assert.equal(r.live[0], l);
  assert.equal(l.title, '새 제목');
  same(l.blob, { bytes: 1 });          // 파일이 같으면 기기 파일은 그대로
  assert.equal(r.mediaChanged.size, 0);
});

test('동기화: Drive에 새 MR이 올라오면 기기 파일을 비운다', () => {
  const l = song('a');
  const r = C.mergeRemoteInto([l], [], [{ id: 'a', no: 10002, title: 'a', updatedAt: 300, fileId: 'f-new' }], C.SONG_FIELDS, { mediaKey: 'blob' });
  assert.equal(l.blob, null);
  assert.equal(l.fileId, 'f-new');
  assert.ok(r.mediaChanged.has('a'));
});

test('동기화: 이 기기에서 바꾼 MR을 아직 못 올렸으면 기기 파일과 파일 id를 지킨다', () => {
  const l = song('a', { mediaDirty: true, fileId: 'f-old' });
  const r = C.mergeRemoteInto([l], [], [{ id: 'a', no: 10002, title: '제목만 바뀜', updatedAt: 300, fileId: 'f-other' }], C.SONG_FIELDS, { mediaKey: 'blob' });
  same(l.blob, { bytes: 1 });
  assert.equal(l.fileId, 'f-old');
  assert.equal(l.title, '제목만 바뀜');
  assert.equal(r.mediaChanged.size, 0);
});

test('동기화: 다른 기기에서 지운 곡은 이 기기에서도 지움 기록으로 바뀐다', () => {
  const l = song('a');
  const r = C.mergeRemoteInto([l], [], [{ id: 'a', deleted: true, updatedAt: 300, fileId: 'f-a' }], C.SONG_FIELDS, { mediaKey: 'blob' });
  assert.equal(r.live.length, 0);
  assert.equal(r.tombs.length, 1);
  assert.equal(r.tombs[0].deleted, true);
  assert.equal(r.tombs[0].trashed, true);         // Drive 파일은 이미 지운 기기가 처리
});

test('동기화: 이 기기에서 지운 게 더 최신이면 Drive의 예전 곡으로 되살아나지 않는다', () => {
  const tomb = { id: 'a', deleted: true, updatedAt: 500 };
  const r = C.mergeRemoteInto([], [tomb], [song('a', { updatedAt: 300 })], C.SONG_FIELDS, { mediaKey: 'blob' });
  assert.equal(r.live.length, 0);
  assert.equal(r.tombs.length, 1);
});

test('동기화: 지운 뒤 다른 기기에서 다시 고쳤으면 되살린다', () => {
  const tomb = { id: 'a', deleted: true, updatedAt: 100 };
  const r = C.mergeRemoteInto([], [tomb], [{ id: 'a', no: 10002, title: '되살림', updatedAt: 900, fileId: 'f-a' }], C.SONG_FIELDS, { mediaKey: 'blob' });
  assert.equal(r.live.length, 1);
  assert.equal(r.tombs.length, 0);
  assert.equal(r.live[0].deleted, undefined);
});

test('동기화: 녹음은 수정 시각이 없으면 만든 시각으로 비교한다', () => {
  const local = { id: 'r', createdAt: 1000, mix: { offset: 50 } };
  const older = C.mergeRemoteInto([local], [], [{ id: 'r', createdAt: 1000, updatedAt: 900, mix: { offset: 0 } }], C.REC_FIELDS, { createdAtFallback: true });
  assert.equal(local.mix.offset, 50);
  assert.equal(older.touched.size, 0);
  C.mergeRemoteInto([local], [], [{ id: 'r', createdAt: 1000, updatedAt: 2000, mix: { offset: 120 } }], C.REC_FIELDS, { createdAtFallback: true });
  assert.equal(local.mix.offset, 120);
});

test('사용자: 더 나중에 바뀐 쪽, 그리고 자동으로 만든 빈 "나"는 버린다', () => {
  const autoMe = { id: 'auto', name: '나', favorites: [], playlists: [], updatedAt: 10, auto: true };
  const mom = { id: 'mom', name: '엄마', favorites: ['x'], playlists: [], updatedAt: 50 };
  const remote = [{ id: 'mom', name: '엄마(새 이름)', favorites: ['x', 'y'], playlists: [], updatedAt: 80 }, { id: 'me', name: '나', favorites: [], playlists: [], updatedAt: 20 }];
  const list = C.mergeProfileLists([autoMe, mom], remote);
  same(list.map(p => p.id).sort(), ['me', 'mom']);
  assert.equal(list.find(p => p.id === 'mom').name, '엄마(새 이름)');
});

test('사용자: 자동으로 만든 "나"라도 좋아요가 있으면 지킨다', () => {
  const autoMe = { id: 'auto', name: '나', favorites: ['s1'], playlists: [], updatedAt: 10, auto: true };
  const list = C.mergeProfileLists([autoMe], [{ id: 'mom', name: '엄마', favorites: [], playlists: [], updatedAt: 5 }]);
  assert.equal(list.length, 2);
});

test('곡 번호: 두 기기에서 같은 번호를 쓰면 나중에 만든 곡 번호를 바꾼다', () => {
  const songs = [
    { id: 'demo', no: 10001, createdAt: 0 },
    { id: 'a', no: 10002, createdAt: 100 },
    { id: 'b', no: 10002, createdAt: 200 },
    { id: 'c', no: 10003, createdAt: 50 },
  ];
  const changed = C.renumberDuplicates(songs, 999);
  same([...changed], ['b']);
  assert.equal(songs.find(s => s.id === 'b').no, 10004);
  assert.equal(songs.find(s => s.id === 'b').updatedAt, 999);
  assert.equal(new Set(songs.map(s => s.no)).size, songs.length);
});

test('library.json: 파일을 못 올린 곡은 빼고, 지움 기록과 사용자를 담는다', () => {
  const lib = C.buildLibrary({
    songs: [{ id: 'demo', demo: true, no: 10001 }, { id: 'a', no: 10002, title: 'A', fileId: 'fa', blob: {}, buffer: {} }, { id: 'b', no: 10003, title: 'B', blob: {} }],
    tombs: [{ id: 'z', deleted: true, updatedAt: 5 }],
    profiles: [{ id: 'p', name: '나', favorites: [], playlists: [], auto: true }],
    recs: [{ id: 'r1', fileId: 'fr', vocal: {} }, { id: 'r2' }],
    recTombs: [],
  }, 1234);
  same(lib.songs.map(s => s.id), ['a', 'z']);
  assert.equal(lib.songs[0].blob, undefined);       // 파일 자체는 올리지 않는다
  assert.equal(lib.songs[0].buffer, undefined);
  assert.equal(lib.profiles[0].auto, undefined);
  same(lib.recs.map(r => r.id), ['r1']);
  assert.equal(lib.updatedAt, 1234);
});

test('library.json: 순서만 다르면 같은 내용으로 본다 (Drive에 다시 쓰지 않음)', () => {
  const a = { songs: [{ id: '1' }, { id: '2' }], profiles: [{ id: 'p' }], recs: [] };
  const b = { songs: [{ id: '2' }, { id: '1' }], profiles: [{ id: 'p' }] };
  assert.equal(C.librarySig(a), C.librarySig(b));
  assert.notEqual(C.librarySig(a), C.librarySig({ ...b, songs: [{ id: '1' }] }));
});

/* ---------------- 백업 파일 ---------------- */
test('백업 파일: 만들었다가 다시 읽으면 머리말과 파일 내용이 그대로', async () => {
  const mr = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'audio/wav' });
  const vocal = new Blob(['목소리 데이터'], { type: 'application/octet-stream' });
  const file = C.packBackup({ version: 1, songs: [{ id: 'a', title: '한글 제목', blob: 0 }], recs: [{ id: 'r', media: 1 }] }, [mr, vocal]);
  const { head, blobAt } = await C.unpackBackup(file);
  assert.equal(head.songs[0].title, '한글 제목');
  assert.equal(blobAt.length, 2);
  same([...new Uint8Array(await blobAt[0].arrayBuffer())], [1, 2, 3, 4, 5]);
  assert.equal(blobAt[0].type, 'audio/wav');
  assert.equal(await blobAt[1].text(), '목소리 데이터');
});

test('백업 파일: 다른 파일이면 알아보기 쉬운 오류를 낸다', async () => {
  await assert.rejects(C.unpackBackup(new Blob(['그냥 텍스트 파일'])), /백업 파일이 아니에요/);
});

test('백업 파일: 끝이 잘린 파일은 잘렸다고 알려 준다', async () => {
  const file = C.packBackup({ songs: [] }, [new Blob([new Uint8Array(100)])]);
  await assert.rejects(C.unpackBackup(file.slice(0, file.size - 10)), /잘렸어요/);
});

/* ---------------- Drive 폴더에 직접 넣은 MR ---------------- */
test('파일 이름에서 제목·가수 뽑기 (TJ 노래방 MR 이름)', () => {
  const cases = [
    ['[TJ노래방] 200% - AKMU(악뮤) _ TJ Karaoke.mp3', '200%', 'AKMU(악뮤)'],
    ['[TJ노래방] 사랑의이름으로! - 잔나비(Feat.카리나 of aespa) _ TJ Karaoke - (320 Kbps).mp3', '사랑의이름으로!', '잔나비(Feat.카리나 of aespa)'],
    ['[TJ노래방] 산책 - 백예린 _ TJ Karaoke - (320 Kbps).mp3', '산책', '백예린'],
    ['[TJ노래방] romeo n juliet - 죠지(Feat.유라(youra)) _ TJ Karaoke - (320 Kbps).mp3', 'romeo n juliet', '죠지(Feat.유라(youra))'],
    ['[TJ노래방] LOVE ATTACK - RESCENE(리센느) _ TJ Karaoke.mp3', 'LOVE ATTACK', 'RESCENE(리센느)'],
    ['밤편지 - 아이유 MR.mp3', '밤편지', '아이유'],
    ['그냥 제목만.m4a', '그냥 제목만', ''],
  ];
  for (const [name, title, artist] of cases) same(C.titleFromFilename(name), { title, artist });
});

test('폴더 파일 중 아직 곡이 아닌 것만 새 곡으로 만든다', () => {
  const files = [
    { id: 'f1', name: '[TJ노래방] 청혼 - 이소라 _ TJ Karaoke.mp3', mimeType: 'audio/mpeg', size: '5000' },
    { id: 'f2', name: '이미 있는 곡.mp3', mimeType: 'audio/mpeg' },
    { id: 'f3', name: '노래방 영상 - 가수.mp4', mimeType: 'video/mp4' },
  ];
  const added = C.songsFromFolderFiles(files, new Set(['f2']), 10005, 777);
  same(added.map(s => [s.id, s.no, s.title, s.artist, s.video, s.fileId]), [
    ['drive-f1', 10005, '청혼', '이소라', false, 'f1'],
    ['drive-f3', 10006, '노래방 영상', '가수', true, 'f3'],
  ]);
  assert.equal(added[0].blob, null);          // 파일은 부를 때 받는다
  assert.equal(added[0].size, 5000);
  assert.equal(added[0].updatedAt, 777);
});

test('같은 파일을 두 기기가 들여와도 곡 id가 같아서 하나로 합쳐진다', () => {
  const f = [{ id: 'same', name: 'A - B.mp3', mimeType: 'audio/mpeg' }];
  const a = C.songsFromFolderFiles(f, new Set(), 10002, 1)[0];
  const b = C.songsFromFolderFiles(f, new Set(), 10009, 2)[0];
  assert.equal(a.id, b.id);
  const r = C.mergeRemoteInto([a], [], [b], C.SONG_FIELDS, { mediaKey: 'blob' });
  assert.equal(r.live.length, 1);
});

/* ---------------- TV로 켜기 (CR-009) ---------------- */
test('주소의 tv 값: ?tv=1·?tv는 TV 화면으로, 0·false·no·off나 없으면 그대로', () => {
  for (const s of ['?tv=1', '?tv', '?tv=', '?tv=yes', '?a=b&tv=1', 'tv=1']) assert.equal(C.tvParam(s), true, s);
  for (const s of ['', '?', '?tv=0', '?tv=false', '?tv=OFF', '?tv=no', '?pin=1234', '?tvx=1', undefined]) assert.equal(C.tvParam(s), false, String(s));
});

test('창이 화면을 다 덮었는지: 크롬 전체 화면이면 안내를 띄우지 않는다', () => {
  const scr = { width: 1920, height: 1080 };
  const win = (iw, ih, ow, oh) => ({ innerWidth: iw, innerHeight: ih, outerWidth: ow, outerHeight: oh });
  assert.equal(C.fillsScreen(win(1920, 1080, 1920, 1080), scr), true);                 // --start-fullscreen · F11
  assert.equal(C.fillsScreen(win(1536, 864, 1920, 1080), scr), true);                  // 같은데 페이지 125% 확대
  assert.equal(C.fillsScreen(win(1745, 982, 1920, 1080), scr), true);                  // 110% 확대 (반올림)
  assert.equal(C.fillsScreen(win(1920, 1009, 1936, 1056), scr), false);                // 최대화한 앱 창 (작업 표시줄 있음)
  assert.equal(C.fillsScreen(win(1920, 1049, 1920, 1080), scr), false);                // 작업 표시줄 숨김 + 최대화 (제목 줄 있음)
  assert.equal(C.fillsScreen(win(1280, 689, 1296, 728), scr), false);                  // 보통 창
  assert.equal(C.fillsScreen(win(2560, 1440, 2560, 1440), { width: 2560, height: 1440 }), true);   // 4K TV를 150%로 쓰는 PC
  assert.equal(C.fillsScreen(win(0, 0, 0, 0), scr), false);                            // 크기를 아직 모를 때
  assert.equal(C.fillsScreen({}, scr), false);
});

/* ---------------- 지연 자동 측정 (CR-003) ---------------- */
// 가짜 녹음: 딸깍 시각 + 지연 자리에 짧은 소리(0.03초)를 넣고, 바닥에는 작은 잡음을 깐다
function fakeTake({ delay, sr = 8000, f0 = 12345, gap = C.MEASURE.gap, noise = 0.005, missing = [] }) {
  const M = C.MEASURE, t0 = f0 / sr + M.lead, clicks = [];
  for (let i = 0; i < M.clicks; i++) clicks.push(t0 + i * gap);
  const len = Math.ceil((M.lead + M.clicks * gap + 1.5) * sr), pcm = new Float32Array(len);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < len; i++) pcm[i] = (rnd() * 2 - 1) * noise;
  const put = t => { const s = Math.round(t * sr) - f0, w = 0.03 * sr; for (let i = 0; i < w; i++) if (s + i >= 0 && s + i < len) pcm[s + i] = 0.5 * Math.sin(i / 3) * (1 - i / w); };
  clicks.forEach((t, i) => { if (!missing.includes(i)) put(t + (Array.isArray(delay) ? delay[i] : delay)); });
  return { pcm, sr, f0, clicks };
}
const near = (a, b, tol = 0.002) => Math.abs(a - b) <= tol;

test('자동 측정: 지연 0.1·0.5·0.8초를 딸깍마다 맞게 찾는다', () => {
  for (const d of [0.1, 0.5, 0.8]) {
    const { pcm, sr, f0, clicks } = fakeTake({ delay: d });
    const lat = C.findClickDelays(pcm, sr, f0, clicks);
    assert.equal(lat.length, 6, `지연 ${d}`);
    for (const x of lat) assert.ok(near(x, d), `지연 ${d}인데 ${x}`);
  }
});

test('자동 측정: 지연이 길어도 앞 딸깍 소리를 잡지 않는다 (예전 0.45초 간격은 잡았다)', () => {
  // 예전 방식(0.45초 간격, 0.42초 창)에 지연 0.5초면 앞 딸깍이 다음 창 0.05초 지점에 들어와 아주 작은 값이 나왔다
  const old = fakeTake({ delay: 0.5, gap: 0.45 });
  const bad = C.findClickDelays(old.pcm, old.sr, old.f0, old.clicks, 0.42);
  assert.ok(bad.some(x => x < 0.1), '예전 방식 재현');
  // 지금 방식(1초 간격, 0.9초 창): 0.85초까지는 제 딸깍만 잡는다
  for (const d of [0.5, 0.7, 0.85]) {
    const { pcm, sr, f0, clicks } = fakeTake({ delay: d });
    const lat = C.findClickDelays(pcm, sr, f0, clicks);
    assert.ok(lat.length >= 5 && lat.every(x => near(x, d)), `지연 ${d}: ${lat}`);
  }
});

test('자동 측정: 소리가 없거나 3번 미만이면 "못 들었어요"', () => {
  const quiet = fakeTake({ delay: 0.2, missing: [0, 1, 2, 3, 4, 5] });
  const lat0 = C.findClickDelays(quiet.pcm, quiet.sr, quiet.f0, quiet.clicks);
  assert.equal(lat0.length, 0);
  assert.equal(C.summarizeDelays(lat0).ok, false);
  const two = fakeTake({ delay: 0.2, missing: [0, 2, 3, 5] });
  const lat2 = C.findClickDelays(two.pcm, two.sr, two.f0, two.clicks);
  assert.equal(lat2.length, 2);
  same(C.summarizeDelays(lat2), { ok: false, heard: 2 });
  assert.equal(C.summarizeDelays(null).ok, false);
  assert.deepEqual(plain(C.findClickDelays(new Float32Array(0), 8000, 0, [1, 2])), []);
});

test('자동 측정: 가운데 값을 쓰고, 600ms를 넘으면 600으로 두고 표시한다', () => {
  same(C.summarizeDelays([0.21, 0.2, 0.19, 0.2, 0.205]), { ok: true, heard: 5, raw: 200, ms: 200, tooLong: false, uneven: false });
  const long = C.summarizeDelays([0.8, 0.8, 0.81, 0.79, 0.8, 0.8]);
  assert.equal(long.ok, true); assert.equal(long.tooLong, true); assert.equal(long.ms, 600); assert.equal(long.raw, 800);
  const edge = C.summarizeDelays([0.6, 0.6, 0.6]);
  assert.equal(edge.tooLong, false); assert.equal(edge.ms, 600);
});

test('자동 측정: 값끼리 차이가 크면 "고르지 않음", 튀는 값 하나는 봐준다', () => {
  assert.equal(C.summarizeDelays([0.1, 0.25, 0.1, 0.3, 0.12, 0.2]).uneven, true);
  assert.equal(C.summarizeDelays([0.2, 0.205, 0.21, 0.2, 0.198, 0.202]).uneven, false);
  const one = C.summarizeDelays([0.2, 0.2, 0.2, 0.2, 0.2, 0.45]);
  assert.equal(one.uneven, false); assert.equal(one.ms, 200);
  assert.equal(C.summarizeDelays([0.1, 0.2, 0.3]).uneven, true);       // 3~4번만 들었으면 빼지 않고 본다
  // 실제 소리에서도: 딸깍마다 지연이 들쭉날쭉하면 표시된다
  const { pcm, sr, f0, clicks } = fakeTake({ delay: [0.1, 0.3, 0.15, 0.4, 0.2, 0.35] });
  assert.equal(C.summarizeDelays(C.findClickDelays(pcm, sr, f0, clicks)).uneven, true);
});

/* ---------------- TV 화면 숫자판: 방향키로 버튼 고르기 (CR-003) ---------------- */
test('방향키로 숫자판 버튼 고르기: 1~9, 아래 줄, 넓은 버튼, 끝에서는 그대로', () => {
  // 휴대폰 리모컨과 같은 모양: 1 2 3 / 4 5 6 / 7 8 9 / ⌫ 0 처음부터 / 우선예약 [예약 두 칸]
  const at = (col, row) => ({ x: col * 10, y: row * 10 });
  const items = [at(0, 0), at(1, 0), at(2, 0), at(0, 1), at(1, 1), at(2, 1), at(0, 2), at(1, 2), at(2, 2),
    at(0, 3), at(1, 3), at(2, 3), at(0, 4), at(1.5, 4)];
  const L = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'clr', 'pri', 'res'];
  const go = (from, dir) => L[C.pickByArrow(items, L.indexOf(from), dir)];
  assert.equal(go('5', 'ArrowRight'), '6');
  assert.equal(go('5', 'ArrowLeft'), '4');
  assert.equal(go('5', 'ArrowUp'), '2');
  assert.equal(go('5', 'ArrowDown'), '8');
  assert.equal(go('8', 'ArrowDown'), '0');
  assert.equal(go('0', 'ArrowDown'), 'res');      // 예약(두 칸)이 0 바로 아래에 더 가깝다
  assert.equal(go('del', 'ArrowDown'), 'pri');
  assert.equal(go('res', 'ArrowUp'), '0');
  assert.equal(go('pri', 'ArrowRight'), 'res');
  assert.equal(go('3', 'ArrowRight'), '3');       // 끝이면 그대로
  assert.equal(go('1', 'ArrowUp'), '1');
  assert.equal(C.pickByArrow(items, -1, 'ArrowDown'), 0);   // 아직 고른 게 없으면 첫 버튼
  assert.equal(C.pickByArrow([], -1, 'ArrowDown'), -1);
});
