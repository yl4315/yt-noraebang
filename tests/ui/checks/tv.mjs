// 흐름 7·8: TV 화면 (마우스 화면): 대기 화면, 바로 시작, 제목 카드·진행 막대, 조작 막대 18개, 숨김, Esc 순서, ?tv=1, 화면 숫자판,
// 다음 곡 카운트다운 (정지·지금 시작·멈추기)
import { TV, PC, txt, visible, isHidden, marks, sawFlash, sawToast, sleep, q, stopAll, selectById, selectNo, enterTVNoFs } from './_lib.mjs';
export const areas = ['L', 'I', 'B', 'F', 'H', 'M'];

export default async function tv(ctx) {
  const { ok, step } = ctx, p = ctx.p, ids = ctx.ids;
  await stopAll(p);
  await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
  await p.emulate(TV);
  await selectNo(p, 10001);
  const setQueue = ids_ => p.eval(`state.queue=${q(ids_)}; saveQueue(); renderQueue()`);
  const bar = sel => `#tvRemote [data-act="${sel}"]`;

  await step('TV 화면 버튼 → 16:9 TV 화면, 전체 화면 요청, 화면 켜 두기', ['B5', 'L1', 'L18'], async () => {
    const f0 = await p.eval('__ui.fsReq');
    await p.click('#tvBtn');
    const open = await p.until(`state.tv && !document.querySelector('#tv').hidden`, 2000);
    await sleep(300);
    const r = await p.rect('#tv .stage');
    const st = await p.eval(`({fs:__ui.fsReq, el:!!document.fullscreenElement, wake:!!Wake.lock})`);
    ok('B5', open, 'TV 화면 버튼 → TV 화면');
    ok('L1', open && Math.abs(r.w / r.h - 16 / 9) < 0.02 && st.fs > f0, `16:9 무대 ${Math.round(r.w)}×${Math.round(r.h)} · 전체 화면 요청 ${st.fs - f0}번 (실제로 덮였나: ${st.el})`);
    ok('L18', st.wake, 'TV 화면이 열리면 화면 켜 두기 요청 (Wake Lock)');
  });

  await step('대기 화면: 예약 7곡 + 외 N곡, 인기차트 TOP 5, 시계·날짜, 안내·사용자·점수, 리모컨 QR', ['L2', 'L3', 'L4', 'L5', 'L6'], async () => {
    // 시험 데이터(S): 부른 횟수·오늘 점수 (reserve 점검이 먼저 넣었으면 그대로)
    await p.eval(`(()=>{ const a=songById(${q(ids.long)}); if(!playsOf(a)){ plays[a.id]={n:5,last:Date.now()}; plays.demo={n:3,last:Date.now()-1000}; localStorage.setItem('nb-plays', JSON.stringify(plays)); }
      if(!scores.some(x=>x.score===91)){ scores.unshift({id:a.id,no:a.no,title:a.title,score:91,at:Date.now(),who:'나'}); localStorage.setItem('nb-scores', JSON.stringify(scores)); } renderBest(); renderIdleChart(); })()`);
    const pool = await p.eval(`state.songs.filter(s=>s.blob||s.demo).map(s=>s.id)`);
    await setQueue(Array.from({ length: 9 }, (_, i) => pool[i % pool.length]));
    const L2 = await p.eval(`({n:document.querySelectorAll('#idleQueue li').length, last:document.querySelector('#idleQueue li:last-child').textContent, c:document.querySelector('#idleCount').textContent, chart:document.querySelector('#idleChart').hidden})`);
    ok('L2', L2.n === 8 && /외 2곡/.test(L2.last) && L2.c === '9곡', `예약 9곡 → 7줄 + "${L2.last.trim()}", "${L2.c}"`);
    await setQueue(pool.slice(0, 2));
    const L3 = await p.eval(`({h:document.querySelector('#idleChart').hidden, n:document.querySelectorAll('#idleChartList li').length, first:document.querySelector('#idleChartList li')?.textContent||'', head:document.querySelector('#idleChart .idle-h').textContent})`);
    const top = await p.eval(`(()=>{const s=chartSongs().filter(playsOf)[0]; return {no:String(s.no), n:playsOf(s)}})()`);
    ok('L3', L2.chart && !L3.h && L3.n >= 1 && L3.n <= 5 && L3.first.includes(top.no) && L3.first.includes(top.n + '회') && /인기차트 TOP 5/.test(L3.head), `예약 9곡이면 숨김 · 2곡이면 "인기차트 TOP 5" ${L3.n}줄 (1위 ${top.no} ${top.n}회)`);
    await setQueue([]);
    const now = new Date();
    const L4 = await p.eval(`({c:document.querySelector('#clock').firstChild.textContent, d:document.querySelector('#clockDate').textContent})`);
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const day = `${now.getMonth() + 1}월 ${now.getDate()}일 ${'일월화수목금토'[now.getDay()]}요일`;
    ok('L4', /^\d\d:\d\d$/.test(L4.c) && Math.abs(toMin(L4.c) - toMin(hm)) <= 1 && L4.d === day, `시계 ${L4.c} · "${L4.d}"`);
    const L5 = await p.eval(`({keys:getComputedStyle(document.querySelector('.idle-tip .for-keys')).display, touch:getComputedStyle(document.querySelector('.idle-tip .for-touch')).display, tip:document.querySelector('.idle-tip .for-keys').textContent,
      user:document.querySelector('#idleUser').textContent, best:document.querySelector('#bestBox').textContent})`);
    ok('L5', L5.keys !== 'none' && L5.touch === 'none' && /Enter 예약/.test(L5.tip) && /S 곡 검색/.test(L5.tip) && /나 · ♥ \d+곡/.test(L5.user) && /오늘 최고 점수91점/.test(L5.best) && /최근 · 91점 QA 시험 노래 \(나\)/.test(L5.best),
      `단축키 안내 · "${L5.user.slice(0, 12)}…" · "${L5.best.slice(0, 30)}…"`);
    const L6 = await p.eval(`({h:document.querySelector('#remoteInfo').hidden, t:document.querySelector('#remoteInfo').textContent, qr:!!document.querySelector('#remoteInfo img.qr')?.src})`);
    const cover = await p.eval(`(()=>{const a=document.querySelector('#remoteInfo').getBoundingClientRect(), b=document.querySelector('#tvRemote').getBoundingClientRect(); const h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top), w=Math.min(a.right,b.right)-Math.max(a.left,b.left); return h>0&&w>0 ? {h:Math.round(h), of:Math.round(a.height)} : null})()`);
    if (cover) ctx.finding('L6', `TV 1920×1080 대기 화면: 리모컨 칸(QR·주소·코드) 아래쪽 ${cover.h}px(칸 높이 ${cover.of}px)가 조작 막대에 가려짐. 대기 중에는 막대가 안 숨어서 계속 가림 (사진 12-tv-idle-1920x1080)`);
    ok('L6', !L6.h && L6.t.includes(`http://192.0.2.1:5199/remote.html`) && /코드 \d{4}/.test(L6.t) && (L6.qr || ctx.conds.W === false), `대기 화면 리모컨 주소·코드·QR (${L6.qr ? 'QR 있음' : 'QR 없음'})`);
  });

  await step('대기 화면에서 예약하면 바로 시작, 제목 카드 4.5초·진행 막대, "지금 부르는 중이에요"', ['I4', 'L7', 'L14', 'L18'], async () => {
    for (const k of '10001') await p.key(k);      // 데모곡(50초)으로: 아래 숨김·취소 시험 동안 곡이 끝나지 않게
    await p.key('Enter');
    const started = await p.until('state.playing', 5000);
    ok('I4', started && (await p.eval('state.song.no')) === 10001, `TV 대기 화면에서 10001 예약 → 바로 시작`);
    await p.until('curTime()>1.2', 3000);
    const a = await p.eval(`({card:!document.querySelector('#titleCard').hidden, title:document.querySelector('#cardTitle').textContent, prog:!document.querySelector('#tvProg').hidden, pt:document.querySelector('#tvProg span').textContent, w:parseFloat(document.querySelector('#tvProg i').style.width), t:curTime()})`);
    await p.until('curTime()>4.8', 6000);
    const b = await p.eval(`({card:!document.querySelector('#titleCard').hidden, w:parseFloat(document.querySelector('#tvProg i').style.width), pt:document.querySelector('#tvProg span').textContent})`);
    ok('L7', a.card && a.title === '작은 방의 노래' && a.prog && /^0:01 \/ 0:\d\d$/.test(a.pt) && !b.card && b.w > a.w,
      `${a.t.toFixed(1)}초 제목 카드 ${a.card} "${a.title}" · 진행 막대 ${a.prog} "${a.pt}" (${a.w.toFixed(1)}%) → 4.8초 카드 ${b.card ? '남음' : '사라짐'}, 막대 "${b.pt}" (${b.w.toFixed(1)}%)`);
    const m = await marks(p);
    await p.move(960, 500);
    await p.click(bar('start'));
    ok('L14', await sawFlash(p, /지금 부르는 중이에요/, m), '부르는 중 "시작" → "지금 부르는 중이에요"');
    ok('L18', await p.eval('!!Wake.lock'), '노래 중 화면 켜 두기');
  });

  await step('노래 중 3초 뒤 막대·커서 숨김 → 마우스·키로 보임, 숨었을 때 첫 클릭은 버튼을 안 누름', ['L9'], async () => {
    const hid = () => p.eval(`document.querySelector('#tv').classList.contains('hide-ui')`);
    const waitHide = () => p.until(`document.querySelector('#tv').classList.contains('hide-ui')`, 4500);
    const h1 = await waitHide();
    const cursor = await p.eval(`getComputedStyle(document.querySelector('#tv')).cursor`);
    await p.move(900, 400); await p.move(905, 405);
    const shown1 = !(await hid());
    await waitHide();
    const v0 = await p.eval('settings.mrVol');
    await p.key('-');
    const shown2 = !(await hid()), v1 = await p.eval('settings.mrVol');
    await p.key('=');
    // 마우스를 "반주 +" 버튼 위에 둔 채 막대가 숨기를 기다렸다가 (움직이지 않고) 누르기
    const r = await p.rect(bar('mr+'));
    await p.move(r.cx, r.cy);
    await waitHide();
    const v2 = await p.eval('settings.mrVol');
    await p.mouse('mousePressed', r.cx, r.cy); await p.mouse('mouseReleased', r.cx, r.cy); await sleep(150);
    const first = await p.eval(`({v:settings.mrVol, shown:!document.querySelector('#tv').classList.contains('hide-ui')})`);
    await p.mouse('mousePressed', r.cx, r.cy); await p.mouse('mouseReleased', r.cx, r.cy); await sleep(150);
    const second = await p.eval('settings.mrVol');
    await p.click(bar('mr-'));
    ok('L9', h1 && cursor === 'none' && shown1 && shown2 && v1 === v0 - 5 && first.v === v2 && first.shown && second === v2 + 5,
      `3초 뒤 숨김(커서 없음) · 마우스 → 보임 · 키 → 보임(볼륨도 바뀜 ${v0}→${v1}) · 숨었을 때 첫 클릭 → 막대만 (${v2}→${first.v}) · 다음 클릭 → ${second}`);
  });

  await step('부르던 곡 취소 → 예약이 있으면 3초 뒤 다음 곡', ['L10'], async () => {
    await setQueue([ids.long]);
    await p.move(960, 500);
    const m = await marks(p);
    await p.click(bar('cancel'));
    const c = await p.eval(`({playing:state.playing, card:!document.querySelector('#nextCard').hidden, sec:document.querySelector('#nextSec').textContent, no:document.querySelector('#nextNo').textContent})`);
    const f = await sawFlash(p, /^취소$/, m);
    const t0 = Date.now();
    const next = await p.until(`state.playing && state.song.no===${ids.longNo}`, 6000);
    const waited = (Date.now() - t0) / 1000;
    ok('L10', !c.playing && c.card && c.sec === '3' && c.no === String(ids.longNo) && f && next && waited > 2 && waited < 4.5, `취소 → "다음 곡 ${c.no}" ${c.sec}초 → ${waited.toFixed(1)}초 뒤 시작`);
  });

  await step('Esc 순서: 숫자판 → 창 → 번호 → 카운트다운 → 점수 → 곡 취소 → TV 나가기', ['L11', 'M3'], async () => {
    const st = () => p.eval(`({pad:!document.querySelector('#numPad').hidden, search:!document.querySelector('#searchOv').hidden, num:numBuf, next:nextAt!=null, score:!document.querySelector('#scoreOverlay').hidden, playing:state.playing, tv:state.tv})`);
    const name = x => x.pad ? '숫자판' : x.search ? '검색 창' : x.num ? '번호' : x.next ? '카운트다운' : x.score ? '점수' : x.playing ? '노래 중' : x.tv ? 'TV 대기' : 'TV 나감';
    // ① 노래 중(데모) + 번호 "5" + 검색 창: Esc → 창 닫기(번호는 남음) → Esc → 번호 지우기
    await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
    await selectNo(p, 10001); await p.eval('play()'); await p.until('state.playing', 3000);
    // 전체 화면(Fullscreen API)이면 첫 Esc는 브라우저가 전체 화면 나가기로 쓰고 페이지에 오지 않는다 → 먼저 나와서 앱의 Esc 차례를 본다
    if (await p.eval('!!document.fullscreenElement')) {
      await p.key('5'); await p.key('s');
      await p.key('Escape'); await sleep(300);
      const eaten = await p.eval(`({fs:!!document.fullscreenElement, search:!document.querySelector('#searchOv').hidden})`);
      if (!eaten.fs && eaten.search) ctx.finding('L11', 'TV 화면이 전체 화면(Fullscreen API)일 때 첫 Esc는 브라우저가 전체 화면 나가기로 쓰고 앱에는 오지 않음 → 창 닫기·곡 취소는 두 번째 Esc부터 (헤드리스 Edge에서 봄. 크롬도 같은 규칙 [일반]). CEO가 TV로 쓸 때 "Esc 한 번에 창이 안 닫힌다"로 느낄 수 있음');
      if (await p.eval('!!document.fullscreenElement')) await p.eval('document.exitFullscreen()');
      await p.eval(`closeOverlays(); numBuf=''; updateNumBox()`); await sleep(200);
    }
    await p.key('5'); await p.key('s');
    const s1 = [await st()];
    for (let i = 0; i < 2; i++) { await p.key('Escape'); await sleep(120); s1.push(await st()); }
    // ② 노래 중 + 예약 1곡 + 점수 창 + 숫자판(번호 "5"): Esc를 차례로
    await setQueue([ids.long]);
    await p.eval(`showScore(80,false)`);
    await p.key('5'); await p.eval(`openNumPad(false)`);
    const s2 = [await st()];
    for (let i = 0; i < 6; i++) { await p.key('Escape'); await sleep(120); s2.push(await st()); if (!s2[s2.length - 1].tv) break; }
    const n1 = s1.map(name), n2 = s2.map(name);
    // 숫자판 Esc는 번호도 같이 지운다 (cancelNumPad). 곡 취소는 예약이 있어 카운트다운을 연다
    const want1 = ['검색 창', '번호', '노래 중'], want2 = ['숫자판', '점수', '노래 중', '카운트다운', 'TV 대기', 'TV 나감'];
    ok('L11', n1.join('>') === want1.join('>') && s1[1].num === '5' && n2.join('>') === want2.join('>'), `Esc 차례: ${n1.join(' → ')} / ${n2.join(' → ')}`);
    const names = n2;
    ok('M3', names[names.length - 1] === 'TV 나감', 'Esc 취소 (L11 순서)');
    await stopAll(p);
  });

  await step('조작 막대 버튼 18개 (마우스 화면은 한 줄)', ['L8'], async () => {
    await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
    await selectById(p, ids.long);
    await enterTVNoFs(p);
    await p.move(960, 500);
    const btns = await p.eval(`[...document.querySelectorAll('#tvRemote [data-act]')].filter(b=>getComputedStyle(b).display!=='none' && b.getBoundingClientRect().width>0).map(b=>b.dataset.act)`);
    const res = {};
    const trace = [];
    const press = async a => {
      await p.move(960, 500);
      const r = await p.rect(bar(a));
      const before = await p.eval(`({pl:state.playing, hide:document.querySelector('#tv').classList.contains('hide-ui'), fs:!!document.fullscreenElement, at:(document.elementFromPoint(${Math.round(r.cx)},${Math.round(r.cy)})?.closest('[data-act]')?.dataset.act)||document.elementFromPoint(${Math.round(r.cx)},${Math.round(r.cy)})?.className})`);
      await p.click(bar(a)); await sleep(150);
      trace.push(`${a}:${JSON.stringify(before)}`);
    };
    const S = e => p.eval(e);
    await press('start'); res.start = await p.until('state.playing', 3000);
    await press('pause'); res.pause = await S('!state.playing && state.offset>0');
    await press('pause'); res.pause = res.pause && await p.until('state.playing', 2000);
    let m = await marks(p); await press('jump'); res.jump = (await S(`__ui.flashes.length`)) > m.f;
    await press('cancel'); res.cancel = await S('!state.playing && state.offset===0');
    await press('num'); res.num = await visible(p, '#numPad'); await press('num'); res.num = res.num && await isHidden(p, '#numPad');
    await press('search'); res.search = await visible(p, '#searchOv'); await p.eval('closeOverlays()');
    await press('queue'); res.queue = await visible(p, '#queueOv'); await p.eval('closeOverlays()');
    await press('chart'); res.chart = await visible(p, '#chartOv'); await p.eval('closeOverlays()');
    await press('mine'); res.mine = await visible(p, '#mineOv'); await p.eval('closeOverlays()');
    const tmpUser = await S(`liveProfiles().length<2 ? (()=>{ const u={id:'qa-tv-user', name:'QA티비', favorites:[], playlists:[], updatedAt:Date.now()}; Profiles.list.push(u); saveProfiles(); return true })() : false`);
    const u0 = await S('me().name'); await press('user'); res.user = (await S('me().name')) !== u0 && (await txt(p, '#tvUserBtn')) === `사용자: ${await S('me().name')}`;
    while ((await S('me().name')) !== u0) await press('user');
    if (tmpUser) await S(`Profiles.list=Profiles.list.filter(x=>x.id!=='qa-tv-user'); saveProfiles(); renderProfileChip()`);
    await press('rec'); res.rec = (await S('state.armed')) && (await txt(p, '#tvRecBtn')) === '● 녹음 켜짐'; await press('rec');
    await press('key-'); res['key-'] = await p.until(`document.querySelector('#keyOut').textContent==='-1'`, 20000);
    await press('key+'); res['key+'] = await p.until(`document.querySelector('#keyOut').textContent==='원래 키'`, 5000);
    const v = await S('settings.mrVol'); await press('mr-'); res['mr-'] = (await S('settings.mrVol')) === v - 5; await press('mr+'); res['mr+'] = (await S('settings.mrVol')) === v;
    m = await marks(p); await press('mic'); res.mic = await sawToast(p, /마이크/, m, 3000);
    const fsBefore = await S('!!document.fullscreenElement'); await press('fs'); await sleep(300); res.fs = (await S('!!document.fullscreenElement')) !== fsBefore;
    if (await S('!!document.fullscreenElement')) { await press('fs'); await sleep(200); }
    await press('exit'); res.exit = await S('!state.tv');
    const bad = Object.entries(res).filter(([, v]) => !v).map(([k]) => k);
    ok('L8', btns.length === 18 && !btns.includes('more') && !bad.length, `보이는 버튼 ${btns.length}개 (한 줄) · 안 된 버튼: ${bad.join(',') || '없음'} (마이크는 지금 권한 거부 상태: 안내가 뜨면 통과, 가짜 마이크는 mic 점검)${bad.length ? ' · 누르기 전 상태 ' + trace.filter(t => bad.some(b => t.startsWith(b + ':'))).join(' ') : ''}`);
  });

  await step('F로 전체 화면 켜고 끄기, T로 나가기', ['L12'], async () => {
    await p.key('t'); await p.until('state.tv', 2000); await sleep(300);
    if (await p.eval('!!document.fullscreenElement')) { await p.key('f'); await sleep(300); }
    await p.key('f'); await sleep(300); const on = await p.eval('!!document.fullscreenElement');
    await p.key('f'); await sleep(300); const off = await p.eval('!document.fullscreenElement');
    await p.key('t'); const out = await p.until('!state.tv', 2000);
    ok('L12', on && off && out, `F 켬 ${on} · F 끔 ${off} · T 나감 ${out}`);
    ok('L18', await p.until('!Wake.lock', 2000), 'TV에서 나가고 노래도 멈추면 화면 켜 두기 풂');
  });

  await step('주소에 ?tv=1(또는 ?tv) → 준비 뒤 바로 TV 화면, 전체 화면 안내와 첫 키', ['L15', 'L16'], async () => {
    await p.goto(ctx.base + '/?tv=1', 'typeof state!=="undefined" && state.songs.length>0 && state.tv');
    const a = await p.eval(`({tv:state.tv, demo:state.song?.no===10001 && !!state.song.buffer, covered:screenCovered(), flash:document.querySelector('#flash').hidden?'':document.querySelector('#flash').textContent})`);
    const f0 = await p.eval('__ui.fsReq');
    await p.key('l');
    await sleep(300);
    const b = await p.eval(`({fs:__ui.fsReq, el:!!document.fullscreenElement, queue:!document.querySelector('#queueOv').hidden})`);
    await p.key('Escape');
    await p.goto(ctx.base + '/index.html?tv', 'typeof state!=="undefined" && state.songs.length>0 && state.tv');
    const c = await p.eval('state.tv');
    await p.goto(ctx.base + '/index.html?tv=0', 'typeof state!=="undefined" && state.songs.length>0 && !!state.song.buffer');
    const d = await p.eval('state.tv');
    ok('L15', a.tv && a.demo && c && !d, `?tv=1 → TV (데모곡 준비 뒤) · ?tv → TV · ?tv=0 → 관리 화면`);
    if (a.covered) ok('L16', true, '이 시험 창은 이미 화면을 다 덮은 것으로 보여서 안내가 안 나옴 (그 경우 규칙대로)');
    else ok('L16', a.flash === '아무 키나 누르면 전체 화면이 돼요 · F 키도 돼요' && b.fs > f0 && b.el && b.queue, `안내 "${a.flash}" · 첫 키(L) → 전체 화면 요청 + 예약 목록도 열림`);
    if (await p.eval('!!document.fullscreenElement')) await p.eval('document.exitFullscreen()');
  });

  await step('화면 숫자판(번호): 1~9·⌫·0·처음부터·우선예약·예약, 7초 규칙, 닫기 3가지, 방향키·Enter', ['I13'], async () => {
    await stopAll(p); await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
    await selectNo(p, 10001);
    await enterTVNoFs(p); await p.move(960, 500);
    const pad = k => `#numPad [data-k="${k}"]`;
    const st = () => p.eval(`({pad:!document.querySelector('#numPad').hidden, box:!document.querySelector('#numBox').hidden, num:numBuf, song:document.querySelector('#numSong').textContent, q:state.queue.length, playing:state.playing})`);
    const res = [];
    await p.click(bar('num'));
    let s = await st(); res.push(['열림·빈 안내', s.pad && s.box && s.song === '곡 번호를 눌러 주세요']);
    for (const k of '10001') await p.click(pad(k));
    s = await st(); res.push(['10001 → 곡 이름', s.num === '10001' && /작은 방의 노래/.test(s.song)]);
    await p.click(pad('del')); s = await st(); res.push(['⌫', s.num === '1000']);
    await p.click(pad('clr')); s = await st(); res.push(['처음부터', s.num === '']);
    let m = await marks(p); await p.click(pad('res')); res.push(['번호 없이 예약 → 안내', await sawFlash(p, /곡 번호를 먼저 눌러 주세요/, m) && (await st()).pad]);
    for (const k of '99999') await p.click(pad(k));
    s = await st(); m = await marks(p); await p.click(pad('res'));
    res.push(['없는 번호', s.song === '없는 번호예요' && await sawFlash(p, /없는 번호예요/, m) && (await st()).q === 0]);
    await p.click(pad('7')); await sleep(7300); s = await st(); res.push(['7초 뒤 번호 지움(숫자판은 열린 채)', s.num === '' && s.pad && s.box]);
    // 닫기: ✕, 바깥 누르기, Esc
    await p.click(pad('close')); res.push(['✕ 닫기', !(await st()).pad]);
    await p.click(bar('num')); await p.clickXY(300, 300); res.push(['바깥 누르면 닫기', !(await st()).pad]);
    await p.click(bar('num')); await p.key('Escape'); res.push(['Esc 닫기', !(await st()).pad && (await p.eval('state.tv'))]);
    // 키보드로 열기 (번호 버튼에 포커스 → Enter): "1"에 포커스, → 로 2, Enter로 누름
    await p.eval(`document.querySelector('${bar('num')}').focus()`); await p.key('Enter'); await sleep(100);
    const f1 = await p.eval(`document.activeElement?.dataset?.k`);
    await p.key('ArrowRight'); const f2 = await p.eval(`document.activeElement?.dataset?.k`);
    await p.key('Enter'); s = await st();
    res.push(['방향키·Enter', f1 === '1' && f2 === '2' && s.num === '2']);
    await p.key('Escape');
    // 우선예약 → 닫히고 대기 화면이라 바로 시작
    await p.click(bar('num'));
    for (const k of '10001') await p.click(pad(k));
    await p.click(pad('pri'));
    const started = await p.until('state.playing', 5000);
    s = await st(); res.push(['우선예약 → 닫힘 + 바로 시작', !s.pad && started]);
    await stopAll(p);
    // 예약 (노래 중이 아니면 바로 시작하므로, 노래 중에 예약해서 예약 목록에 들어가는지)
    await enterTVNoFs(p); await p.key(' '); await p.until('state.playing', 3000); await p.move(960, 500);
    await p.click(bar('num'));
    for (const k of String(ids.longNo)) await p.click(pad(k));
    await p.click(pad('res'));
    s = await st(); res.push(['예약 → 닫힘 + 예약 목록', !s.pad && s.q === 1]);
    const bad = res.filter(([, v]) => !v).map(([k]) => k);
    ok('I13', !bad.length, bad.length ? `안 된 것: ${bad.join(' / ')}` : res.map(([k]) => k).join(' · '));
    await stopAll(p);
  });

  await step('정지(■)를 누르면 다음 곡 카운트다운도 멈춤, 곡이 끝나면 예약 첫 곡이 카운트다운 뒤 시작 ("지금 시작"·"멈추기")', ['F12', 'H4'], async () => {
    await p.emulate(PC);
    await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
    const finish = async () => {
      await selectById(p, ids.short);
      await setQueue(['demo']);
      await p.eval('play()');
      return p.until(`!document.querySelector('#nextCard').hidden`, 8000);
    };
    const c1 = await finish();
    const card = await p.eval(`({no:document.querySelector('#nextNo').textContent, t:document.querySelector('#nextTitle').textContent, sec:+document.querySelector('#nextSec').textContent})`);
    await p.click('#stopBtn');
    const stopped = await p.eval(`document.querySelector('#nextCard').hidden && nextAt==null`);
    await sleep(3500);
    const stillIdle = await p.eval('!state.playing');
    ok('F12', c1 && stopped && stillIdle, `곡 끝 → 카운트다운 → ■ → 멈춤 (3.5초 뒤에도 시작 안 함)`);
    const c2 = await finish();
    await p.click('#nextNow');
    const now = await p.until('state.playing && state.song.no===10001', 4000);
    await stopAll(p);
    const c3 = await finish();
    await p.click('#nextCancel');
    const cancelled = await p.eval(`document.querySelector('#nextCard').hidden && nextAt==null`);
    await stopAll(p);
    const c4 = await finish();
    const t0 = Date.now();
    const auto = await p.until('state.playing && state.song.no===10001', 6000);
    const w = (Date.now() - t0) / 1000;
    await stopAll(p);
    ok('H4', c1 && card.no === '10001' && card.sec >= 2 && c2 && now && c3 && cancelled && c4 && auto && w > 1.5, `"다음 곡 ${card.no} ${card.t}" · 지금 시작 ${now} · 멈추기 ${cancelled} · 그냥 두면 ${w.toFixed(1)}초 뒤 시작`);
    await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
  });
  await p.emulate(PC);
  await stopAll(p);
}
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
