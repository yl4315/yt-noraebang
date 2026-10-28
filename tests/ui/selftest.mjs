// 화면 자동 점검(CR-019)이 고장을 정말 잡는지 보는 시험: node tests/ui/selftest.mjs
// 앱 파일을 임시 폴더에 복사해 일부러 3군데를 고장 낸 뒤(저장소는 안 고침) 그 사본을 점검하고,
// 고장 낸 번호가 "실패"로 나오는지 본다. 끝나면 사본을 지운다.
//   ① 단축키 하나 빼기: C(인기차트)  → M4·M10·I9 실패
//   ② 창 ✕ 버튼 숨기기: 곡 검색 ✕   → I12 실패
//   ③ 데모곡 번호 바꾸기: 10001 → 10009 → S1·S4 실패
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-ui-broken-'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-ui-selftest-'));
const files = ['index.html', 'remote.html', 'server.py', 'sw.js', 'manifest.webmanifest', 'remote.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'css', 'js'];
for (const f of files) fs.cpSync(path.join(REPO, f), path.join(copy, f), { recursive: true });
const edit = (f, from, to) => {
  const p = path.join(copy, f), s = fs.readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`${f}에서 고칠 곳을 못 찾음: ${from}`);
  fs.writeFileSync(p, s.replace(from, to));
};
edit('js/karaoke.js', "else if (is('c', 'C', 'ㅊ')) openChart();", 'else if (false) openChart();');
fs.appendFileSync(path.join(copy, 'css', 'app.css'), '\n#searchClose{display:none !important}\n');
edit('js/main.js', "no: 10001, title: '작은 방의 노래'", "no: 10009, title: '작은 방의 노래'");
console.log(`고장 낸 사본: ${copy}`);
let code = 1;
try {
  try {
    execFileSync(process.execPath, [path.join(HERE, 'run.mjs'), '--root', copy, '--checks', 'basics,songs,reserve,keys', '--out', out], { stdio: 'inherit', cwd: REPO });
  } catch { /* 실패가 나와야 정상 (종료 코드 1) */ }
  const res = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
  const st = Object.fromEntries(res.features.map(f => [f.id, f.status]));
  const want = { '① 단축키 C 빼기': ['M4', 'M10', 'I9'], '② 곡 검색 ✕ 숨기기': ['I12'], '③ 데모곡 번호 10009': ['S1', 'S4'] };
  console.log('\n고장을 잡았나:');
  let all = true;
  for (const [k, ids] of Object.entries(want)) {
    const caught = ids.filter(id => st[id] === 'fail');
    console.log(`  ${caught.length === ids.length ? '잡음' : '못 잡음'} ${k}: ${ids.map(id => `${id}=${st[id]}`).join(' ')}`);
    if (caught.length !== ids.length) all = false;
  }
  console.log(all ? '\n결과: 고장 3가지를 모두 잡았어요' : '\n결과: 못 잡은 고장이 있어요');
  console.log(`점검 결과표: ${path.join(out, 'results.md')}`);
  code = all ? 0 : 1;
} finally {
  fs.rmSync(copy, { recursive: true, force: true });
}
process.exit(code);
