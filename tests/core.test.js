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
