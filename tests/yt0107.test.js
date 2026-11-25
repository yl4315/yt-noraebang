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
