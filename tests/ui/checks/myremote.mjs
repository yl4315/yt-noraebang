// 내 폰 리모컨 (CR-228 ③, X9~X11 · ④ 기본 길 TV QR L6): 노래방 PC 1 + 내 폰 1을 따로 켠 Edge 둘로 본다 (따로 켠 Edge = 따로 저장소 = 다른 기기).
// 가짜 허브(fakehub.mjs)의 가짜 Realtime 공개 broadcast만 쓰고 진짜 허브에는 연결 0. 둘 다 정적 서버(= GitHub Pages와 같은 상태, server.py 없음)에서 연다.
// 폰은 같은 주소의 노래방 앱(index.html)에서 허브에 로그인한 뒤 remote.html을 연다 (실제 쓰는 순서 그대로).
// 방 이름·허브 주소·키는 이 점검의 기록·결과표에도 쓰지 않는다: Node 변수에만 두고 "몇 개 보였나"만 센다.
// 시험 곡·계정은 이 점검이 켠 Edge 임시 프로필에만 넣고, 점검이 끝나면 프로필째 지운다 (run.mjs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PC, PHONE, READY_DEMO, openPage, seedSong, txt, visible, isHidden, clipShot, sleep, q } from './_lib.mjs';
import { wav } from '../fixtures.mjs';
import { FAKE_HUB_HOST, FAKE_HUB_KEY, hubCode, fakeMail, makeFakeRealtime } from '../fakehub.mjs';
export const areas = ['X'];

// 모든 console 글을 모아 둔다 (방 이름·허브 주소·키가 찍히지 않았는지 훑음)
const CONS = `(() => { if (window.__cons) return; const c = window.__cons = [];
  for (const m of ['log','info','warn','error','debug']) { const o = console[m].bind(console); console[m] = (...a) => { try { c.push(a.map(x => { try { return typeof x === 'string' ? x : (x && x.stack) || JSON.stringify(x); } catch { return String(x); } }).join(' ').slice(0, 2000)); } catch {} return o(...a); }; } })()`;
// PC가 받은 명령 기록 (remoteRun을 감싸서 이름만 적고 그대로 실행, remote.mjs와 같은 방법)
const SPY_CMDS = `if(!window.__cmds){ window.__cmds=[]; const o=remoteRun; remoteRun=c=>{ __cmds.push(c.cmd); return o(c); }; }`;
const ROOM_RE = /^nbm-[A-Za-z0-9_-]{43}$/;
const APP_ON = `!$('#app').hidden && $('#hubView').hidden && $('#pinView').hidden && !$('#conn').hidden && $('#conn span').textContent==='연결됨'`;
const VIEW = h => `!$('#hubView').hidden && $('#app').hidden && $('#hubH').textContent===${q(h)}`;
const H_LOGIN = '허브 로그인이 필요해요', H_OFF = '폰 리모컨이 꺼져 있어요';

export default async function myremote(ctx) {
  const { ok, step } = ctx, H = ctx.hub;
  await ctx.startStatic();
  const base = ctx.staticBase;
  const R = makeFakeRealtime({ onNet: n => ctx.netLog.push(n) });
  H.rt = R;
  const shotDir = ctx.shotsDir; fs.mkdirSync(shotDir, { recursive: true });
  const shot = async (p, name) => { try { await sleep(350); await p.shot(path.join(shotDir, name)); } catch (e) { ctx.log('  (사진 실패 ' + name + ': ' + e.message + ')'); } };
  const waitNode = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (fn()) return true; } catch {} await sleep(100); } return !!fn(); };
  const secrets = new Set([FAKE_HUB_HOST, FAKE_HUB_KEY]);
  const leaks = text => [...secrets].filter(s => s && String(text).includes(s)).length;
  const dump = p => p.eval(`({html:document.documentElement.outerHTML, text:document.body.innerText, href:location.href, cons:(window.__cons||[]).join('\\n')})`);
  const typeInto = async (p, sel, text) => { await p.eval(`(()=>{const e=$(${q(sel)}); e.value=''; e.focus()})()`); await p.type(text); };
  const tagOf = room => R.tag('realtime:' + room);
  // PC → 폰 답 (이벤트 m). to = 폰 표
  const toPid = (pid, t, from = 0) => R.log.slice(from).filter(e => e.op === 'broadcast' && e.event === 'm' && e.from === 'page' && e.toGid === pid && (!t || e.t === t));
  const fakePid = () => crypto.randomBytes(16).toString('base64url');     // 22자 (폰 표 모양)

  const hb = await ctx.newBrowser(), pb = await ctx.newBrowser();
  const host = await openPage(ctx, PC, null, READY_DEMO, hb);
  await R.attach(host, hb);
  await host.s('Page.addScriptToEvaluateOnNewDocument', { source: CONS });
  await host.goto(base + '/index.html', READY_DEMO, 150000);
  const ph = await openPage({ ...ctx, adv: false }, PHONE, null, null, pb);
  await R.attach(ph, pb);
  await ph.s('Page.addScriptToEvaluateOnNewDocument', { source: CONS });
  await ph.media([{ name: 'prefers-color-scheme', value: 'dark' }]);
  const openSettings = async () => { if (!(await host.eval(`$('#cloudDialog').open`))) { await host.click('#settingsBtn'); await host.until(`$('#cloudDialog').open`, 3000); } };
  const closeDialogs = () => host.eval(`document.querySelectorAll('dialog[open]').forEach(d=>d.close())`);
  const cmds = () => host.eval('__cmds.length');

  const mk = (name, sec, f1, f2) => { const f = path.join(ctx.tmp, 'files', name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, wav(sec, f1, f2)); return f; };
  const songs = [];
  const email = fakeMail('qa-my-' + crypto.randomBytes(3).toString('hex')), pw = 'qa-' + crypto.randomBytes(9).toString('hex');
  const uid = H.addUser(email, pw);
  const slot = () => H.secrets.get([uid, 'noraebang', 'remote_room'].join('|'));
  let room = '', phonePid = '';

  await step('노래방 PC 준비 (정적 서버 = Pages): 시험 곡 2개 · 허브 로그인 전에는 내 폰 리모컨 칸 없음', ['X9'], async () => {
    songs.push(await seedSong(host, { title: 'QA 내폰 첫곡', artist: 'QA가수', wav: mk('QA 내폰 첫곡.wav', 90, 262, 392) }));
    songs.push(await seedSong(host, { title: 'QA 내폰 둘째곡', artist: 'QA가수B', wav: mk('QA 내폰 둘째곡.wav', 90, 294, 440) }));
    await host.eval(SPY_CMDS);
    await openSettings();
    const st = await host.eval(`({sec:$('#myRemoteSec').hidden, sub:$('#advSubMy').hidden, on:My.on, old:$('#remoteSec').hidden})`);
    ok('X9', songs.length === 2 && st.sec && st.sub && !st.on && R.opens === 0,
      `로그인 전: 칸 ${st.sec ? '숨김' : '보임'} · "더 보기 (고급)" 작은 글 ${st.sub ? '없음' : '있음'} · Realtime 연결 ${R.opens} · 옛 폰 리모컨 칸 ${st.old ? '숨김(정적 서버)' : '보임'}`);
    await closeDialogs();
    await host.eval('enterTV()');
    const tv0 = await host.until(`state.tv && !$('#tvIdle').hidden`, 4000) && await isHidden(host, '#remoteInfo') && await host.eval(`!$('#remoteInfo').childElementCount`);
    await host.eval('exitTV()');
    ok('L6', tv0, `정적 서버(Pages) · 내 폰 리모컨 꺼짐: TV 대기 화면 리모컨 칸 ${tv0 ? '없음' : '있음'} (예전처럼 숨김)`);
  });

  await step('노래방 PC: 허브 코드 저장 · 가짜 계정 로그인 → 설정 › 더 보기 (고급)에 "내 폰 리모컨 (허브)" 칸 (처음엔 꺼짐)', ['X9'], async () => {
    await openSettings(); await host.scrollTo('#hubSec');
    await typeInto(host, '#hubCode', hubCode()); await host.click('#hubCodeSave'); await sleep(300);
    await typeInto(host, '#hubEmail', email); await typeInto(host, '#hubPw', pw);
    await host.click('#hubLoginBtn');
    await host.until(`!$('#hubLoginBtn').disabled && !/로그인 중|맞추는 중/.test($('#hubMsg').textContent)`, 20000);
    const shown = await host.until(`!$('#myRemoteSec').hidden && !$('#advSubMy').hidden`, 5000);
    const st = await host.eval(`({inAdv:$('#advBox').contains($('#myRemoteSec')), next:($('#myRemoteSec').nextElementSibling||{}).id, h3:$('#myRemoteSec h3').textContent,
      on:$('#myRemoteOn').checked, role:$('#myRemoteOn').getAttribute('role'), sub:$('#myRemoteSub').textContent, link:$('#myRemoteLink').href, linkRow:!$('#myRemoteLink').parentElement.hidden, pref:localStorage.getItem('nb-myremote'), my:My.on})`);
    ok('X9', shown && st.inAdv && st.next === 'remoteSec' && st.h3 === '내 폰 리모컨 (허브)', `로그인하면 보임 · 고급 안 · 옛 폰 리모컨 칸 바로 위 · 제목 "${st.h3}"`);
    ok('X9', !st.on && !st.my && st.role === 'switch' && st.sub === '꺼짐 · 노래방을 띄운 PC에서 켜요' && st.pref === null && slot() === undefined && R.joins.length === 0,
      `처음엔 꺼짐: "${st.sub}" · 열쇠 칸 ${slot() === undefined ? '비어 있음' : '있음'} · 채널 ${R.joins.length}개`);
    ok('X9', st.link === base + '/remote.html' && st.linkRow, '[이 기기에서 리모컨 열기] = 같은 주소의 remote.html (꺼져 있을 때 보임)');
  });

  await step('켜기: 새 256비트 방(손님 방과 다른 모양) → 열쇠 칸 remote_room → 듣기 · 켜 둔 것을 이 기기에 기억', ['X9'], async () => {
    await host.eval(`$('#myRemoteOn').click()`);
    const on = await host.until(`My.on && !My.busy`, 20000);
    room = on ? await host.eval('My.room') : '';
    if (room) secrets.add(room);
    const j = R.joins[R.joins.length - 1] || {};
    const st = await host.eval(`({sub:$('#myRemoteSub').textContent, sw:$('#myRemoteOn').checked, pref:localStorage.getItem('nb-myremote'), linkHid:$('#myRemoteLink').parentElement.hidden})`);
    ok('X9', on && ROOM_RE.test(room) && slot() === room && (room.length - 4) * 6 >= 256, `켜짐 · 방 이름 nbm- + ${room.length - 4}자 (base64url, 32바이트 = 256비트 난수) · 열쇠 칸 = 이 방`);
    ok('X9', j.room === tagOf(room) && j.private === false && j.self === false && j.presence === false && j.pg === 0 && R.badKey === 0 && R.badUrl === 0,
      `채널: 공개 broadcast (private ${j.private} · self ${j.self} · presence ${j.presence} · 표 변경 ${j.pg}) · 공개 키만`);
    ok('X9', st.sw && st.sub === '켜짐 · 폰 0대' && st.pref === '1' && st.linkHid, `"${st.sub}" · 기억 nb-myremote=${st.pref} · 받는 기기에는 [이 기기에서 리모컨 열기] ${st.linkHid ? '숨김' : '보임'}`);
    const d = await dump(host);
    ok('X9', leaks(d.text) + leaks(d.html) + leaks(d.cons) + leaks(d.href) === 0, `PC 화면 글·HTML·콘솔·주소에 방 이름·허브 주소·키 ${leaks(d.text)}·${leaks(d.html)}·${leaks(d.cons)}·${leaks(d.href)}개`);
    await clipShot(host, ['#myRemoteSec'], path.join(shotDir, 'x-my-host-on.png'));
  });

  // CR-228 ④ 기본 길 (L6): 켜 둔 동안 server.py 없는 화면의 TV 대기 화면에 내 폰 리모컨 QR + 글 + 옛 길 안내 한 줄. 손님 QR이 보이면 숨김
  await step('TV 대기 화면 (기본 길): 내 폰 리모컨 QR = 같은 곳 remote.html(?·# 없음) · 글 · 옛 길 안내 한 줄 · 주소 글 없음 · 손님 QR이 보이면 숨김', ['L6'], async () => {
    const want = base + '/remote.html';
    await closeDialogs();
    await host.eval('enterTV()');
    const shown = await host.until(`state.tv && !$('#tvIdle').hidden && !$('#remoteInfo').hidden && !!$('#remoteInfo img.qr')`, 10000);   // CR-251 YT-r16: 앱 안 toqr라 인터넷 조건 없이 늘 나와야 함
    // QR 그림을 칸마다 읽어 toqr(앱 안 사본)로 만든 같은 주소 무늬와 맞춰 본다 (cdnjs qrcode 라이브러리는 안 불러야 함)
    const st = await host.eval(`(async()=>{ const b=$('#remoteInfo'), img=b.querySelector('img.qr'); let same=false;
      if (img) { await img.decode().catch(()=>{}); const { toQR } = await import(new URL('js/vendor/toqr-0.1.1.mjs', document.baseURI).href);
        const m = toQR(${q(want)}, 0), n = Math.round(Math.sqrt(m.length)), cell = img.naturalWidth / (n + 4);
        const cv = document.createElement('canvas'); cv.width = cv.height = img.naturalWidth; const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, cv.width, cv.height).data; same = Number.isInteger(cell) && cell > 0;
        for (let y = 0; same && y < n; y++) for (let x = 0; x < n; x++) { const i = (Math.floor((y + 2.5) * cell) * cv.width + Math.floor((x + 2.5) * cell)) * 4; if ((px[i] < 128) !== !!m[y * n + x]) { same = false; break; } } }
      const cdn = [...document.scripts].some(x => /cdnjs/.test(x.src)) || typeof qrcode !== 'undefined';
      return { title:b.querySelector('.my-tv b')?.textContent||'', line:b.querySelector('.my-tv span')?.textContent||'', old:b.querySelector('.my-tv-old')?.textContent||'', T:MY_TV_TEXT,
        t:b.textContent, qr:b.querySelectorAll('img.qr').length, same, cdn, alt:img?.alt||'', url:myRemoteUrl(location.href), html:b.innerHTML.replace(/ src="[^"]*"/g,'') }; })()`);
    const oldVis = await visible(host, '#remoteInfo .my-tv-old');
    ok('L6', shown && await visible(host, '#remoteInfo') && st.title === st.T.title && st.line === st.T.line && st.qr === 1 && st.same && !st.cdn,
      `TV 대기 화면: "${st.title}" · "${st.line}" · QR ${st.qr}개${st.same ? ' (= 같은 곳 remote.html, 앱 안 toqr)' : ''}${st.cdn ? ' · cdnjs QR 라이브러리를 불렀음' : ''}`);
    ok('L6', st.url === want && !/[?#]/.test(st.url) && !/remote\.html|https?:|nbm-/.test(st.html) && !/remote\.html|https?:/.test(st.t) && st.alt === st.T.alt,
      `QR 주소 = 같은 곳 remote.html (?·# 없음 = 방 이름·코드 0) · 화면 글·HTML에 주소 없음 · 그림 설명 "${st.alt}"`);
    ok('L6', oldVis && st.old === st.T.old && /YT\s노래방\s켜기/.test(st.old) && /옛\s폰\s리모컨\sQR/.test(st.old),
      `옛 길 안내 보임: "${st.old.replace(/\u00a0/g, ' ')}"`);
    await shot(host, 'x-my-tv-qr.png');
    // 손님 QR을 켜면 리모컨 칸은 숨김 (css .tv-idle.guest-on .remote-info) → 손님 방을 닫으면 다시 보임
    await host.eval('guestOpen()');
    const g = await host.until(`Guest.on && !!Guest.qr && !Guest.busy && $('#tvIdle').classList.contains('guest-on') && !$('#guestCardQr').hidden`, 20000);
    const gRoom = g ? await host.eval('Guest.room') : '';
    if (gRoom) secrets.add(gRoom);
    const gHid = g && await isHidden(host, '#remoteInfo') && await host.eval('My.on && !$("#remoteInfo").hidden');
    await shot(host, 'x-my-tv-guest.png');
    await host.eval('guestClose()');
    const back = await host.until(`!Guest.on && !Guest.busy && !$('#tvIdle').classList.contains('guest-on')`, 8000) && await visible(host, '#remoteInfo');
    await host.eval('exitTV()');
    ok('L6', gHid && back, `손님 QR 켬 → 리모컨 칸 ${gHid ? '숨김' : '안 숨음'} (켜 둔 그대로) · 손님 방 닫음 → ${back ? '다시 보임' : '안 보임'}`);
  });

  await step('폰: 허브 로그인 안 한 폰 → "노래방 설정 › 허브 연결에서 로그인하고 돌아오면…" + [노래방 열기] · server.py로 열면 옛 코드 화면 그대로', ['X11'], async () => {
    await ph.s('Page.navigate', { url: base + '/remote.html' });
    const seen = await ph.until(`document.readyState==='complete' && (${VIEW(H_LOGIN)})`, 15000);
    const st = await ph.eval(`({p:$('#hubP').textContent, open:!$('#hubOpen').hidden, href:$('#hubOpen').href, retry:!$('#hubRetry').hidden, pin:$('#pinView').hidden, connHid:$('#conn').hidden, ls:Object.keys(localStorage).filter(k=>k.startsWith('nb-hub')).length})`);
    ok('X11', seen && /노래방 설정 › 허브\s연결에서 로그인하고 돌아오면 바로 이어져요/.test(st.p) && st.open && st.href === base + '/' && !st.retry && st.pin && st.connHid && st.ls === 0,
      `"${H_LOGIN}" · [노래방 열기] → 노래방 첫 화면 · 코드 입력 화면 ${st.pin ? '없음' : '보임'} · 연결 점 ${st.connHid ? '숨김' : '보임'}`);
    await shot(ph, 'x-my-phone-login.png');
    // 로그인 세션을 쓰는 화면이라 remote.html에도 CSP: 주고받는 곳은 같은 주소와 회사 허브(*.supabase.co)만
    const csp = await ph.eval(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content||''`);
    const conn = (/connect-src ([^;]+)/.exec(csp) || [])[1] || '';
    ok('X11', conn.trim() === "'self' https://*.supabase.co wss://*.supabase.co" && /object-src 'none'/.test(csp), `remote.html CSP connect-src: ${conn ? '같은 주소 + 회사 허브만' : '없음'}`);
    // server.py(이 PC 127.0.0.1)로 열면: /api/remote/info가 답하니 옛 길 = 4자리 코드 화면
    await ph.s('Page.navigate', { url: ctx.base + '/remote.html' });
    const old = await ph.until(`document.readyState==='complete' && !$('#pinView').hidden && $('#hubView').hidden && $('#app').hidden`, 10000);
    ok('X11', old && /노래방 코드 입력/.test(await txt(ph, '#pinView h1')), 'server.py 주소: 옛 폰 리모컨 코드 입력 화면 그대로 (허브 길 안 씀)');
  });

  await step('폰: 같은 주소의 노래방 앱에서 허브 로그인 → remote.html = 바로 이어짐 · 곡·예약·사용자 보임', ['X10'], async () => {
    await ph.goto(base + '/index.html', READY_DEMO, 150000);
    await ph.eval(`(()=>{ $('#hubCode').value=${q(hubCode())}; hubCodeSave(); })()`);
    await ph.until('hubOn()', 5000);
    await ph.eval(`(()=>{ $('#hubEmail').value=${q(email)}; $('#hubPw').value=${q(pw)}; $('#hubLogin').requestSubmit(); })()`);
    const inOk = await ph.until(`/로그인했어요/.test($('#hubMsg').textContent)`, 20000);
    const sets0 = H.secretSets.length;
    await ph.s('Page.navigate', { url: base + '/remote.html' });
    const on = await ph.until(`document.readyState==='complete' && (${APP_ON})`, 20000);
    const want = await host.eval(`remoteState().songs.length`);
    const got = await ph.until(`S && S.songs.length===${want} && document.querySelector('#whoName').textContent===${q(await host.eval('me().name'))}`, 10000);
    const st = await ph.eval(`({n:S.songs.length, who:$('#whoName').textContent, url:location.search+location.hash, a2:!$('#a2hs').hidden})`);
    const hello = R.log.find(e => e.op === 'broadcast' && e.event === 'p' && e.from === 'page' && e.t === 'hello' && e.room === tagOf(room));
    phonePid = hello ? hello.pid : '';
    ok('X10', inOk && on && got && st.url === '', `로그인 뒤 remote.html → "연결됨" · 곡 ${st.n}개 (PC ${want}개) · 사용자 "${st.who}" · 주소 뒤 글 ${st.url ? '있음' : '없음'}`);
    ok('X10', await host.until(`My.phones.size===1 && $('#myRemoteSub').textContent==='켜짐 · 폰 1대'`, 5000) && toPid(phonePid, 'welcome').length >= 1, 'PC: "켜짐 · 폰 1대 이어짐" · 폰에 welcome');
    ok('X10', H.secretSets.length === sets0, `폰은 열쇠 칸을 읽기만 (쓰기 ${H.secretSets.length - sets0}번)`);
    await ph.eval('window.scrollTo(0,0)');
    await shot(ph, 'x-my-phone-app.png');
  });

  await step('폰 → PC 명령 16가지: 옛 폰 리모컨과 같은 remoteRun이 실행 · 폰 화면이 PC 상태를 따라감', ['X10'], async () => {
    const [s1, s2] = songs.map(s => s.id);
    const v0 = await host.eval('settings.mrVol'), meId = await host.eval('me().id');
    const bad = [];
    const run = async (name, js, until, ms = 6000) => {
      const n0 = await cmds();
      await ph.eval(js);
      const done = await host.until(`__cmds.length>${n0} && (${until})`, ms);
      if (!done) bad.push(name);
      await sleep(250);
    };
    const btn = sel => `document.querySelector(${q(sel)}).click()`;
    const send = (c, a, msg) => `send(${q(c)}, ${q(a)}${msg ? ', ' + q(msg) : ''})`;
    await ph.eval(`(()=>{ if (window.__toasts) return; const t=$('#toast'), a=window.__toasts=[]; new MutationObserver(()=>{ if(!t.hidden) a.push(t.textContent); }).observe(t,{attributes:true,childList:true,characterData:true,subtree:true}); })()`);
    await run('reserve', send('reserve', { id: s1 }, '예약 · QA 내폰 첫곡'), `state.queue.includes(${q(s1)})`);
    const toastOk = await ph.until(`__toasts.includes('예약 · QA 내폰 첫곡')`, 4000);
    const queueOk = await ph.until(`S && S.queue.includes(${q(s1)})`, 4000);
    await run('reserve 우선', send('reserve', { id: s2, priority: true }), `state.queue[0]===${q(s2)}`);
    await run('top', send('top', { id: s1 }), `state.queue[0]===${q(s1)}`);
    await run('unreserve', send('unreserve', { id: s2 }), `!state.queue.includes(${q(s2)})`);
    await run('reserveMany', send('reserveMany', { ids: [s2], label: 'QA 목록' }), `state.queue.includes(${q(s2)})`);
    await run('fav', send('fav', { id: s1 }), `me().favorites.includes(${q(s1)})`);
    await run('profile', send('profile', { id: meId }), `me().id===${q(meId)}`);
    await run('key', btn('[data-cmd="key"][data-delta="1"]'), 'state.key===1');
    await run('keyReset', btn('[data-cmd="keyReset"]'), '(state.key||0)===0');
    await run('mr', btn('[data-cmd="mr"][data-delta="-5"]'), `settings.mrVol===${v0 - 5}`);
    await run('rec', btn('[data-cmd="rec"]'), 'state.armed===true');
    await run('rec 끄기', btn('[data-cmd="rec"]'), 'state.armed===false');
    await run('start', btn('[data-cmd="start"]'), 'state.playing');
    const playT = await host.eval(`state.song ? state.song.title : ''`);
    const nowOk = !!playT && await ph.until(`(document.querySelector('#now .t')?.textContent||'')===${q(playT)} && /부르는 중/.test(document.querySelector('#now .meta')?.textContent||'')`, 6000);
    await run('pause', btn('[data-cmd="pause"]'), '!state.playing');
    await run('now', send('now', { id: s2 }), `state.song && state.song.id===${q(s2)}`);
    await run('jump', btn('[data-cmd="jump"]'), 'true');
    await run('cancel', btn('[data-cmd="cancel"]'), '!state.playing');
    await run('tv', btn('[data-cmd="tv"]'), 'state.tv');
    await host.eval('exitTV()'); await sleep(200);
    const got = new Set(await host.eval('__cmds'));
    const all = ['start', 'pause', 'cancel', 'jump', 'reserve', 'reserveMany', 'unreserve', 'top', 'now', 'mr', 'key', 'keyReset', 'profile', 'fav', 'tv', 'rec'];
    const miss = all.filter(c => !got.has(c));
    ok('X10', !miss.length && !bad.length, miss.length || bad.length ? `안 된 명령: ${[...miss, ...bad].join(',')}` : '16가지 다 PC remoteRun이 실행 (각각 PC 상태로 확인)');
    const oks = toPid(phonePid, 'ok').length, nos = toPid(phonePid, 'no').length;
    const toasts = await ph.eval('__toasts.join(" | ")'), nowT = await ph.eval(`document.querySelector('#now')?.textContent||''`);
    ok('X10', toastOk && queueOk && nowOk && oks >= 18 && nos === 0, `폰: 알림 ${toastOk ? '"예약 · QA 내폰 첫곡"' : '없음(' + toasts + ')'} · 예약 목록 ${queueOk ? '따라감' : '안 따라감'} · 지금 곡 ${nowOk ? '따라감(부르는 중)' : '안 따라감(PC "' + playT + '" · 폰 "' + nowT.slice(0, 40) + '")'} · PC 답 ok ${oks}개 · no ${nos}개`);
    await host.eval(`(async()=>{ cancelNext(); stopPlayback(); state.queue=[]; saveQueue(); renderQueue(); })()`);
  });

  await step('PC가 지키는 것: 안 들어온 표·모르는 종류·모르는 명령·4KB 넘음 버림 · 없는 곡·예약·사용자 거절 · 한 대 1초 8개 · 폰 4대까지', ['X10'], async () => {
    const A = fakePid(), say = (pid, o) => R.injectRoom(room, 'p', { v: 1, pid, ...o });
    const n0 = await cmds(), l0 = R.log.length;
    say(A, { t: 'cmd', seq: 1, cmd: 'keyReset' });                                          // hello 전 명령
    await sleep(600);
    const before = (await cmds()) === n0 && toPid(A, '', l0).length === 0;
    say(A, { t: 'hello' });
    const welcome = await waitNode(() => toPid(A, 'welcome', l0).length === 1, 4000);
    const l1 = R.log.length;
    say(A, { t: 'cmd', seq: 2, cmd: 'eval' });
    say(A, { t: 'search', seq: 3, q: 'a' });
    say(A, { v: 2, t: 'cmd', seq: 4, cmd: 'start' });
    say(A, { t: 'cmd', seq: 5, cmd: 'reserveMany', args: { ids: Array.from({ length: 60 }, (_, i) => String(i).padEnd(90, 'x')) } });   // 4KB 넘음
    say(A, { t: 'cmd', seq: 6, cmd: 'start', args: { x: 1 } });
    R.injectRoom(room, 'p', { v: 1, t: 'reserve', gid: A, no: 1 });                        // 손님 방 모양
    await sleep(800);
    const dropped = (await cmds()) === n0 && toPid(A, '', l1).length === 0;
    say(A, { t: 'cmd', seq: 7, cmd: 'reserve', args: { id: 'qa-no-such-song' } });
    say(A, { t: 'cmd', seq: 8, cmd: 'unreserve', args: { id: songs[0].id } });
    say(A, { t: 'cmd', seq: 9, cmd: 'profile', args: { id: 'qa-no-profile' } });
    await waitNode(() => toPid(A, 'no', l1).length >= 3, 4000);
    const whys = toPid(A, 'no', l1).map(e => e.why).join(',');
    await sleep(1200);
    const n1 = await cmds(), l2 = R.log.length;
    for (let i = 0; i < 12; i++) say(A, { t: 'cmd', seq: 20 + i, cmd: 'keyReset' });
    await sleep(1000);
    const ran = (await cmds()) - n1, oks = toPid(A, 'ok', l2).length;
    ok('X10', before && welcome && dropped, `hello 전 명령 버림 · hello → welcome · 모르는 명령·종류·v2·4KB 넘음·칸 틀림·손님 모양 버림 (답 없음, PC 실행 0)`);
    ok('X10', whys === 'nosong,gone,noprofile' && (await cmds()) - n1 === ran, `없는 곡·예약에 없는 곡·없는 사용자 → 거절 (${whys})`);
    ok('X10', ran === 8 && oks === 8, `한 대가 1초에 12번 → ${ran}번 실행 (답 ok ${oks})`);
    const B = fakePid(), C = fakePid(), D = fakePid(), l3 = R.log.length;
    for (const p of [B, C]) say(p, { t: 'hello' });
    await waitNode(() => toPid(C, 'welcome', l3).length === 1, 4000);
    say(D, { t: 'hello' });
    const full = await waitNode(() => toPid(D, 'full', l3).length === 1, 4000);
    const four = await host.eval(`My.phones.size===4 && $('#myRemoteSub').textContent==='켜짐 · 폰 4대'`);
    for (const p of [A, B, C]) say(p, { t: 'bye' });
    ok('X10', full && four && toPid(D, 'welcome', l3).length === 0 && await host.until('My.phones.size===1', 4000), '폰 4대까지 (5번째는 full) · bye → 나감');
  });

  await step('손님 채널로 보낸 내 폰 명령은 안 됨 (방이 따로)', ['X10'], async () => {
    await openSettings(); await host.scrollTo('#guestSec'); await host.click('#guestRow'); await host.until(`$('#guestDialog').open`, 3000);
    const gOpen = await host.until(`Guest.on && !!Guest.qr && !Guest.busy`, 20000);
    const gRoom = gOpen ? await host.eval('Guest.room') : '';
    if (gRoom) secrets.add(gRoom);
    const E = fakePid(), n0 = await cmds(), l0 = R.log.length;
    const subs = R.injectRoom(gRoom, 'p', { v: 1, t: 'hello', pid: E });
    R.injectRoom(gRoom, 'p', { v: 1, t: 'cmd', pid: E, seq: 1, cmd: 'start' });
    R.injectRoom(gRoom, 'g', { v: 1, t: 'cmd', pid: E, seq: 2, cmd: 'start' });
    R.injectRoom(gRoom, 'g', { v: 1, t: 'cmd', gid: E.slice(0, 16), seq: 3, cmd: 'start' });
    R.injectRoom(gRoom, 'g', { v: 1, t: 'hello', pid: E });
    await sleep(1000);
    const replies = R.log.slice(l0).filter(e => e.op === 'broadcast' && e.from === 'page' && (e.toGid === E || e.toGid === E.slice(0, 16) || (e.event === 'm' && e.room === tagOf(gRoom))));
    ok('X10', gOpen && subs >= 1 && (await cmds()) === n0 && !(await host.eval('state.playing')) && replies.length === 0 && toPid(E).length === 0,
      `손님 방(PC가 듣는 중 ${subs}개)에 내 폰 모양 hello·명령 5개 → PC 실행 0 · 답 0 · 내 폰 방은 그대로 (${await host.eval('My.on') ? '켜짐' : '꺼짐'})`);
    await host.click('#guestCloseBtn');
    await host.until(`!Guest.on`, 4000);
    await closeDialogs();
  });

  let room2 = '';
  // CR-251 YT-r4: 폰 화면이 30초 넘게 꺼졌다 켜져도(PC는 그대로) "꺼져 있어요"로 굳지 않고 저절로 다시 이어진다.
  // 폰 페이지의 시계만 31초 앞으로 돌려 "30초 소식 없음"을 만든다 (PC·가짜 허브는 그대로)
  await step('폰 30초 소식 없음 (화면 꺼짐 흉내) → 끝난 방으로 적지 않고 같은 방에 저절로 다시 이어짐', ['X11'], async () => {
    const before = await ph.until(APP_ON, 8000);
    const l0 = R.log.length;
    await ph.eval(`(() => { const o = Date.now.bind(Date); window.__dn = o; Date.now = () => o() + 31000; })()`);
    const waitSeen = await ph.until(`!$('#hubView').hidden || !(${APP_ON})`, 5000);
    const back = await ph.until(APP_ON, 15000);
    const hellos = R.log.slice(l0).filter(e => e.op === 'broadcast' && e.event === 'p' && e.t === 'hello').length;
    await sleep(1500);
    const still = await ph.eval(APP_ON);
    await ph.eval(`if (window.__dn) { Date.now = window.__dn; delete window.__dn; }`);
    ok('X11', before && back && still && hellos >= 1 && await host.until('My.phones.size===1', 5000),
      `30초 소식 없음 → ${waitSeen ? '"연결하는 중"을 거쳐 ' : ''}같은 방에 다시 hello ${hellos}번 → 다시 "연결됨"${back ? '' : ' (안 됨)'} · "꺼져 있어요"로 굳지 않음`);
  });

  await step('끄기 → 폰 "[폰 리모컨 받기]를 켜 주세요" · 열쇠 칸 비움 · 다시 켜면 새 방 (옛 방 이름은 안 통함) · [다시 해 보기]', ['X9', 'X11'], async () => {
    await host.eval(`$('#myRemoteOn').click()`);
    const off = await host.until(`!My.on && !My.busy && !$('#myRemoteOn').checked`, 6000);
    const seen = await ph.until(VIEW(H_OFF), 8000);
    const st = await ph.eval(`({p:$('#hubP').textContent, retry:!$('#hubRetry').hidden, open:!$('#hubOpen').hidden, connHid:$('#conn').hidden})`);
    ok('X9', off && slot() === undefined && await host.eval(`localStorage.getItem('nb-myremote')===null && $('#myRemoteSub').textContent==='꺼짐 · 노래방을 띄운 PC에서 켜요'`),
      `끄면: 열쇠 칸 ${slot() === undefined ? '비움' : '남음'} · 기억 지움 · "${await txt(host, '#myRemoteSub')}"`);
    ok('L6', off && await host.eval(`$('#remoteInfo').hidden && !$('#remoteInfo').childElementCount`), '끄면 TV 대기 화면 내 폰 리모컨 QR 바로 숨김 (새로 고침 없이)');
    ok('X11', seen && /\[폰\s리모컨\s받기\]를\s켜\s주세요/.test(st.p) && st.retry && !st.open && st.connHid, `폰: "${H_OFF}" · [다시 해 보기] · 연결 점 ${st.connHid ? '숨김' : '보임'}`);
    await shot(ph, 'x-my-phone-off.png');
    await ph.eval(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })`);
    const A = fakePid(), l0 = R.log.length;
    const deadSubs = R.injectRoom(room, 'p', { v: 1, t: 'hello', pid: A });
    await host.eval(`$('#myRemoteOn').click()`);
    const on = await host.until(`My.on && !My.busy`, 20000);
    room2 = on ? await host.eval('My.room') : '';
    if (room2) secrets.add(room2);
    const oldSubs = R.injectRoom(room, 'p', { v: 1, t: 'hello', pid: A });
    await sleep(600);
    ok('X9', on && ROOM_RE.test(room2) && room2 !== room && slot() === room2 && deadSubs === 0 && oldSubs === 0 && toPid(A, '', l0).length === 0,
      `다시 켜면 새 방 이름 · 열쇠 칸 = 새 방 · 옛 방 이름으로 hello → 듣는 곳 ${oldSubs}개 · 답 0`);
    ok('L6', on && await host.until(`!$('#remoteInfo').hidden && !!$('#remoteInfo .my-tv') && (!!$('#remoteInfo img.qr') || ${ctx.conds.W === false})`, 8000), '다시 켜면 TV 대기 화면 QR 다시 보임');
    const still = await ph.eval(VIEW(H_OFF));
    await ph.tap('#hubRetry');
    const back = await ph.until(APP_ON, 15000);
    await ph.eval(`delete document.visibilityState`);
    ok('X11', still && back && await host.until('My.phones.size===1', 5000), `PC가 다시 켜도 폰은 끝난 방 안내 그대로${still ? '' : '(아님)'} → [다시 해 보기] → 새 방으로 다시 이어짐`);
  });

  await step('노래방 화면을 닫거나 새로 고침 → 폰 "꺼져 있어요" · 켜 둔 기기는 다시 열 때 새 방으로 저절로 켬', ['X9'], async () => {
    const closed0 = R.log.filter(e => e.op === 'broadcast' && e.t === 'closed' && e.from === 'page').length;
    // 폰은 그동안 화면이 숨은 것으로 둔다 (꺼짐 화면에서 15초마다 저절로 다시 보는 것을 막아, 꺼짐 안내를 확실히 본다)
    await ph.eval(`Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'})`);
    const t0 = Date.now(), reload = host.goto(base + '/index.html', READY_DEMO, 150000);
    // 닫히는 페이지가 pagehide에서 보내는 "closed"는 가짜 점검 다리(CDP)가 못 받는다 → 그때는 폰의 30초 끊김 길(LOST_MS)로 꺼짐. 바로 뜨는지는 기기 확인(X10)
    // CR-251 YT-r4: 30초 끊김 뒤 폰은 열쇠 칸을 다시 읽는다 → PC가 그사이 새 방을 열었으면 새 방에 저절로 이어지고, 아니면 "꺼져 있어요"
    const seen = await ph.until(`(${VIEW(H_OFF)}) || (${APP_ON})`, 45000), seenS = ((Date.now() - t0) / 1000).toFixed(1);
    const autoBack = seen && await ph.eval(APP_ON);
    const closedN = R.log.filter(e => e.op === 'broadcast' && e.t === 'closed' && e.from === 'page').length - closed0;
    await reload;
    const on = await host.until(`My.on && !My.busy`, 20000);
    const room3 = on ? await host.eval('My.room') : '';
    if (room3) secrets.add(room3);
    const why = [!seen && `폰 꺼짐 안내 안 보임(PC closed ${closedN}개)`, !on && 'PC가 다시 안 켬', on && !ROOM_RE.test(room3) && '이름 모양 틀림', on && room3 === room2 && '옛 방 이름', on && slot() !== room3 && '열쇠 칸 ≠ 새 방'].filter(Boolean);
    ok('X9', !why.length, `새로 고침: 폰 ${autoBack ? '새 방에 저절로 다시 이어짐' : '"' + H_OFF + '"'} (${seen ? seenS + '초 · ' + (closedN ? 'PC closed 받음' : '30초 끊김 길 — 가짜 다리는 닫히는 페이지 메시지를 못 받음, 바로 뜨는지 기기 확인') : '못 봄'}) → 다시 연 화면은 로그인한 채라 새 방으로 저절로 켬 (열쇠 칸 = 새 방)${why.length ? ' · 틀림: ' + why.join(', ') : ''}`);
    // 폰 화면을 다시 보이게 하고 [다시 해 보기] → 새 방 (열쇠 칸에서 새 이름을 읽음)
    await ph.eval(`delete document.visibilityState`);
    // CR-251 YT-r4: 30초 끊김 뒤 폰이 아직 옛 방에 다시 붙어 보는 중이면(답 기다림 WAIT_MS+9초) "꺼져 있어요" 또는 새 방 연결이 될 때까지 기다린다
    await ph.until(`(${VIEW(H_OFF)}) || (${APP_ON})`, 30000);
    const still = await ph.eval(VIEW(H_OFF));
    if (still) await ph.tap('#hubRetry');
    ok('X9', await ph.until(APP_ON, 20000) && await host.until('My.phones.size===1', 8000), `폰 ${still ? '[다시 해 보기]' : '저절로 다시 봄'} → 새 방에 이어짐 (PC 폰 1대)`);
  });

  await step('폰 로그아웃 → remote.html "허브 로그인이 필요해요" · PC 로그아웃 → 방 끝·열쇠 칸 비움·칸 숨김', ['X9', 'X11'], async () => {
    // 폰이 remote.html을 떠나면 "나가요"(bye). 진짜로 닫히는 페이지의 마지막 메시지는 가짜 점검 다리가 못 받으니,
    // 닫힐 때와 같은 pagehide를 먼저 불러 bye가 supabase의 pagehide 끊기보다 먼저 나가는지(잡기 단계) 본다
    await ph.eval(`dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))`);
    const gone = await host.until('My.phones.size===0', 5000);
    await ph.goto(base + '/index.html', 'typeof hubOn==="function" && hubOn()', 60000);
    await ph.eval('hubLogout()');
    await ph.until(`/로그아웃했어요/.test($('#hubMsg').textContent)`, 8000);
    await ph.s('Page.navigate', { url: base + '/remote.html' });
    const seen = await ph.until(`document.readyState==='complete' && (${VIEW(H_LOGIN)})`, 15000);
    const auth = await ph.eval(`Object.keys(localStorage).filter(k=>k.startsWith('nb-hub-auth')).length`);
    ok('X11', gone && seen && auth === 0, `폰이 떠날 때(pagehide) "나가요" → PC 폰 0대${gone ? '' : ' (안 됨)'} · 폰 로그아웃 뒤 remote.html "${H_LOGIN}"${seen ? '' : ' (안 보임)'} (로그인 세션 ${auth}개)`);
    await host.eval('hubLogout()');
    const done = await host.until(`!My.on && $('#myRemoteSec').hidden && $('#advSubMy').hidden`, 8000);
    ok('X9', done && slot() === undefined && await host.eval(`localStorage.getItem('nb-myremote')==='1'`), 'PC 로그아웃 → 방 끝 · 열쇠 칸 비움 · 칸 숨김 (켜 둔 설정은 이 기기에 그대로)');
    ok('L6', done && await host.eval(`$('#remoteInfo').hidden`), '로그아웃(방 끝) → TV 대기 화면 QR 숨김');
  });

  await step('방 이름·허브 주소·키: PC·폰 화면 글·HTML·콘솔·주소에 0 · 가짜 허브가 아닌 WebSocket 0', ['X9', 'X10'], async () => {
    const a = await dump(host), b = await dump(ph);
    const n = [a, b].reduce((s, d) => s + leaks(d.text) + leaks(d.html) + leaks(d.cons) + leaks(d.href), 0);
    ok('X9', n === 0, `PC·폰 훑기: ${n}개 (방 ${[room, room2].filter(Boolean).length + 1}개 이름 포함)`);
    ok('X10', R.real.length === 0, `가짜 허브가 아닌 WebSocket ${R.real.length}개 · 진짜 허브·다른 와이파이 폰은 사람 (기기 확인)`);
  });

  R.off(); H.rt = null;
  for (const b of [pb, hb]) { try { await b.closeAll(); } catch {} }
}
