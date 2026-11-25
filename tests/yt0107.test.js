// CR-251 YT-07(인터넷 탓에 못 튼 예약곡 건너뛰기) · YT-01(노래방에서 안 틀어지는 영상 기억) 순수 로직 테스트: node --test tests/
// core.test.js·load-core.js와 따로 둔다 (같은 때 다른 가지가 그 두 파일을 고칠 수 있어서). 불러오는 방법은 load-core.js와 같다
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(names) {
  const ctx = vm.createContext({ console, Blob, TextEncoder, TextDecoder, DataView, Uint8Array, URLSearchParams, URL, crypto: globalThis.crypto, atob, btoa });
  for (const f of ['util.js', 'core.js']) {
    const file = path.join(__dirname, '..', 'js', f);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }
  return vm.runInContext(`({ ${names.join(', ')} })`, ctx);
}
const plain = x => JSON.parse(JSON.stringify(x));
const C = load(['ytErrLines', 'ytNetSkips']);

test('못 트는 유튜브 곡 안내 두 줄 (YT-07): 인터넷 탓 두 가지는 건너뛸 때 "못 틀어서 건너뛰어요"', () => {
  // 손으로 고른 곡 (예전 글 그대로)
  assert.deepEqual(plain(C.ytErrLines('offline', false)), { head: '인터넷이 끊겨서 유튜브 곡을 틀 수 없어요', why: '인터넷이 다시 되면 곡을 다시 골라 주세요' });
  assert.deepEqual(plain(C.ytErrLines('api', false)), { head: '유튜브 플레이어를 불러오지 못했어요', why: '인터넷 연결을 확인하고 곡을 다시 골라 주세요' });
  // 예약 차례로 저절로 시작한 곡 → 3초 뒤 다음 곡
  const skip = '못 틀어서 건너뛰어요 · 인터넷이 되면 이 곡을 다시 골라 주세요';
  assert.deepEqual(plain(C.ytErrLines('offline', true)), { head: '인터넷이 끊겨서 유튜브 곡을 틀 수 없어요', why: skip });
  assert.deepEqual(plain(C.ytErrLines('api', true)), { head: '유튜브 플레이어를 불러오지 못했어요', why: skip });
  // 영상 오류는 건너뛰어도 글이 같다 (예전부터 다음 곡 카드가 3초를 셈)
  for (const sk of [false, true]) {
    assert.deepEqual(plain(C.ytErrLines(150, sk)), { head: '이 영상은 노래방에서 틀 수 없어요', why: '올린 사람이 다른 곳에서 틀지 못하게 막았어요' });
    assert.equal(C.ytErrLines(101, sk).why, '올린 사람이 다른 곳에서 틀지 못하게 막았어요');
    assert.equal(C.ytErrLines(100, sk).why, '지워졌거나 비공개인 영상이에요');
    assert.equal(C.ytErrLines(2, sk).why, '영상 주소가 잘못됐어요');
    assert.equal(C.ytErrLines(5, sk).why, '이 브라우저에서 틀 수 없는 영상이에요');
    assert.equal(C.ytErrLines(153, sk).why, '유튜브가 이 화면 주소를 확인하지 못했어요');
    assert.equal(C.ytErrLines(999, sk).why, '유튜브 오류 (999)');
  }
});

test('인터넷 탓에 못 튼 곡을 건너뛸까 (YT-07): 예약 차례로 시작한 그 곡 · 싱크 편집 아님 · 다음 예약곡 있음', () => {
  const a = { id: 'a' }, b = { id: 'b' };
  assert.equal(C.ytNetSkips(a, a, false, 2), true);
  assert.equal(C.ytNetSkips(a, a, false, 1), true);
  assert.equal(C.ytNetSkips(a, a, false, 0), false, '다음 예약곡이 없으면 안내만');
  assert.equal(C.ytNetSkips(null, a, false, 3), false, '손으로 고른 곡은 안내만');
  assert.equal(C.ytNetSkips(b, a, false, 3), false, '다른 곡이 예약 차례였으면 (그사이 손으로 바꿈) 안내만');
  assert.equal(C.ytNetSkips(a, a, true, 3), false, '싱크 편집 중에는 넘어가지 않음');
  assert.equal(C.ytNetSkips(null, null, false, 3), false);
});

const D = load(['ytBlockCode', 'ytBlocked', 'YT_BLOCK_TAG', 'ytSkipText', 'guestSkipText', 'guestSearchResult', 'guestStateMsg', 'guestQueueMap', 'myCleanSongs']);
const yt = (id, extra = {}) => ({ id, no: 30000 + id.length, title: `유튜브 ${id}`, artist: '가수', source: 'yt', ytId: 'abcdefghij' + id.slice(-1), ...extra });

test('노래방에서 안 틀어지는 영상 기억 (YT-01): 100·101·150만 · 유튜브 곡만', () => {
  for (const c of [100, 101, 150]) assert.equal(D.ytBlockCode(c), true, `오류 ${c}`);
  for (const c of [2, 5, 153, 'offline', 'api', null, undefined, '150', 0]) assert.equal(D.ytBlockCode(c), false, `오류 ${c}는 다시 하면 될 수 있어서 적지 않음`);
  assert.equal(D.ytBlocked(yt('a', { ytBlocked: 150 })), true);
  assert.equal(D.ytBlocked(yt('b', { ytBlocked: 100 })), true);
  assert.equal(D.ytBlocked(yt('c')), false, '표시 없는 유튜브 곡');
  assert.equal(D.ytBlocked(yt('d', { ytBlocked: 5 })), false, '적지 않는 번호');
  assert.equal(D.ytBlocked({ id: 'm', no: 1, title: 'MR', ytBlocked: 150 }), false, '내 MR 곡에는 표시하지 않음');
  assert.equal(D.ytBlocked(null), false);
  assert.equal(D.YT_BLOCK_TAG, '노래방에서 안 틀어짐');
});

test('건너뛸 때 알림 글 (YT-01): 노래방 화면 · 손님 폰', () => {
  assert.equal(D.ytSkipText({ no: 30012, title: '첫눈' }), '30012 첫눈 · 노래방에서 안 틀어져서 건너뛰었어요');
  assert.equal(D.guestSkipText('첫눈'), '첫눈 곡은 노래방에서 안 틀어져서 넘어갔어요');
  assert.equal(D.guestSkipText('  첫  눈 \n'), '첫 눈 곡은 노래방에서 안 틀어져서 넘어갔어요', '빈칸 정리');
  assert.equal(D.guestSkipText(''), '예약한 곡은 노래방에서 안 틀어져서 넘어갔어요');
  assert.equal(D.guestSkipText(undefined), '예약한 곡은 노래방에서 안 틀어져서 넘어갔어요');
});

test('표시가 손님 화면·내 폰 리모컨으로 가는 칸 (YT-01): blocked:true는 그런 곡에만', () => {
  const songs = [yt('a', { no: 30001, title: '시험 막힘', ytBlocked: 101 }), yt('b', { no: 30002, title: '시험 됨' }), { id: 'm', no: 10002, title: '시험 MR', artist: '' }];
  const r = D.guestSearchResult(songs, '시험');
  const by = Object.fromEntries(r.items.map(x => [x.no, x]));
  assert.equal(by[30001].blocked, true);
  assert.equal('blocked' in by[30002], false, '안 막힌 곡에는 칸이 없음 (예전 손님 화면 그대로)');
  assert.deepEqual(Object.keys(by[10002]).sort(), ['artist', 'kind', 'no', 'title']);
  const of = Object.fromEntries(songs.map(s => [s.id, s]));
  const q = ['a', 'b', 'm'], map = D.guestQueueMap(q, [{ rid: 'r1', gid: 'g1', id: 'a', nick: '손님' }]);
  const st = D.guestStateMsg({ now: null, queue: q, songOf: id => of[id], map, keyOn: false, yt: true });
  assert.equal(st.q[0].blocked, true);
  assert.equal(st.q[0].r, 'r1');
  assert.equal('blocked' in st.q[1], false);
  assert.equal('blocked' in st.q[2], false);
  // 내 폰 리모컨 곡 목록: blocked는 true일 때만 남고, 다른 값은 버림
  assert.deepEqual(plain(D.myCleanSongs([{ id: 'a', no: 1, title: 't', artist: 'r', video: false, local: true, blocked: true }, { id: 'b', no: 2, title: 'u', artist: '', blocked: 'yes' }])),
    [{ id: 'a', no: 1, title: 't', artist: 'r', video: false, local: true, blocked: true }, { id: 'b', no: 2, title: 'u', artist: '', video: false, local: false }]);
});
