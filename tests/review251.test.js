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
