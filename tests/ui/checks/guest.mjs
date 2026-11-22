// 손님 방 (CR-228, X1~X8): 방장 PC 1 + 손님 폰 2로 본다. 가짜 허브(fakehub.mjs)의 가짜 Realtime 공개 broadcast만 쓰고 진짜 허브에는 연결 0.
// Edge를 셋 켠다: 방장 · 손님 A(+ 꽉 참·옛 QR 손님) · 손님 B. 따로 켠 Edge = 따로 저장소 (손님 폰에 남는 것이 없는지 보려고).
// 방 이름·연결 코드·허브 주소·키는 이 점검의 기록·결과표에도 쓰지 않는다: Node 변수에만 두고 "몇 개 보였나"만 센다.
// 시험 곡·사용자 이름은 방장 Edge 임시 프로필에만 넣고, 점검이 끝나면 프로필째 지운다 (run.mjs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PC, PHONE, TV, READY_DEMO, openPage, seedSong, txt, visible, isHidden, count, marks, sawToast, sleep, enterTVNoFs } from './_lib.mjs';
import { wav } from '../fixtures.mjs';
import { FAKE_HUB_HOST, FAKE_HUB_KEY, hubCode, fakeMail, makeFakeRealtime } from '../fakehub.mjs';
export const areas = ['X'];

// 모든 console 글을 모아 둔다 (방 이름·코드·허브 주소·키가 찍히지 않았는지 훑음)
const CONS = `(() => { if (window.__cons) return; const c = window.__cons = [];
  for (const m of ['log','info','warn','error','debug']) { const o = console[m].bind(console); console[m] = (...a) => { try { c.push(a.map(x => { try { return typeof x === 'string' ? x : (x && x.stack) || JSON.stringify(x); } catch { return String(x); } }).join(' ').slice(0, 2000)); } catch {} return o(...a); }; } })()`;
const JOIN_READY = `!$('#scrJoin').hidden && !$('#joinBtn').disabled`;

export default async function guest(ctx) {
  const { ok, step } = ctx, H = ctx.hub;
  const R = makeFakeRealtime({ onNet: n => ctx.netLog.push(n) });
  H.rt = R;
  const shotDir = ctx.shotsDir; fs.mkdirSync(shotDir, { recursive: true });
  const shot = async (p, name) => { try { await sleep(350); await p.shot(path.join(shotDir, name)); } catch (e) { ctx.log('  (사진 실패 ' + name + ': ' + e.message + ')'); } };
  const waitNode = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (fn()) return true; } catch {} await sleep(100); } return !!fn(); };
  // 숨겨야 하는 값 (허브 주소·공개 키 + 방을 열 때마다 방 이름·연결 코드). 보였는지 "개수"만 쓴다
  const secrets = new Set([FAKE_HUB_HOST, FAKE_HUB_KEY]);
  const leaks = text => [...secrets].filter(s => s && String(text).includes(s)).length;
  const dump = p => p.eval(`({html:document.documentElement.outerHTML, text:document.body.innerText, href:location.href, hash:location.hash, cons:(window.__cons||[]).join('\\n')})`);
  const typeInto = async (p, sel, text) => { await p.eval(`(()=>{const e=$(${JSON.stringify(sel)}); e.value=''; e.focus()})()`); await p.type(text); };

  // 가짜 손님 (Node가 방에 직접 보내는 메시지): 표·번호는 이 점검이 만든 값
  const fakeGid = () => crypto.randomBytes(12).toString('base64url');     // 16자 (손님 표 모양)
  let fseq = 0, host = null;
  const say = (gid, o) => R.inject(host, 'g', { v: 1, gid, seq: ++fseq, ...o });
  const replies = (gid, t) => R.log.filter(e => e.op === 'broadcast' && e.event === 'h' && e.toGid === gid && (!t || e.t === t));
  const hostSays = (t, from = 0) => R.log.slice(from).filter(e => e.op === 'broadcast' && e.event === 'h' && e.from === 'page' && e.t === t);

  const hb = await ctx.newBrowser(), gbA = await ctx.newBrowser(), gbB = await ctx.newBrowser();
  // 손님 Edge 둘에는 손님 화면만 연다 → 여기서 가짜 허브로 가는 요청은 모두 손님 것 (Realtime 말고는 0이어야: 표·RPC·로그인 0)
  const guestHub = [];
  for (const b of [gbA, gbB]) b.onEvent(m => {
    if (m.method !== 'Fetch.requestPaused') return;
    try { const r = m.params.request, u = new URL(r.url); if (u.hostname === FAKE_HUB_HOST && r.method !== 'OPTIONS') guestHub.push(u.pathname); } catch {}
  });
  host = await openPage(ctx, PC, null, READY_DEMO, hb);
  await R.attach(host, hb);
  await host.s('Page.addScriptToEvaluateOnNewDocument', { source: CONS });
  await host.goto(ctx.base + '/index.html', READY_DEMO, 150000);
  const openGuest = async (b, url, ready = JOIN_READY, ms = 15000) => {
    const p = await openPage({ ...ctx, adv: false }, PHONE, null, null, b);   // 손님 폰에는 점검 도구의 고급 켜기(nb-advanced·__ui-adv)를 넣지 않는다 — X7 "손님 폰 저장 0"을 그대로 재려고
    await R.attach(p, b);
    await p.s('Page.addScriptToEvaluateOnNewDocument', { source: CONS });
    await p.s('Page.navigate', { url });        // p.goto는 실패 글에 주소를 넣어서 쓰지 않는다 (방 이름이 기록에 남지 않게)
    const ready_ = await p.until(`document.readyState==='complete' && (${ready})`, ms);
    return { p, ready: ready_ };
  };
  const openSettings = async () => { if (!(await host.eval(`$('#cloudDialog').open`))) { await host.click('#settingsBtn'); await host.until(`$('#cloudDialog').open`, 3000); } };
  const closeDialogs = () => host.eval(`document.querySelectorAll('dialog[open]').forEach(d=>d.close())`);
  const openSheet = async () => { await openSettings(); await host.scrollTo('#guestSec'); await host.click('#guestRow'); await host.until(`$('#guestDialog').open`, 3000); };
  const roomOpen = async () => {
    const okOpen = await host.until(`Guest.on && !!Guest.qr && !Guest.busy`, 20000);
    const url = await host.eval('Guest.url'), room = await host.eval('Guest.room');
    if (url) { secrets.add(room); secrets.add(url.split('&c=')[1]); }
    return { okOpen, url, tag: R.joins.length ? R.joins[R.joins.length - 1].room : '' };
  };

  // 방장 Edge에만 넣는 시험 데이터: 사용자 이름·재생목록(손님 화면에 안 나와야 함) + 90초 시험 곡 3개
  const mk = (name, sec, f1, f2) => { const f = path.join(ctx.tmp, 'files', name); fs.writeFileSync(f, wav(sec, f1, f2)); return f; };
  const songs = [];
  await step('방장 준비: 시험 곡 3개 · 사용자 이름 · 재생목록 (방장 Edge 임시 프로필에만)', ['X5'], async () => {
    songs.push(await seedSong(host, { title: 'QA 손님 첫곡', artist: 'QA가수', wav: mk('QA 손님 첫곡.wav', 90, 262, 392) }));
    songs.push(await seedSong(host, { title: 'QA 손님 둘째곡', artist: 'QA가수B', wav: mk('QA 손님 둘째곡.wav', 90, 294, 440) }));
    songs.push(await seedSong(host, { title: 'QA 손님 셋째곡', artist: 'QA가수C', wav: mk('QA 손님 셋째곡.wav', 90, 330, 494) }));
    await host.eval(`(()=>{ me().name='QA방장이름'; me().favorites=[${JSON.stringify(songs[0].id)}]; me().playlists=[{id:uid(),name:'QA방장재생목록',songs:[${JSON.stringify(songs[1].id)}]}]; saveProfiles(me()); renderProfileChip(); })()`);
    ok('X5', songs.length === 3 && songs.every(s => Number.isInteger(s.no)), '시험 곡 번호 ' + songs.map(s => s.no).join('·'));
  });

  // X3: 허브가 없으면 방을 못 연다 (요청 0)
  await step('허브 없이: 손님 초대 QR 시트 → "허브를 먼저 연결해 주세요" · TV 카드 없음 · Realtime 연결 0', ['X3'], async () => {
    ok('X3', await host.eval(`$('#guestCard').hidden`), 'TV 대기 카드 숨김 (허브 없음)');
    ok('X3', /로그인 없이 폰으로 예약/.test(await txt(host, '#guestRowSub')), '설정 손님 줄: ' + await txt(host, '#guestRowSub'));
    // 자리 (디자인 확인 CR-228 2장): 설정 창 맨 위 — <h2> 바로 아래 '손님' 묶음, 안에 <h3> 없음, 다음은 '곡 창고' 묶음, 고급 밖
    await openSettings();
    const pos = await host.eval(`(()=>{const g=$('#guestSec'), pv=g.previousElementSibling, nx=g.nextElementSibling, pp=pv&&pv.previousElementSibling;
      const t=e=>e?(e.tagName.toLowerCase()+(e.className?'.'+e.className:'')+':'+e.textContent.trim()):'';
      return {first:($('#cloudDialog .set-sec')||{}).id, prev:t(pv), next:t(nx), top:t(pp), h3:!!g.querySelector('h3'), inAdv:$('#advBox').contains(g)}})()`);
    ok('X3', pos.first === 'guestSec' && pos.prev === 'p.set-group:손님' && pos.next === 'p.set-group:곡 창고' && /^h2:/.test(pos.top) && !pos.h3 && !pos.inAdv,
      `설정 창 첫 구역 #${pos.first} · 앞 "${pos.prev}" · 그 앞 ${pos.top.split(':')[0]} · 뒤 "${pos.next}" · 안 h3 ${pos.h3 ? '있음' : '없음'} · 고급 ${pos.inAdv ? '안' : '밖'}`);
    await closeDialogs();
    await openSheet();
    await sleep(300);
    const msg = await txt(host, '#guestMsg');
    ok('X3', /허브를 먼저 연결해 주세요/.test(msg) && await visible(host, '#guestOff') && await isHidden(host, '#guestOnBox'), '시트 글: ' + msg);
    ok('X3', R.opens === 0 && !(await host.eval('Guest.on')), `Realtime 연결 ${R.opens}`);
    await closeDialogs();
  });

  // 허브 코드 저장 + 가짜 계정 로그인 (방장은 로그인해 있어도 손님 방은 공개 broadcast만)
  const email = fakeMail('qa-guest-' + crypto.randomBytes(3).toString('hex')), pw = 'qa-' + crypto.randomBytes(9).toString('hex');
  const gUid = H.addUser(email, pw);
  // CR-231: 방장 계정 허브 열쇠 칸에 MR 만들기 주소(가짜 이름, 열지 않음)가 있어도 손님 폰에는 안 감 (X7에서 봄)
  const MR_GUEST = 'http://mr-guest.example.test:8765';
  H.secrets.set([gUid, 'noraebang', 'mr_server'].join('|'), MR_GUEST);
  await step('방장: 허브 코드 저장 · 가짜 계정 로그인 → TV 대기 카드에 [손님 QR 켜기]', ['X3'], async () => {
    await openSettings(); await host.scrollTo('#hubSec');
    await typeInto(host, '#hubCode', hubCode()); await host.click('#hubCodeSave'); await sleep(300);
    await typeInto(host, '#hubEmail', email); await typeInto(host, '#hubPw', pw);
    await host.click('#hubLoginBtn');
    await host.until(`!$('#hubLoginBtn').disabled && !/로그인 중|맞추는 중/.test($('#hubMsg').textContent)`, 20000);
    ok('X3', await host.eval('hubOn()'), '허브 연결 있음');
    await host.click('#cloudClose'); await sleep(200);
    ok('X3', await host.eval(`!$('#guestCard').hidden && !$('#guestCardBtn').hidden && $('#guestCardQr').hidden`), 'TV 대기 카드 [손님 QR 켜기] 단추 (설정 창을 닫으면 다시 그림)');
  });

  // X3·X4·X1: 방 열기
  let room1 = null;
  await step('손님 초대 QR 시트: 바로 방을 열고 QR · 들어온 손님 0명 · [새 QR 만들기]·[방 닫기]', ['X1', 'X3', 'X4'], async () => {
    await openSheet();
    room1 = await roomOpen();
    ok('X3', room1.okOpen, '방 열림 + QR 그림');
    ok('X3', await visible(host, '#guestOnBox') && await isHidden(host, '#guestOff') && await visible(host, '#guestNewBtn') && await visible(host, '#guestCloseBtn'), 'QR·단추 보임');
    ok('X3', /들어온 손님 0명/.test(await txt(host, '#guestCount')) && /켜짐 · 손님 0명/.test(await txt(host, '#guestRowSub')), await txt(host, '#guestCount'));
    const img = await host.eval(`(()=>{const i=$('#guestQrImg');return {png:/^data:image\\/png;base64,/.test(i.src), w:i.naturalWidth, h:i.naturalHeight, css:getComputedStyle(i).imageRendering}})()`);
    ok('X1', img.png && img.w >= 25 && img.w === img.h, `QR 그림 PNG ${img.w}×${img.h} (${img.css})`);
    const shape = await host.eval(`(()=>{const u=new URL(Guest.url);return {path:u.pathname, same:u.origin===location.origin, q:Guest.url.includes('?'), hash:/^#r=nbr-[A-Za-z0-9_-]{43}&c=nbhub1\\.[A-Za-z0-9_-]+$/.test(u.hash), roomBits:(Guest.room.length-4)*6}})()`);
    ok('X4', shape.path.endsWith('/guest.html') && shape.same && !shape.q && shape.hash, `주소 모양: …/guest.html#r=…&c=… · ? ${shape.q ? '있음' : '없음'}`);
    ok('X4', shape.roomBits >= 256, `방 이름 난수 ${shape.roomBits}비트 (base64url 43자)`);
    const j = R.joins[R.joins.length - 1] || {};
    ok('X4', j.private === false && j.self === false && j.presence === false && j.pg === 0, `방장 채널: 공개 broadcast (private ${j.private} · self ${j.self} · presence ${j.presence} · 표 변경 ${j.pg})`);
    ok('X4', R.badKey === 0 && R.badUrl === 0, `Realtime 주소 wss·/realtime/v1/websocket·vsn 2.0.0 · 공개 키만 (틀림 ${R.badUrl}·${R.badKey})`);
    const d = await dump(host);
    ok('X4', leaks(d.text) === 0 && leaks(d.html) === 0 && leaks(d.cons) === 0, `방장 화면 글·HTML·콘솔에 방 이름·코드·허브 주소·키 ${leaks(d.text)}·${leaks(d.html)}·${leaks(d.cons)}개`);
    await shot(host, 'x-guest-host-sheet.png');
  });

  // 손님 A·B 들어오기 (G1)
  let A = null, B = null;
  await step('손님 A·B: QR 주소로 열기 → # 바로 지움 → "노래방에 들어왔어요" (G1) → 이름 넣고 들어가기', ['X2', 'X4', 'X5'], async () => {
    if (!room1 || !room1.url) throw new Error('방이 안 열림');
    A = await openGuest(gbA, room1.url); B = await openGuest(gbB, room1.url);
    ok('X5', A.ready && B.ready, '두 폰 모두 G1 (들어가기 단추 켜짐)');
    for (const [n, g] of [['A', A], ['B', B]]) {
      const d = await dump(g.p);
      ok('X4', d.hash === '' && /\/guest\.html$/.test(new URL(d.href).pathname) && leaks(d.href) === 0, `손님 ${n} 주소창: # ${d.hash ? '남음' : '지움'}`);
    }
    await shot(A.p, 'x-guest-g1-join.png');
    await typeInto(A.p, '#nick', 'QA손님하나');
    await A.p.tap('#joinBtn');
    await B.p.tap('#joinBtn');
    ok('X5', await A.p.until(`!$('#scrMain').hidden`, 5000) && await B.p.until(`!$('#scrMain').hidden`, 5000), '두 폰 모두 곡 찾기 화면');
    ok('X2', await host.until(`Guest.guests.size===2`, 5000), '방장: 손님 2명');
    ok('X3', /들어온 손님 2명/.test(await txt(host, '#guestCount')) && /켜짐 · 손님 2명/.test(await txt(host, '#guestRowSub')), await txt(host, '#guestCount'));
    ok('X5', /방에 연결됨/.test(await txt(A.p, '#connTxt')), '손님 연결 표시: ' + await txt(A.p, '#connTxt'));
  });

  // X5: 곡 찾기 (방장이 대신 찾고 번호·제목·가수·종류만)
  await step('곡 찾기 (G2): 방장 MR 창고에서 찾은 결과 — 번호·제목·가수·종류만', ['X2', 'X5', 'X7'], async () => {
    const from = R.log.length;
    await A.p.tap('#q'); await A.p.type('QA 손님');
    ok('X5', await A.p.until(`document.querySelectorAll('#findList .li').length===3`, 5000), '결과 ' + await count(A.p, '#findList .li') + '줄');
    const meta = await txt(A.p, '#findMeta');
    ok('X5', /곡 \d+개 중 3개/.test(meta), meta);
    const rows = await A.p.eval(`[...document.querySelectorAll('#findList .li')].map(li=>({no:li.querySelector('.no').textContent, t1:li.querySelector('.t1').textContent, t2:li.querySelector('.t2').textContent, btn:li.querySelector('button').textContent}))`);
    ok('X5', rows.every(r => /^\d+$/.test(r.no) && /^QA 손님/.test(r.t1) && / · MR$/.test(r.t2) && r.btn === '예약'), rows.map(r => `${r.no} ${r.t1} (${r.t2})`).join(' / '));
    const found = R.log.slice(from).filter(e => e.op === 'broadcast' && e.t === 'found');
    const keys = [...new Set(found.flatMap(e => e.keys || []))].sort().join(',');
    ok('X7', found.length > 0 && keys === 'artist,kind,no,title', `방장이 돌려준 곡 칸: ${keys}`);
    // 번호로도 찾기
    await A.p.eval(`$('#q').value=''`); await A.p.type(String(songs[1].no));
    ok('X5', await A.p.until(`[...document.querySelectorAll('#findList .li .no')].some(x=>x.textContent===${JSON.stringify(String(songs[1].no))})`, 5000), '번호로 찾기');
    await A.p.eval(`$('#q').value=''`); await A.p.type('QA 손님');
    await A.p.until(`document.querySelectorAll('#findList .li').length===3`, 5000);
    await shot(A.p, 'x-guest-g2-find.png');
  });

  // X5: 예약 → 방장 예약 목록에 손님 이름
  const tapReserve = async (g, title) => {
    const i = await g.p.eval(`[...document.querySelectorAll('#findList .li')].findIndex(li=>li.querySelector('.t1').textContent===${JSON.stringify(title)})`);
    if (i < 0) throw new Error('결과에 없는 곡: ' + title);
    await g.p.tap(`#findList .li:nth-child(${i + 1}) .pill`);
  };
  await step('예약: 손님 A(이름 있음)·B(이름 없음) → "예약했어요 · N번째" · 방장 예약 목록에 손님 이름', ['X2', 'X5'], async () => {
    let mk_ = await marks(A.p);
    await tapReserve(A, 'QA 손님 첫곡');
    ok('X5', await sawToast(A.p, /예약했어요 · 1번째/, mk_), 'A 알림: ' + await txt(A.p, '#toast'));
    // B는 곡 찾기를 아직 안 했으니 찾고 예약
    await B.p.tap('#q'); await B.p.type('QA 손님');
    await B.p.until(`document.querySelectorAll('#findList .li').length===3`, 5000);
    mk_ = await marks(B.p);
    await tapReserve(B, 'QA 손님 둘째곡');
    ok('X5', await sawToast(B.p, /예약했어요 · 2번째/, mk_), 'B 알림: ' + await txt(B.p, '#toast'));
    ok('X2', await host.until(`state.queue.length===2`, 4000), '방장 예약 ' + await host.eval('state.queue.length') + '곡');
    const who = await host.eval(`[...document.querySelectorAll('#idleQueue li .t small.who')].map(x=>x.textContent)`);
    ok('X5', who.join('|') === 'QA손님하나|손님', '방장 대기 화면 예약 목록 손님 이름: ' + who.join(' · '));
    await host.eval('openQueue()'); await sleep(150);
    const ov = await txt(host, '#queueList');
    ok('X5', /QA손님하나/.test(ov) && /손님/.test(ov), '방장 예약 목록 창에도 손님 이름');
    await host.eval('closeOverlays()');
  });

  // X6: 예약 목록 (G5)
  await step('예약 목록 (G5): 제목만 · 내 예약 표시 · 내 것만 [빼기] · 다른 손님 이름 안 보임', ['X6', 'X7'], async () => {
    await A.p.tap('.tabs [data-tab="tabQueue"]'); await B.p.tap('.tabs [data-tab="tabQueue"]');
    ok('X6', await A.p.until(`/예약 2곡/.test($('#qN').textContent) && /내 예약 1곡/.test($('#qMine').textContent)`, 4000), `A: ${await txt(A.p, '#qN')} · ${await txt(A.p, '#qMine')}`);
    const a = await A.p.eval(`({me:document.querySelectorAll('#queueList .chip.me').length, out:document.querySelectorAll('#queueList .pill.ghost').length, t:[...document.querySelectorAll('#queueList .t1')].map(x=>x.textContent)})`);
    ok('X6', a.me === 1 && a.out === 1 && a.t.join('|') === 'QA 손님 첫곡|QA 손님 둘째곡', `A: 내 예약 ${a.me} · [빼기] ${a.out} · ${a.t.join(' / ')}`);
    const st = R.log.filter(e => e.op === 'broadcast' && e.t === 'state').pop() || {};
    ok('X7', (st.qKeys || []).every(k => ['artist', 'kind', 'r', 'title'].includes(k)), '방장이 보낸 예약 목록 칸: ' + (st.qKeys || []).join(','));
    const bt = await dump(B.p);
    ok('X7', !/QA손님하나/.test(bt.text + bt.html), '손님 B 화면에 A 이름 없음');
    await shot(A.p, 'x-guest-g5-queue.png');
  });

  // X6: 지금 곡 + 키 (G4)
  await step('지금 곡 (G4): 방장이 시작 → 제목·진행 · 키 ♯·원래 키 (−2~+2)', ['X2', 'X6'], async () => {
    await host.eval('startNext()');
    ok('X6', await host.until(`state.playing && state.song && state.song.title==='QA 손님 첫곡'`, 15000), '방장 재생: ' + await host.eval('state.song && state.song.title'));
    await A.p.tap('.tabs [data-tab="tabNow"]');
    ok('X6', await A.p.until(`$('#nowTitle').textContent==='QA 손님 첫곡' && !$('#nowProgBox').hidden && !$('#keyUp').disabled`, 6000), 'A 지금 곡: ' + await txt(A.p, '#nowTitle'));
    ok('X6', /QA 손님 둘째곡/.test(await txt(A.p, '#nextBox')), '다음 곡: ' + await txt(A.p, '#nextBox'));
    await A.p.tap('#keyUp');
    ok('X2', await host.until(`state.key===1`, 5000), '방장 키 ' + await host.eval('state.key'));
    ok('X6', await A.p.until(`/지금 \\+1/.test($('#keyHead').textContent)`, 5000), 'A: ' + await txt(A.p, '#keyHead'));
    await shot(A.p, 'x-guest-g4-now.png');
    await sleep(300); await A.p.tap('#keyUp');
    ok('X6', await host.until(`state.key===2`, 5000) && await A.p.until(`$('#keyUp').disabled`, 4000), '+2에서 ♯ 꺼짐 (최대 +2)');
    await sleep(300); await A.p.tap('#keyZero');
    ok('X6', await host.until(`state.key===0`, 5000), '원래 키로');
    // 범위 밖·방장이 끈 키는 방장이 받지 않는다 (가짜 손님으로 보냄)
    const f = fakeGid(); say(f, { t: 'hello' }); await waitNode(() => replies(f, 'welcome').length, 4000); await sleep(1100);
    say(f, { t: 'key', k: 3 }); await sleep(700);
    ok('X6', (await host.eval('state.key')) === 0 && replies(f).filter(e => e.t !== 'welcome' && e.t !== 'state').length === 0, '키 +3 요청은 버림 (답 없음)');
    await host.eval(`$('#guestKeyOn').click()`);
    ok('X6', await A.p.until(`$('#keyUp').disabled && $('#keyDown').disabled && /꺼 두었어요/.test($('#keyInfo').textContent)`, 5000), 'A: ' + await txt(A.p, '#keyInfo'));
    await sleep(300); say(f, { t: 'key', k: 1 });
    ok('X6', await waitNode(() => replies(f, 'no').some(e => e.why === 'keyoff'), 4000) && (await host.eval('state.key')) === 0, '방장이 손님 키를 끄면 "keyoff"로 거절');
    await host.eval(`$('#guestKeyOn').click()`);
    ok('X6', await A.p.until(`!$('#keyUp').disabled`, 5000) && await host.eval(`localStorage.getItem('nb-guest-key')===null`), '다시 켬 (nb-guest-key 지움)');
    say(f, { t: 'bye' });
  });

  // X6·X7: 내 예약 빼기 · 남의 예약은 못 뺌
  await step('예약 빼기: A가 자기 예약 [빼기] → "예약에서 뺐어요" · 남의 예약 빼기는 거절', ['X2', 'X6', 'X7'], async () => {
    await A.p.tap('.tabs [data-tab="tabFind"]');
    let mk_ = await marks(A.p);
    await tapReserve(A, 'QA 손님 셋째곡');
    ok('X6', await sawToast(A.p, /예약했어요 · 2번째/, mk_), 'A 알림: ' + await txt(A.p, '#toast'));
    await host.until(`state.queue.length===2`, 4000);
    await A.p.tap('.tabs [data-tab="tabQueue"]');
    await A.p.until(`document.querySelectorAll('#queueList .pill.ghost').length===1`, 4000);
    mk_ = await marks(A.p);
    await A.p.tap('#queueList .pill.ghost');
    ok('X6', await sawToast(A.p, /예약에서 뺐어요/, mk_), 'A 알림: ' + await txt(A.p, '#toast'));
    ok('X2', await host.until(`state.queue.length===1 && songById(state.queue[0]).title==='QA 손님 둘째곡'`, 4000), '방장 예약 ' + await host.eval('state.queue.length') + '곡');
    // 남의 예약(B 것)을 다른 손님 표로 빼기 → 거절
    const bRid = await host.eval(`(Guest.res.find(r=>r.nick==='')||{}).rid||''`);
    const f = fakeGid(); say(f, { t: 'hello' }); await waitNode(() => replies(f, 'welcome').length, 4000); await sleep(300);
    say(f, { t: 'unreserve', rid: bRid });
    ok('X7', await waitNode(() => replies(f, 'no').some(e => e.why === 'gone'), 4000) && (await host.eval('state.queue.length')) === 1, '남의 예약 빼기는 "gone"으로 거절, 예약 그대로');
    // 없는 곡 번호 · 유튜브(CR-030 없음) 예약 → 거절
    await sleep(300); say(f, { t: 'reserve', no: 999999 });
    ok('X7', await waitNode(() => replies(f, 'no').some(e => e.why === 'nosong'), 4000), '없는 곡 번호는 "nosong"');
    await sleep(300); say(f, { t: 'reserve', ytId: 'QAqaQAqaQA1' });
    ok('X8', await waitNode(() => replies(f, 'no').some(e => e.why === 'yt'), 4000) && (await host.eval('state.queue.length')) === 1, '유튜브 예약은 CR-030이 없으면 "yt"로 거절');
    ok('X8', (await host.eval(`typeof ytReserve`)) === 'undefined' && await isHidden(A.p, '#segBox'), '손님 화면 유튜브 칸 숨김 (ytReserve 없음)');
    say(f, { t: 'bye' });
  });

  // X7: 버리는 메시지 · 1초 4개 · 6명까지
  await step('지키기: 모르는 종류·4KB 넘음·안 들어온 표는 버림 · 한 사람 1초 4개 · 손님 6명까지 ("방이 꽉 찼어요")', ['X7'], async () => {
    const f = fakeGid(); say(f, { t: 'hello' }); await waitNode(() => replies(f, 'welcome').length, 4000); await sleep(1100);
    const q0 = await host.eval('state.queue.length');
    say(f, { t: 'admin', cmd: 'clear' }); say(f, { t: 'search', q: 'QA', kind: 'mr', pad: 'x'.repeat(5000) });
    const stranger = fakeGid(); say(stranger, { t: 'reserve', no: songs[0].no });
    await sleep(1200);
    ok('X7', replies(f).filter(e => e.t !== 'welcome' && e.t !== 'state').length === 0 && replies(stranger).length === 0 && (await host.eval('state.queue.length')) === q0,
      '모르는 종류·4KB 넘는 메시지·안 들어온 표의 예약: 답 0, 예약 그대로');
    for (let i = 0; i < 6; i++) say(f, { t: 'search', q: 'QA 손님', kind: 'mr' });
    await sleep(1200);
    const n = replies(f, 'found').length;
    ok('X7', n === 4, `1초에 검색 6번 → 답 ${n}개 (4개까지)`);
    // 지금 A·B·f = 3명. 가짜 3명 더 → 6명, 손님 C는 "방이 꽉 찼어요"
    const more = [fakeGid(), fakeGid(), fakeGid()];
    for (const g of more) say(g, { t: 'hello' });
    ok('X7', await host.until(`Guest.guests.size===6`, 4000), '방장: 손님 ' + await host.eval('Guest.guests.size') + '명');
    const C = await openGuest(gbA, room1.url, `/방이 꽉 찼어요/.test($('#msgBig').textContent)`, 15000);
    ok('X7', C.ready && await visible(C.p, '#retryBtn'), '손님 C: ' + await txt(C.p, '#msgBig'));
    await shot(C.p, 'x-guest-full.png');
    for (const g of [f, ...more]) say(g, { t: 'bye' });
    await host.until(`Guest.guests.size===2`, 4000);
    await C.p.tap('#retryBtn');
    ok('X7', await C.p.until(JOIN_READY, 10000), '자리가 나면 [다시 해 보기]로 들어옴');
    await C.p.close();
    await host.until(`Guest.guests.size<=3`, 2000);
  });

  // X7: 손님 폰 개인 정보·저장 0
  await step('손님 화면 개인 정보 0 · 손님 폰 저장 0 · 콘솔에 방 이름·코드·허브 주소·키 0', ['X4', 'X7'], async () => {
    const words = ['QA방장이름', 'QA방장재생목록', '♡', '♥', '플레이리스트', '재생목록', '녹음', '점수', 'Drive', '드라이브', email, 'nb-'];
    const dev = await host.eval(`lsGet('nb-device')`); if (dev) words.push(dev);
    for (const [n, g] of [['A', A], ['B', B]]) {
      const d = await dump(g.p), hit = words.filter(w => (d.text + d.html).includes(w));
      ok('X7', hit.length === 0, `손님 ${n} 화면에 사용자 이름·♡·재생목록·녹음·점수·Drive·계정·기기 ${hit.length}개`);
      ok('X4', leaks(d.text) + leaks(d.html) + leaks(d.cons) === 0, `손님 ${n} 화면·HTML·콘솔에 방 이름·코드·허브 주소·키 ${leaks(d.text) + leaks(d.html) + leaks(d.cons)}개`);
      const store = await g.p.eval(`(async()=>({ls:localStorage.length, ss:sessionStorage.length, idb:(await indexedDB.databases()).length, ck:document.cookie.length, caches:(await caches.keys()).length, sw:(await navigator.serviceWorker.getRegistrations()).length}))()`);
      ok('X7', Object.values(store).every(v => v === 0), `손님 ${n} 폰 저장: localStorage ${store.ls} · sessionStorage ${store.ss} · IndexedDB ${store.idb} · 쿠키 ${store.ck} · 캐시 ${store.caches} · 서비스 워커 ${store.sw}`);
      // CR-231: 손님 화면은 허브 열쇠 칸을 읽는 코드도, MR 만들기 주소도 없음
      const mrCode = await g.p.eval(`({hub:typeof hubMrServer, mr:typeof mrServer, hubObj:typeof Hub})`);
      const mrHit = (d.text + d.html + d.cons).includes('mr-guest.example.test');
      ok('X7', !mrHit && mrCode.hub === 'undefined' && mrCode.mr === 'undefined' && mrCode.hubObj === 'undefined',
        `손님 ${n}: MR 만들기 주소 ${mrHit ? '있음!' : '0'} · 허브 열쇠 칸 읽는 코드 ${mrCode.hub === 'undefined' && mrCode.mr === 'undefined' ? '없음' : '있음!'}`);
    }
    const hostMr = await host.eval(`({hub:Hub.mrServer===undefined?'(안 읽음)':Hub.mrServer})`);
    ok('X7', hostMr.hub === MR_GUEST, `(대조) 방장 기기는 허브 열쇠 칸에서 MR 주소를 ${hostMr.hub === MR_GUEST ? '받음' : '못 받음'} → 손님 쪽 0이 우연이 아님`);
    const csp = await A.p.eval(`(document.querySelector('meta[http-equiv="Content-Security-Policy"]')||{}).content||''`);
    const conn = (csp.match(/connect-src ([^;]+)/) || [, ''])[1].trim();
    ok('X4', conn === 'https://*.supabase.co wss://*.supabase.co' && /default-src 'none'/.test(csp) && /script-src 'self'/.test(csp), '손님 화면 보안 규칙 connect-src: ' + conn);
    const notRt = guestHub.filter(x => !x.startsWith('/realtime/v1/')).length;
    ok('X4', notRt === 0 && R.joins.every(j => !j.private && !j.pg && !j.presence), `손님 폰 → 허브 표·RPC·로그인 요청 ${notRt}개 (Realtime 말고 0) · 모든 채널 공개 broadcast (채널 ${R.joins.length}개)`);
    const d = await dump(host);
    ok('X4', leaks(d.cons) === 0, `방장 콘솔에 방 이름·코드·허브 주소·키 ${leaks(d.cons)}개`);
  });

  // X3: TV 대기 화면 카드 (옛 리모컨 QR과 둘 중 하나만) · TV에서 손님 예약은 바로 시작
  await step('TV 대기 화면: 손님 QR 카드 (옛 리모컨 QR 숨김) · TV에 QR 끄기 · 손님 예약이 바로 시작', ['X3', 'X5'], async () => {
    await host.eval(`(async()=>{ cancelNext(); stopPlayback(); hideScore(); closeOverlays(); state.queue.length=0; saveQueue(); renderQueue(); })()`);
    await closeDialogs();
    await enterTVNoFs(host);
    await host.until(`!$('#tvIdle').hidden`, 4000);
    ok('X3', await visible(host, '#guestCard') && await visible(host, '#guestCardQr') && await host.eval(`$('#tvIdle').classList.contains('guest-on')`) && await isHidden(host, '#remoteInfo'),
      'TV 대기: 손님 QR 카드 보임 · 옛 리모컨 안내 숨김');
    ok('X3', /로그인 없음 · 손님 \d명/.test(await txt(host, '#guestCardSub')), await txt(host, '#guestCardSub'));
    await shot(host, 'x-guest-tv-card.png');
    // TV 1920 (디자인 확인 CR-228 #1~#3): 점수가 가장 긴 경우(오늘 최고 + 최근 3줄) 카드가 점수·사용자 줄을 덮지 않음 · QR max(96px,16cqw) · 고급을 켜도 팁 한 줄
    // 점수는 방장 Edge 임시 프로필에만 넣는 시험 기록 (점검 뒤 지움)
    const scWas = await host.eval(`localStorage.getItem('nb-scores')`);
    await host.eval(`(()=>{const s0=state.songs.find(s=>s.title==='QA 손님 첫곡')||state.songs.find(s=>!s.demo); const now=Date.now();
      [70,85,92].forEach((v,i)=>scores.unshift({id:s0.id,no:s0.no,title:s0.title+' (QA 시험 긴 제목 줄임 확인용)',score:v,at:now-(3-i)*1000,who:'QA'}));
      localStorage.setItem('nb-scores', JSON.stringify(scores)); renderBest(); renderIdleChart();})()`);
    const advWas = await host.eval(`document.documentElement.classList.contains('adv')`);
    const over = (a, b) => a && b ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : -1;
    const measure = () => host.eval(`(()=>{const r=e=>{const b=e.getBoundingClientRect(); return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,w:Math.round(b.width)}};
      const tip=document.querySelector('.idle-tip'), best=$('#bestBox'), clock=$('#clock');
      return {card:r($('#guestCard')), qr:r($('#guestCardQr')), best:r(best), user:r($('#idleUser')), clock:r(clock), stage:Math.round(document.querySelector('#stage').getBoundingClientRect().width),
        bestBeside:getComputedStyle(best).gridColumnStart==='2', tipFull:getComputedStyle(tip.querySelector('.adv-full')).display, tipShort:getComputedStyle($('#idleTipShort')).display, lines:best.querySelectorAll('li').length}})()`);
    let tv = null, tvAdv = null;
    try {
      await host.emulate(TV); await sleep(400);
      await host.eval('applyAdv(false)'); await sleep(150);
      tv = await measure();
      await shot(host, 'x-guest-tv-card-1920.png');
      await host.eval('applyAdv(true)'); await sleep(150);
      tvAdv = await measure();
    } finally {
      await host.eval(`applyAdv(${advWas})`);
      await host.emulate(PC); await sleep(300);
      await host.eval(`(()=>{const v=${JSON.stringify(scWas)}; if(v===null) localStorage.removeItem('nb-scores'); else localStorage.setItem('nb-scores', v); scores.length=0; scores.push(...JSON.parse(v||'[]')); renderBest(); renderIdleChart();})()`);
    }
    const pc = await measure();
    const qrWant = s => Math.max(96, Math.round(s * 0.16));
    ok('X3', tv && tv.lines === 4 && tv.bestBeside && over(tv.card, tv.best) === 0 && over(tv.card, tv.user) === 0 && Math.abs(tv.qr.w - qrWant(tv.stage)) <= 2 && tv.tipShort !== 'none' && tv.tipFull === 'none',
      `TV 1920: 점수 ${tv && tv.lines}줄 시계 옆 ${tv && tv.bestBeside} · 카드가 덮는 넓이 점수 ${tv && over(tv.card, tv.best)} · 사용자 줄 ${tv && over(tv.card, tv.user)} · QR ${tv && tv.qr.w}px (무대 ${tv && tv.stage}px의 16%)`);
    ok('X3', tvAdv && tvAdv.tipFull === 'none' && tvAdv.tipShort !== 'none' && over(tvAdv.card, tvAdv.user) === 0 && over(tvAdv.card, tvAdv.best) === 0,
      `TV 1920 고급 켬: 팁 ${tvAdv && tvAdv.tipFull === 'none' ? '한 줄(짧은 글)' : '예전 3줄'} · 카드가 덮는 넓이 사용자 줄 ${tvAdv && over(tvAdv.card, tvAdv.user)} · 점수 ${tvAdv && over(tvAdv.card, tvAdv.best)}`);
    ok('X3', over(pc.card, pc.user) === 0 && over(pc.card, pc.best) === 0 && Math.abs(pc.qr.w - qrWant(pc.stage)) <= 2, `PC 1280 (점수 없음): 카드가 덮는 넓이 사용자 줄 ${over(pc.card, pc.user)} · 점수 ${over(pc.card, pc.best)} · QR ${pc.qr.w}px (무대 ${pc.stage}px)`);
    await host.eval(`$('#guestTvQr').click()`); await sleep(150);
    ok('X3', await host.eval(`$('#guestCard').hidden && !$('#tvIdle').classList.contains('guest-on') && localStorage.getItem('nb-guest-tv')==='0'`), 'TV에 QR 끄기 → 카드 숨김 (nb-guest-tv=0)');
    await host.eval(`$('#guestTvQr').click()`); await sleep(150);
    ok('X3', await visible(host, '#guestCard') && await host.eval(`localStorage.getItem('nb-guest-tv')===null`), '다시 켬');
    await A.p.tap('.tabs [data-tab="tabFind"]');
    const mk_ = await marks(A.p);
    await tapReserve(A, 'QA 손님 둘째곡');
    ok('X5', await sawToast(A.p, /예약했어요 · 바로 시작해요/, mk_, 6000), 'TV 대기 중 손님 예약: ' + await txt(A.p, '#toast'));
    ok('X5', await host.until(`state.playing && state.song.title==='QA 손님 둘째곡'`, 15000), '방장 TV에서 바로 시작');
  });

  // X8: 방 닫기 → G6a · 옛 QR → G6b · 새 QR = 새 방 · 허브 연결 끊으면 방도 닫힘
  await step('방 닫기: 손님 "방이 닫혔어요" (G6a) · 손님 이름 지움 · 닫은 방 QR → "방에 붙지 못했어요" (G6b)', ['X2', 'X8'], async () => {
    await host.eval(`(async()=>{ cancelNext(); stopPlayback(); hideScore(); if (state.tv) exitTV(); })()`);
    await host.eval(`reserve(songById(${JSON.stringify(songs[2].id)}), false)`);      // 방장이 넣은 예약 (손님 이름 없음)
    await openSheet();
    await host.click('#guestCloseBtn');
    ok('X8', await host.until(`!Guest.on && !$('#guestOff').hidden`, 4000), '방장: 방 닫힘 · [손님 QR 켜기]');
    ok('X8', await A.p.until(`/방이 닫혔어요/.test($('#msgBig').textContent) && /연결 끊김/.test($('#connTxt').textContent)`, 5000) && await B.p.until(`/방이 닫혔어요/.test($('#msgBig').textContent)`, 5000),
      'A·B: ' + await txt(A.p, '#msgBig'));
    ok('X8', await A.p.eval(`$('#nick').value==='' && $('#queueList').textContent==='' && $('#findList').textContent===''`), 'A 화면의 이름·목록 지움');
    ok('X8', await waitNode(() => R.subs(host) === 0, 3000), '방장이 방 채널에서 나감');
    ok('X8', !/QA손님하나/.test(await txt(host, '#idleQueue')), '방장 예약 목록에서 손님 이름 지움');
    await shot(A.p, 'x-guest-g6a-closed.png');
    const D = await openGuest(gbA, room1.url, `/방에 붙지 못했어요/.test($('#msgBig').textContent)`, 20000);
    ok('X8', D.ready && await visible(D.p, '#retryBtn'), '닫은 방 QR: ' + await txt(D.p, '#msgBig'));
    await shot(D.p, 'x-guest-g6b-lost.png');
    await D.p.close();
  });

  await step('새 QR = 새 방 (옛 손님은 닫힘) · 허브 연결을 끊으면 방도 닫힘', ['X4', 'X8'], async () => {
    await host.click('#guestOpenBtn');
    const r2 = await roomOpen();
    ok('X4', r2.okOpen && r2.url !== room1.url && r2.tag !== room1.tag, '다시 열면 새 방 이름');
    await A.p.s('Page.navigate', { url: 'about:blank' });     // 같은 주소에 #만 다르면 새로 열리지 않아서 한 번 비운다
    await A.p.until(`location.href==='about:blank'`, 5000);
    await A.p.s('Page.navigate', { url: r2.url });
    await A.p.until(`document.readyState==='complete' && (${JOIN_READY})`, 15000);
    await A.p.tap('#joinBtn');
    await host.until(`Guest.guests.size===1`, 5000);
    await host.click('#guestNewBtn');
    const r3 = await roomOpen();
    ok('X8', r3.okOpen && r3.tag !== r2.tag && await A.p.until(`/방이 닫혔어요/.test($('#msgBig').textContent)`, 5000), '[새 QR 만들기] → 새 방 · 옛 손님은 "방이 닫혔어요"');
    await closeDialogs();
    await host.eval('hubDisconnect()');
    ok('X8', await host.until(`!Guest.on`, 4000) && await host.eval(`$('#guestCard').hidden`), '허브 연결 끊기 → 방도 닫힘 · TV 카드 없음');
  });

  // X2·X1: 진짜 폰 카메라·진짜 허브 Realtime은 사람 (기기 확인)
  ok('X1', true, 'QR 그림·주소 모양 자동. 폰 카메라로 찍기는 사람');
  ok('X2', R.real.length === 0, `가짜 허브가 아닌 WebSocket ${R.real.length}개 · 진짜 허브 Realtime은 사람`);
  R.off(); H.rt = null;
  for (const b of [gbB, gbA, hb]) { try { await b.closeAll(); } catch {} }
}
