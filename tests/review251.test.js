// CR-251 검토 고침 (YT-r1·r12 …) 순수 로직 테스트: node --test tests/
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
const C = load(['remotePollNext']);

test('옛 폰 리모컨 받아 오기 (YT-r12): 서버를 껐다 켜면 번호를 0으로 돌리고, 그 답의 명령은 실행하지 않는다', () => {
  // 처음: 표를 기억하고 번호를 따라감
  assert.deepEqual(plain(C.remotePollNext({ since: 0, boot: null }, { last: 3, boot: 'aaaa0001' })), { since: 3, boot: 'aaaa0001', restarted: false });
  assert.deepEqual(plain(C.remotePollNext({ since: 3, boot: 'aaaa0001' }, { last: 5, boot: 'aaaa0001' })), { since: 5, boot: 'aaaa0001', restarted: false });
  // 다시 켬: 번호가 줄었음 (옛 서버라 표가 없어도)
  assert.deepEqual(plain(C.remotePollNext({ since: 57, boot: null }, { last: 2 })), { since: 0, boot: null, restarted: true });
  // 다시 켬: 표가 바뀜 (번호가 더 커도)
  assert.deepEqual(plain(C.remotePollNext({ since: 1, boot: 'aaaa0001' }, { last: 4, boot: 'bbbb0002' })), { since: 0, boot: 'bbbb0002', restarted: true });
  // 다시 켠 뒤 처음부터 받기 → 다음 번은 보통
  assert.deepEqual(plain(C.remotePollNext({ since: 0, boot: 'bbbb0002' }, { last: 4, boot: 'bbbb0002' })), { since: 4, boot: 'bbbb0002', restarted: false });
  // 이상한 답은 번호를 그대로
  assert.deepEqual(plain(C.remotePollNext({ since: 7, boot: 'aaaa0001' }, { last: 'x' })), { since: 7, boot: 'aaaa0001', restarted: false });
  assert.deepEqual(plain(C.remotePollNext(null, null)), { since: 0, boot: null, restarted: false });
});

test('소리 메모리 비우기 (YT-r1): 지금 곡·다음 예약 곡·녹음 중인 곡·데모를 뺀, 소리를 풀어 둔 곡만 놓을 곡으로', () => {
  const { songBuffersToFree } = load(['songBuffersToFree']);
  const buf = {}, a = { id: 'a', buffer: buf }, b = { id: 'b', buffer: buf }, c = { id: 'c', buffer: buf }, d = { id: 'demo', demo: true, buffer: buf }, e = { id: 'e', buffer: null };
  const ids = (list) => list.map(s => s.id).join(',');
  assert.equal(ids(songBuffersToFree([a, b, c, d, e], [a])), 'b,c');               // 데모·안 풀린 곡은 빼고
  assert.equal(ids(songBuffersToFree([a, b, c, d, e], [a, 'b'])), 'c');            // 다음 예약 곡은 id로
  assert.equal(ids(songBuffersToFree([a, b, c, d, e], [a, 'b', c])), '');          // 녹음 중인 곡
  assert.equal(ids(songBuffersToFree([a, b], [a, undefined, false, null])), 'b');  // 예약이 비었음·녹음 안 함
  assert.equal(ids(songBuffersToFree(null, null)), '');
});

test('최근 것만 두는 Map (YT-r1, 녹음 미리듣기 캐시): 넣거나 다시 쓰면 맨 뒤로, max개를 넘으면 가장 오래 안 쓴 것부터 뺀다', () => {
  const { lruSet } = load(['lruSet']);
  const m = new Map();
  lruSet(m, 'r1', 1, 2); lruSet(m, 'r2', 2, 2); lruSet(m, 'r3', 3, 2);
  assert.deepEqual([...m.keys()], ['r2', 'r3']);
  lruSet(m, 'r2', 2, 2); lruSet(m, 'r4', 4, 2);                                   // r2를 다시 썼으니 r3이 빠짐
  assert.deepEqual([...m.keys()], ['r2', 'r4']);
  assert.equal(m.get('r4'), 4);
  lruSet(m, 'r5', 5, 0);                                                           // 0·이상한 값이어도 1개는 둔다
  assert.deepEqual([...m.keys()], ['r5']);
});

test('녹음 저장 알림 (YT-r11 = YT-16): 녹음 백업이 꺼져 있으면 "이 기기에만 있어요 · 백업 켜기", 켜져 있으면 예전 글 그대로', () => {
  const { recSavedText } = load(['recSavedText']);
  assert.equal(recSavedText('곡', '0:05', false), "녹음 저장됨 · 곡 (0:05) · 이 기기에만 있어요 · 백업 켜기: 설정 › 곡 창고 · 박자가 어긋나면 '싱크·믹스 조절'에서 고치세요");
  assert.equal(recSavedText('곡', '0:05', true), "녹음 저장됨 · 곡 (0:05) · 박자가 어긋나면 '싱크·믹스 조절'에서 고치세요");
});

test('녹음 줄 "백업 안 됨" 표 (YT-16): 백업이 꺼져 있고 Drive에 없는 녹음만', () => {
  const { recBackupMissing } = load(['recBackupMissing']);
  assert.equal(recBackupMissing({ id: 'a' }, false), true);
  assert.equal(recBackupMissing({ id: 'a', fileId: 'f1' }, false), false);   // 이미 Drive에 있음
  assert.equal(recBackupMissing({ id: 'a' }, true), false);                  // 백업 켬 (다음 동기화 때 올라감)
  assert.equal(recBackupMissing(null, false), false);
});
