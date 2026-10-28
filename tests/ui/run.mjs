// 화면 자동 점검 (CR-019): npm run test:ui
// 빈 시험 프로필의 헤드리스 Edge가 시험 서버에서 노래방을 켜고 눌러 본 뒤, 기능 목록 번호마다 결과표와 스크린샷을 남긴다.
//   npm run test:ui                      전부 (결과는 PC 임시 폴더)
//   npm run test:ui -- --out <폴더>       결과·스크린샷 둘 곳 (앱 저장소 안은 tests/ui/out만 됨: 공개 저장소라서)
//   npm run test:ui -- --only L,M         그 구역만 점검 (나머지 번호는 "건너뜀")
//   npm run test:ui -- --shots            스크린샷만
//   npm run test:ui -- --compare <폴더>   예전 결과 폴더의 스크린샷과 화소 비교 (바뀐 사진 목록)
//   npm run test:ui -- --root <폴더>      다른 폴더(예: 일부러 고장 낸 사본)를 점검
// CEO 데이터와 섞이지 않게: 매번 새 빈 Edge 프로필, 5173이 아닌 빈 포트, 리모컨 코드 파일은 임시 폴더,
// Google·Drive 요청은 막고 가사 서버(lrclib.net)는 가짜 답. 끝나면 Edge·서버·임시 폴더를 지우고
// 저장소 git status와 .remote.json이 그대로인지 본다.
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchEdge, ourEdgeProcesses, killPids, sleep, findEdge, timing } from './edge.mjs';
import { makeFixtures } from './fixtures.mjs';
import { compareShots } from './compare.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const T0 = Date.now();
const secs = () => ((Date.now() - T0) / 1000).toFixed(1);

/* ---------------- 옵션 ---------------- */
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
const OUT = path.resolve(opt('--out') || path.join(os.tmpdir(), 'yt-noraebang-ui', stamp));
const ONLY = opt('--only') ? opt('--only').toUpperCase().split(/[,\s]+/).filter(Boolean) : null;
const SHOTS_ONLY = argv.includes('--shots');
const COMPARE = opt('--compare') ? path.resolve(opt('--compare')) : null;
const ROOT = path.resolve(opt('--root') || REPO);
const CHECKS = opt('--checks') ? opt('--checks').split(',') : null;   // 개발용: 점검 파일 몇 개만 (예: --checks basics,tv). 스크린샷은 건너뜀
const inside = (p, dir) => { const r = path.relative(dir, p); return !r.startsWith('..') && !path.isAbsolute(r); };
if (inside(OUT, REPO) && !inside(OUT, path.join(REPO, 'tests', 'ui', 'out'))) {
  console.error(`결과 폴더가 앱 저장소 안이에요: ${OUT}\n앱 저장소는 공개라서 결과·사진을 두지 않아요. 기본(임시 폴더)이나 --out tests/ui/out, 또는 저장소 밖 폴더를 써 주세요.`);
  process.exit(2);
}
const FEATURES = JSON.parse(fs.readFileSync(path.join(HERE, 'features.json'), 'utf8'));

/* ---------------- 결과 모으기 ---------------- */
const R = new Map(FEATURES.features.map(f => [f.id, { f, ok: [], bad: [], skip: [] }]));
const findings = [];        // 점검이 본 앱의 문제 (보고만)
const common = [];          // 공통 점검 (번호 없음): 페이지 오류, 가로 스크롤, 밖으로 나간 요청, 정리
const logLines = [];
const log = (...a) => { const line = `[${secs()}s] ` + a.join(' '); logLines.push(line); console.log(line); };
const conds = { P: null, V: null, O: null, M: null, W: null, S: true, L: true };
const condWhy = {};

const ctx = {
  REPO, ROOT, OUT, shotsDir: path.join(OUT, 'shots'), log, sleep, conds, condWhy,
  /** 기능 번호 확인 기록. cond가 거짓이면 실패 */
  ok(id, cond, detail = '') {
    const r = R.get(id); if (!r) throw new Error('features.json에 없는 번호: ' + id);
    (cond ? r.ok : r.bad).push(detail || (cond ? '확인' : '다름'));
    if (!cond) log(`  ✕ ${id} ${detail}`);
    return !!cond;
  },
  skip(id, why) { R.get(id).skip.push(why); },
  /** 점검하다 본 앱의 문제 (통과·실패와 따로, 고치지 않고 보고만) */
  finding(id, text) { if (!findings.some(x => x.text === text)) findings.push({ id, text }); },
  common(name, cond, detail = '') { common.push({ name, ok: !!cond, detail }); if (!cond) log(`  ✕ [공통] ${name} ${detail}`); return !!cond; },
  /** 한 단계: 안에서 오류가 나면 ids를 실패로 적고 다음 단계로 간다 */
  async step(title, ids, fn) {
    log(`- ${title}`);
    try { await fn(); }
    catch (e) { log(`  ! ${title}: ${e.message}`); for (const id of ids) ctx.ok(id, false, `${title} 중 오류: ${e.message}`); }
  },
  wants(...areas) { return !ONLY || areas.some(a => ONLY.includes(a)); },
  netLog: [], lrcLog: [], lrcRules: [],
};

/* ---------------- 준비: 시작 전 저장소 상태 ---------------- */
function gitStatus() {
  try { return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: REPO, encoding: 'utf8' }); } catch (e) { return 'git status 실패: ' + e.message; }
}
function remoteFileState() {
  const f = path.join(REPO, '.remote.json');
  if (!fs.existsSync(f)) return 'none';
  return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') + ' ' + fs.statSync(f).mtimeMs;
}
const before = { git: gitStatus(), remote: remoteFileState(), rootRemote: ROOT !== REPO && fs.existsSync(path.join(ROOT, '.remote.json')) };

/* ---------------- 서버 ---------------- */
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer(); s.unref();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
async function freePortNot5173() { for (;;) { const p = await freePort(); if (p !== 5173) return p; } }
const procs = new Set();
function startServer(args, label) {
  return new Promise((res, rej) => {
    const pr = spawn('python', [path.join(HERE, 'serve.py'), ...args], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    procs.add(pr);
    let out = '';
    const t = setTimeout(() => rej(new Error(`${label} 서버가 10초 안에 켜지지 않았어요: ${out}`)), 10000);
    pr.stdout.on('data', d => { out += d; if (out.includes('READY')) { clearTimeout(t); res(pr); } });
    pr.stderr.on('data', d => { out += d; });
    pr.on('exit', code => { procs.delete(pr); if (!out.includes('READY')) { clearTimeout(t); rej(new Error(`${label} 서버가 꺼졌어요 (${code}): ${out}`)); } });
  });
}
async function stopServer(pr) {
  if (!pr || pr.exitCode !== null) return;
  try { pr.stdin.end(); } catch {}
  for (let i = 0; i < 20 && pr.exitCode === null; i++) await sleep(100);
  if (pr.exitCode === null) { try { execFileSync('taskkill', ['/PID', String(pr.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
  procs.delete(pr);
}

/* ---------------- 밖으로 나가는 요청: 허용 / 가짜 답 / 막기 ---------------- */
const ALLOW = /^(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com)$/;
// 가로챌 바깥 주소: 허용(글꼴·QR), 가짜 답(가사 서버), 막음(Google 로그인·Drive). 그 밖은 Edge가 이름 찾기부터 실패한다 (edge.mjs)
const ROUTED = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'lrclib.net', 'accounts.google.com', 'www.googleapis.com', 'oauth2.googleapis.com', 'apis.google.com'];
const LOCAL = /^(127\.0\.0\.1|localhost)$/;
function makeRouter(page) {
  return async p => {
    const u = new URL(p.request.url);
    if (u.protocol === 'data:' || u.protocol === 'blob:' || LOCAL.test(u.hostname)) return { continue: true };
    if (page.isOffline) { ctx.netLog.push({ kind: '끊김 흉내', url: u.origin + u.pathname }); return { fail: 'InternetDisconnected' }; }
    if (u.hostname === 'lrclib.net') {
      const q = u.searchParams.get('q') || '';
      // 규칙: { q: 정규식, status, body, delay, neterr, times(이 횟수만 쓰고 빠짐) } — 먼저 맞는 규칙
      const rule = ctx.lrcRules.find(r => new RegExp(r.q).test(q)) || { status: 200, body: [] };
      if (rule.times != null && --rule.times <= 0) ctx.lrcRules.splice(ctx.lrcRules.indexOf(rule), 1);
      ctx.lrcLog.push({ q, status: rule.neterr ? 'neterr' : rule.status || 200 });
      ctx.netLog.push({ kind: '가짜 답', url: u.origin + u.pathname + '?q=' + q });
      if (rule.neterr) return { fail: 'InternetDisconnected' };
      return { fulfill: { status: rule.status || 200, body: rule.body ?? [], delay: rule.delay } };
    }
    if (ALLOW.test(u.hostname)) {
      // 글꼴·QR 라이브러리: 점검이 한 번만 받아 두고 탭마다 그대로 준다 (인터넷이 느려도 화면이 멈추지 않게, 10초 넘으면 없이 간다)
      const r = await cachedFetch(p.request.url, p.request.headers);
      ctx.netLog.push({ kind: '허용', url: u.origin + u.pathname, status: r.status });
      return { fulfill: { status: r.status, body: r.body, headers: { 'content-type': r.type, 'access-control-allow-origin': '*' } } };
    }
    ctx.netLog.push({ kind: '막음', url: u.origin + u.pathname });
    return { fail: 'BlockedByClient' };
  };
}
const extCache = new Map();
function cachedFetch(url, headers = {}) {
  if (!extCache.has(url)) extCache.set(url, (async () => {
    try {
      const pick = Object.fromEntries(Object.entries(headers).filter(([k]) => /^(user-agent|accept)$/i.test(k)));
      const res = await fetch(url, { headers: pick, signal: AbortSignal.timeout(10000) });
      return { status: res.status, type: res.headers.get('content-type') || 'application/octet-stream', body: Buffer.from(await res.arrayBuffer()) };
    } catch (e) { log(`  (밖 파일을 못 받음: ${url.slice(0, 80)} ${e.message})`); return { status: 504, type: 'text/plain', body: Buffer.from('') }; }
  })());
  return extCache.get(url);
}
// 알려진 콘솔 오류 (실패로 세지 않음)
const KNOWN = [
  /ERR_BLOCKED_BY_CLIENT/,                                  // 점검이 막은 Google 로그인·Drive 요청
  /ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|ERR_NETWORK_CHANGED|ERR_FAILED|ERR_NAME_NOT_RESOLVED/,  // 오프라인 흉내·서버 끄기
  /UI점검: 일부러/,                                          // 점검이 일부러 낸 실패 (키 바꾸기 실패 흉내 등)
  /백업 파일/,                                               // 백업 파일이 아닌 파일 불러오기 (일부러)
  /status of 404/,                                         // 정적 서버(리모컨 없음)의 /api/remote/info
  /status of 503/,                                         // 가짜 가사 서버 "바빠요" 답 (일부러)
  /status of 403/,                                         // 휴대폰 리모컨: 바뀐 코드로 보낸 명령 (일부러)
  /AbortError|NotAllowedError: play\(\)/,                  // 영상 재생 끊김 (곡 바꿀 때)
];

/* ---------------- 조건 확인 (첫날 확인 5개를 매번) ---------------- */
async function probeConditions(page) {
  const r = await page.eval(`(async()=>{
    const out={};
    try{ ensureCtx(); await E.ctx.resume(); const a=E.ctx.currentTime; const t0=performance.now(); while(performance.now()-t0<8000 && E.ctx.currentTime-a<0.3) await new Promise(r=>setTimeout(r,100)); out.P=E.ctx.currentTime-a>=0.3; out.Pw='8초 동안 '+(E.ctx.currentTime-a).toFixed(2)+'초'; }catch(e){ out.P=false; out.Pw=e.message }
    try{ const st=await navigator.mediaDevices.getUserMedia({audio:true}); out.M=st.getAudioTracks().length>0; st.getTracks().forEach(t=>t.stop()); }catch(e){ out.M=false; out.Mw=e.name }
    out.V = typeof MediaRecorder==='function' && MediaRecorder.isTypeSupported('video/webm') && !!HTMLCanvasElement.prototype.captureStream;
    out.hover = matchMedia('(hover:hover)').matches;
    return out })()`, 20000);
  conds.P = r.P; if (!r.P) condWhy.P = '반주 시계가 흐르지 않아요 ' + (r.Pw || '');
  conds.M = r.M; if (!r.M) condWhy.M = '가짜 마이크를 켜지 못했어요 ' + (r.Mw || '');
  conds.V = r.V; if (!r.V) condWhy.V = 'MediaRecorder로 시험 동영상을 만들 수 없어요';
  await page.offline(true); await sleep(200);
  conds.O = (await page.eval('navigator.onLine')) === false; if (!conds.O) condWhy.O = '인터넷 끊김 흉내가 navigator.onLine을 바꾸지 못했어요';
  await page.offline(false); await sleep(200);
  try {
    const w = await page.eval(`fetch('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',{cache:'no-store'}).then(r=>r.ok,()=>false)`, 15000);
    conds.W = !!w; if (!w) condWhy.W = 'QR 라이브러리(cdnjs)에 닿지 않아요 (인터넷)';
  } catch (e) { conds.W = false; condWhy.W = e.message; }
  log(`조건: ${Object.entries(conds).map(([k, v]) => `${k}=${v ? '됨' : '안 됨'}`).join(' ')}`);
}

/* ---------------- 결과표 ---------------- */
function finalStatus(r) {
  const f = r.f;
  if (ONLY && !ONLY.includes(f.area)) return { st: 'skip', why: `--only ${ONLY.join(',')} 밖` };
  const condBad = (f.cond || []).filter(c => conds[c] === false);
  const auto = f.cls === 'auto' || f.cls === 'partial' || f.cls === 'device';
  if (condBad.length && auto && !r.bad.length) return { st: 'skip', why: `조건 ${condBad.join('·')} 안 됨: ${condBad.map(c => condWhy[c] || FEATURES.conds[c]).join(' / ')}` };
  if (condBad.length && auto && r.bad.length) return { st: 'skip', why: `조건 ${condBad.join('·')} 안 됨 (그래서 실패 ${r.bad.length}개는 세지 않음): ${r.bad[0]}` };
  if (SHOTS_ONLY && !r.ok.length && !r.bad.length) return { st: 'skip', why: '--shots (스크린샷만)' };
  if (CHECKS && !r.ok.length && !r.bad.length) return { st: 'skip', why: `--checks ${CHECKS.join(',')} 밖` };
  if (r.bad.length && f.known && r.bad.every(b => b.includes(f.known.match))) return { st: 'known', why: `알려진 문제 (${f.known.since}): ${f.known.text} · 이번 결과: ${r.bad.join(' / ')}${r.ok.length ? ' · 나머지 통과: ' + r.ok.join(' / ') : ''}` };
  if (r.bad.length) return { st: 'fail', why: r.bad.join(' / ') };
  if (f.known && r.ok.length) { ctx.finding(f.id, `알려진 문제가 이번에는 통과: 고쳐졌으면 features.json의 known을 지워 주세요`); }
  if (f.cls === 'auto') return r.ok.length ? { st: 'pass', why: r.ok.join(' / ') } : { st: 'fail', why: r.skip.length ? '건너뜀: ' + r.skip.join(' / ') : '자동 점검 줄인데 확인 기록이 없어요 (점검 도구를 확인해 주세요)' };
  if (f.cls === 'partial' && f.autoBy === 'npm test') return { st: 'partial', why: `자동 부분은 npm test: ${f.autoPart} · 사람: ${f.humanPart}` };
  if (f.cls === 'partial') return r.ok.length ? { st: 'partial', why: `자동 통과: ${r.ok.join(' / ')} · 사람: ${f.humanPart}` } : { st: 'fail', why: '일부 자동 줄인데 앞부분 확인 기록이 없어요' };
  if (f.cls === 'device') return { st: 'device', why: r.ok.length ? `앞부분 자동 통과: ${r.ok.join(' / ')}` : (f.autoPart || '') };
  if (f.cls === 'test') return { st: 'test', why: `npm test: ${f.tests}` };
  return { st: 'human', why: f.why };
}
const ST_KO = { pass: '통과', fail: '실패', known: '알려진 문제 (보고함)', skip: '건너뜀', partial: '일부 통과 · 사람 확인', device: '기기 확인 필요', test: '기존 테스트 (npm test)', human: '사람 확인' };
const CLS_KO = { auto: '자동', test: '지금 테스트', partial: '일부 자동', human: '사람', device: '기기' };
const md = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function writeResults({ shots, compare, cleanup, edgeErrors, elapsed, aborted }) {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = FEATURES.features.map(f => { const r = R.get(f.id), s = finalStatus(r); return { id: f.id, area: f.area, cls: f.cls, cond: f.cond || [], status: s.st, detail: s.why, text: f.text }; });
  const count = st => rows.filter(x => x.status === st).length;
  const byCls = {}; for (const x of rows) byCls[x.cls] = (byCls[x.cls] || 0) + 1;
  const commonBad = common.filter(c => !c.ok);
  const failed = count('fail') + commonBad.length + (aborted ? 1 : 0);
  const summary = { ok: failed === 0, elapsedSec: elapsed, total: rows.length, byClass: byCls, byStatus: Object.fromEntries(Object.keys(ST_KO).map(k => [k, count(k)])),
    commonFailed: commonBad.length, slow: timing.slow, conds, condWhy, only: ONLY, shotsOnly: SHOTS_ONLY, root: ROOT, out: OUT, node: process.version, edge: findEdge(), aborted: aborted || null };
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ summary, features: rows, common, findings, shots, compare, cleanup, net: ctx.netLog, lrclib: ctx.lrcLog, pageErrors: edgeErrors }, null, 1));
  const L = [];
  L.push(`# YT 노래방 화면 자동 점검 결과 (CR-019)`, '');
  L.push(`- 결과: **${failed === 0 ? '통과' : `실패 ${failed}개`}** · 걸린 시간 ${elapsed}초 · ${new Date().toLocaleString('ko-KR')}`);
  L.push(`- 점검한 폴더: \`${ROOT}\`${ROOT !== REPO ? ' (저장소가 아닌 사본)' : ''} · Node ${process.version} · Edge \`${findEdge()}\`${timing.slow > 1 ? ` · PC가 바빠서 기다리는 시간 ${timing.slow}배` : ''}`);
  if (ONLY) L.push(`- --only ${ONLY.join(',')}: 그 구역만 점검`);
  if (SHOTS_ONLY) L.push('- --shots: 스크린샷만');
  if (aborted) L.push(`- **점검이 중간에 멈춤**: ${aborted}`);
  L.push(`- 조건: ${Object.entries(conds).map(([k, v]) => `${k} ${FEATURES.conds[k].split(' (')[0]} = ${v === null ? '확인 안 함' : v ? '됨' : '안 됨' + (condWhy[k] ? ` (${condWhy[k]})` : '')}`).join(' · ')}`);
  L.push('', '## 한눈에', '', '| 결과 | 수 |', '|---|---|');
  for (const k of ['pass', 'fail', 'known', 'skip', 'partial', 'device', 'test', 'human']) L.push(`| ${ST_KO[k]} | ${count(k)} |`);
  L.push(`| 합계 | ${rows.length} |`, '', `분류(features.json): ${Object.entries(byCls).map(([k, v]) => `${CLS_KO[k]} ${v}`).join(' · ')}`, '');
  L.push('## 공통 점검', '', '| 점검 | 결과 | 내용 |', '|---|---|---|');
  for (const c of common) L.push(`| ${md(c.name)} | ${c.ok ? '통과' : '**실패**'} | ${md(c.detail)} |`);
  if (findings.length) {
    L.push('', '## 점검하다 본 것 (앱은 고치지 않음, 보고만)', '');
    for (const x of findings) L.push(`- ${x.id}: ${x.text}`);
  }
  if (rows.some(x => x.status === 'known')) {
    L.push('', '## 알려진 문제 (점검이 찾아 보고함, 고치기 전까지 실패로 세지 않음)', '', '| 번호 | 내용 | 왜 |', '|---|---|---|');
    for (const x of rows.filter(x => x.status === 'known')) L.push(`| ${x.id} | ${md(x.text.slice(0, 60))} | ${md(x.detail)} |`);
  }
  if (rows.some(x => x.status === 'fail')) {
    L.push('', '## 실패한 번호', '', '| 번호 | 내용 | 왜 |', '|---|---|---|');
    for (const x of rows.filter(x => x.status === 'fail')) L.push(`| ${x.id} | ${md(x.text.slice(0, 60))} | ${md(x.detail)} |`);
  }
  L.push('', '## 기능 번호별 (208줄)', '', '| 번호 | 분류 | 조건 | 결과 | 내용 | 확인한 것 / 이유 |', '|---|---|---|---|---|---|');
  for (const x of rows) L.push(`| ${x.id} | ${CLS_KO[x.cls]} | ${x.cond.join('·')} | ${x.status === 'fail' ? '**실패**' : ST_KO[x.status]} | ${md(x.text.length > 70 ? x.text.slice(0, 70) + '…' : x.text)} | ${md(x.detail.length > 400 ? x.detail.slice(0, 400) + '…' : x.detail)} |`);
  if (shots?.length) {
    L.push('', `## 스크린샷 (${shots.length}장, \`shots/\`)`, '', '| 파일 | 크기 | 맞음 |', '|---|---|---|');
    for (const s of shots) L.push(`| ${s.file} | ${s.w}×${s.h} | ${s.ok ? '맞음' : '**다름** (기대 ' + s.want + ')'} |`);
  }
  if (compare) {
    L.push('', `## 스크린샷 비교 (\`${compare.prev}\`와)`, '', `바뀐 사진 ${compare.changed.length}장 · 같은 사진 ${compare.same} · 새 사진 ${compare.added.length} · 없어진 사진 ${compare.removed.length}. 통과 기준 숫자는 없다: 바뀐 사진은 사람이 본다.`, '');
    if (compare.changed.length) { L.push('| 파일 | 바뀐 화소 비율 | 바뀐 곳(x0,y0,x1,y1) |', '|---|---|---|'); for (const c of compare.changed) L.push(`| ${c.file} | ${c.ratio} | ${c.bbox || c.note || ''} |`); }
    if (compare.added.length) L.push('', '새 사진: ' + compare.added.join(', '));
    if (compare.removed.length) L.push('', '없어진 사진: ' + compare.removed.join(', '));
  }
  L.push('', '## 밖으로 나간 요청', '', '| 종류 | 수 | 예 |', '|---|---|---|');
  for (const k of ['허용', '가짜 답', '막음']) { const xs = ctx.netLog.filter(n => n.kind === k); L.push(`| ${k} | ${xs.length} | ${md([...new Set(xs.map(n => n.url.replace(/^https?:\/\//, '').split('?')[0].split('/').slice(0, 2).join('/')))].slice(0, 6).join(', '))} |`); }
  if (edgeErrors?.length) {
    L.push('', '## 페이지 오류·콘솔 오류', '', '| 종류 | 알려진 것 | 내용 |', '|---|---|---|');
    for (const e of edgeErrors.slice(0, 80)) L.push(`| ${e.kind} | ${e.known ? '예' : '**아니오**'} | ${md((e.text + ' ' + (e.url || '')).slice(0, 200))} |`);
  }
  L.push('', '## 정리', '', ...cleanup.map(c => `- ${c.ok ? '통과' : '**실패**'} · ${c.name}${c.detail ? ': ' + c.detail : ''}`));
  fs.writeFileSync(path.join(OUT, 'results.md'), L.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'log.txt'), logLines.join('\n') + '\n');
  return { summary, rows, failed };
}

/* ---------------- 실행 ---------------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-ui-check-'));     // 코드 파일·시험 파일·내려받은 파일
const pinDir = path.join(tmp, 'pin'), dlDir = path.join(tmp, 'downloads');
fs.mkdirSync(pinDir); fs.mkdirSync(dlDir);
let mainSrv = null, staticSrv = null, aborted = null;
const browsers = new Set();
let shots = [], compare = null;
const edgeErrors = [];
fs.mkdirSync(OUT, { recursive: true });
log(`YT 노래방 화면 자동 점검 시작 · 결과 폴더 ${OUT}`);
if (!findEdge()) { console.error('Edge(msedge.exe)를 찾지 못했어요'); process.exit(2); }

const onSignal = async () => { aborted = '사용자가 멈춤 (Ctrl+C)'; };
process.on('SIGINT', onSignal);

try {
  const port = await freePortNot5173(), staticPort = await freePortNot5173();
  mainSrv = await startServer([String(port), '--pin-dir', pinDir, '--root', ROOT, '--pin', '2580'], '노래방');
  ctx.port = port; ctx.staticPort = staticPort;
  ctx.base = `http://127.0.0.1:${port}`;
  ctx.localBase = `http://localhost:${port}`;           // 다른 저장소(빈 곳): 백업 불러오기 시험
  ctx.staticBase = `http://127.0.0.1:${staticPort}`;
  ctx.startStatic = async () => { if (!staticSrv) staticSrv = await startServer([String(staticPort), '--static', '--root', ROOT], '정적'); };
  ctx.stopStatic = async () => { await stopServer(staticSrv); staticSrv = null; };
  await ctx.startStatic();
  log(`시험 서버 127.0.0.1:${port} (리모컨 코드 파일: 임시 폴더) · 정적 서버 127.0.0.1:${staticPort}`);
  ctx.fx = makeFixtures(path.join(tmp, 'files'));
  ctx.dlDir = dlDir;
  ctx.tmp = tmp;
  ctx.newBrowser = async () => {
    const b = await launchEdge({ downloadDir: dlDir });
    browsers.add(b);
    const origNew = b.newPage;
    // 탭의 페이지 오류·콘솔 오류는 탭을 닫을 때 모은다
    const collect = p => { if (p.collected) return; p.collected = true; edgeErrors.push(...p.events.map(e => ({ ...e, known: KNOWN.some(k => k.test(e.text + ' ' + (e.url || ''))) }))); };
    b.newPage = async () => {
      const p = await origNew();
      await p.route(makeRouter(p), ROUTED, u => ctx.netLog.push({ kind: '막음', url: u.origin + u.pathname, note: '모르는 곳 (이름 찾기에서 막힘)' }));
      const origClose = p.close;
      p.close = async () => { collect(p); await origClose(); };
      return p;
    };
    b.closeAll = async () => { for (const p of b.pages) collect(p); await b.close(); browsers.delete(b); };
    return b;
  };
  ctx.downloads = () => [...[...browsers].flatMap(b => [...b.downloads.values()])];

  // 기능 점검이 같이 쓰는 브라우저와 PC 탭 (빈 저장소). 첫 탭이 데모 반주를 합성하는 동안(PC가 바쁘면 1분 넘게) 기다린 뒤
  // 같은 탭에서 조건(소리 시계·가짜 마이크·오프라인 흉내·인터넷)을 확인한다
  const lib = await import(pathToFileURL(path.join(HERE, 'checks', '_lib.mjs')));
  const fb = await ctx.newBrowser();
  ctx.browser = fb;
  {
    const t = Date.now();
    ctx.p = await lib.openPage(ctx, lib.PC, ctx.base + '/index.html', lib.READY_DEMO, fb, 240000);
    const sec = (Date.now() - t) / 1000;
    // 한가한 PC에서는 10초 안팎. 오래 걸리면 PC가 바쁜 것이니 기다리는 시간을 그만큼 늘린다 (최대 3배)
    timing.slow = Math.min(3, Math.max(1, Math.round(sec / 15 * 10) / 10));
    log(`첫 화면 준비 (데모 반주 합성 포함) ${sec.toFixed(0)}초${timing.slow > 1 ? ` → PC가 바빠서 기다리는 시간 ${timing.slow}배` : ''}`);
    await probeConditions(ctx.p);
  }

  // 1) 스크린샷 (고정 시각·고정 시험 데이터로, 따로 켠 빈 Edge에서)
  const shotMod = await import(pathToFileURL(path.join(HERE, 'checks', 'shots.mjs')));
  if ((!ONLY && !CHECKS) || SHOTS_ONLY) shots = await shotMod.default(ctx);
  // 2) 기능 점검
  if (!SHOTS_ONLY) {
    const order = ['basics', 'songs', 'bulk', 'video', 'reserve', 'profiles', 'keys', 'syncedit', 'tv', 'touch', 'record', 'mic', 'settings', 'backup', 'remote', 'offline'];
    // 마이크는 '거부' 상태로 시작한다 (마이크가 꺼진 채의 안내를 먼저 본다. 가짜 마이크는 mic 점검에서 켠다)
    await ctx.p.eval(`localStorage.setItem('__ui-mic','deny')`);
    ctx.ids = {};
    for (const name of order) {
      if (aborted) break;
      if (CHECKS && !CHECKS.includes(name)) continue;
      const mod = await import(pathToFileURL(path.join(HERE, 'checks', name + '.mjs')));
      // basics·songs는 다른 점검이 쓰는 시험 곡을 만들어서 --only여도 먼저 돈다 (그 구역 결과는 "건너뜀"으로 둔다)
      if (!ctx.wants(...mod.areas) && !['basics', 'songs'].includes(name)) { log(`(${name}: --only 밖이라 건너뜀)`); continue; }
      log(`=== ${name} (${mod.areas.join('')}) ===`);
      await ctx.p.bringToFront().catch(() => {});
      try { await mod.default(ctx); }
      catch (e) { log(`! ${name} 점검이 멈춤: ${e.stack || e.message}`); ctx.common(`${name} 점검이 끝까지 돌았다`, false, e.message); }
    }
  }
  await fb.closeAll();
  if (COMPARE) compare = compareShots(COMPARE, ctx.shotsDir);
} catch (e) {
  aborted = e.message;
  log('! 점검이 멈췄어요: ' + (e.stack || e.message));
} finally {
  // 정리
  for (const b of [...browsers]) { try { await b.closeAll(); } catch {} }
  await stopServer(mainSrv); await stopServer(staticSrv);
  for (const pr of [...procs]) await stopServer(pr);
}

// 정리 확인
const cleanup = [];
const left = ourEdgeProcesses();
if (left.length) killPids(left);
cleanup.push({ name: '헤드리스 Edge 0개 (점검이 켠 것)', ok: left.length === 0, detail: left.length ? `${left.length}개가 남아 있어서 껐어요` : '' });
const leftProfiles = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('yt-ui-check-edge-'));
for (const n of leftProfiles) { try { fs.rmSync(path.join(os.tmpdir(), n), { recursive: true, force: true }); } catch {} }
cleanup.push({ name: '임시 Edge 프로필 0개', ok: !fs.readdirSync(os.tmpdir()).some(n => n.startsWith('yt-ui-check-edge-')), detail: leftProfiles.length ? `${leftProfiles.length}개 지움` : '' });
for (let i = 0; i < 10; i++) { try { fs.rmSync(tmp, { recursive: true, force: true }); break; } catch { await sleep(300); } }
cleanup.push({ name: '임시 폴더(코드 파일·시험 파일·내려받은 파일) 지움', ok: !fs.existsSync(tmp) });
cleanup.push({ name: '시험 서버 꺼짐', ok: procs.size === 0 });
const after = { git: gitStatus(), remote: remoteFileState() };
cleanup.push({ name: '저장소 git status가 시작 전과 같음', ok: after.git === before.git, detail: after.git === before.git ? (before.git.trim() ? '시작 전부터 바뀐 파일 있음(그대로)' : '깨끗함') : `달라짐:\n${after.git}` });
cleanup.push({ name: '저장소 .remote.json이 생기거나 바뀌지 않음', ok: after.remote === before.remote, detail: before.remote === 'none' ? '없음 → ' + (after.remote === 'none' ? '없음' : '생김!') : '' });
if (ROOT !== REPO) cleanup.push({ name: '점검한 사본 폴더에 .remote.json이 생기지 않음', ok: before.rootRemote || !fs.existsSync(path.join(ROOT, '.remote.json')) });
for (const c of cleanup) if (!c.ok) log(`✕ 정리: ${c.name} ${c.detail || ''}`);

// 콘솔 오류 공통 점검
const unknown = edgeErrors.filter(e => !e.known);
ctx.common('페이지 오류(예외) 0', !edgeErrors.some(e => e.kind === 'pageerror'), edgeErrors.filter(e => e.kind === 'pageerror').map(e => e.text).slice(0, 5).join(' / '));
ctx.common('콘솔 오류는 알려진 것만', !unknown.length, unknown.map(e => e.text).slice(0, 5).join(' / '));
const outside = ctx.netLog.filter(n => n.kind === '막음' && !/accounts\.google\.com|googleapis\.com|apis\.google\.com/.test(n.url));
ctx.common('밖으로 나간 요청은 허용 목록(글꼴·QR 라이브러리)뿐, Google은 막고 lrclib은 가짜 답', outside.length === 0, outside.length ? '모르는 곳: ' + [...new Set(outside.map(n => n.url))].join(', ') : `막음 ${ctx.netLog.filter(n => n.kind === '막음').length} · 가짜 답 ${ctx.netLog.filter(n => n.kind === '가짜 답').length} · 허용 ${ctx.netLog.filter(n => n.kind === '허용').length}`);
for (const c of cleanup) if (!c.ok) common.push({ name: '정리: ' + c.name, ok: false, detail: c.detail || '' });

const elapsed = Math.round((Date.now() - T0) / 1000);
const { summary, rows, failed } = writeResults({ shots, compare, cleanup, edgeErrors, elapsed, aborted });
console.log('');
console.log(`결과: ${failed === 0 ? '통과' : '실패 ' + failed + '개'} · 걸린 시간 ${elapsed}초`);
console.log(Object.entries(summary.byStatus).map(([k, v]) => `${ST_KO[k]} ${v}`).join(' · '));
for (const x of rows.filter(x => x.status === 'fail')) console.log(`  실패 ${x.id}: ${x.detail.slice(0, 200)}`);
for (const x of rows.filter(x => x.status === 'known')) console.log(`  알려진 문제 ${x.id}: ${x.detail.slice(0, 160)}`);
for (const c of common.filter(c => !c.ok)) console.log(`  실패 [공통] ${c.name}: ${c.detail.slice(0, 200)}`);
if (shots.length) console.log(`스크린샷 ${shots.length}장: ${ctx.shotsDir}`);
if (compare) console.log(`비교: 바뀐 사진 ${compare.changed.length}장 (results.md 맨 아래)`);
console.log(`결과표: ${path.join(OUT, 'results.md')}`);
process.exit(failed === 0 ? 0 : 1);
