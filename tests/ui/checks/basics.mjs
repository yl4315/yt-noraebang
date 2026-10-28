// 흐름 1·2·17: 빈 저장소에서 열기, 위쪽 막대·탭·설정 창, 데모곡 재생, 볼륨·키, 좁은 화면·움직임 줄이기
import { PC, PHONE, openPage, txt, isHidden, visible, marks, sawToast, sawFlash, noHScroll, sleep, q, stopAll } from './_lib.mjs';
export const areas = ['B', 'C', 'E', 'F', 'K', 'S', 'O', 'P', 'H', 'I', 'M'];

export default async function basics(ctx) {
  const { ok, step } = ctx;
  const p = ctx.p;

  await step('빈 저장소에서 열기: 사용자 "나", 데모곡 10001, 로고, 탭', ['K1', 'S4', 'S1', 'S3', 'B1', 'C2', 'C1', 'E2', 'F2'], async () => {
    ok('K1', await p.eval(`liveProfiles().length===1 && me().name==='나'`) && (await txt(p, '#profName')) === '나', '사용자 "나" 하나, 위쪽 버튼에 "나"');
    ok('S4', await p.eval(`state.song.no===10001 && document.querySelector('#songNo').textContent==='10001' && document.querySelector('#songList li.on .no').textContent==='10001'`), '시작할 때 10001이 골라짐 (무대 번호·목록 표시)');
    const first = await p.eval(`(()=>{const li=document.querySelector('#songList li'); return {no:li.querySelector('.no').textContent, t:li.querySelector('.t').textContent, a:li.querySelector('.a').textContent}})()`);
    ok('S1', first.no === '10001' && first.t === '작은 방의 노래', `맨 위 ${first.no} ${first.t}`);
    ok('C2', first.no === '10001' && first.t === '작은 방의 노래' && first.a.startsWith('YT 노래방 데모 MR'), `줄에 번호·제목·가수: ${first.no} / ${first.t} / ${first.a}`);
    const demoActs = await p.eval(`[...document.querySelectorAll('#songList li:first-child .acts button')].map(b=>b.title||b.textContent)`);
    ok('S3', !demoActs.includes('수정') && !demoActs.includes('삭제') && await isHidden(p, '#syncBtn'), `데모곡 줄 버튼: ${demoActs.join(',')} · 가사 싱크 편집 버튼 숨김`);
    const logo = await txt(p, '.logo');
    ok('B1', /YT\s*노래방/.test(logo) && logo.includes('MR · 녹음 · 점수'), `로고 "${logo.replace(/\s+/g, ' ').trim()}"`);
    ok('E2', await visible(p, '#titleCard') && (await txt(p, '#cardTitle')) === '작은 방의 노래' && (await txt(p, '#titleCard .press')).includes('스페이스바'), '시작 전 제목 카드');
    ok('F2', (await visible(p, '.deck .keys')) && (await txt(p, '.deck .keys')).includes('Space'), '단축키 안내 글');
    // 탭 3개
    await p.click('#tabMine');
    const mine = await p.eval(`!document.querySelector('#minePanel').hidden && document.querySelector('#songsPanel').hidden && document.querySelector('#tabMine').classList.contains('on')`);
    await p.click('#tabRecs');
    const recs = await p.eval(`!document.querySelector('#recsPanel').hidden && document.querySelector('#minePanel').hidden && document.querySelector('#recCount').textContent==='0' && !document.querySelector('#recEmpty').hidden`);
    await p.click('#tabSongs');
    const songs = await p.eval(`!document.querySelector('#songsPanel').hidden && document.querySelector('#recsPanel').hidden`);
    ok('C1', mine && recs && songs, `내 목록 ${mine} · 내 녹음(수 0) ${recs} · 곡 목록 ${songs}`);
    ctx.common('PC 1280 첫 화면 가로 스크롤 없음', await noHScroll(p));
  });

  await step('위쪽 막대: 사용자 창, 설정 창(Drive·저장 공간·리모컨), 클라이언트 ID', ['B2', 'B4', 'P1', 'P5', 'O3', 'O1', 'B3'], async () => {
    await p.click('#profileBtn');
    ok('B2', await p.until(`document.querySelector('#profileDialog').open`, 2000), '사용자 버튼 → 사용자 창');
    await p.click('#profClose');
    ok('B3', (await txt(p, '#cloudTxt')) === 'Drive 연결', '연결 전 Drive 버튼 "Drive 연결"');
    await p.click('#settingsBtn');
    const open = await p.until(`document.querySelector('#cloudDialog').open`, 2000);
    ok('B4', open && (await txt(p, '#cloudDialog h2')) === 'Drive · 저장 공간', '설정 버튼 → "Drive · 저장 공간" 창');
    await p.until(`document.querySelector('#storeTxt').textContent.length>0`, 3000);
    const st = await p.eval(`({t:document.querySelector('#storeTxt').textContent, w:document.querySelector('#storeBar').style.width, c:document.querySelector('#storeCounts').textContent})`);
    ok('P1', /사용 중/.test(st.t) && /남은 공간/.test(st.t) && parseFloat(st.w) > 0, `"${st.t}" 막대 ${st.w}`);
    ok('P5', (await visible(p, '#remoteSet')) && (await txt(p, '#remoteSet')).includes('휴대폰 리모컨'), '설정 창 휴대폰 리모컨 칸');
    ok('O1', (await txt(p, '#cloudStatus')).includes('Google 계정 연결'), `연결 전 상태 글 "${await txt(p, '#cloudStatus')}"`);
    // 클라이언트 ID: 들어 있음 → 틀린 값 안내 → 바꾸기 → 원래대로
    const cid = await p.eval(`document.querySelector('#gClientId').value`);
    await p.eval(`document.querySelector('#clientAdv').open=true`);
    const howto = await p.eval(`[...document.querySelectorAll('#clientAdv details summary')].some(s=>s.textContent.includes('만드는 방법')) && document.querySelector('#clientAdv .steps').textContent.includes('Google Cloud 콘솔')`);
    // (연결 전에는 저장 결과 글이 설정 창 상태 줄이 아니라 Drive 버튼 풍선 글(Cloud.msg)에만 나온다 → 그 글로 본다)
    await p.eval(`document.querySelector('#gClientId').value='잘못된 값'`); await p.click('#gClientSave');
    const bad = await p.eval(`({m:Cloud.msg, id:Cloud.clientId})`);
    await p.eval(`document.querySelector('#gClientId').value='qa-test-123.apps.googleusercontent.com'`); await p.click('#gClientSave');
    const saved = await p.eval(`({m:Cloud.msg, id:Cloud.clientId, ls:localStorage.getItem('nb-gclient')})`);
    await p.eval(`document.querySelector('#gClientId').value=${q(cid)}`); await p.click('#gClientSave');
    const back = await p.eval(`Cloud.clientId`);
    ok('O3', /\.apps\.googleusercontent\.com$/.test(cid) && howto && /apps\.googleusercontent\.com/.test(bad.m) && bad.id === cid && /저장했어요/.test(saved.m) && saved.ls === 'qa-test-123.apps.googleusercontent.com' && back === cid,
      `기본 ID 들어 있음 · 만드는 방법 안내 · 틀린 값은 저장 안 하고 안내 · 바꾸기 저장 · 원래대로 되돌림`);
    ctx.finding?.('O3', '설정 창: Drive 연결 전에는 클라이언트 ID "저장" 결과 글(틀린 값 안내·저장했어요)이 창에 안 보이고 Drive 버튼 풍선 글에만 들어감 (renderCloudPanel이 연결 전에는 Cloud.msg를 안 씀)');
    await p.click('#cloudClose');
  });

  await step('데모곡 재생 (Space): 제목 카드 → ●● → 두 줄 가사 → 조명 → 위치 막대 → 정지', ['M1', 'H5', 'E4', 'E3', 'E10', 'F1', 'I10', 'E7', 'S1'], async () => {
    const m = await marks(p);
    await p.key(' ');
    ok('M1', await p.until('state.playing', 3000), 'Space → 시작');
    ok('H5', await sawToast(p, /마이크를 켜면 녹음하고 점수도/, m), '마이크가 꺼진 채 시작 → 안내');
    ok('I10', await p.eval(`playsOf(state.song)===1`), '처음부터 시작하면 부른 횟수 1');
    ok('F1', (await p.eval(`document.querySelector('#playBtn').getAttribute('aria-label')`)) === '일시정지', '재생 중 시작 버튼이 일시정지로');
    await p.until('curTime()>1.6', 5000);
    const d = await p.eval(`({t:curTime(), dots:document.querySelector('#lineTop .dots').textContent+document.querySelector('#lineBottom .dots').textContent})`);
    ok('E4', /●/.test(d.dots), `첫 줄 4초 전 ●● (${d.t.toFixed(1)}초: "${d.dots}")`);
    ok('S1', d.t > 1.5, `데모 반주 시간이 흐름 ${d.t.toFixed(1)}초`);
    await p.until('curTime()>6.2', 8000);
    const l1 = await p.eval(`({t:curTime(), top:document.querySelector('#lineTop .base').textContent, bot:document.querySelector('#lineBottom .base').textContent, p:parseFloat(document.querySelector('#lineTop').style.getPropertyValue('--p'))})`);
    await sleep(500);
    const p2 = await p.eval(`parseFloat(document.querySelector('#lineTop').style.getPropertyValue('--p'))`);
    ok('E3', l1.top === '창문 너머 불빛 하나' && l1.bot === '오늘 밤도 너를 불러' && l1.p > 0 && p2 > l1.p, `두 줄 "${l1.top}" / "${l1.bot}", 색 ${l1.p.toFixed(0)}% → ${p2.toFixed(0)}%`);
    const lights = await p.eval(`(()=>{const cs=getComputedStyle(document.querySelector('.lights')); return {n:cs.animationName, d:cs.animationDuration, ps:cs.animationPlayState, playing:document.querySelector('#stage').classList.contains('playing')}})()`);
    ok('E10', lights.playing && lights.n === 'drift' && lights.d === '7s' && lights.ps === 'running', `무대 조명 ${lights.n} ${lights.d} ${lights.ps}`);
    // 위치 막대를 마우스로 눌러 20초 근처로
    const r = await p.rect('#seek'), durS = await p.eval('dur()');
    await p.clickXY(r.x + r.w * (20 / durS), r.cy);
    await sleep(300);
    const t2 = await p.eval('curTime()');
    ok('E7', t2 > 18 && t2 < 23, `위치 막대를 눌러 ${t2.toFixed(1)}초로`);
    await p.key(' ');
    const paused = await p.eval(`!state.playing && state.offset>18 && document.querySelector('#playBtn').getAttribute('aria-label')==='시작'`);
    await p.click('#stopBtn');
    const stopped = await p.eval(`!state.playing && state.offset===0`);
    ok('F1', paused && stopped, `일시정지(위치 유지) ${paused} · 정지(처음으로) ${stopped}`);
  });

  await step('녹음 버튼과 상태 글 (마이크 거부 상태)', ['F1', 'B6'], async () => {
    const m = await marks(p);
    await p.click('#recBtn');
    await p.until(`state.armed`, 3000);
    ok('B6', await sawToast(p, /마이크 권한이 거부됐어요/, m), '권한 거부 때 안내');
    const lbl = await txt(p, '#recLbl');
    await p.click('#recBtn');
    const lbl2 = await txt(p, '#recLbl');
    ok('F1', lbl.startsWith('녹음 대기') && lbl2 === '녹음 꺼짐' && (await p.eval(`document.querySelector('#recBtn').getAttribute('aria-pressed')`)) === 'false', `녹음 버튼 "${lbl}" → "${lbl2}"`);
  });

  await step('아래 조작부 버튼: 곡 검색·예약 목록·인기차트·간주점프', ['F3'], async () => {
    await p.click('#openSearchBtn'); const a = await visible(p, '#searchOv'); await p.key('Escape');
    await p.click('#openQueueBtn'); const b = await visible(p, '#queueOv'); await p.click('#queueClose');
    await p.click('#openChartBtn'); const c = await visible(p, '#chartOv'); await p.click('#chartClose');
    const m = await marks(p);
    await p.click('#jumpBtn');
    const j = await sawFlash(p, /노래가 나올 때 쓸 수 있어요/, m);
    ok('F3', a && b && c && j, `곡 검색 ${a} · 예약 목록 ${b} · 인기차트 ${c} · 간주점프(멈춤 안내) ${j}`);
  });

  await step('짧은 알림·볼륨·멜로디 가이드·데모 키 바꾸기', ['E11', 'S2', 'F9', 'E1'], async () => {
    let m = await marks(p);
    await p.click('#songList li:first-child .acts .btn');     // 예약
    const f1 = await sawFlash(p, /예약\s+10001\s+작은 방의 노래/, m);
    m = await marks(p); await p.key('-'); const f2 = await sawFlash(p, /반주 볼륨 75/, m);
    m = await marks(p); await p.key('='); const f3 = await sawFlash(p, /반주 볼륨 80/, m);
    m = await marks(p); await p.key('.');
    const k1 = await p.until(`state.key===1 && !!state.keyBufs`, 25000);
    const f4 = await sawFlash(p, /키 \+1/, m, 2000);
    const badge = await p.eval(`!document.querySelector('#keyBadge').hidden && document.querySelector('#keyBadge').textContent==='키 +1' && document.querySelector('#keyOut').textContent==='+1'`);
    ok('E11', f1 && f2 && f3 && f4, `예약 ${f1} · 볼륨 ${f2 && f3} · 키 ${f4}`);
    ok('E1', badge && (await txt(p, '#songNo')) === '10001' && (await txt(p, '#songTtl')).includes('작은 방의 노래') && await visible(p, '#qChips') && (await txt(p, '#qChips')).includes('10001'),
      '곡 머리: 번호·제목·예약 칩(10001)·키 배지 "키 +1"');
    ok('S2', k1 && await visible(p, '#guideKnob'), '데모곡: 멜로디 가이드 칸이 보이고 키 +1이 됨');
    m = await marks(p); await p.key(','); await p.until('state.key===0', 3000);
    await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
    // 음향 설정: 슬라이더를 키보드로 움직이고 새로고침 뒤에도 남는지
    const before = await p.eval(`({...settings})`);
    for (const id of ['s-mrVol', 's-micVol', 's-echo', 's-reverb', 's-guide', 's-recOffset']) {
      await p.eval(`document.querySelector('#${id}').focus()`);
      await p.key('ArrowLeft'); await p.key('ArrowLeft');
    }
    const after = await p.eval(`({...settings})`);
    const changed = ['mrVol', 'micVol', 'echo', 'reverb', 'guide', 'recOffset'].filter(k => after[k] !== before[k]);
    await p.eval(`document.activeElement.blur()`);
    await p.goto(ctx.base + '/index.html', 'typeof state!=="undefined" && state.song && !!state.song.buffer');
    const kept = await p.eval(`(()=>{const s=JSON.parse(localStorage.getItem('nb-settings')); return ['mrVol','micVol','echo','reverb','guide','recOffset'].filter(k=>s[k]===${q(after)}[k] && +document.querySelector('#s-'+k).value===s[k])})()`);
    ok('F9', changed.length === 6 && kept.length === 6, `바뀐 칸 ${changed.join(',')} · 새로고침 뒤 남은 칸 ${kept.join(',')}`);
    // 원래 값으로
    await p.eval(`Object.assign(settings, ${q({ mrVol: before.mrVol, micVol: before.micVol, echo: before.echo, reverb: before.reverb, guide: before.guide, recOffset: before.recOffset, recOffsetTouched: false })}); applySettings(); saveSettings()`);
  });

  await step('좁은 화면(980·560)과 움직임 줄이기', ['B8', 'E12'], async () => {
    await p.emulate({ width: 980, height: 800 }); await sleep(200);
    const w980 = await p.eval(`({cols:getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').length, order:getComputedStyle(document.querySelector('.side')).order})`);
    await p.emulate({ width: 1000, height: 800 }); await sleep(200);
    const w1000 = await p.eval(`getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').length`);
    await p.emulate({ width: 560, height: 900 });
    await p.goto(ctx.base + '/index.html', 'typeof state!=="undefined" && state.song && !!state.song.buffer');
    const w560 = await p.eval(`({deckOpen:document.querySelector('#deckMore').open, small:getComputedStyle(document.querySelector('.logo small')).display, deckCols:getComputedStyle(document.querySelector('.deck')).gridTemplateColumns.split(' ').length})`);
    const hs = await noHScroll(p);
    ok('B8', w1000 >= 2 && w980.cols === 1 && w980.order === '2' && !w560.deckOpen && w560.small === 'none' && w560.deckCols === 1 && hs,
      `1000px ${w1000}칸 → 980px ${w980.cols}칸(곡 목록 아래로) · 560px 음향 설정 접힘 ${!w560.deckOpen}, 로고 작은 글 숨김, 가로 스크롤 없음 ${hs}`);
    await p.emulate(PC);
    await p.goto(ctx.base + '/index.html', 'typeof state!=="undefined" && state.song && !!state.song.buffer');
    const normal = await p.eval(`({l:getComputedStyle(document.querySelector('.lights')).animationName, r:getComputedStyle(document.querySelector('#recBadge')).animationName})`);
    await p.media([{ name: 'prefers-reduced-motion', value: 'reduce' }]); await sleep(150);
    const reduced = await p.eval(`({l:getComputedStyle(document.querySelector('.lights')).animationName, r:getComputedStyle(document.querySelector('#recBadge')).animationName})`);
    const score = await p.eval(`(async()=>{ showScore(77,false); await new Promise(r=>requestAnimationFrame(()=>r())); const v=document.querySelector('#scoreNum').textContent; hideScore(); return v })()`);
    await p.media([]);
    ok('E12', normal.l === 'drift' && normal.r === 'blink' && reduced.l === 'none' && reduced.r === 'none' && score === '77',
      `조명 ${normal.l}→${reduced.l} · REC ${normal.r}→${reduced.r} · 점수 바로 77 (${score})`);
  });
  await stopAll(p);
}
