// 허브 곡 설정·자동 싱크 (CR-227 1단계, W1~W6·W9~W12): 가짜 허브(fakehub.mjs, 만든 주소의 메모리 허브)와 가짜 LRCLIB로만 본다.
// 진짜 허브·LRCLIB·Google·집 AI에는 요청 0 (run.mjs 가로채기 + 공통 점검). 메일·비밀번호·키는 이 점검이 만든 가짜 값.
// 새 Edge 하나에 "기기" 둘: 기기 1 = 127.0.0.1, 기기 2 = localhost (다른 origin = 다른 빈 저장소). 같은 MR 파일(시험 사인파)을 둘 다에 넣는다.
// 같이 쓰는 PC 탭은 맨 끝에 "허브를 안 쓴 채 다른 점검이 다 돌았는지"(W12)만 본다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PC, PHONE, READY_DEMO, openPage, seedSong, selectById, txt, visible, isHidden, marks, sawToast, sleep, q } from './_lib.mjs';
import { wav, LRC_SHORT, PLAIN } from '../fixtures.mjs';
import { FAKE_HUB_HOST, FAKE_HUB_URL, FAKE_HUB_KEY, hubCode, fakeMail } from '../fakehub.mjs';
export const areas = ['W'];

// 모든 console 글을 모아 둔다 (허브 주소·키·토큰이 찍히지 않았는지 W11에서 훑음)
const CONS = `(() => { if (window.__cons) return; const c = window.__cons = [];
  for (const m of ['log','info','warn','error','debug']) { const o = console[m].bind(console); console[m] = (...a) => { try { c.push(a.map(x => { try { return typeof x === 'string' ? x : (x && x.stack) || JSON.stringify(x); } catch { return String(x); } }).join(' ').slice(0, 2000)); } catch {} return o(...a); }; } })()`;
const sha40 = file => 'mr-' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 40);
const b64j = o => Buffer.from(JSON.stringify(o)).toString('base64url');

export default async function hub(ctx) {
  const { ok, step } = ctx, H = ctx.hub;
  const shotDir = ctx.shotsDir; fs.mkdirSync(shotDir, { recursive: true });
  const shot = async (p, name) => { try { await sleep(350); await p.shot(path.join(shotDir, name)); } catch (e) { ctx.log('  (사진 실패 ' + name + ': ' + e.message + ')'); } };
  const waitNode = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (fn()) return true; } catch {} await sleep(150); } return !!fn(); };
  const hubKeys = p => p.eval(`Object.keys(localStorage).filter(k=>k.startsWith('nb-hub')).sort()`);

  // W12: 같이 쓰는 탭은 허브 코드 없이 다른 점검(236줄)을 다 돌았다 → 허브 값·요청·타이머 0
  await step('허브 없이: 같이 쓰는 탭에 nb-hub* 0개 · 허브 요청 0 · 타이머 0 (다른 점검은 허브 꺼짐으로 돎)', ['W12'], async () => {
    const st = await ctx.p.eval(`({keys:Object.keys(localStorage).filter(k=>k.startsWith('nb-hub')).length, conf:Hub.conf, state:Hub.state, every:Hub.every, sb:!!Hub.sb, out:Hub.out.length})`);
    ok('W12', st.keys === 0 && st.conf === null && st.state === 'off' && !st.every && !st.sb && st.out === 0, JSON.stringify(st));
    ok('W12', H.log.length === 0, `허브 요청 ${H.log.length}건`);
    ok('W12', !ctx.netLog.some(n => /supabase/.test(n.url)), 'Supabase 주소로 나간 요청 없음');
  });

  // 가짜 계정 (이 점검이 만든 값) · 가짜 YouTube 열쇠 (허브 열쇠 칸)
  const email = fakeMail('qa-hub-' + crypto.randomBytes(3).toString('hex')), pw = 'qa-' + crypto.randomBytes(9).toString('hex');
  const email2 = fakeMail('qa-hub2-' + crypto.randomBytes(3).toString('hex')), pw2 = 'qa-' + crypto.randomBytes(9).toString('hex');
  const uid = H.addUser(email, pw); H.addUser(email2, pw2);
  const ytKey = 'qa-yt-' + crypto.randomBytes(8).toString('hex');
  H.secrets.set([uid, 'noraebang', 'youtube_key'].join('|'), ytKey);
  // 시험 MR 파일: 곡마다 다른 길이 = 다른 해시 (같은 파일이면 같은 곡으로 맞춰지므로)
  const fx = ctx.fx, mk = (name, sec) => { const f = path.join(ctx.tmp, 'files', name); fs.writeFileSync(f, wav(sec, 262, 392)); return f; };
  const fInst = mk('QA 시험 허브 연주곡.wav', 3.6), fDel = mk('QA 시험 허브 지울곡.wav', 2.4);
  const K1 = sha40(fx.short), K2 = sha40(fx.plain), KDEL = sha40(fDel);
  const rowOf = k => H.rowsOf(uid).find(r => r.id === k);

  const hb = await ctx.newBrowser();
  const open = async base => {
    const p = await openPage(ctx, PC, null, READY_DEMO, hb);
    await p.s('Page.addScriptToEvaluateOnNewDocument', { source: CONS });
    await p.goto(base + '/index.html', READY_DEMO, 150000);
    return p;
  };
  const openSettings = async p => { if (!(await p.eval(`$('#cloudDialog').open`))) { await p.click('#settingsBtn'); await p.until(`$('#cloudDialog').open`, 3000); } await p.scrollTo('#hubSec'); };
  const closeSettings = async p => { if (await p.eval(`$('#cloudDialog').open`)) await p.click('#cloudClose'); };
  const typeInto = async (p, sel, text) => { await p.eval(`(()=>{const e=$(${q(sel)}); e.value=''; e.focus()})()`); await p.type(text); };
  const saveCode = async (p, code) => { await typeInto(p, '#hubCode', code); await p.click('#hubCodeSave'); await sleep(250); return { msg: await txt(p, '#hubMsg'), left: await p.eval(`$('#hubCode').value`), keys: await hubKeys(p) }; };
  const login = async (p, em, pass) => {
    await typeInto(p, '#hubEmail', em); await typeInto(p, '#hubPw', pass);
    await p.click('#hubLoginBtn');
    await p.until(`!$('#hubLoginBtn').disabled && !/로그인 중|맞추는 중/.test($('#hubMsg').textContent)`, 20000);
    return { msg: await txt(p, '#hubMsg'), pwLeft: await p.eval(`$('#hubPw').value`), state: await p.eval('Hub.state') };
  };
  const song = (p, id) => p.eval(`(()=>{const s=songById(${q(id)}); return s ? {lyrics:s.lyrics||'', off:+s.lyricOffset||0, base:s.baseKey|0, chk:!!s.syncChk, hubK:s.hubK||null, mrHash:s.mrHash||null, at:s.settingsAt||0} : null})()`);
  let pa = null, pb = null;
  try {
    pa = await open(ctx.base);
    pb = await open(ctx.localBase);

    /* ---------------- W1 연결 코드 · 로그인 ---------------- */
    await step('기기 1: 허브 연결 칸 → 틀린 값·비밀 키 거절 → 코드 저장 → 틀린 비밀번호 → 로그인', ['W1', 'W12'], async () => {
      await openSettings(pa);
      ok('W12', /연결 안 됨 · 허브 없이도 지금처럼 다 돼요/.test(await txt(pa, '#hubState')) && await visible(pa, '#hubCodeRow') && await isHidden(pa, '#hubLogin'), '새 기기: "연결 안 됨" · 코드 칸만');
      const jwt = role => [b64j({ alg: 'HS256', typ: 'JWT' }), b64j({ role, iss: 'supabase' }), 'qasig'].join('.');
      const bad = [
        ['아무 글', 'hello'],
        ['허브 주소 모양 아님', hubCode('https://qa.example.test', FAKE_HUB_KEY)],
        ['비밀 키 sb_secret_', hubCode(FAKE_HUB_URL, 'sb_secret_' + 'q'.repeat(24))],
        ['service_role 키', hubCode(FAKE_HUB_URL, jwt('service_role'))],
        ['JSON service_role', JSON.stringify({ url: FAKE_HUB_URL, anonKey: jwt('service_role') })],
      ];
      for (const [name, code] of bad) {
        const r = await saveCode(pa, code);
        ok('W1', /이 값은 못 써요/.test(r.msg) && r.keys.length === 0 && r.left === '', `${name}: "${r.msg}" nb-hub ${r.keys.length}개, 칸 "${r.left}"`);
      }
      // hub.json 모양(JSON)도 받는지는 core 테스트가 본다. 여기서는 nbhub1 코드
      const r = await saveCode(pa, hubCode());
      const conf = await pa.eval(`JSON.parse(localStorage.getItem('nb-hub')||'null')`);
      ok('W1', /허브 코드를 저장했어요/.test(r.msg) && conf && conf.u === FAKE_HUB_URL && conf.k === FAKE_HUB_KEY && r.left === '', `"${r.msg}" 칸 비움 ${r.left === ''}`);
      await pa.until(`!$('#hubLogin').hidden`, 3000);
      ok('W1', /허브 코드 저장됨 · 로그인해 주세요/.test(await txt(pa, '#hubState')) && await isHidden(pa, '#hubCodeRow'), await txt(pa, '#hubState'));
      const w = await login(pa, email, pw + 'x');
      ok('W1', /로그인 못 했어요/.test(w.msg) && w.pwLeft === '' && w.state === 'login', `틀린 비밀번호: "${w.msg}" 칸 비움 ${w.pwLeft === ''}`);
      const g = await login(pa, email, pw);
      ok('W1', g.msg === '로그인했어요' && g.state === 'ok' && g.pwLeft === '', `"${g.msg}" ${g.state}`);
      const ls = await pa.eval(`Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('nb-hub')).map(k=>[k,localStorage.getItem(k)]))`);
      ok('W1', Object.keys(ls).some(k => k.startsWith('nb-hub-auth')) && /^[0-9a-f]{16}$/.test(ls['nb-hub-owner'] || ''), `저장된 칸: ${Object.keys(ls).join(', ')} · 계정 표시는 해시 16자리`);
      const allLs = await pa.eval(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])))`);
      ok('W1', !allLs.includes(pw) && !(ls['nb-hub-owner'] || '').includes(uid), '비밀번호·계정 id는 저장 안 함');
      ok('W1', /로그인됨/.test(await txt(pa, '#hubState')) && await visible(pa, '#hubLogout') && await visible(pa, '#hubSyncNow') && await isHidden(pa, '#hubLogin'), await txt(pa, '#hubState'));
      // 허브 열쇠 칸(YouTube 검색 열쇠): 로그인 뒤 한 번 읽어 메모리에만
      await pa.until(`Hub.ytKey !== undefined`, 5000);
      ok('W1', (await pa.eval('Hub.ytKey')) === ytKey && !allLs.includes(ytKey), 'YouTube 열쇠: 허브 열쇠 칸에서 읽어 메모리에만 (localStorage 0)');
      await shot(pa, 'W1-허브-로그인됨-1280.png');
      await closeSettings(pa);
    });

    /* ---------------- W2 곡 설정 저장 ---------------- */
    let s1 = null;
    await step('기기 1: 곡 넣고 가사 타이밍 +0.2 · 키 +2 → 3초 뒤 허브 줄 (열쇠 = MR 파일 해시, 소리 파일 안 감)', ['W2'], async () => {
      s1 = (await seedSong(pa, { title: 'QA 시험 허브 곡', artist: 'QA가수', lyrics: LRC_SHORT, wav: fx.short })).id;
      await selectById(pa, s1);
      await pa.click('[data-lyr="0.1"]'); await pa.click('[data-lyr="0.1"]');
      await pa.click('[data-key-step="1"]'); await sleep(300); await pa.click('[data-key-step="1"]');
      const got = await waitNode(() => { const r = rowOf(K1); return r && r.data.offset === 0.2 && r.data.key === 2; }, 25000);
      await pa.until(`(songById(${q(s1)})||{}).hubK === ${q(K1)}`, 5000);   // 보낸 뒤 받기까지 끝나면 이 기기 곡에 "맞춘 열쇠" 표시
      const r = rowOf(K1), x = await song(pa, s1);
      ok('W2', got && r.data.lrc === LRC_SHORT && r.data.v === 1 && r.app === 'noraebang', got ? `허브 줄: 가사 ${r.data.lrc.length}자 · 타이밍 ${r.data.offset} · 키 ${r.data.key}` : '허브 줄이 안 옴: ' + JSON.stringify(H.rowsOf(uid).map(r => [r.id.slice(0, 8), r.data.offset, r.data.key])));
      ok('W2', x.mrHash === K1 && x.hubK === K1, `곡 열쇠 = MR 파일 SHA-256 앞 40자 (${(x.mrHash || '').slice(0, 10)}…)`);
      const size = fs.statSync(fx.short).size, bodies = H.bodies.join('\n');
      ok('W2', H.bodies.length > 0 && !/RIFF|UklGR|WAVEfmt|data:audio/.test(bodies) && Math.max(...H.bodies.map(b => b.length)) < size, `보낸 몸 ${H.bodies.length}개 · 가장 큰 것 ${Math.max(...H.bodies.map(b => b.length))}B < MR 파일 ${size}B · 소리 파일 표시 0`);
      ok('W2', H.badKey === 0, `공개 키가 아닌 요청 ${H.badKey}건`);
    });

    /* ---------------- W3 다른 기기에서 읽기 ---------------- */
    let s1b = null;
    await step('기기 2(빈 저장소): 같은 MR 파일 → 로그인 → 가사·타이밍·기본 키가 들어옴 · 뒤에 넣은 곡도 채워짐', ['W3', 'W1'], async () => {
      s1b = (await seedSong(pb, { title: 'QA 시험 이름 다른 곡', artist: '', lyrics: '', wav: fx.short })).id;
      await selectById(pb, s1b);
      await openSettings(pb);
      const r = await saveCode(pb, hubCode());
      ok('W1', /허브 코드를 저장했어요/.test(r.msg), '기기 2 코드 저장');
      const g = await login(pb, email, pw);
      ok('W1', g.state === 'ok', '기기 2 로그인 ' + g.msg);
      await pb.until(`(songById(${q(s1b)}).lyrics||'') === ${q(LRC_SHORT)}`, 8000);
      const x = await song(pb, s1b);
      ok('W3', x.lyrics === LRC_SHORT && x.off === 0.2 && x.base === 2 && x.hubK === K1, `가사 ${x.lyrics === LRC_SHORT ? '같음' : '다름'} · 타이밍 ${x.off} · 기본 키 ${x.base}`);
      ok('W3', (await pb.eval(`keyOf(songById(${q(s1b)}))`)) === 2, '사용자별 키가 없으면 허브 기본 키를 씀 (keyOf = 2)');
      ok('W3', /다른 기기에서 맞춘 설정을 불러왔어요/.test(await txt(pb, '#syncLine')), `싱크 한 줄: "${await txt(pb, '#syncLine')}"`);
      // 로그인한 뒤에 넣은 같은 MR 곡: 다음 맞추기([지금 맞추기])에서 채워짐
      const s1c = (await seedSong(pb, { title: 'QA 시험 같은 MR 또', artist: '', lyrics: '', wav: fx.short })).id;
      await pb.click('#hubSyncNow');
      await pb.until(`(songById(${q(s1c)}).lyrics||'') === ${q(LRC_SHORT)}`, 8000);
      const y = await song(pb, s1c);
      ok('W3', y.lyrics === LRC_SHORT && y.off === 0.2 && y.base === 2, '로그인 뒤에 넣은 곡도 [지금 맞추기]에서 채워짐');
      ok('W3', /곡 설정 1곡 맞춤/.test(await txt(pb, '#hubState')), await txt(pb, '#hubState'));
      await closeSettings(pb);
    });

    /* ---------------- W4 오프라인 쌓았다 보내기 ---------------- */
    await step('기기 1: 인터넷 끊김 흉내 중 가사 타이밍 +1 → "보낼 곡 1개" → 다시 이으면 허브에 올라감', ['W4'], async () => {
      const before = rowOf(K1).updated_at;
      await pa.offline(true);
      await pa.click('[data-lyr="1"]');
      const out = await pa.eval(`JSON.parse(localStorage.getItem('nb-hub-out')||'[]')`);
      ok('W4', out.length === 1 && out[0].k === K1, `nb-hub-out ${out.length}줄`);
      await sleep(3600);
      await openSettings(pa);
      const st = await txt(pa, '#hubState');
      ok('W4', /인터넷이 없어요/.test(st) && /보낼 곡 1개/.test(st), `상태: "${st}"`);
      ok('W4', rowOf(K1).updated_at === before && rowOf(K1).data.offset === 0.2, '끊긴 동안 허브 그대로');
      await pa.offline(false);
      const up = await waitNode(() => rowOf(K1).data.offset === 1.2, 20000);
      ok('W4', up, `다시 이은 뒤 허브 타이밍 ${rowOf(K1).data.offset}`);
      await pa.until(`!localStorage.getItem('nb-hub-out') && Hub.state==='ok'`, 8000);
      ok('W4', !(await pa.eval(`localStorage.getItem('nb-hub-out')`)) && !/보낼 곡/.test(await txt(pa, '#hubState')), `보낸 뒤: "${await txt(pa, '#hubState')}"`);
      await closeSettings(pa);
    });

    /* ---------------- W5 나중 것이 이김 · 지움 표시 ---------------- */
    await step('두 기기가 같은 곡을 고침: 기기 1(끊긴 채 먼저) · 기기 2(나중) → 둘 다 기기 2 값 · 곡 지우면 지움 표시만', ['W5'], async () => {
      await pa.offline(true);
      await pa.click('[data-lyr="-1"]');            // 기기 1: 0.2 (먼저 고침, 아직 못 보냄)
      await sleep(1500);                             // 기기 1의 곡 저장(0.6초 뒤, 곡 고친 시각)보다 확실히 나중에
      await selectById(pb, s1b);
      await pb.click('[data-lyr="-0.1"]');          // 기기 2: 1.2 → 1.1 (나중에 고침)… 기기 2는 W4 값을 아직 안 받았을 수 있다
      const pbOff = (await song(pb, s1b)).off;
      const up = await waitNode(() => rowOf(K1).data.offset === pbOff, 20000);
      ok('W5', up, `기기 2 값 ${pbOff}가 허브에 (허브 ${rowOf(K1).data.offset})`);
      await pa.offline(false);
      await pa.until(`Math.abs((+songById(${q(s1)}).lyricOffset||0) - ${pbOff}) < 1e-9 && !localStorage.getItem('nb-hub-out')`, 15000);
      const a = await song(pa, s1);
      ok('W5', a.off === pbOff && rowOf(K1).data.offset === pbOff, `기기 1 ${a.off} · 허브 ${rowOf(K1).data.offset} · 기기 2 ${pbOff} (먼저 고친 기기 1 값 0.2는 짐)`);
      // 지움 표시
      const sd = (await seedSong(pa, { title: 'QA 시험 허브 지울곡', artist: 'QA가수', lyrics: LRC_SHORT, wav: fDel })).id;
      await pa.eval('hubSync({force:true})');
      const pushed = await waitNode(() => rowOf(KDEL) && rowOf(KDEL).deleted_at === null, 15000);
      await pa.eval(`(async()=>{ const s=songById(${q(sd)}); await deleteSong(s); })()`);
      const del = await waitNode(() => rowOf(KDEL) && rowOf(KDEL).deleted_at !== null, 15000);
      ok('W5', pushed && del && Object.keys(rowOf(KDEL).data).length === 0, `지운 곡: 허브 줄 지움 표시 ${del} · 내용 비움`);
      ok('W5', rowOf(K1).deleted_at === null, '다른 곡 줄은 그대로');
    });

    /* ---------------- W6 자동 싱크 (가짜 LRCLIB) ---------------- */
    let s2 = null;
    await step('무대 [자동 싱크]: 가짜 LRCLIB /api/get 시각 가사 → 곡에 들어감 · 보낸 값은 제목·가수·길이뿐', ['W6', 'W9'], async () => {
      s2 = (await seedSong(pa, { title: 'QA 시험 자동싱크 곡', artist: 'QA가수 (feat. QA둘)', lyrics: PLAIN, wav: fx.plain })).id;
      await selectById(pa, s2);
      ok('W6', await visible(pa, '#autoSyncBtn') && await isHidden(pa, '#syncChkBtn'), '시각 없는 가사 곡: [자동 싱크] 보임');
      const lrc = '[00:00.50]QA 시험 자동 첫 줄\n[00:02.00]QA 시험 자동 둘째 줄\n[00:03.50]QA 시험 자동 셋째 줄';
      ctx.lrcGetRules.push({ track: '^QA 시험 자동싱크 곡$', status: 200, times: 1, body: { id: 9001, trackName: 'QA 시험 자동싱크 곡', artistName: 'QA가수', albumName: 'QA 시험 앨범', duration: 5, instrumental: false, plainLyrics: 'QA 시험 자동 첫 줄', syncedLyrics: lrc } });
      const nGet = ctx.lrcGetLog.length, nSearch = ctx.lrcLog.length;
      await pa.click('#autoSyncBtn');
      await pa.until(`(songById(${q(s2)}).lyrics||'') === ${q(lrc)}`, 10000);
      const x = await song(pa, s2), line = await txt(pa, '#syncLine');
      ok('W6', x.lyrics === lrc && x.off === 0 && x.chk, `곡 가사 = 가짜 LRCLIB 시각 가사 · 확인 표시 ${x.chk}`);
      ok('W6', /가사 시각을 찾았어요 \(LRCLIB\)/.test(line), `한 줄: "${line}"`);
      const g = ctx.lrcGetLog.slice(nGet);
      ok('W6', g.length === 1 && g[0].params.slice().sort().join(',') === 'artist_name,duration,track_name' && g[0].track === 'QA 시험 자동싱크 곡' && g[0].artist === 'QA가수' && g[0].duration === '5',
        `보낸 값: ${g.map(e => e.params.join('·') + ` (${e.track} / ${e.artist} / ${e.duration})`).join(' ; ')}`);
      ok('W6', ctx.lrcLog.length === nSearch, '정확히 찾아서 검색(/api/search)은 안 함');
      ok('W6', await isHidden(pa, '#autoSyncBtn') && await visible(pa, '#syncChkBtn'), '찾은 뒤: [자동 싱크] 숨김 · "확인해 주세요" 보임');
      ok('W9', await visible(pa, '#syncChkBtn') && /자동 싱크 · 확인해 주세요/.test(await txt(pa, '#syncChkBtn')), '"자동 싱크 · 확인해 주세요" 단추');
      const up = await waitNode(() => rowOf(K2) && rowOf(K2).data.lrc === lrc && rowOf(K2).data.chk === 1, 15000);
      ok('W6', up, '자동 싱크 결과가 허브로 (확인 표시 포함)');
      await shot(pa, 'W6-자동싱크-찾음-1280.png');
    });
    await step('못 찾음: /api/get 없음(404) + 검색 0개 → "가사 시각을 못 찾았어요" + [직접 맞추기]', ['W6'], async () => {
      const s3 = (await seedSong(pa, { title: 'QA 시험 못찾는 곡', artist: 'QA가수', lyrics: PLAIN, wav: fx.nolyr })).id;
      await pa.emulate(PHONE);
      await selectById(pa, s3);
      const nGet = ctx.lrcGetLog.length, nSearch = ctx.lrcLog.length;
      await pa.click('#autoSyncBtn');
      await pa.until(`/못 찾았어요/.test($('#syncLine').textContent)`, 15000);
      const line = await txt(pa, '#syncLine'), x = await song(pa, s3);
      ok('W6', /가사 시각을 못 찾았어요/.test(line) && await visible(pa, '#syncLine .sl-act') && /직접 맞추기/.test(await txt(pa, '#syncLine .sl-act')), `한 줄: "${line}"`);
      ok('W6', ctx.lrcGetLog.slice(nGet).some(e => e.status === 404) && ctx.lrcLog.length > nSearch && x.lyrics === PLAIN, `get 404 → 검색 ${ctx.lrcLog.length - nSearch}번 · 가사 그대로`);
      await shot(pa, 'W6-자동싱크-못찾음-412.png');
      await pa.click('#syncLine .sl-act');
      ok('W6', await pa.until('!!state.sync', 3000), '[직접 맞추기] → 싱크 편집');
      await pa.click('#syCancel');
      await pa.emulate(PC);
    });

    /* ---------------- W9 확인 표시 ---------------- */
    await step('"확인해 주세요" → 싱크 편집 → 저장 → 표시 사라짐 (허브로도)', ['W9'], async () => {
      await selectById(pa, s2);
      await pa.click('#syncChkBtn');
      ok('W9', await pa.until('!!state.sync', 3000), '누르면 싱크 편집');
      await pa.click('#sySave');
      await pa.until(`!state.sync`, 3000);
      const x = await song(pa, s2);
      ok('W9', !x.chk && await isHidden(pa, '#syncChkBtn'), `저장 뒤 표시 ${x.chk ? '남음' : '사라짐'}`);
      const up = await waitNode(() => rowOf(K2) && rowOf(K2).data.chk === undefined, 15000);
      ok('W9', up, '허브 줄의 확인 표시도 사라짐');
    });

    /* ---------------- W10 목소리 없는 곡 ---------------- */
    await step('LRCLIB가 연주곡이라고 하면 안내만 (가사 그대로, 검색 안 함)', ['W10'], async () => {
      const s4 = (await seedSong(pa, { title: 'QA 시험 연주곡', artist: 'QA가수', lyrics: PLAIN, wav: fInst })).id;
      await selectById(pa, s4);
      ctx.lrcGetRules.push({ track: '^QA 시험 연주곡$', status: 200, times: 1, body: { id: 9002, trackName: 'QA 시험 연주곡', artistName: 'QA가수', albumName: '', duration: 4, instrumental: true, plainLyrics: null, syncedLyrics: null } });
      const nSearch = ctx.lrcLog.length;
      await pa.click('#autoSyncBtn');
      await pa.until(`/목소리 없는 곡/.test($('#syncLine').textContent)`, 10000);
      const line = await txt(pa, '#syncLine'), x = await song(pa, s4);
      ok('W10', /목소리 없는 곡\(연주곡\)이라 가사를 넣지 않았어요/.test(line) && x.lyrics === PLAIN && !x.chk && ctx.lrcLog.length === nSearch, `한 줄: "${line}" · 가사 그대로`);
    });

    /* ---------------- W11 연결 정보가 백업·Drive·화면·콘솔에 없음 ---------------- */
    await step('로그인한 기기의 백업 파일·library.json·기기 기록·화면·콘솔을 훑음: 허브 주소·키·토큰·코드 0', ['W11'], async () => {
      const auth = await pa.eval(`(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('nb-hub-auth')); try { const o=JSON.parse(localStorage.getItem(k)); return {a:o.access_token, r:o.refresh_token}; } catch { return {}; }})()`);
      const needles = [FAKE_HUB_HOST, 'qafakehub', FAKE_HUB_KEY, 'nbhub1', 'nb-hub', uid, email, pw, ytKey, auth.a, auth.r].filter(Boolean);
      const found = text => needles.filter(n => text.includes(n)).map(n => n === FAKE_HUB_HOST || n === 'qafakehub' ? '허브 주소' : n === FAKE_HUB_KEY ? '공개 키' : n === uid ? '계정 id' : n === email ? '메일' : n === pw ? '비밀번호' : n === ytKey ? 'YouTube 열쇠' : n === auth.a || n === auth.r ? '토큰' : n);
      const out = await pa.eval(`(async()=>{
        const orig = window.download; let got = null; window.download = (f) => { got = f; };
        try { await exportBackup(); } finally { window.download = orig; }
        const backup = got ? await got.text() : '';
        const lib = JSON.stringify(buildLibrary({ songs: state.songs, tombs: state.tombs, profiles: Profiles.list, recs: state.recs, recTombs: state.recTombs }));
        const stats = JSON.stringify(buildStatsFile(deviceId(), plays, scores));
        const screen = document.body.innerText + ' ' + [...document.querySelectorAll('input,textarea')].map(e => e.value).join(' ');
        return { backup, lib, stats, screen, cons: (window.__cons||[]).join('\\n'), n: state.songs.filter(s=>!s.demo).length };
      })()`, 60000);
      ok('W11', out.backup.length > 0 && found(out.backup).length === 0, `백업 파일 ${out.backup.length}자: ${found(out.backup).join(', ') || '0'}`);
      ok('W11', out.lib.length > 0 && found(out.lib).length === 0 && !/hubK|mrHash|settingsAt|baseKey/.test(out.lib), `library.json: ${found(out.lib).join(', ') || '0'} (허브 칸도 안 들어감)`);
      ok('W11', found(out.stats).length === 0, `기기 기록: ${found(out.stats).join(', ') || '0'}`);
      ok('W11', found(out.screen).length === 0, `화면 글·입력 칸: ${found(out.screen).join(', ') || '0'}`);
      const consB = await pb.eval(`(window.__cons||[]).join('\\n')`);
      ok('W11', found(out.cons + consB).length === 0, `콘솔 글 (기기 1·2): ${found(out.cons + consB).join(', ') || '0'}`);
    });

    /* ---------------- W1 로그아웃 · 다른 계정 · 연결 끊기 · #hub= 주소 ---------------- */
    await step('로그아웃 → 다른 계정 거절 → [연결 끊기] 두 번 → nb-hub* 0개, 곡·가사 그대로', ['W1', 'W12'], async () => {
      await openSettings(pa);
      await pa.click('#hubLogout');
      await pa.until(`/로그아웃했어요/.test($('#hubMsg').textContent)`, 5000);
      const k1 = await hubKeys(pa);
      ok('W1', !k1.some(k => k.startsWith('nb-hub-auth')) && k1.includes('nb-hub') && (await pa.eval('Hub.ytKey')) === undefined && await visible(pa, '#hubLogin'), `로그아웃: 남은 칸 ${k1.join(', ')} · YouTube 열쇠 메모리에서도 지움`);
      const o = await login(pa, email2, pw2);
      ok('W1', /처음 연결한 계정과 달라요/.test(o.msg) && !(await hubKeys(pa)).some(k => k.startsWith('nb-hub-auth')), `다른 계정: "${o.msg}"`);
      const before = await pa.eval(`state.songs.filter(s=>!s.demo).map(s=>s.id+'|'+(s.lyrics||'').length).join(',')`);
      await pa.click('#hubForget');
      ok('W1', /한 번 더 누르면 끊어요/.test(await txt(pa, '#hubForget')) && (await hubKeys(pa)).includes('nb-hub'), '한 번 누르면 아직 안 끊김');
      await pa.click('#hubForget');
      await pa.until(`/연결을 끊었어요/.test($('#hubMsg').textContent)`, 5000);
      const after = await pa.eval(`state.songs.filter(s=>!s.demo).map(s=>s.id+'|'+(s.lyrics||'').length).join(',')`);
      const marks1 = await pa.eval(`state.songs.filter(s=>s.hubK||s.hubSig).length`);
      ok('W1', (await hubKeys(pa)).length === 0 && (await pa.eval('Hub.conf')) === null && after === before && marks1 === 0, `끊은 뒤: nb-hub* ${(await hubKeys(pa)).length}개 · 곡 ${after.split(',').length}곡 그대로 · 맞춘 표시 ${marks1}`);
      ok('W12', /연결 안 됨/.test(await txt(pa, '#hubState')) && await visible(pa, '#hubCodeRow'), '끊은 뒤 "연결 안 됨" (허브 없이 그대로)');
      // 기기 2(localhost)는 아직 연결된 채라 그 요청은 빼고, 끊은 기기 1(127.0.0.1)에서 나간 것만 센다
      const nLog = H.log.length; await sleep(1500);
      const extra = H.log.slice(nLog).filter(e => e.origin !== ctx.localBase), other = H.log.length - nLog - extra.length;
      ok('W12', extra.length === 0, `끊은 뒤 기기 1의 허브 요청 ${extra.length}개${extra.length ? ' (' + extra.slice(0, 4).map(e => (e.origin || '출처 없음') + ' ' + e.m + ' ' + e.path).join(', ') + ')' : ''} · 아직 연결된 기기 2 요청 ${other}개는 셈에서 뺌`);
      await closeSettings(pa);
    });
    await step('주소 #hub=… 로 열기: 틀린 값은 저장 안 함 · 맞는 값은 저장 · 둘 다 주소에서 # 지움', ['W1'], async () => {
      await openSettings(pb);
      await pb.click('#hubForget'); await pb.click('#hubForget');
      await pb.until(`Hub.conf===null`, 5000);
      // 열기 실패 글에 주소가 그대로 나오므로 # 뒤(가짜 코드)는 가린다
      const gotoHub = async url => { try { await pb.goto(url, READY_DEMO, 150000); } catch (e) { throw new Error(String(e?.message || e).replace(/#hub=\S*/g, '#hub=(가림)')); } };
      await gotoHub(ctx.localBase + '/index.html?qa=1#hub=nbhub1.qa-bad');
      const m0 = { t: 0 };
      ok('W1', await sawToast(pb, /이 값은 못 써요/, m0, 5000) && (await pb.eval('location.hash')) === '' && (await hubKeys(pb)).length === 0, `틀린 #hub: 알림 · 주소 "${await pb.eval('location.hash')}" · nb-hub ${(await hubKeys(pb)).length}개`);
      await gotoHub(ctx.localBase + '/index.html?qa=2#hub=' + hubCode());
      const conf = await pb.eval(`JSON.parse(localStorage.getItem('nb-hub')||'null')`);
      ok('W1', await sawToast(pb, /허브 코드를 저장했어요/, { t: 0 }, 5000) && (await pb.eval('location.hash')) === '' && !(await pb.eval('location.href')).includes('nbhub1') && conf && conf.u === FAKE_HUB_URL,
        `맞는 #hub: 저장 · 주소에 코드 ${(await pb.eval('location.href')).includes('nbhub1') ? '남음' : '없음'}`);
      await openSettings(pb);
      await pb.click('#hubForget'); await pb.click('#hubForget');
      await pb.until(`Hub.conf===null`, 5000);
      ok('W1', (await hubKeys(pb)).length === 0, '기기 2도 끊음 (nb-hub* 0개)');
    });
  } finally {
    await hb.closeAll();
  }
}
