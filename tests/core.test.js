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

/* ---------------- 곡 넣기 자동화 (CR-017) ---------------- */
test('파일 이름 해석 보강: 빈 괄호, Inst., 밑줄, 노래방 번호, 트랙 번호', () => {
  const cases = [
    ['[TJ노래방] 200% - AKMU(악뮤) _ TJ Karaoke.mp3', '200%', 'AKMU(악뮤)'],
    ['밤편지 - 아이유 (MR).mp3', '밤편지', '아이유'],
    ['밤편지 - 아이유 [MR].mp3', '밤편지', '아이유'],
    ['밤편지(Inst.).m4a', '밤편지', ''],
    ['좋은 날_아이유_MR.mp3', '좋은 날', '아이유'],
    ['[KY 금영노래방] 밤편지 - 아이유 (KY.12345) _ KY Karaoke.mp4', '밤편지', '아이유'],
    ['01 밤편지.mp3', '밤편지', ''],
    ['아이유 - 밤편지 MR.mp3', '아이유', '밤편지'],            // 뒤집힘은 가사를 찾을 때 맞춘다
  ];
  for (const [name, title, artist] of cases) same(C.titleFromFilename(name), { title, artist });
});

test('파일 이름 해석: 제목 속 숫자·Mr·Instant는 지키고, 밑줄이 여러 개면 띄어쓰기로', () => {
  const cases = [
    ['10 Minutes - 이효리.mp3', '10 Minutes', '이효리'],
    ['Mr. Chu - Apink MR.mp3', 'Mr. Chu', 'Apink'],
    ['Instant Crush - Daft Punk (Instrumental).mp3', 'Instant Crush', 'Daft Punk'],
    ['1. 산책 - 백예린.mp3', '산책', '백예린'],
    ['07 - 청혼 - 이소라.mp3', '청혼', '이소라'],
    ['Good_Day_IU_mr.mp3', 'Good Day IU', ''],
    ['밤편지 – 아이유.mp3', '밤편지', '아이유'],
    ['01.mp3', '01', ''],
  ];
  for (const [name, title, artist] of cases) same(C.titleFromFilename(name), { title, artist });
});

test('MR 파일인지: 음악·동영상 형식, 형식을 모르면 확장자로', () => {
  assert.equal(C.isMediaFile({ name: 'a.mp3', type: 'audio/mpeg' }), true);
  assert.equal(C.isMediaFile({ name: '영상', type: 'video/mp4' }), true);
  assert.equal(C.isMediaFile({ name: '노래.M4A', type: '' }), true);
  assert.equal(C.isMediaFile({ name: '가사.txt', type: 'text/plain' }), false);
  assert.equal(C.isMediaFile({ name: '사진.jpg', type: 'image/jpeg' }), false);
  assert.equal(C.isMediaFile(null), false);
});

test('파일 이름 순서: 숫자는 크기대로', () => {
  const names = ['10 다.mp3', '2 나.mp3', '1 가.mp3', 'b.mp3', 'A.mp3'];
  same(names.map(name => ({ name })).sort(C.byFileName).map(f => f.name), ['1 가.mp3', '2 나.mp3', '10 다.mp3', 'A.mp3', 'b.mp3']);
});

test('번호 이어 붙이기: 가장 큰 번호 + 1부터, 데모곡만 있으면 10002부터', () => {
  same(C.nextSongNumbers([{ no: 10001, demo: true }], 3), [10002, 10003, 10004]);
  same(C.nextSongNumbers([{ no: 10001 }, { no: '10007' }, { no: 10003 }], 2), [10008, 10009]);
  same(C.nextSongNumbers([], 1), [10002]);
  same(C.nextSongNumbers([{ no: 10001 }], 0), []);
});

test('같은 곡 찾기: 제목·가수가 같으면 (띄어쓰기·대소문자 무시), 데모곡은 빼고', () => {
  const songs = [{ id: 'd', title: '작은 방의 노래', artist: 'YT 노래방 데모 MR', demo: true }, { id: 'a', title: 'Love Attack', artist: 'RESCENE(리센느)' }, { id: 'b', title: '산책', artist: '' }];
  assert.equal(C.findSameSong(songs, 'love  attack', 'rescene (리센느)').id, 'a');
  assert.equal(C.findSameSong(songs, '산책', '').id, 'b');
  assert.equal(C.findSameSong(songs, '산책', '백예린'), null);
  assert.equal(C.findSameSong(songs, '작은 방의 노래', 'YT 노래방 데모 MR'), null);
});

test('가사 없음: 데모곡 빼고 가사가 빈 곡 (띄어쓰기만 있어도 빈 것)', () => {
  assert.equal(C.lacksLyrics({ lyrics: '' }), true);
  assert.equal(C.lacksLyrics({ lyrics: '  \n ' }), true);
  assert.equal(C.lacksLyrics({}), true);
  assert.equal(C.lacksLyrics({ lyrics: '[00:01.00]가사' }), false);
  assert.equal(C.lacksLyrics({ demo: true }), false);
});

test('가수 이름: 괄호 앞·괄호 안 이름을 따로, Feat. 뒤는 뺀다', () => {
  same(C.artistNames('AKMU(악뮤)'), ['AKMU', '악뮤']);
  same(C.artistNames('잔나비(Feat.카리나 of aespa)'), ['잔나비']);
  same(C.artistNames('죠지(Feat.유라(youra))'), ['죠지']);
  same(C.artistNames('아이유 (IU)'), ['아이유', 'IU']);
  same(C.artistNames('Zion.T feat. Crush'), ['Zion.T']);
  same(C.artistNames('(G)I-DLE'), ['I-DLE']);
  same(C.artistNames('Defeat'), ['Defeat']);
  same(C.artistNames('아이유'), ['아이유']);
  same(C.artistNames(''), []);
  assert.equal(C.artistMatches('AKMU(악뮤)', 'AKMU'), true);
  assert.equal(C.artistMatches('AKMU(악뮤)', '악뮤'), true);
  assert.equal(C.artistMatches('잔나비(Feat.카리나 of aespa)', '잔나비'), true);
  assert.equal(C.artistMatches('아이유', 'IU'), false);
  assert.equal(C.artistMatches('아이유', '아이유 (IU)'), true);
  assert.equal(C.artistMatches('아이유', ''), false);
});

// 예전(songs.js) 정렬 규칙 그대로: 괄호 없는 가수는 새 정렬과 결과가 같아야 한다
function oldRank(found, title, artist, mrDur) {
  const nt = C.norm(title), titleRank = x => {
    const tn = C.norm(x.trackName);
    if (tn === nt || tn.includes(`(${nt})`) || tn.replace(/\(.*?\)/g, '') === nt) return 0;
    return tn.includes(nt) ? 30 : 60;
  };
  return found.filter(x => x.syncedLyrics || x.plainLyrics)
    .map(x => ({ x, rank: (x.syncedLyrics ? 0 : 1000) + (artist && !C.norm(x.artistName).includes(C.norm(artist)) ? 200 : 0) + titleRank(x) + (mrDur ? Math.min(29, Math.abs(x.duration - mrDur) / 2) : 0) }))
    .sort((a, b) => a.rank - b.rank).slice(0, 15).map(o => o.x);
}
const cand = (id, trackName, artistName, duration, synced = true, plain = true) =>
  ({ id, trackName, artistName, duration, syncedLyrics: synced ? '[00:01.00]가' : null, plainLyrics: plain ? '가' : null });
const FOUND = [
  cand(1, '밤편지', '아이유', 253, false),
  cand(2, '밤편지 (Live)', '아이유', 270),
  cand(3, '밤편지', 'Cover Singer', 251),
  cand(4, 'Through the Night (밤편지)', 'IU', 254),
  cand(5, '밤편지', '아이유', 254),
  cand(6, '밤편지', '아이유', 300),
  cand(7, '다른 노래', '아이유', 200),
  cand(8, '밤편지', '아이유', 250, false, false),
];

test('가사 후보 정렬: 괄호 없는 가수는 예전 정렬과 같은 결과', () => {
  for (const [title, artist, mrDur] of [['밤편지', '아이유', 254], ['밤편지', '아이유', null], ['밤편지', '', 260], ['밤편지', 'IU', 254], ['다른 노래', '아이유', 0]]) {
    same(C.rankLyrics(FOUND, { title, artist, mrDur }).map(x => x.id), oldRank(FOUND, title, artist, mrDur).map(x => x.id));
  }
  const many = Array.from({ length: 20 }, (_, i) => cand(100 + i, '밤편지', '아이유', 240 + i));
  assert.equal(C.rankLyrics(many, { title: '밤편지', artist: '아이유', mrDur: 250 }).length, 15);
});

test('가사 후보 정렬: 가수 이름에 괄호가 있어도 가수를 맞춘다 (예전에는 가수 다름으로 밀렸다)', () => {
  const found = [cand(1, '200%', 'Someone Else', 200), cand(2, '200%', 'AKMU', 201)];
  same(C.rankLyrics(found, { title: '200%', artist: 'AKMU(악뮤)', mrDur: 200 }).map(x => x.id), [2, 1]);
  same(oldRank(found, '200%', 'AKMU(악뮤)', 200).map(x => x.id), [1, 2]);   // 예전 규칙의 문제
});

test('가사 자동으로 넣기: 싱크 + 제목 + 가수 + MR 길이 3초 안, 넷 다 맞을 때만', () => {
  const ok = C.chooseLyrics(FOUND, { title: '밤편지', artist: '아이유', mrDur: 255 });
  assert.equal(ok.auto.id, 5); assert.equal(ok.why, ''); assert.equal(ok.swapped, false);
  const no = (found, opts, why) => { const r = C.chooseLyrics(found, opts); assert.equal(r.auto, null, why); assert.equal(r.why, why); return r; };
  no([cand(1, '밤편지', '아이유', 254, false)], { title: '밤편지', artist: '아이유', mrDur: 254 }, 'plain');
  no([cand(1, '밤편지 리메이크', '아이유', 254)], { title: '밤편지', artist: '아이유', mrDur: 254 }, 'title');   // "밤편지 (Live)"는 예전 규칙대로 같은 제목 → 길이로 거른다
  no([cand(1, '밤편지', '아이유', 254)], { title: '밤편지', artist: '', mrDur: 254 }, 'noartist');
  no([cand(1, '밤편지', 'Cover Singer', 254)], { title: '밤편지', artist: '아이유', mrDur: 254 }, 'artist');
  no([cand(1, '밤편지', '아이유', 254)], { title: '밤편지', artist: '아이유', mrDur: null }, 'nodur');
  no([cand(1, '밤편지', '아이유', 254)], { title: '밤편지', artist: '아이유', mrDur: 258 }, 'duration');
  no([], { title: '밤편지', artist: '아이유', mrDur: 254 }, 'none');
  assert.equal(C.chooseLyrics([cand(1, '밤편지', '아이유', 254)], { title: '밤편지', artist: '아이유', mrDur: 257 }).auto.id, 1);   // 딱 3초는 넣는다
  assert.equal(C.chooseLyrics([cand(1, '200%', 'AKMU', 200)], { title: '200%', artist: 'AKMU(악뮤)', mrDur: 199 }).auto.id, 1);     // 가수 괄호
});

test('가사 자동으로 넣기: 파일 이름의 제목·가수가 뒤집혀 있으면 바꿔서 맞춘다', () => {
  const r = C.chooseLyrics(FOUND, { title: '아이유', artist: '밤편지', mrDur: 254 });
  assert.equal(r.swapped, true); assert.equal(r.title, '밤편지'); assert.equal(r.artist, '아이유'); assert.equal(r.auto.id, 5);
  const n = C.chooseLyrics(FOUND, { title: '밤편지', artist: '아이유', mrDur: 254 });
  assert.equal(n.swapped, false);
  const x = C.chooseLyrics([cand(1, '전혀 다른 곡', '누군가', 200)], { title: '아이유', artist: '밤편지', mrDur: 200 });
  assert.equal(x.swapped, false); assert.equal(x.title, '아이유');
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

test('방향키로 숫자판: 위 오른쪽 ✕가 있어도 아래 줄 오른쪽 끝에서 → 는 그대로 (QA CR-003 R5)', () => {
  // TV 화면 숫자판: 머리 줄 오른쪽에 ✕(닫기), 그 아래 1~9 / ⌫ 0 처음부터 / 우선예약 [예약 두 칸]
  const at = (col, row) => ({ x: col * 70, y: row * 50 });
  const items = [at(2.3, -1), at(0, 0), at(1, 0), at(2, 0), at(0, 1), at(1, 1), at(2, 1), at(0, 2), at(1, 2), at(2, 2),
    at(0, 3), at(1, 3), at(2, 3), at(0, 4), at(1.5, 4)];
  const L = ['close', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'clr', 'pri', 'res'];
  const go = (from, dir) => L[C.pickByArrow(items, L.indexOf(from), dir)];
  assert.equal(go('clr', 'ArrowRight'), 'clr');
  assert.equal(go('res', 'ArrowRight'), 'res');
  assert.equal(go('9', 'ArrowRight'), '9');
  assert.equal(go('3', 'ArrowUp'), 'close');     // 위로는 ✕에 간다
  assert.equal(go('close', 'ArrowDown'), '3');
  assert.equal(go('5', 'ArrowRight'), '6');
});

test('파일 이름 → 제목: 뒤에 숫자가 이어지는 앞 숫자는 트랙 번호가 아니다 (QA CR-017 R7)', () => {
  same(C.titleFromFilename('1-800-273-8255 - Logic.mp3'), { title: '1-800-273-8255', artist: 'Logic' });
  same(C.titleFromFilename('1. 밤편지 - 아이유.mp3'), { title: '밤편지', artist: '아이유' });
  same(C.titleFromFilename('01 밤편지.mp3'), { title: '밤편지', artist: '' });
  same(C.titleFromFilename('3-좋은 날.mp3'), { title: '좋은 날', artist: '' });
});

/* ---------------- 기기 맞추기 (CR-039) ---------------- */
const P = (n, last = 0) => ({ n, last });
const S = (id, score, at, extra = {}) => ({ id, no: 10000 + at % 100, title: '곡' + id, score, at, who: '나', ...extra });

test('기기 맞추기: 횟수 합치기는 곡마다 큰 쪽·늦은 시각, 순서를 바꿔도·두 번 해도 같고 줄지 않는다', () => {
  const a = { s1: P(3, 100), s2: P(1, 50) }, b = { s1: P(2, 300), s3: P(4, 10) };
  const ab = C.mergePlays(a, b), ba = C.mergePlays(b, a);
  same(ab, { s1: P(3, 300), s2: P(1, 50), s3: P(4, 10) });
  same(ab, ba);
  same(C.mergePlays(ab, b), ab);
  same(C.mergePlays(ab, {}), ab);
  // 모양이 틀린 줄(숫자 아님·음수·빈 값)은 뺀다
  same(C.mergePlays({ x: { n: 'a' }, y: { n: -1 }, z: null, w: P(2) }, 'oops'), { w: P(2) });
});

test('기기 맞추기: 점수 합치기는 합집합 (시각·곡·점수가 같으면 한 번), 최근 순, 기기마다 30개', () => {
  const a = [S('s1', 80, 3), S('s2', 70, 1)], b = [S('s1', 80, 3), S('s3', 90, 2)];
  same(C.mergeScores(a, b).map(x => x.at), [3, 2, 1]);
  same(C.mergeScores(a, b), C.mergeScores(b, a));
  same(C.mergeScores(C.mergeScores(a, b), b), C.mergeScores(a, b));
  const many = Array.from({ length: 40 }, (_, i) => S('s' + i, 50, i + 1));
  assert.equal(C.mergeScores(many, []).length, 30);
  assert.equal(C.mergeScores(many, []).at(-1).at, 11);
  assert.equal(C.mergeScores(many, [], 0).length, 40);
  assert.equal(C.mergeScores([{ score: 'x', at: 1, id: 'a' }, { score: 1, at: 2 }], []).length, 0);
});

test('기기 맞추기: 합계 = 이 기기 + 다른 기기 사본들, 내 id 사본은 두 번 세지 않고 틀린 모양은 무시', () => {
  const mine = { plays: { s1: P(2, 100) }, scores: [S('s1', 80, 10)] };
  const others = {
    pc: { mt: 5, plays: { s1: P(5, 200), s2: P(1, 50) }, scores: [S('s1', 95, 20), S('s1', 80, 10)] },
    me: { mt: 9, plays: { s1: P(100) }, scores: [S('s1', 100, 30)] },        // 내 id 사본: 빼야 함
    bad: { mt: 1, plays: 'x', scores: 'y' }, nul: null,
  };
  const t = C.statsTotals(mine, others, 'me');
  same(t.plays, { s1: P(7, 200), s2: P(1, 50) });
  same(t.scores.map(x => x.score), [95, 80]);
  assert.equal(t.devices, 2);    // pc + bad (모양만 틀린 칸은 0으로 셈)
  same(C.statsTotals(mine, {}, 'me').plays, mine.plays);
  same(C.statsTotals({}, undefined, null), { plays: {}, scores: [], devices: 0 });
});

test('기기 맞추기: 비교값은 키 순서가 달라도 같고, 내용이 바뀌면 달라진다', () => {
  const a = C.statsSig({ plays: { s1: P(1, 2), s2: P(3, 4) }, scores: [S('a', 1, 2), S('b', 3, 1)] });
  const b = C.statsSig({ plays: { s2: P(3, 4), s1: P(1, 2) }, scores: [S('b', 3, 1), S('a', 1, 2)] });
  assert.equal(a, b);
  assert.notEqual(a, C.statsSig({ plays: { s1: P(2, 2), s2: P(3, 4) }, scores: [S('a', 1, 2), S('b', 3, 1)] }));
});

test('기기 맞추기: Drive 파일 모양 (v·device), 깨진 파일은 null', () => {
  const f = C.buildStatsFile('dev1', { s1: P(2, 5) }, [S('s1', 80, 3)], 1000);
  same(f, { v: 1, app: 'YT 노래방', device: 'dev1', updatedAt: 1000, plays: { s1: P(2, 5) }, scores: [S('s1', 80, 3)] });
  assert.equal(C.statsFileName('dev1'), 'stats-dev1.json');
  same(C.parseStatsFile(f), { device: 'dev1', plays: { s1: P(2, 5) }, scores: [S('s1', 80, 3)] });
  for (const bad of [null, 'x', {}, { device: 'd' }, { v: 1 }, { v: '1', device: 'd' }]) assert.equal(C.parseStatsFile(bad), null);
  same(C.parseStatsFile({ v: 2, device: 'd', plays: { s: { n: -3 } }, scores: 5, extra: 1 }), { device: 'd', plays: {}, scores: [] });
});

test('기기 맞추기: 폴더 JSON 목록 → 내 파일 + 다른 기기 파일 (같은 이름 둘이면 나중 것, 내 id가 없으면 모두 남의 것)', () => {
  const files = [
    { id: 'L', name: 'library.json', modifiedTime: '2026-10-30T00:00:00Z' },
    { id: 'm1', name: 'stats-me.json', modifiedTime: '2026-10-30T00:00:00Z' },
    { id: 'p1', name: 'stats-pc.json', modifiedTime: '2026-10-29T00:00:00Z' },
    { id: 'p2', name: 'stats-pc.json', modifiedTime: '2026-10-31T00:00:00Z' },
    { id: 'x', name: 'stats-.json' }, { id: 'y', name: 'my stats-pc.json' },
  ];
  const r = C.pickStatsFiles(files, 'me');
  assert.equal(r.mine.id, 'm1');
  same(r.others.map(x => [x.id, x.device]), [['p2', 'pc']]);
  const n = C.pickStatsFiles(files, null);
  assert.equal(n.mine, null);
  same(n.others.map(x => x.device).sort(), ['me', 'pc']);
});

test('기기 맞추기: 백업 파일 점수·횟수 — 다른 기기 것은 그 기기 칸, 옛 백업·같은 기기는 예전 규칙', () => {
  const mine = { plays: { s1: P(3, 1) }, scores: [S('s1', 70, 5)] };
  const head = { plays: { s1: P(5, 2), s2: P(1, 1) }, scores: [S('s1', 90, 6), S('s1', 70, 5)] };
  // 옛 백업 (device 없음): 횟수는 큰 쪽, 점수는 (시각, 제목)으로 합집합
  const old = C.mergeBackupStats(head, 'me', mine, {});
  assert.equal(old.target, 'mine');
  same(old.plays, { s1: P(5, 2), s2: P(1, 1) });
  same(old.scores.map(x => x.score), [90, 70]);
  // 같은 기기
  assert.equal(C.mergeBackupStats({ ...head, device: 'me' }, 'me', mine, {}).target, 'mine');
  // 다른 기기: 내 기록은 그대로, 그 기기 칸에 합침. 두 번 불러와도 같음
  const o = C.mergeBackupStats({ ...head, device: 'pc' }, 'me', mine, {});
  assert.equal(o.target, 'other');
  same(o.plays, mine.plays); same(o.scores, mine.scores);
  same(o.others.pc.plays, head.plays);
  const o2 = C.mergeBackupStats({ ...head, device: 'pc' }, 'me', mine, o.others);
  same(o2.others, o.others);
  // 내 id가 아직 없으면 (처음 쓰는 기기) device가 있는 백업은 다른 기기 것
  assert.equal(C.mergeBackupStats({ ...head, device: 'pc' }, null, mine, {}).target, 'other');
});

test('여행 준비: 받을 순서는 많이 부른 곡 → 좋아요 → 번호, 동영상 빼기, 크기 모르는 곡, 여유 10%', () => {
  const songs = [
    { id: 'demo', no: 10001, demo: true },
    { id: 'a', no: 10002, fileId: 'fa', size: 100 },
    { id: 'b', no: 10003, fileId: 'fb', size: 200, video: true },
    { id: 'c', no: 10004, fileId: 'fc' },                      // 크기 모름
    { id: 'd', no: 10005, fileId: 'fd', size: 300 },
    { id: 'e', no: 10006, fileId: 'fe', size: 50, blob: {} },  // 이미 기기에 있음
    { id: 'f', no: 10007, size: 50, blob: {} },                // Drive에 없음
  ];
  const plays = { d: P(5, 1), b: P(5, 9), a: P(1, 1) };
  const r = C.planDownload({ songs, plays, favorites: ['c'], free: 1000 });
  same(r.list.map(s => s.id), ['b', 'd', 'a', 'c']);
  assert.equal(r.need, 600); assert.equal(r.unknown, 1); assert.equal(r.fits, true); assert.equal(r.video, 1);
  assert.equal(C.planDownload({ songs, plays, free: 650 }).fits, false);   // 600 + 10% > 650
  const nv = C.planDownload({ songs, plays, free: 650, skipVideo: true });
  same(nv.list.map(s => s.id), ['d', 'a', 'c']);
  assert.equal(nv.need, 400); assert.equal(nv.fits, true); assert.equal(nv.skippedVideo, 1);
  assert.equal(C.planDownload({ songs, free: null }).fits, true);           // 남은 공간을 모르면 받다가 막히면 멈춤
  same(C.planDownload({ songs }).list.map(s => s.id), ['a', 'b', 'c', 'd']);
  same(C.planDownload({ songs, favorites: ['d', 'c'] }).list.map(s => s.id), ['c', 'd', 'a', 'b']);
});

test('여행 준비: 끝 판정은 지금 상태로 — 새 곡이 생기면 아직, 영구 저장 꺼짐은 끝 + 경고, 앱 화면 저장 안 됨은 아직', () => {
  const on = [{ id: 'demo', demo: true }, { id: 'a', fileId: 'fa', blob: {} }, { id: 'b', fileId: 'fb', blob: {} }];
  same(C.travelStatus({ songs: on, persisted: true, shellCached: true }), { done: true, why: null, cloudOnly: 0, local: 2, pendingUpload: 0, warnPersist: false });
  assert.equal(C.travelStatus({ songs: on, persisted: false, shellCached: true }).warnPersist, true);
  const more = C.travelStatus({ songs: [...on, { id: 'c', fileId: 'fc' }], persisted: true, shellCached: true });
  same([more.done, more.why, more.cloudOnly], [false, 'songs', 1]);
  assert.equal(C.travelStatus({ songs: on, persisted: true, shellCached: false }).why, 'shell');
  assert.equal(C.travelStatus({ songs: on, connected: false, shellCached: true }).why, 'connect');
  // PC: 이 기기에서 넣고 아직 Drive에 안 올라간 곡
  assert.equal(C.travelStatus({ songs: [...on, { id: 'n', blob: {} }, { id: 'm', fileId: 'fm', blob: {}, mediaDirty: true }], shellCached: true }).pendingUpload, 2);
});

test('MR 만들기: 서버 주소 다듬기 — 코드에 기본 주소 없음, 끝 / 떼기, http·https만, @·?·# 안 됨', () => {
  assert.equal(C.MR_DEFAULT_SERVER, '');       // CR-231: 공개 저장소라 코드에 주소를 두지 않는다
  same(C.normalizeMrServer('http://mr.example.test:8765'), { ok: true, url: 'http://mr.example.test:8765', origin: 'http://mr.example.test:8765' });
  same(C.normalizeMrServer('  http://mr.example.test:8765///  '), { ok: true, url: 'http://mr.example.test:8765', origin: 'http://mr.example.test:8765' });
  same(C.normalizeMrServer('HTTPS://Dgx.Example:8443/mr/'), { ok: true, url: 'https://dgx.example:8443/mr', origin: 'https://dgx.example:8443' });
  assert.equal(C.normalizeMrServer('http://127.0.0.1:80').url, 'http://127.0.0.1');       // 기본 포트는 빠진다 (origin과 같게)
  assert.equal(C.normalizeMrServer('').why, 'empty');
  assert.equal(C.normalizeMrServer(null).why, 'empty');
  for (const bad of ['mr.example.test:8765', 'ftp://dgx:21', 'http:/dgx', 'http:///x', 'javascript:alert(1)']) assert.equal(C.normalizeMrServer(bad).why, 'scheme', bad);
  for (const bad of ['http://me:pw@dgx:8765', 'http://@dgx']) assert.equal(C.normalizeMrServer(bad).why, 'userinfo', bad);
  for (const bad of ['http://dgx:8765/?a=1', 'http://dgx:8765/#x', 'http://dg x:8765', 'http://dgx:99999', 'http://dgx\\evil']) assert.equal(C.normalizeMrServer(bad).ok, false, bad);
});

test('MR 만들기 서버 주소 (CR-231): 이 기기 → 허브 → 없음 · 허브 값 검사 · 이 기기에 채우기 · 안내 글', () => {
  const DEV = 'http://mr.example.test:8765', HUB = 'https://mr-hub.example.test:8443/mr';
  assert.equal(C.MR_HUB_NAME, 'mr_server');
  // ① 이 기기 ② 허브 ③ 없음. 모양이 틀린 값은 건너뛴다
  same(C.mrServerPick(DEV, HUB), { url: DEV, from: 'device' });
  same(C.mrServerPick(DEV + '/', ''), { url: DEV, from: 'device' });
  same(C.mrServerPick(null, HUB), { url: HUB, from: 'hub' });
  same(C.mrServerPick('', HUB + '/'), { url: HUB, from: 'hub' });
  same(C.mrServerPick('mr.example.test:8765', HUB), { url: HUB, from: 'hub' });     // 이 기기 값이 틀리면 허브 값
  same(C.mrServerPick(null, null), { url: '', from: '' });
  same(C.mrServerPick('', 'javascript:alert(1)'), { url: '', from: '' });
  same(C.mrServerPick(undefined, 'http://me:pw@mr.example.test'), { url: '', from: '' });
  // 허브에서 온 값: 글자 1~512자·제어 문자 없음·주소 모양만
  assert.equal(C.mrHubValueOk(DEV), DEV);
  assert.equal(C.mrHubValueOk('  ' + DEV + '/  '), DEV);
  for (const bad of [null, undefined, 42, {}, '', '   ', 'mr.example.test:8765', 'ftp://x', 'http://a@b', 'http://x\nevil.test', DEV + '?a=1', 'http://' + 'a'.repeat(520) + '.test'])
    assert.equal(C.mrHubValueOk(bad), null, String(bad).slice(0, 40));
  // 이 기기(nb-mrserver)에 채우기: 이 기기 값이 없거나 틀릴 때만, 허브 값이 맞을 때만
  assert.equal(C.mrHubFill(null, DEV), DEV);
  assert.equal(C.mrHubFill('', DEV + '/'), DEV);
  assert.equal(C.mrHubFill('mr.example.test:8765', DEV), DEV);
  assert.equal(C.mrHubFill(HUB, DEV), null);                 // 이 기기 설정이 이김
  assert.equal(C.mrHubFill(null, 'mr.example.test'), null);  // 틀린 허브 값은 버림
  assert.equal(C.mrHubFill(null, null), null);
  // 안내 글: 글에 주소가 없다. [저장] 결과 넷, [이 기기에서 지우기] 둘, 주소 없음 (MR 만들기·자동 싱크가 같은 글)
  assert.deepEqual(Object.keys(C.MR_SAVE_TEXT).sort(), ['device', 'hub', 'hubfail', 'saving']);
  assert.match(C.MR_SAVE_TEXT.hub, /허브에도 넣어서 내 다른 기기도 이 주소를 써요/);
  assert.equal(C.MR_SAVE_TEXT.device, '이 기기에만 저장했어요 · 허브에 로그인한 뒤 다시 저장하면 내 다른 기기도 같이 써요');
  assert.match(C.MR_SAVE_TEXT.hubfail, /^이 기기에는 저장했어요 · 허브에는 못 넣었어요/);
  assert.notEqual(C.mrClearText(true), C.mrClearText(false));
  assert.match(C.mrClearText(true), /허브에 있는 주소/);
  // 곡 목록 [MR 만들기] 안내는 짧은 글 (옆 [주소 넣기]), 자동 싱크 줄은 단추가 없어 길이 든 글
  assert.equal(C.MR_NOSERVER_SHORT, 'MR 만들기 서버 주소가 아직 없어요 · 한 번만 넣어 주세요');
  assert.equal(C.MR_NOSERVER_TEXT, 'MR 만들기 서버 주소가 아직 없어요 · 설정 → 더 보기 (고급) → MR 만들기 (집 AI 서버)에 한 번 넣어 주세요');
  assert.equal(C.alignErrText('noserver'), C.MR_NOSERVER_TEXT);
  for (const t of [...Object.values(C.MR_SAVE_TEXT), C.mrClearText(true), C.mrClearText(false), C.MR_NOSERVER_TEXT, C.MR_NOSERVER_SHORT])
    assert.doesNotMatch(t, /https?:|:8765|dgx|ts\.net|100\.\d/i, t);
});

test('MR 만들기: 받은 메시지 — 내가 연 창 + 서버 주소 + {app,v}일 때만, 파일은 30개·120MB·MR 파일만', () => {
  const want = 'http://mr.example.test:8765', from = { origin: want, mine: true };
  const mp3 = (name = '밤편지 - 아이유 (MR).mp3', size = 9e6, type = 'audio/mpeg') => ({ name, size, type });
  same(C.mrMessageOk({ app: 'yena-mr', v: 1, type: 'hello', base: want, https: null }, from, want), { type: 'hello' });
  // 무시: 다른 주소, 내가 열지 않은 창, 서버 주소를 모름, 약속 밖 모양
  assert.equal(C.mrMessageOk({ app: 'yena-mr', v: 1, type: 'hello' }, { origin: 'http://evil.test', mine: true }, want), null);
  assert.equal(C.mrMessageOk({ app: 'yena-mr', v: 1, type: 'hello' }, { origin: want, mine: false }, want), null);
  assert.equal(C.mrMessageOk({ app: 'yena-mr', v: 1, type: 'hello' }, from, ''), null);
  for (const m of [null, 'hello', { app: 'other', v: 1, type: 'hello' }, { app: 'yena-mr', v: 2, type: 'hello' }, { app: 'yena-mr', v: '1', type: 'hello' }, { app: 'yena-mr', v: 1 }])
    assert.equal(C.mrMessageOk(m, from, want), null, JSON.stringify(m));
  // 파일
  const files = [mp3(), mp3('산책 - 백예린 (MR).mp3')];
  const r = C.mrMessageOk({ app: 'yena-mr', v: 1, type: 'files', files }, from, want);
  assert.equal(r.type, 'files'); assert.equal(r.files.length, 2); assert.equal(r.bad, undefined);
  assert.equal(C.mrMessageOk({ app: 'yena-mr', v: 1, type: 'files', files: [mp3('a (MR).mp3', C.MR_MAX_BYTES)] }, from, want).bad, undefined);   // 120MB 꼭 맞으면 됨
  const bad = f => C.mrMessageOk({ app: 'yena-mr', v: 1, type: 'files', files: f }, from, want);
  for (const [why, f] of [['없음', []], ['배열 아님', 'x'], ['파일 아님', ['밤편지.mp3']], ['120MB 넘음', [mp3('a.mp3', C.MR_MAX_BYTES + 1)]], ['빈 파일', [mp3('a.mp3', 0)]],
    ['MR 파일 아님', [mp3('메모.txt', 10, 'text/plain')]], ['하나라도 틀리면', [mp3(), { name: 'x.mp3' }]], ['31개', Array.from({ length: 31 }, (_, i) => mp3(`${i} (MR).mp3`))]])
    same(bad(f), { type: 'files', bad: true }, why);
  assert.equal(bad(Array.from({ length: 30 }, (_, i) => mp3(`${i} (MR).mp3`))).bad, undefined);
  // 브라우저처럼 isFile을 넘기면 그것으로 본다 (모양만 같은 가짜는 안 됨)
  assert.equal(C.mrMessageOk({ app: 'yena-mr', v: 1, type: 'files', files: [mp3()] }, from, want, () => false).bad, true);
  // 받은 MR 이름 → 제목·가수 (서비스 이름 규칙 "제목 - 가수 (MR).mp3"와 맞물림)
  same(C.titleFromFilename('밤편지 - 아이유 (MR).mp3'), { title: '밤편지', artist: '아이유' });
  same(C.titleFromFilename('[TJ노래방] 산책 - 백예린 _ TJ Karaoke (MR).mp3'), { title: '산책', artist: '백예린' });
  same(C.titleFromFilename('1부 행진곡_멸종위기사랑 (MR).mp3'), { title: '1부 행진곡', artist: '멸종위기사랑' });
});

/* ---------------- 유튜브 곡 (CR-030) ---------------- */
test('유튜브 링크 → 영상 번호: 링크 5종이 같은 영상, 재생목록은 영상 하나만, 엉뚱한 글은 null', () => {
  const id = 'dQw4w9WgXcQ';
  for (const link of [
    `https://youtu.be/${id}`, `youtu.be/${id}?si=abc123`, `https://www.youtube.com/watch?v=${id}`, `https://m.youtube.com/watch?app=m&v=${id}&t=30s`,
    `https://www.youtube.com/shorts/${id}`, `https://music.youtube.com/watch?v=${id}&feature=share`, `https://www.youtube.com/embed/${id}?start=5`,
    `https://www.youtube-nocookie.com/embed/${id}`, `https://www.youtube.com/watch?v=${id}&list=PLabcdefghijklmnop&index=3`, `https://www.youtube.com/live/${id}`,
    `노래방 영상이에요 https://youtu.be/${id} 같이 불러요`, `[TJ노래방] 밤편지 - 아이유\nhttps://youtube.com/watch?v=${id}`,
  ]) assert.equal(C.parseYouTubeId(link), id, link);
  for (const bad of ['', null, undefined, '밤편지 아이유', id, 'https://example.com/watch?v=' + id, 'https://notyoutube.com/watch?v=' + id,
    'https://www.youtube.com/playlist?list=PLabcdefghijklmnop', 'https://www.youtube.com/@channel', 'https://www.youtube.com/results?search_query=x',
    'https://youtu.be/short', 'https://www.youtube.com/watch?v=' + id + 'x', 'mailto:me@youtube.com/watch?v=' + id])
    assert.equal(C.parseYouTubeId(bad), null, String(bad));
  assert.equal(C.ytWatchUrl(id), 'https://www.youtube.com/watch?v=' + id);
});

test('유튜브 곡 판정·같은 영상 찾기·가사 없음에서 빠짐', () => {
  const yt = { id: 'y1', no: 10, title: '밤편지', source: 'yt', ytId: 'dQw4w9WgXcQ', lyrics: '' };
  assert.equal(C.isYtSong(yt), true);
  assert.equal(C.isYtSong({ ...yt, ytId: 'bad' }), false);
  assert.equal(C.isYtSong({ id: 'm1', title: 'MR', blob: {} }), false);
  assert.equal(C.isYtSong(null), false);
  assert.equal(C.findYtSong([{ id: 'm1' }, yt], 'dQw4w9WgXcQ'), yt);
  assert.equal(C.findYtSong([{ ...yt, deleted: true }], 'dQw4w9WgXcQ'), null);
  assert.equal(C.findYtSong([yt], 'aaaaaaaaaaa'), null);
  assert.equal(C.lacksLyrics(yt), false);                       // 영상만으로 정상
  assert.equal(C.lacksLyrics({ id: 'm1', title: 'MR', lyrics: '' }), true);   // 내 MR 곡은 전과 같음
});

test('유튜브 곡은 Drive library.json에 글만 들어가고 다른 기기에서 그대로 합쳐진다', () => {
  const yt = { id: 'y1', no: 10, title: '밤편지', artist: '아이유', source: 'yt', ytId: 'dQw4w9WgXcQ', ytDur: 253.5, lyrics: '[00:01.00]가사', createdAt: 1, updatedAt: 2 };
  const local = { id: 'm1', no: 11, title: '안 올린 MR', blob: {}, createdAt: 1, updatedAt: 1 };
  const lib = C.buildLibrary({ songs: [yt, local], tombs: [], profiles: [], recs: [], recTombs: [] }, 5);
  same(lib.songs, [{ id: 'y1', no: 10, title: '밤편지', artist: '아이유', lyrics: '[00:01.00]가사', createdAt: 1, updatedAt: 2, source: 'yt', ytId: 'dQw4w9WgXcQ', ytDur: 253.5 }]);
  assert.ok(C.SONG_FIELDS.includes('source') && C.SONG_FIELDS.includes('ytId') && C.SONG_FIELDS.includes('ytDur'));
  const { live: list } = C.mergeRemoteInto([], [], lib.songs, C.SONG_FIELDS, { mediaKey: 'blob' });
  assert.equal(list.length, 1); assert.equal(C.isYtSong(list[0]), true); assert.equal(list[0].ytId, 'dQw4w9WgXcQ');
});

test('열쇠 없는 유튜브 검색 주소: 검색어에 "노래방"을 보탠다', () => {
  assert.equal(C.ytSearchQuery('밤편지 아이유'), '밤편지 아이유 노래방');
  assert.equal(C.ytSearchQuery('  밤편지   노래방 '), '밤편지 노래방');
  assert.equal(C.ytSearchQuery('Through the Night karaoke'), 'Through the Night karaoke');
  assert.equal(C.ytSearchQuery('밤편지 MR'), '밤편지 MR');
  assert.equal(C.ytSearchQuery('Mr. Chu'), 'Mr. Chu 노래방');
  assert.equal(C.ytSearchQuery(''), '');
  assert.equal(C.ytResultsUrl('밤편지 & 아이유'), 'https://www.youtube.com/results?search_query=' + encodeURIComponent('밤편지 & 아이유 노래방'));
});

test('열쇠 검색 답 읽기: 영상만, 제목의 &amp; 같은 것을 글자로', () => {
  const json = { items: [
    { id: { kind: 'youtube#video', videoId: 'dQw4w9WgXcQ' }, snippet: { title: '[TJ노래방] 밤편지 - 아이유 / TJ Karaoke', channelTitle: 'TJ KARAOKE', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg' } } } },
    { id: { videoId: 'abcdefghijk' }, snippet: { title: 'Rock &amp; Roll &#39;Night&#39; &quot;MR&quot; &#x41;', channelTitle: 'Q&amp;A', thumbnails: { default: { url: 'http://evil.example/x.jpg' } } } },
    { id: { kind: 'youtube#channel', channelId: 'UCxxx' }, snippet: { title: '채널' } },
    { id: { videoId: 'short' }, snippet: { title: '이상한 번호' } },
    { id: { videoId: 'zzzzzzzzzzz' }, snippet: { title: '' } },
  ] };
  same(C.parseYtSearch(json), [
    { id: 'dQw4w9WgXcQ', title: '[TJ노래방] 밤편지 - 아이유 / TJ Karaoke', channel: 'TJ KARAOKE', thumb: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg' },
    { id: 'abcdefghijk', title: 'Rock & Roll \'Night\' "MR" A', channel: 'Q&A', thumb: '' },
  ]);
  same(C.parseYtSearch(null), []);
  same(C.parseYtSearch({ items: 'x' }), []);
  assert.equal(C.htmlText('a &unknown; b &#0; c'), 'a &unknown; b &#0; c');
});

test('영상 제목 → 곡 제목·가수: 노래방 꼬리표를 떼고, 노래방 채널 이름은 가수로 안 씀', () => {
  same(C.ytTitleParts('[TJ노래방] 밤편지 - 아이유 / TJ Karaoke', 'TJ KARAOKE'), { title: '밤편지', artist: '아이유' });
  same(C.ytTitleParts('[KY ENTERTAINMENT] 좋은 날 - 아이유 (KY.46470) / KY Karaoke', 'KY KARAOKE'), { title: '좋은 날', artist: '아이유' });
  same(C.ytTitleParts('Through the Night (Karaoke Version)', 'IU - Topic'), { title: 'Through the Night', artist: 'IU' });
  same(C.ytTitleParts('밤편지 노래방', '노래방 채널'), { title: '밤편지', artist: '' });
  same(C.ytTitleParts('Rock &amp; Roll - 가수 MR', ''), { title: 'Rock & Roll', artist: '가수' });
  same(C.ytTitleParts('', 'x'), { title: '', artist: '' });
});

test('폰 [공유]로 받은 주소: 글 속 링크를 찾고, 공유 칸만 지운다', () => {
  const id = 'dQw4w9WgXcQ';
  same(C.shareParams('?title=' + encodeURIComponent('[TJ노래방] 밤편지') + '&text=' + encodeURIComponent('https://youtu.be/' + id + '?si=x')), { id, title: '[TJ노래방] 밤편지' });
  same(C.shareParams('?text=' + encodeURIComponent('[TJ노래방] 밤편지 - 아이유 https://youtu.be/' + id)), { id, title: '[TJ노래방] 밤편지 - 아이유' });
  same(C.shareParams('?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id) + '&title='), { id, title: '' });
  same(C.shareParams('?text=' + encodeURIComponent('그냥 글')), { id: null, title: '그냥 글' });
  assert.equal(C.shareParams('?tv=1'), null);
  assert.equal(C.shareParams(''), null);
  assert.equal(C.stripShareParams('?title=a&text=b&url=c'), '');
  assert.equal(C.stripShareParams('?tv=1&text=b'), '?tv=1');
  assert.equal(C.stripShareParams(''), '');
});

test('숨김 정리 (CR-229): "더 보기 (고급)"은 \'1\'일 때만 켜짐, 저장 열쇠는 nb- 접두어', () => {
  assert.equal(C.ADV_KEY, 'nb-advanced');
  assert.equal(C.DECK_KEY, 'nb-deck');
  assert.equal(C.advOn('1'), true);
  for (const v of [null, undefined, '', '0', 'true', 1]) assert.equal(C.advOn(v), false, String(v));
});

test('숨김 정리 (CR-229): 음향 설정 처음 상태 — 고급이면 예전 규칙, 아니면 접힘이 기본이고 편 상태를 기억', () => {
  // 고급 켬: 예전처럼 PC는 펼침, 560px 이하는 접힘 (저장 값은 안 봄)
  assert.equal(C.deckOpenAtStart(true, null, false), true);
  assert.equal(C.deckOpenAtStart(true, '0', false), true);
  assert.equal(C.deckOpenAtStart(true, '1', true), false);
  // 고급 끔(기본): 처음엔 접힘, 사람이 펴 두면('1') 다음에도 펼침
  assert.equal(C.deckOpenAtStart(false, null, false), false);
  assert.equal(C.deckOpenAtStart(false, '0', false), false);
  assert.equal(C.deckOpenAtStart(false, '1', false), true);
  assert.equal(C.deckOpenAtStart(false, '1', true), true);
});

test('숨김 정리 (CR-229): 저장 공간 한 줄 요약', () => {
  assert.equal(C.storeSummary(24, 0, '3.2GB'), '곡 24개 · 남은 공간 약 3.2GB');
  assert.equal(C.storeSummary(3, 2, '120MB'), '곡 3개 · Drive에만 2개 · 남은 공간 약 120MB');
  assert.equal(C.storeSummary(0, 0, ''), '곡 0개');
});

test('숨김 정리 (CR-229): 숨김 코드는 설정 값(nb-settings 등)을 쓰지 않는다 — 새 저장 열쇠는 nb-advanced·nb-deck 둘뿐', () => {
  const fs = require('node:fs'), path = require('node:path');
  const js = ['core.js', 'karaoke.js', 'cloud.js', 'main.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')).join('\n');
  // CR-229 블록이 쓰는 열쇠는 ADV_KEY·DECK_KEY만
  const block = js.split('\n').filter(l => /ADV_KEY|DECK_KEY/.test(l));
  assert.ok(block.length >= 3, '고급·음향 접기 코드가 있음');
  for (const l of block) assert.ok(!/saveSettings|nb-settings|settings\[/.test(l), l);
  // 설정 창 HTML: 숨긴 칸의 id는 그대로 남아 있다 (지우지 않음)
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const id of ['s-echo', 's-reverb', 's-guide', 's-recOffset', 'measureBtn', 't-monitor', 't-speakerMode', 'lyrOff', 'syncBtn', 'clientAdv', 'gClientId',
    'storeBar', 'storeTxt', 'storeCounts', 'persistTxt', 'dlAllBtn', 'persistBtn', 'travelSec', 'travelGo', 'bkExport', 'bkFile', 'mrServer', 'mrSave', 'mrReset',
    'remoteSet', 'remoteCtl', 'remoteNewEach', 'remoteNewPin'])
    assert.ok(html.includes(`id="${id}"`), id);
});

test('MR 만들기 + 가사 정렬 (CR-227 W7·W8): 새 메시지 모양 — files.lrc · lyrics_req · aligned (크기·글·값 검사, 틀리면 무시)', () => {
  const want = 'http://mr-test-box:8765', from = { origin: want, mine: true };
  const M = o => C.mrMessageOk({ app: 'yena-mr', v: 1, ...o }, from, want);
  const mp3 = (name = '지은 노래 - 시험가수 (MR).mp3') => ({ name, size: 9e6, type: 'audio/mpeg' });
  const LRC = '[00:01.00]첫 줄 가사\n[00:04.50]둘째 줄 가사';
  const al = (o = {}) => ({ name: '지은 노래 - 시험가수 (MR).mp3', lrc: LRC, score: 0.82, level: 'high', ...o });
  // files.lrc: 같은 차례·같은 이름이면 붙고, 틀린 칸은 null (파일은 그대로 받음)
  const files = [mp3(), mp3('둘째 노래 - 시험가수 (MR).mp3')];
  same(M({ type: 'files', files, lrc: [al(), null] }).lrc, [{ lrc: LRC, score: 0.82, level: 'high' }, null]);
  same(M({ type: 'files', files, lrc: [al(), al({ name: '둘째 노래 - 시험가수 (MR).mp3', level: 'low', score: 0.2 })] }).lrc[1], { lrc: LRC, score: 0.2, level: 'low' });
  for (const [why, x] of [['이름이 다른 파일', al({ name: '다른 곡 (MR).mp3' })], ['시각 없는 글', al({ lrc: '첫 줄 가사\n둘째 줄' })], ['빈 글', al({ lrc: '' })],
    ['글이 64KB 넘음', al({ lrc: '[00:01.00]' + '가'.repeat(C.MR_LRC_MAX) })], ['글 아님', al({ lrc: 3 })], ['점수 1 넘음', al({ score: 1.5 })], ['점수 글자', al({ score: '0.8' })],
    ['점수 NaN', al({ score: NaN })], ['모르는 level', al({ level: 'great' })], ['배열', [al()]], ['글자', 'x']]) {
    const r = M({ type: 'files', files, lrc: [x, al({ name: '둘째 노래 - 시험가수 (MR).mp3' })] });
    assert.equal(r.bad, undefined, why); assert.equal(r.files.length, 2, why); assert.equal(r.lrc[0], null, why); assert.equal(r.lrc[1].level, 'high', why);
  }
  // 수가 다르거나 다 틀리면 lrc 통째로 없음 (예전처럼 파일만)
  assert.equal(M({ type: 'files', files, lrc: [al()] }).lrc, undefined);
  assert.equal(M({ type: 'files', files, lrc: [null, null] }).lrc, undefined);
  assert.equal(M({ type: 'files', files, lrc: 'x' }).lrc, undefined);
  assert.equal(M({ type: 'files', files }).lrc, undefined);
  // 파일이 틀리면 lrc가 맞아도 nack bad (예전과 같음)
  same(M({ type: 'files', files: ['a.mp3'], lrc: [al()] }), { type: 'files', bad: true });

  // lyrics_req: 1~30개, key 글자 모양, 이름 255자, 길이 0~3600초 또는 없음
  same(M({ type: 'lyrics_req', items: [{ key: 'k1', name: '지은 노래 - 시험가수.mp3', duration: 183.4 }, { key: 'k2', name: '둘째.wav' }] }),
    { type: 'lyrics_req', items: [{ key: 'k1', name: '지은 노래 - 시험가수.mp3', duration: 183.4 }, { key: 'k2', name: '둘째.wav', duration: null }] });
  for (const [why, items] of [['없음', []], ['배열 아님', { key: 'k1' }], ['31개', Array.from({ length: 31 }, (_, i) => ({ key: 'k' + i, name: 'a.mp3' }))],
    ['key 모양', [{ key: 'k 1', name: 'a.mp3' }]], ['key 41자', [{ key: 'k'.repeat(41), name: 'a.mp3' }]], ['key 숫자', [{ key: 1, name: 'a.mp3' }]],
    ['이름 없음', [{ key: 'k1', name: '' }]], ['이름 256자', [{ key: 'k1', name: 'a'.repeat(256) }]], ['길이 음수', [{ key: 'k1', name: 'a.mp3', duration: -1 }]],
    ['길이 1시간 넘음', [{ key: 'k1', name: 'a.mp3', duration: 3601 }]], ['길이 글자', [{ key: 'k1', name: 'a.mp3', duration: '180' }]], ['칸이 글자', ['k1']]])
    assert.equal(M({ type: 'lyrics_req', items }), null, why);
  assert.equal(M({ type: 'lyrics_req', items: Array.from({ length: 30 }, (_, i) => ({ key: 'k' + i, name: 'a.mp3' })) }).items.length, 30);

  // aligned: 결과 또는 오류 코드. 곡 번호(uid) 모양 · 결과 검사는 files.lrc와 같음
  const sid = '7f0c2a3e-1b2c-4d5e-8f90-123456789abc';
  same(M({ type: 'aligned', songId: sid, lrc: LRC, score: 0.4, level: 'mid', extra: 'x' }), { type: 'aligned', songId: sid, lrc: LRC, score: 0.4, level: 'mid' });
  same(M({ type: 'aligned', songId: sid, error: 'no_vocals' }), { type: 'aligned', songId: sid, error: 'no_vocals' });
  for (const [why, o] of [['곡 번호 없음', { lrc: LRC, score: 0.4, level: 'mid' }], ['곡 번호 모양', { songId: '../x', error: 'no_match' }], ['곡 번호 65자', { songId: 'a'.repeat(65), error: 'no_match' }],
    ['오류 코드 모양', { songId: sid, error: 'No Match!' }], ['오류 코드 33자', { songId: sid, error: 'a'.repeat(33) }], ['오류 코드 숫자', { songId: sid, error: 4 }],
    ['시각 없는 글', { songId: sid, lrc: '가사만', score: 0.4, level: 'mid' }], ['level 없음', { songId: sid, lrc: LRC, score: 0.4 }], ['점수 없음', { songId: sid, lrc: LRC, level: 'mid' }]])
    assert.equal(M({ type: 'aligned', ...o }), null, why);
  // 예전 모양은 예전과 같다 (hello · 모르는 type)
  same(M({ type: 'hello', base: want }), { type: 'hello' });
  same(M({ type: 'something_new', x: 1 }), { type: 'something_new' });
  // hello.caps (새 창만): 글자 모양만 남김, 10개 넘으면 없는 것으로
  same(M({ type: 'hello', base: want, caps: ['lyrics_req', 'align_req', 'Bad Cap', 3] }), { type: 'hello', caps: ['lyrics_req', 'align_req'] });
  same(M({ type: 'hello', caps: Array(11).fill('x') }), { type: 'hello' });
  same(M({ type: 'hello', caps: 'align_req' }), { type: 'hello' });
  // 다른 주소·내가 열지 않은 창이면 새 모양도 무시
  assert.equal(C.mrMessageOk({ app: 'yena-mr', v: 1, type: 'aligned', songId: sid, error: 'no_match' }, { origin: 'http://evil.test', mine: true }, want), null);
  assert.equal(C.mrMessageOk({ app: 'yena-mr', v: 1, type: 'lyrics_req', items: [{ key: 'k1', name: 'a.mp3' }] }, { origin: want, mine: false }, want), null);
});

test('가사 정렬 (CR-227 W7·W8): 창에 보낼 가사 · LRCLIB 답 · 단추 · 넣기 전 물음 · 오류 안내', () => {
  const PLAIN = '[후렴]\n첫 줄 가사\n\n둘째 줄 가사', LRC = '[00:01.00]첫 줄 가사\n[00:04.50]둘째 줄 가사';
  // 노래방 곡으로 답 (lyrics_req): 시각 없는 가사는 글 그대로, 시각이 있으면 synced (글 안 보냄), 가사 없으면 null
  same(C.mrLyricsFor({ lyrics: PLAIN }), { synced: false, text: PLAIN });
  same(C.mrLyricsFor({ lyrics: LRC }), { synced: true, text: '' });
  for (const s of [null, {}, { lyrics: '' }, { lyrics: '  \n ' }, { lyrics: '[간주]' }, { lyrics: 3 }]) assert.equal(C.mrLyricsFor(s), null, JSON.stringify(s));
  assert.equal(C.mrLyricsFor({ lyrics: '가'.repeat(C.MR_LYR_MAX + 1) }), null);       // 48KB 넘으면 보내지 않음
  // LRCLIB /api/get 답
  same(C.mrLyricsFromLrclib({ plainLyrics: PLAIN, syncedLyrics: null }), { synced: false, text: PLAIN });
  same(C.mrLyricsFromLrclib({ plainLyrics: PLAIN, syncedLyrics: LRC }), { synced: true, text: '' });
  for (const got of [null, { instrumental: true, plainLyrics: PLAIN }, { plainLyrics: '' }, { plainLyrics: 3 }, 'x'])
    same(C.mrLyricsFromLrclib(got), { synced: false, text: '' });
  // W8 집 AI에 보낼 글: 시각 없는 가사는 그대로, 시각이 있으면 시각을 뗀 줄
  assert.equal(C.alignLyricsText({ lyrics: PLAIN }), PLAIN);
  assert.equal(C.alignLyricsText({ lyrics: '[ar:시험]\n' + LRC + '\n[00:09.00]' }), '첫 줄 가사\n둘째 줄 가사');
  assert.equal(C.alignLyricsText({ lyrics: '' }), '');
  assert.equal(C.alignLyricsText({ lyrics: '가'.repeat(C.MR_LYR_MAX + 1) }), '');
  // 단추: 데모·가사 없음은 안 보임. 무대 단추는 시각 없는 곡이나 "확인해 주세요" 곡만, 곡 수정 창은 시각이 있어도 보임
  assert.equal(C.canAlignSong({ lyrics: PLAIN }, true), true);
  assert.equal(C.canAlignSong({ lyrics: LRC }, true), false);
  assert.equal(C.canAlignSong({ lyrics: LRC, syncChk: 1 }, true), true);
  assert.equal(C.canAlignSong({ lyrics: LRC }), true);
  for (const s of [null, { demo: true, lyrics: PLAIN }, { lyrics: '' }]) { assert.equal(C.canAlignSong(s), false); assert.equal(C.canAlignSong(s, true), false); }
  // 넣기 전에 물음: low · 이미 시각 있음 (둘 다 아니면 묻지 않고 넣음)
  same(C.alignAsk({ lyrics: PLAIN }, 'high'), { low: false, overwrite: false });
  same(C.alignAsk({ lyrics: PLAIN }, 'low'), { low: true, overwrite: false });
  same(C.alignAsk({ lyrics: LRC, syncChk: 1 }, 'mid'), { low: false, overwrite: true });
  same(C.alignAsk({ lyrics: LRC }, 'low'), { low: true, overwrite: true });
  // 오류 안내: app/errors.py와 같은 뜻 + W10 목소리 없는 파일
  assert.equal(C.alignErrText('no_match'), '가사와 노래 소리가 맞지 않아 시각을 못 붙였어요');
  assert.equal(C.alignErrText('no_vocals'), '목소리가 없는 파일이에요(MR). 원곡 파일을 골라 주세요');
  assert.match(C.alignErrText('bad_lyrics'), /^가사를 읽지 못했어요/);
  assert.equal(C.alignErrText('unreachable'), '집 AI에 닿지 않아요 · 집에 가면 다시 해요');
  assert.equal(C.alignErrText('worker_failed'), '가사 시각을 못 맞췄어요 · 잠시 뒤 다시 해 주세요');
  assert.equal(C.alignErrText('__proto__'), '가사 시각을 못 맞췄어요 · 잠시 뒤 다시 해 주세요');
});

/* ---------------- 허브: 곡 설정 맞추기 (CR-227) ---------------- */
// 시험 값은 모두 가짜: 주소는 qafakehub000…, 키는 여기서 만든 가짜 JWT·가짜 공개 키
const FAKE_URL = 'https://' + 'qafakehub'.padEnd(20, '0') + '.supabase.co';
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = role => [b64u({ alg: 'HS256', typ: 'JWT' }), b64u({ iss: 'qa', role }), 'qa-signature'].join('.');
const FAKE_PUB = 'sb_publishable_' + 'qa'.repeat(12);

test('허브 연결 코드: hub.json 내용과 nbhub1 코드를 읽고, 주소·키 모양이 틀리면 못 씀 (값은 돌려주지 않음)', () => {
  const anon = fakeJwt('anon');
  same(C.hubCodeParse(JSON.stringify({ url: FAKE_URL, anonKey: anon })), { ok: true, u: FAKE_URL, k: anon });
  same(C.hubCodeParse(JSON.stringify({ url: FAKE_URL + '/', anonKey: FAKE_PUB }) + '\n'), { ok: true, u: FAKE_URL, k: FAKE_PUB });
  const code = C.hubCodeMake(FAKE_URL, anon);
  assert.match(code, /^nbhub1\.[A-Za-z0-9_-]+$/);
  same(C.hubCodeParse(code), { ok: true, u: FAKE_URL, k: anon });
  same(C.hubCodeParse('#hub=' + code), { ok: true, u: FAKE_URL, k: anon });
  // 못 쓰는 값: 비밀 키, service_role JWT, 다른 주소, http, 모양이 틀린 키·글
  for (const bad of [
    JSON.stringify({ url: FAKE_URL, anonKey: 'sb_secret_' + 'qa'.repeat(12) }),
    JSON.stringify({ url: FAKE_URL, anonKey: fakeJwt('service_role') }),
    JSON.stringify({ url: FAKE_URL, anonKey: fakeJwt('authenticated') }),
    JSON.stringify({ url: 'https://qa.example.com', anonKey: anon }),
    JSON.stringify({ url: FAKE_URL.replace('https', 'http'), anonKey: anon }),
    JSON.stringify({ url: FAKE_URL.replace('qafakehub', 'qafakehub0'), anonKey: anon }),
    JSON.stringify({ url: FAKE_URL, anonKey: 'not a key' }),
    JSON.stringify({ url: FAKE_URL, anonKey: 'plainkey123' }),
    JSON.stringify({ url: FAKE_URL }),
    'nbhub1.' + Buffer.from('{"u":').toString('base64url'),
    'nbhub2.' + C.hubCodeMake(FAKE_URL, anon).slice(7),
    '{not json', '', null, '[1,2]', 'x'.repeat(5000),
  ]) same(C.hubCodeParse(bad), { ok: false });
  assert.equal(C.hubPairOk(FAKE_URL, 'sb_secret_abcdefghij'), false);
});

test('곡 열쇠: MR 곡은 파일 해시 앞 40자리, 유튜브 곡은 영상 번호, 데모·지운 곡·해시 없음은 null', () => {
  const hex = 'ab'.repeat(32);
  assert.equal(C.mrHashKey(hex), 'mr-' + hex.slice(0, 40));
  assert.equal(C.mrHashKey('xyz'), null);
  assert.equal(C.songSettingsKey({ mrHash: 'mr-' + hex.slice(0, 40) }), 'mr-' + hex.slice(0, 40));
  assert.equal(C.songSettingsKey({ source: 'yt', ytId: 'dQw4w9WgXcQ' }), 'yt-dQw4w9WgXcQ');
  assert.equal(C.songSettingsKey({ source: 'yt', ytId: 'short' }), null);
  assert.equal(C.songSettingsKey({ title: '해시 아직' }), null);
  assert.equal(C.songSettingsKey({ demo: true, mrHash: 'mr-' + hex.slice(0, 40) }), null);
  assert.equal(C.songSettingsKey({ deleted: true, mrHash: 'mr-' + hex.slice(0, 40) }), null);
  assert.ok(C.songSettingsKey({ mrHash: 'mr-' + hex.slice(0, 40) }).length <= 64);
});

test('곡 설정 data: 가사·오프셋·기본 키만, 범위를 넘으면 자름, 제목·가수 100자, 48KB 넘는 가사는 big', () => {
  const s = { title: 'QA'.repeat(80), artist: '가수', lyrics: '[00:01.00]첫 줄', lyricOffset: 31.27, baseKey: 9, blob: {}, buffer: {}, id: 'x', fileId: 'f' };
  const { data, big } = C.songSettingsData(s);
  same(data, { v: 1, src: 'mr', title: 'QA'.repeat(50), artist: '가수', lrc: '[00:01.00]첫 줄', offset: 30, key: 6 });
  assert.equal(big, false);
  assert.equal(C.songSettingsData({ ...s, source: 'yt', syncChk: 1 }).data.src, 'yt');
  assert.equal(C.songSettingsData({ ...s, syncChk: 1 }).data.chk, 1);
  assert.equal(C.songSettingsData({ ...s, lyrics: '가'.repeat(17000) }).big, true);   // 한글 3바이트 × 17000 > 48KB
  same(C.settingsFromData({ v: 1, lrc: 'a', offset: -99, key: 2.6 }), { lrc: 'a', offset: -30, key: 3, chk: 0 });
  same(C.settingsFromData({ v: 1, lrc: 5, offset: 'x', key: null }), { lrc: '', offset: 0, key: 0, chk: 0 });
  assert.equal(C.settingsFromData({ v: 2 }), null);
  assert.equal(C.settingsFromData({}), null);
  assert.equal(C.settingsHas(C.settingsOf({ lyrics: '  ' })), false);
  assert.equal(C.settingsHas(C.settingsOf({ lyricOffset: 0.5 })), true);
  const rec = C.hubRecord({ mrHash: 'mr-' + 'a'.repeat(40), createdAt: 500, lyrics: 'x' }, 900);
  same(rec, { id: 'mr-' + 'a'.repeat(40), createdAt: 500, updatedAt: 900, deletedAt: null, data: { v: 1, src: 'mr', title: '', artist: '', lrc: 'x', offset: 0, key: 0 } });
  assert.equal(C.hubRecord({ mrHash: 'mr-' + 'a'.repeat(40), createdAt: 2000 }, 900).createdAt, 900);   // 만든 시각이 고친 시각보다 늦으면 고친 시각
});

test('허브 합치기: 나중에 고친 쪽이 이김, 새 기기는 허브 것을 받음, 같으면 안 보냄, 거절된 내용은 다시 안 보냄', () => {
  const k = 'mr-' + 'c'.repeat(40);
  const sig = x => C.settingsSig({ lrc: x, offset: 0, key: 0, chk: 0 });
  const L = o => ({ k, sig: sig('내 가사'), has: true, ...o });
  const R = o => ({ sig: sig('허브 가사'), at: 1000, del: 0, ...o });
  // 같음
  same(C.hubPlan(L({}), R({ sig: sig('내 가사') })), { act: 'same' });
  // 새 기기 (맞춘 적 없음·고친 적 없음): 내용이 있어도 허브 것
  same(C.hubPlan(L({ updatedAt: 5000, createdAt: 5000 }), R({})), { act: 'pull' });
  same(C.hubPlan(L({ has: false, sig: sig('') }), R({})), { act: 'pull' });
  // 새 기기인데 허브에 없음: 내용이 있으면 처음 값을 보냄, 없으면 할 것 없음
  same(C.hubPlan(L({ createdAt: 300, updatedAt: 400 }), null), { act: 'push', at: 400 });
  same(C.hubPlan(L({ has: false, sig: sig('') }), null), { act: 'none' });
  // 맞춘 뒤 이 기기에서 고침: 허브 것보다 늦으면 보냄, 이르면 허브 것
  const synced = { syncK: k, syncSig: sig('옛 가사') };
  same(C.hubPlan(L({ ...synced, settingsAt: 2000 }), R({})), { act: 'push', at: 2000 });
  same(C.hubPlan(L({ ...synced, settingsAt: 900 }), R({})), { act: 'pull' });
  same(C.hubPlan(L({ ...synced, settingsAt: 1000 }), R({})), { act: 'pull' });   // 같은 시각이면 허브 것 (허브도 늦은 것만 받음)
  // 맞춘 뒤 Drive로 가사가 바뀜(설정 고친 시각은 옛것, 곡 고친 시각이 늦음) → 곡 고친 시각으로 보냄
  same(C.hubPlan(L({ ...synced, settingsAt: 500, updatedAt: 3000 }), R({})), { act: 'push', at: 3000 });
  same(C.hubPlan(L({ ...synced, settingsAt: 500, updatedAt: 800 }), R({})), { act: 'pull' });
  // 맞춘 뒤 이 기기는 그대로, 허브가 바뀜 → 허브 것
  same(C.hubPlan(L({ syncK: k, syncSig: sig('내 가사') }), R({})), { act: 'pull' });
  // 다른 열쇠로 맞췄던 곡(MR 파일을 바꿈) + 고친 시각 → 새 열쇠로 보냄
  same(C.hubPlan(L({ syncK: 'mr-' + 'd'.repeat(40), syncSig: sig('내 가사'), settingsAt: 3000 }), null), { act: 'push', at: 3000 });
  // 거절된 내용은 다시 안 보냄, 바뀌면 다시
  same(C.hubPlan(L({ ...synced, settingsAt: 2000, rej: sig('내 가사') }), null), { act: 'none' });
  same(C.hubPlan(L({ ...synced, settingsAt: 2000, rej: sig('더 옛 가사') }), null), { act: 'push', at: 2000 });
  // 지운 표시: 없는 것으로 보고, 다시 보낼 때는 지운 시각보다 늦게
  same(C.hubPlan(L({ createdAt: 300, updatedAt: 400 }), R({ del: 1, at: 1000 })), { act: 'push', at: 1001 });
  same(C.hubPlan(L({ syncK: k, syncSig: sig('내 가사') }), R({ del: 1, at: 1000 })), { act: 'none' });
});

test('허브 사본: 받은 줄을 넣고 받기 위치는 가장 큰 seq, 같은 열쇠는 늦은 것만, 모양이 틀린 줄은 버림', () => {
  const a = 'mr-' + 'a'.repeat(40), b = 'yt-dQw4w9WgXcQ';
  let m = C.hubMirrorAdd(null, [
    { id: a, data: { v: 1, lrc: 'A1' }, created_at: 1, updated_at: 100, deleted_at: null, seq: 7 },
    { id: b, data: { v: 1, lrc: 'B1' }, created_at: 1, updated_at: 50, deleted_at: null, seq: 9 },
    { id: 'bad id!', data: {}, updated_at: 1, seq: 99 }, null, { id: 5 },
  ]);
  assert.equal(m.cursor, 9); assert.equal(m.changed, 2);
  m = C.hubMirrorAdd(m, [{ id: a, data: { v: 1, lrc: 'A0' }, updated_at: 90, seq: 10 }, { id: b, data: {}, updated_at: 60, deleted_at: 60, seq: 11 }]);
  assert.equal(m.cursor, 11); assert.equal(m.songs[a].d.lrc, 'A1'); assert.equal(m.songs[b].del, 1);
  same(C.hubRemote(m.songs[a]), { sig: C.settingsSig({ lrc: 'A1', offset: 0, key: 0, chk: 0 }), at: 100, del: 0, x: { lrc: 'A1', offset: 0, key: 0, chk: 0 } });
  assert.equal(C.hubRemote(m.songs[b]).del, 1);
  assert.equal(C.hubRemote(null), null);
  assert.equal(C.hubMirrorAdd(m, 'not rows').cursor, 11);
});

test('보낼 줄 목록: 열쇠마다 하나(마지막 것), 보낸 열쇠는 빠짐, 모양이 틀린 열쇠는 안 들어감', () => {
  const a = 'mr-' + 'a'.repeat(40), b = 'mr-' + 'b'.repeat(40);
  let q = C.hubQueueAdd(null, a, 1);
  q = C.hubQueueAdd(q, b, 2); q = C.hubQueueAdd(q, a, 3); q = C.hubQueueAdd(q, 'bad key!', 4);
  same(q, [{ k: b, at: 2 }, { k: a, at: 3 }]);
  q = C.hubQueueAdd(q, b, 5, true);
  same(q, [{ k: a, at: 3 }, { k: b, at: 5, del: 1 }]);
  same(C.hubQueueDrop(q, [a]), [{ k: b, at: 5, del: 1 }]);
  same(C.hubQueueDrop('x', [a]), []);
});

test('자동 싱크: LRCLIB에는 제목·가수(첫 이름)·길이만, /api/get이 맞으면 그것, 아니면 검색 결과에서 고르기, 연주곡은 안내', () => {
  same(C.lrclibGetParams('밤편지', 'IU(아이유)', 253.4), { track_name: '밤편지', artist_name: 'IU', duration: '253' });
  same(C.lrclibGetParams(' 밤편지 ', '아이유', null), { track_name: '밤편지', artist_name: '아이유' });
  assert.equal(C.lrclibGetParams('밤편지', '', 200), null);
  assert.equal(C.lrclibGetParams('', '아이유', 200), null);
  const lrc = '[00:01.00]첫 줄\n[00:05.00]둘째 줄';
  same(C.autoSyncPick({ syncedLyrics: lrc, duration: 200 }, null, { title: '밤편지', artist: '아이유', mrDur: 201 }), { lrc, from: 'get' });
  same(C.autoSyncPick({ syncedLyrics: lrc, duration: 200 }, null, { title: '밤편지', artist: '아이유', mrDur: 230 }), { why: 'none' });
  same(C.autoSyncPick({ plainLyrics: '가사만', syncedLyrics: null }, null, {}), { why: 'none' });
  same(C.autoSyncPick({ instrumental: true }, null, {}), { why: 'novoice' });
  const found = [{ id: 1, trackName: '밤편지', artistName: '아이유', duration: 253, syncedLyrics: lrc }];
  same(C.autoSyncPick(null, found, { title: '밤편지', artist: '아이유', mrDur: 252 }), { lrc, from: 'search' });
  same(C.autoSyncPick(null, found, { title: '밤편지', artist: '아이유', mrDur: 300 }), { why: 'none' });
  same(C.autoSyncPick(null, [], { title: '밤편지', artist: '아이유', mrDur: 252 }), { why: 'none' });
  assert.equal(C.canAutoSync({ title: '곡', lyrics: '' }), true);
  assert.equal(C.canAutoSync({ title: '곡', lyrics: '가사만 있음' }), true);
  assert.equal(C.canAutoSync({ title: '곡', lyrics: lrc }), false);
  assert.equal(C.canAutoSync({ demo: true, title: '데모' }), false);
  assert.equal(C.canAutoSync({ title: ' ' }), false);
});

/* ---------------- 손님 방 (CR-228) ---------------- */
const HU = 'https://' + 'qafakehub' + '0'.repeat(11) + '.supabase.co', HK = 'sb_publishable_' + 'qa'.repeat(12);
const HCODE = C.hubCodeMake(HU, HK);
const GID = 'g'.repeat(22);
const seqRng = start => { let n = start; return { getRandomValues: b => { for (let i = 0; i < b.length; i++) b[i] = (n + i * 7) & 255; n++; return b; } }; };

test('손님 방 이름: 32바이트(256비트) → nbr- + 43자, 열 때마다 새 이름 (같은 이름 없음)', () => {
  const a = C.guestRoomName(), b = C.guestRoomName();
  assert.match(a, /^nbr-[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  const many = new Set(Array.from({ length: 200 }, () => C.guestRoomName()));
  assert.equal(many.size, 200);
  // 난수 32바이트를 다 쓴다: 바이트 하나만 달라도 이름이 다르다
  assert.notEqual(C.guestRoomName(seqRng(1)), C.guestRoomName(seqRng(2)));
  assert.match(C.guestId(), /^[A-Za-z0-9_-]{22}$/);
});

test('손님 QR 주소: guest.html#r=…&c=… · 값은 # 뒤에만 · ? 0개 · 틀린 값이면 null', () => {
  const room = C.guestRoomName();
  const u = C.guestUrl('https://example.test/yt-noraebang/index.html?tv=1#hub=x', room, HCODE);
  assert.equal(u, 'https://example.test/yt-noraebang/guest.html#r=' + room + '&c=' + HCODE);
  assert.equal(u.includes('?'), false);
  assert.equal(u.split('#').length, 2);
  assert.equal(u.split('#')[0].includes(room), false);
  assert.equal(u.split('#')[0].includes('supabase'), false);
  assert.equal(C.guestUrl('http://127.0.0.1:5173/', room, HCODE), 'http://127.0.0.1:5173/guest.html#r=' + room + '&c=' + HCODE);
  assert.equal(C.guestUrl('https://example.test/', 'nbr-짧음', HCODE), null);
  assert.equal(C.guestUrl('https://example.test/', room, 'nbhub1.틀림'), null);
  assert.equal(C.guestUrl('file:///C:/x/index.html', room, HCODE), null);
  // 손님 폰이 읽기
  const p = C.guestUrlParse('#' + u.split('#')[1]);
  same(p, { ok: true, room, u: HU, k: HK });
  same(C.guestUrlParse('#r=' + room), { ok: false });
  same(C.guestUrlParse('#r=nbr-abc&c=' + HCODE), { ok: false });
  same(C.guestUrlParse(''), { ok: false });
  same(C.guestUrlParse('#r=' + room + '&c=' + C.hubCodeMake(HU, 'sb_secret_' + 'x'.repeat(20))), { ok: false });
});

test('손님 메시지 확인 guestMsgOk: 모르는 종류·4KB 넘음·번호 없음·키 범위 밖은 버림', () => {
  const m = o => ({ v: 1, gid: GID, seq: 1, ...o });
  assert.equal(C.guestMsgOk(m({ t: 'hello' })), true);
  assert.equal(C.guestMsgOk(m({ t: 'hello', nick: '손님1' })), true);
  assert.equal(C.guestMsgOk(m({ t: 'search', q: '밤', kind: 'mr' })), true);
  assert.equal(C.guestMsgOk(m({ t: 'reserve', no: 10001 })), true);
  assert.equal(C.guestMsgOk(m({ t: 'reserve', ytId: 'abcdefghijk' })), true);
  assert.equal(C.guestMsgOk(m({ t: 'unreserve', rid: 'r'.repeat(22) })), true);
  assert.equal(C.guestMsgOk(m({ t: 'key', k: -2 })), true);
  assert.equal(C.guestMsgOk(m({ t: 'key', k: 2 })), true);
  assert.equal(C.guestMsgOk(m({ t: 'bye' })), true);
  // 이상한 종류·모양
  for (const bad of [null, 'hello', [], {}, m({ t: 'start' }), m({ t: 'cancel' }), m({ t: 'profile' }), m({ t: 'eval' }), m({ t: '__proto__' }),
    { ...m({ t: 'hello' }), v: 2 }, { ...m({ t: 'hello' }), gid: 'x' }, { ...m({ t: 'hello' }), gid: 'g'.repeat(40) }, { ...m({ t: 'hello' }), seq: -1 }, { ...m({ t: 'hello' }), seq: 1.5 }])
    assert.equal(C.guestMsgOk(bad), false, JSON.stringify(bad));
  // 4KB 넘음
  assert.equal(C.guestMsgOk(m({ t: 'search', q: '가', pad: 'x'.repeat(4100) })), false);
  assert.equal(C.guestMsgOk(m({ t: 'hello', pad: '가'.repeat(1400) })), false);   // 글자 수는 적어도 바이트로 4KB 넘음
  // 번호 없음·틀린 번호
  for (const o of [{ t: 'reserve' }, { t: 'reserve', no: '10001' }, { t: 'reserve', no: 0 }, { t: 'reserve', no: 1.5 }, { t: 'reserve', no: 1e7 },
    { t: 'reserve', no: 10001, ytId: 'abcdefghijk' }, { t: 'reserve', ytId: 'abc' }, { t: 'reserve', ytId: 'abcdefghij<' }])
    assert.equal(C.guestMsgOk(m(o)), false, JSON.stringify(o));
  // 키 범위 밖
  for (const k of [3, -3, 6, 0.5, '1', null]) assert.equal(C.guestMsgOk(m({ t: 'key', k })), false, String(k));
  // 이름 10자까지 · 제어 문자 없음 · 검색어 60자까지
  assert.equal(C.guestMsgOk(m({ t: 'hello', nick: '가'.repeat(10) })), true);
  assert.equal(C.guestMsgOk(m({ t: 'hello', nick: '가'.repeat(11) })), false);
  assert.equal(C.guestMsgOk(m({ t: 'hello', nick: 'a\nb' })), false);
  assert.equal(C.guestMsgOk(m({ t: 'hello', nick: 3 })), false);
  assert.equal(C.guestMsgOk(m({ t: 'search', q: 'a'.repeat(61) })), false);
  assert.equal(C.guestMsgOk(m({ t: 'search', q: '밤', kind: 'drive' })), false);
  assert.equal(C.guestMsgOk(m({ t: 'unreserve', rid: '../x' })), false);
});

test('손님 속도 제한: 한 사람 1초에 4개까지, 1초 지나면 다시', () => {
  const log = [];
  assert.deepEqual([0, 100, 200, 300, 400].map(t => C.guestRateOk(log, t)), [true, true, true, true, false]);
  assert.equal(C.guestRateOk(log, 999), false);
  assert.equal(C.guestRateOk(log, 1000), true);
  assert.equal(C.guestRateOk(log, 1100), true);
  assert.equal(C.guestRateOk([], 0, 30), true);
  assert.equal(C.GUEST_MAX, 6); assert.equal(C.GUEST_PER_SEC, 4); assert.equal(C.GUEST_MAX_BYTES, 4096);
});

test('손님 검색 답: 번호·제목·가수·종류만, 30개까지, 곡 창고 곡 수', () => {
  const songs = Array.from({ length: 40 }, (_, i) => ({ id: 's' + i, no: 20001 + i, title: (i % 2 ? '시험 바다 ' : '시험 하늘 ') + i, artist: 'QA 가수', lyrics: '지어낸 가사', blob: {}, fileId: 'f', video: i === 3 }));
  songs.push({ id: 'del', no: 30000, title: '시험 바다 지움', deleted: true });
  const r = C.guestSearchResult(songs, '시험');
  assert.equal(r.total, 40); assert.equal(r.n, 40); assert.equal(r.items.length, 30);
  same(Object.keys(r.items[0]).sort(), ['artist', 'kind', 'no', 'title']);
  assert.equal(r.items.find(x => x.no === 20004).kind, 'video');
  assert.equal(r.items.find(x => x.no === 20001).kind, 'mr');
  const b = C.guestSearchResult(songs, '바다');
  assert.equal(b.n, 20); assert.equal(b.items.every(x => /바다/.test(x.title)), true);
  same(C.guestSearchResult(songs, '20005').items.map(x => x.no), [20005]);
  assert.equal(C.guestSearchResult([{ id: 'y', no: 1, title: '유튜브 곡', source: 'yt', ytId: 'abcdefghijk' }], '').items[0].kind, 'yt');
  assert.equal(JSON.stringify(r).includes('지어낸 가사'), false);
});

test('손님 예약 짝짓기·상태: 예약 표만, 누가 넣었는지는 안 감 · 제목 10개 · 뒤의 손님 예약은 rest', () => {
  const songs = { a: { id: 'a', no: 1, title: '시험 가', artist: 'QA' }, b: { id: 'b', no: 2, title: '시험 나', artist: 'QA' }, c: { id: 'c', no: 3, title: '시험 다', artist: '', ytId: 'abcdefghijk', source: 'yt' } };
  const R1 = 'r'.repeat(22), R2 = 's'.repeat(22), R3 = 't'.repeat(22);
  const res = [{ rid: R1, gid: GID, id: 'a', nick: '손님1' }, { rid: R2, gid: 'h'.repeat(22), id: 'b', nick: '' }, { rid: R3, gid: GID, id: 'x', nick: '' }];
  const queue = ['a', 'b', 'a'];
  const map = C.guestQueueMap(queue, res);
  same(map.at.map(r => r && r.rid), [null, R2, R1]);   // 같은 곡 a가 둘이면 뒤쪽이 손님 예약
  same(map.live.map(r => r.rid), [R1, R2]);            // 짝이 없는 R3(이미 불렀음)는 빠짐
  const st = C.guestStateMsg({ now: songs.c, playing: true, t: 12.4, d: 200.6, key: 1, keyOk: false, queue, songOf: id => songs[id], map, keyOn: true, yt: false });
  same(st.now, { title: '시험 다', artist: '', kind: 'yt', playing: true, t: 12, d: 201, key: 1, keyOk: false });
  same(st.q, [{ title: '시험 가', artist: 'QA', kind: 'mr' }, { title: '시험 나', artist: 'QA', kind: 'mr', r: R2 }, { title: '시험 가', artist: 'QA', kind: 'mr', r: R1 }]);
  assert.equal(st.n, 3); assert.equal(st.v, 1); assert.equal(st.t, 'state');
  const text = JSON.stringify(st);
  assert.equal(text.includes(GID), false); assert.equal(text.includes('손님1'), false); assert.equal(text.includes('"no"'), false);
  // 12곡: 앞 10개만 제목, 11번째 뒤 손님 예약은 표만
  const q12 = Array.from({ length: 12 }, (_, i) => i < 11 ? 'a' : 'b');
  const m12 = C.guestQueueMap(q12, [{ rid: R2, gid: GID, id: 'b', nick: '' }]);
  const s12 = C.guestStateMsg({ now: null, queue: q12, songOf: id => songs[id], map: m12, keyOn: false, yt: true });
  assert.equal(s12.q.length, 10); same(s12.rest, [R2]); assert.equal(s12.now, null); assert.equal(s12.n, 12); assert.equal(s12.yt, true);
});
