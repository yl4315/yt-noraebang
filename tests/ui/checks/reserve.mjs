// 흐름 5·6: 번호 예약, 검색·예약 목록·인기차트·내 목록 창 (열고 닫기, 창 안 단축키, 빈 창 안내)
import { txt, visible, isHidden, marks, sawFlash, sleep, q, stopAll, selectById } from './_lib.mjs';
export const areas = ['I', 'M', 'K'];

export default async function reserve(ctx) {
  const { ok, step } = ctx, p = ctx.p, ids = ctx.ids;
  const box = () => p.eval(`({h:document.querySelector('#numBox').hidden, d:numBuf, s:document.querySelector('#numSong').textContent})`);
  const queueNos = () => p.eval(`state.queue.map(id=>songById(id).no)`);
  const clearQ = () => p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
  await stopAll(p); await clearQ();
  const no = ctx.ids.longNo || 10002;

  await step('번호 입력: 곡 이름 / "번호를 마저…" / "없는 번호예요" / 7초 뒤 지움', ['I1', 'M2'], async () => {
    for (const k of '10001') await p.key(k);
    const a = await box();
    await p.key('Escape');
    for (const k of '100') await p.key(k);
    const b = await box();
    await p.key('Escape');
    for (const k of '99999') await p.key(k);
    const c = await box();
    await p.key('Escape');
    await p.key('1');
    const t0 = Date.now();
    await sleep(6500);
    const still = await box();
    const gone = await p.until(`document.querySelector('#numBox').hidden`, 2500);
    ok('I1', !a.h && a.d === '10001' && a.s === '작은 방의 노래 · YT 노래방 데모 MR' && b.s === '번호를 마저 눌러 주세요' && c.s === '없는 번호예요' && !still.h && gone,
      `"${a.s}" · "${b.s}" · "${c.s}" · 6.5초엔 남고 7초 뒤 지워짐 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  });

  await step('번호 + Enter 예약, + P 우선예약, ⌫ 지우기, Esc 취소', ['I2', 'M2', 'I3'], async () => {
    let m = await marks(p);
    for (const k of '10001') await p.key(k);
    await p.key('Enter');
    const r1 = await sawFlash(p, /^예약\s+10001/, m);
    m = await marks(p);
    for (const k of String(no)) await p.key(k);
    await p.key('p');
    const r2 = await sawFlash(p, new RegExp('우선예약\\s+' + no), m);
    const qn = await queueNos();
    for (const k of '123') await p.key(k);
    await p.key('Backspace');
    const del = (await box()).d;
    await p.key('Escape');
    const esc = await box();
    ok('I2', r1 && r2 && qn[0] === no && qn[1] === 10001 && del === '12' && esc.h, `Enter 예약 · P 우선예약 (예약 ${qn.join(',')}) · ⌫ → "${del}" · Esc 닫힘`);
    ok('M2', del === '12' && qn[0] === no, '0~9 번호, P 우선예약, ⌫ 지우기');
    await p.goto(ctx.base + '/index.html', 'typeof state!=="undefined" && state.song && !!state.song.buffer');
    const after = await queueNos();
    ok('I3', after.join(',') === qn.join(','), `새로고침 뒤 예약 ${after.join(',')}`);
  });

  await step('예약이 있을 때 시작하면 예약 첫 곡부터', ['I5'], async () => {
    await selectById(p, ctx.ids.long);
    await p.eval(`state.queue=[${q(ctx.ids.long)}, 'demo']; saveQueue(); renderQueue()`);
    await p.key(' ');
    await p.until('state.playing', 5000);
    const s = await p.eval(`({no:state.song.no, q:state.queue.map(id=>songById(id).no)})`);
    await stopAll(p);
    ok('I5', s.no === no && s.q.join(',') === '10001', `시작 → 예약 첫 곡 ${s.no}, 남은 예약 ${s.q.join(',')}`);
    await clearQ();
  });

  await step('곡 검색(S, /): 제목·가수·번호·초성, ↑↓·Enter·Shift+Enter·Esc', ['I6', 'I7', 'M4', 'M11'], async () => {
    const search = async (k, text) => {
      await p.key(k); await sleep(100);
      if (text) await p.type(text);
      await sleep(150);
      return p.eval(`[...document.querySelectorAll('#searchList .ov-row')].map(li=>li.querySelector('.no').textContent)`);
    };
    const byTitle = await search('s', '작은 방'); await p.key('Escape');
    const byArtist = await search('/', 'QA가수'); await p.key('Escape');
    const byNo = await search('s', String(no)); await p.key('Escape');
    const byCho = await search('s', 'ㅈㅇㅂ'); await p.key('Escape');
    ok('I6', byTitle[0] === '10001' && byArtist.length >= 3 && byNo[0] === String(no) && byCho.includes('10001'),
      `제목 "작은 방" → ${byTitle[0]} · 가수 "QA가수" ${byArtist.length}곡 · 번호 → ${byNo[0]} · 초성 "ㅈㅇㅂ" → ${byCho.join(',')}`);
    await clearQ();
    const list = await search('s', 'QA 시험');
    await p.key('ArrowDown');
    const sel1 = await p.eval(`[...document.querySelectorAll('#searchList .ov-row')].findIndex(li=>li.classList.contains('sel'))`);
    await p.key('Enter');
    await p.key('ArrowUp');
    await p.key('Enter', { shift: true });
    const qn = await queueNos();
    await p.key('Escape');
    const closed = await isHidden(p, '#searchOv');
    ok('I7', list.length >= 3 && sel1 === 1 && qn.length === 2 && qn[1] === +list[1] && qn[0] === +list[0] && closed,
      `↓ → 둘째 줄 · Enter 예약(${list[1]}) · ↑ Shift+Enter 우선예약(${list[0]}) · Esc 닫힘`);
    ok('M4', byArtist.length >= 3, 'S·/ 로 검색 창');
  });

  await step('예약 목록 창(L): 지금 부르기·맨 위로·취소, ↑↓·Enter·P·Del', ['I8', 'M4', 'M11'], async () => {
    await clearQ();
    await p.eval(`for (const s of state.songs.filter(s=>s.blob||s.demo).slice(0,4)) state.queue.push(s.id); saveQueue(); renderQueue()`);
    const q0 = await queueNos();
    await p.key('l');
    const open = await visible(p, '#queueOv');
    const hint = await txt(p, '#queueHint');
    await p.key('ArrowDown'); await p.key('ArrowDown');
    await p.key('p');
    const q1 = await queueNos();
    await p.key('ArrowDown');
    await p.key('Delete');
    const q2 = await queueNos();
    // 버튼: 둘째 줄 "맨 위로", 셋째 줄 "취소"
    await p.click('#queueList li:nth-child(2) .acts .btn:nth-child(2)');
    const q3 = await queueNos();
    await p.click('#queueList li:nth-child(2) .acts .btn:nth-child(3)');
    const q4 = await queueNos();
    await p.key('l');
    const closedL = await isHidden(p, '#queueOv');
    await p.key('ㅣ');      // 한글 자판 L 자리
    const openK = await visible(p, '#queueOv');
    await p.key('Enter');      // 첫 곡 지금 부르기
    const started = await p.until('state.playing', 6000);
    const playingNo = await p.eval('state.song.no');
    await stopAll(p);
    ok('I8', open && hint === '4곡 예약됨' && q1[0] === q0[2] && q2.length === 3 && q3[0] === q2[1] && q4.length === 2 && closedL && openK && started && playingNo === q4[0],
      `열림 "${hint}" · ↓↓P 맨 위로 · ↓Del 취소 · 버튼 맨 위로·취소 · L 닫기 · Enter 지금 부르기 (${playingNo})`);
    ok('M4', open && closedL, 'L 예약 목록');
    ok('M11', q1[0] === q0[2] && q2.length === 3, '예약 목록 창 안 ↑↓·P·Del·Enter');
  });

  await step('인기차트 창(C): 많이 부른 순 "N회 부름 · 최고 N점", 예약', ['I9', 'M4', 'M11'], async () => {
    await clearQ();
    // 시험 데이터: 부른 횟수·점수
    await p.eval(`(()=>{ const a=songById(${q(ctx.ids.long)}), b=songById('demo');
      plays[a.id]={n:5,last:Date.now()}; plays[b.id]={n:3,last:Date.now()-1000}; localStorage.setItem('nb-plays', JSON.stringify(plays));
      scores.unshift({id:a.id,no:a.no,title:a.title,score:91,at:Date.now(),who:'나'}); localStorage.setItem('nb-scores', JSON.stringify(scores)); renderBest(); renderIdleChart(); })()`);
    await p.key('c');
    const rows = await p.eval(`[...document.querySelectorAll('#chartList .ov-row')].slice(0,3).map(li=>({no:li.querySelector('.no').textContent, stat:[...li.querySelectorAll('.nm small.stat')].map(x=>x.textContent).join(' '), top:li.classList.contains('top')}))`);
    await p.key('Enter');
    await p.key('ArrowDown');
    await p.key('p');
    const qn = await queueNos();
    await p.key('c');
    const closed = await isHidden(p, '#chartOv');
    ok('I9', rows[0].no === String(no) && /5회 부름 · 최고 91점/.test(rows[0].stat) && rows[1].no === '10001' && /3회 부름/.test(rows[1].stat) && rows[0].top && qn[0] === 10001 && qn[1] === no,
      `1위 ${rows[0].no} "${rows[0].stat}" · 2위 ${rows[1].no} "${rows[1].stat}" · Enter 예약·P 우선예약 (${qn.join(',')})`);
    ok('M4', closed, 'C 인기차트');
    ok('M11', qn.length === 2, '인기차트 창 안 ↑↓·Enter·P·C');
    await clearQ();
  });

  await step('창 ✕ 닫기, 빈 창 안내', ['I12'], async () => {
    await clearQ();
    await p.key('s'); await p.type('없는곡zzzz'); await sleep(150);
    const e1 = await txt(p, '#searchList');
    await p.click('#searchClose'); const c1 = await isHidden(p, '#searchOv');
    await p.key('l'); const e2 = await txt(p, '#queueList');
    await p.click('#queueClose'); const c2 = await isHidden(p, '#queueOv');
    await p.key('c'); await p.click('#chartClose'); const c3 = await isHidden(p, '#chartOv');
    const favs = await p.eval(`me().favorites.length + me().playlists.length`);
    await p.key('m'); const e4 = await txt(p, '#mineList');
    await p.click('#mineClose'); const c4 = await isHidden(p, '#mineOv');
    ok('I12', c1 && c2 && c3 && c4 && /^찾는 곡이 없어요/.test(e1) && /^예약된 곡이 없어요/.test(e2) && (favs > 0 || /^♥를 누른 곡과 재생목록이 여기 보여요/.test(e4.replace(/^♥ 좋아요 · 0곡/, ''))),
      `✕로 4개 다 닫힘 · "${e1.slice(0, 12)}…" · "${e2.slice(0, 12)}…" · 내 목록 빈 안내`);
  });
  await stopAll(p);
}
