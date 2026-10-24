// 브라우저 없이 js/util.js + js/core.js를 불러온다. 두 파일은 브라우저용 일반 스크립트라서
// 같은 vm 컨텍스트에서 차례로 실행하고, 필요한 이름들을 꺼내 쓴다.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const NAMES = ['fmtMs', 'norm', 'chosung', 'pick', 'parseLyrics', 'toLRC', 'searchIn', 'SONG_FIELDS', 'REC_FIELDS',
  'mergeRemoteInto', 'mergeProfileLists', 'renumberDuplicates', 'buildLibrary', 'librarySig', 'packBackup', 'unpackBackup', 'BK_MAGIC', 'titleFromFilename', 'songsFromFolderFiles'];

function loadCore() {
  const ctx = vm.createContext({ console, Blob, TextEncoder, TextDecoder, DataView, Uint8Array, crypto: globalThis.crypto });
  for (const f of ['util.js', 'core.js']) {
    const file = path.join(__dirname, '..', 'js', f);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }
  return vm.runInContext(`({ ${NAMES.join(', ')} })`, ctx);
}

// vm 안에서 만든 객체는 프로토타입이 달라서, 비교할 때는 평범한 JSON 값으로 바꾼다
const plain = x => JSON.parse(JSON.stringify(x));

module.exports = { loadCore, plain };
