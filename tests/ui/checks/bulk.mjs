// CR-017: 여러 곡 한 번에 넣기 창 (곡 추가 창에서 여러 개 고르기·PC 끌어다 놓기), 가사 차례로 찾기(가짜 답), "가사 없음" 모아 찾기
import { PC, PHONE, openPage, txt, visible, marks, sawToast, sleep, q, stopAll } from './_lib.mjs';
import { cand } from '../fixtures.mjs';
export const areas = ['C', 'D'];

const rows = p => p.eval(`[...document.querySelectorAll('#blkList .bk-row')].map(li=>({no:li.querySelector('.no').textContent, t:li.querySelector('.t').textContent, a:li.querySelector('.a').textContent,
  st:li.querySelector('.bk-st').textContent, cls:li.querySelector('.bk-st').className.replace('bk-st','').trim(), chk:li.querySelector('.bk-chk input').checked, open:li.classList.contains('open'), msg:li.querySelector('.bk-msg').textContent}))`);
const head = p => p.eval(`({sum:document.querySelector('#blkSum').textContent, note:document.querySelector('#blkNote').hidden?'':document.querySelector('#blkNoteTxt').textContent,
  save:document.querySelector('#blkSave').textContent, dis:document.querySelector('#blkSave').disabled, open:document.querySelector('#bulkDialog').open, title:document.querySelector('#blkTitle').textContent,
  info:document.querySelector('#blkInfo').hidden?'':document.querySelector('#blkInfo').textContent, running:Bulk.running})`);
const settled = p => p.until(`!Bulk.running`, 60000, 200);

export default async function bulk(ctx) {
  const { ok, step, fx } = ctx, p = ctx.p, ids = ctx.ids;
  const R = (i, s) => `#blkList .bk-row:nth-child(${i}) ${s}`;

  await step('곡 추가 창에서 MR 여러 개 고르기 → 여러 곡 넣기 창 (MR 아닌 파일 빠짐, 파일 이름 순서, 같은 곡 체크 꺼짐)', ['D11', 'D12', 'D14', 'D15'], async () => {
    ctx.lrcRules.length = 0;
    ctx.lrcRules.push(
      { q: '^QA가수A QA 시험 첫째$', delay: 150, body: [cand(201, 'QA 시험 첫째', 'QA가수A', 3)] },                      // 뒤집힌 이름 → 뒤집어 맞춰 자동
      { q: '^QA 시험 둘째', delay: 150, body: [cand(202, 'QA 시험 둘째', 'QA가수B', 3, false), cand(203, 'QA 시험 둘째 (Live)', 'QA가수B', 3, false)] },   // 싱크 없음 → 골라 주세요
      { q: '^QA 시험 셋째', status: 503 },                                                                                // 바쁨
      { q: '^QA 시험 넷째', status: 503 },                                                                                // 바쁨 (두 곡 연달아 → 멈춤)
    );
    ctx.lrcLog.length = 0;
    const n0 = await p.eval('state.songs.length');
    await p.click('#addSongBtn');
    await p.setFiles('#f-file', [...fx.bulk, ...fx.notMedia]);
    const opened = await p.until(`document.querySelector('#bulkDialog').open && !document.querySelector('#songDialog').open`, 4000);
    const h0 = await head(p), r0 = await rows(p);
    const nextNo = await p.eval('nextSongNumbers(state.songs,1)[0]');
    const order = r0.map(r => r.t).join(' / ');
    ok('D11', opened && h0.title === '여러 곡 한 번에 넣기' && r0.length === 6 && /2개는 MR 파일\(음악·동영상\)이 아니라서 뺐어요/.test(h0.info)
      && r0[0].t === 'QA가수A' && r0[1].t === 'QA 시험 둘째' && r0[2].t === 'QA 시험 셋째' && r0[3].t === 'QA 시험 넷째' && r0[4].t === 'QA 시험 열째' && r0[5].t === 'QA 시험 노래'
      && r0[0].no === String(nextNo) && r0[4].no === String(nextNo + 4),
      `MR 8개 중 6줄 ("${h0.info}"), 파일 이름 순서 ${order}, 번호 ${r0[0].no}~${r0[4].no}`);
    ok('D15', !r0[5].chk && r0[5].st === '이미 같은 곡이 있어요' && r0[5].no === '—', `같은 곡 줄: 체크 꺼짐 "${r0[5].st}", 번호 없음`);
    await settled(p);
    const r1 = await rows(p), h1 = await head(p);
    ok('D12', r1[0].cls === 'ok' && /가사 자동/.test(r1[0].st) && r1[0].t === 'QA 시험 첫째' && r1[0].a === 'QA가수A' && /바뀌어 있어서 바꿔 넣었어요/.test(r1[0].msg),
      `뒤집힌 이름: "${r1[0].t} / ${r1[0].a}" "${r1[0].st}"`);
    ok('D14', r1[2].st === '서버가 바빠요 · 다시 찾기' && r1[3].st === '서버가 바빠요 · 다시 찾기' && r1[4].st === '대기' && /계속 바빠서 찾기를 멈췄어요/.test(h1.note) && /다시 찾을 곡 3/.test(h1.sum),
      `두 곡 연달아 바쁨 → 멈춤: 셋째 "${r1[2].st}", 넷째 "${r1[3].st}", 열째 "${r1[4].st}", 위쪽 "${h1.note.slice(0, 30)}…"`);
    ok('D13', r1[1].cls === 'ask' && /골라 주세요 \(2개\)/.test(r1[1].st), `싱크 없음 → "${r1[1].st}"`);
    // 위쪽 "다시 찾기": 셋째는 못 찾음, 넷째·열째는 찾음
    ctx.lrcRules.length = 0;
    ctx.lrcRules.push({ q: '^QA 시험 셋째', body: [] }, { q: '^QA 시험 넷째 QA가수D$', body: [cand(204, 'QA 시험 넷째', 'QA가수D', 3)] }, { q: '^QA 시험 열째 QA가수J$', body: [cand(205, 'QA 시험 열째', 'QA가수J', 3)] });
    await p.click('#blkRetry');
    await sleep(300); await settled(p);
    const r2 = await rows(p), h2 = await head(p);
    ok('D14', r2[2].st === '✕ 못 찾음 · 다시 찾기' && /가사 자동/.test(r2[3].st) && /가사 자동/.test(r2[4].st) && !h2.note, `다시 찾기 → 셋째 "${r2[2].st}", 넷째·열째 가사 자동`);
    ctx.bulkN0 = n0;
  });

  await step('줄 펼치기: 후보 고르기, 제목 고쳐 다시 찾기(끊김·찾음), 가사 없이 넣기', ['D13', 'D14'], async () => {
    await p.click(R(2, '.bk-main'));
    const items = await p.eval(`document.querySelectorAll('#blkList .bk-row:nth-child(2) .lrc-results li').length`);
    await p.click(R(2, '.lrc-results li:first-child button'));
    const r2 = (await rows(p))[1];
    ok('D13', items === 2 && r2.cls === 'ok' && /✔ 고름/.test(r2.st) && !r2.open, `후보 ${items}개 중 고름 → "${r2.st}"`);
    // 셋째: 제목을 고쳐 다시 찾기 — 인터넷 끊김이면 "인터넷 끊김"
    await p.click(R(3, '.bk-main'));
    await p.eval(`(()=>{const i=document.querySelector(${q(R(3, '.f-t'))}); i.value='QA 시험 셋째 고침'; i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await p.offline(true); await sleep(200);
    await p.click(R(3, '.bk-find'));
    await sleep(500); await settled(p);
    const off = (await rows(p))[2], hOff = await head(p);
    await p.offline(false); await sleep(200);
    ctx.lrcRules.unshift({ q: '^QA 시험 셋째 고침', body: [cand(206, 'QA 시험 셋째 고침', 'QA가수C', 3)] });
    await p.click(R(3, '.bk-main'));
    if (!(await rows(p))[2].open) await p.click(R(3, '.bk-main'));
    await p.click(R(3, '.bk-find'));
    await sleep(300); await settled(p);
    const fixed = (await rows(p))[2];
    ok('D14', off.st === '인터넷 끊김' && /인터넷이 끊겨 있어요/.test(hOff.note) && fixed.t === 'QA 시험 셋째 고침' && /가사 자동/.test(fixed.st),
      `끊김 → "${off.st}" · 연결 뒤 고친 제목으로 다시 찾기 → "${fixed.st}"`);
    // 넷째: 가사 없이 넣기
    await p.click(R(4, '.bk-main'));
    await p.click(R(4, '.bk-skip'));
    const sk = (await rows(p))[3];
    ok('D13', sk.st === '가사 없이' && /가사 없이 넣어요/.test(sk.msg), `"가사 없이 넣기" → "${sk.st}"`);
  });

  await step('저장: 체크한 곡만 한꺼번에, 알림 숫자', ['D15', 'C12'], async () => {
    const h = await head(p);
    const m = await marks(p);
    await p.click('#blkSave');
    await p.until(`!document.querySelector('#bulkDialog').open`, 8000);
    const n1 = await p.eval('state.songs.length');
    const added = await p.eval(`state.songs.slice(-5).map(s=>({no:s.no,t:s.title,a:s.artist,ly:!!(s.lyrics||'').trim()}))`);
    const t = await sawToast(p, /5곡 추가됨 · 가사 4곡 \(자동 3곡\) · 가사 없음 1곡/, m, 3000);
    const tt = await p.eval(`__ui.toasts.slice(${m.t}).map(x=>x.text).join(' / ')`);
    ok('D15', h.save === '5곡 저장' && n1 === ctx.bulkN0 + 5 && t && added.filter(x => x.ly).length === 4 && !added.some(x => x.t === 'QA 시험 노래' && x.a === 'QA가수'),
      `"${h.save}" → 5곡 추가, 알림 "${tt}", 같은 곡은 안 넣음`);
    ids.bulkSkipped = await p.eval(`state.songs.find(s=>s.title==='QA 시험 넷째').id`);
  });

  await step('취소·✕로 닫으면 아무것도 저장 안 함, PC 끌어다 놓기로 열림, 목록 밖에 놓으면 안 열림', ['D15', 'D11'], async () => {
    ctx.lrcRules.length = 0;
    ctx.lrcRules.push({ q: '.*', delay: 300, body: [] });
    const n0 = await p.eval('state.songs.length');
    // 끌어다 놓기 (PC): 곡 목록 위에 파일 2개
    await p.eval(`window.scrollTo(0,0)`); await sleep(100);
    await p.eval(`window.__dlog=[]; for (const t of ['dragenter','dragover','drop']) document.addEventListener(t, e=>__dlog.push(t+':'+(e.target.id||e.target.className)+':'+e.defaultPrevented+':'+[...(e.dataTransfer?.types||[])].join('|')), true)`);
    const r = await p.rect('#songsPanel'), x = r.cx, y = Math.max(r.y, 0) + 60;
    await p.drag('dragEnter', x, y, fx.drop);
    for (let i = 0; i < 4; i++) { await p.drag('dragOver', x, y, fx.drop); await sleep(60); }
    const hl = await p.eval(`document.querySelector('#songsPanel').classList.contains('drop')`);
    await p.drag('drop', x, y, fx.drop);
    const opened = await p.until(`document.querySelector('#bulkDialog').open`, 3000);
    if (!opened) throw new Error(`끌어다 놓아도 창이 안 열림 (열린 창: ${await p.eval(`[...document.querySelectorAll('dialog[open]')].map(d=>d.id).join()`)} · 놓은 곳 ${x},${y} · 그 자리 요소 ${await p.eval(`document.elementFromPoint(${x},${y})?.id||document.elementFromPoint(${x},${y})?.className`)} · 강조 ${hl} · 알림 ${await p.eval('JSON.stringify(__dlog)')})`);
    const rr = await rows(p);
    await p.click('#blkCancel');
    const closed1 = await p.until(`!document.querySelector('#bulkDialog').open`, 2000);
    // 다시 열고 ✕
    await p.dropFiles(x, y, fx.drop);
    await p.until(`document.querySelector('#bulkDialog').open`, 3000);
    await p.click('#blkX');
    await p.until(`!document.querySelector('#bulkDialog').open`, 2000);
    await sleep(500);
    const n1 = await p.eval('state.songs.length');
    ok('D11', hl && opened && rr.length === 2 && rr[0].t === 'QA 시험 끌어놓기', `PC 곡 목록에 끌어다 놓기 → 강조 ${hl}, 창 열림, ${rr.length}줄`);
    ok('D15', closed1 && n1 === n0, `취소·✕ → 저장 안 함 (곡 수 ${n0} → ${n1})`);
    // 목록 밖(위쪽 막대)에 놓기: 화면이 그대로, 창 안 열림
    const url0 = await p.eval('location.href');
    await p.dropFiles(640, 20, fx.drop.slice(0, 1));
    await sleep(500);
    const same = (await p.eval('location.href')) === url0 && !(await p.eval(`document.querySelector('#bulkDialog').open`));
    ok('D11', same, '곡 목록 밖에 놓으면 화면 그대로 (창 안 열림)');
  });

  await step('"가사 없음 N곡 · 찾기": 같은 창에서 찾아 고른 가사만 저장 (가사 타이밍 0)', ['C12'], async () => {
    ctx.lrcRules.length = 0;
    ctx.lrcRules.push(
      { q: '^QA 시험 가사없음$', body: [cand(301, 'QA 시험 가사없음', 'QA가수', 3)] },        // 가수를 몰라서 골라 주세요
      { q: '.*', body: [] },
    );
    const miss = await p.eval(`state.songs.filter(lacksLyrics).map(s=>s.title)`);
    const btn = await txt(p, '#missBtn');
    await p.click('#missBtn');
    await p.until(`document.querySelector('#bulkDialog').open`, 3000);
    const h0 = await head(p);
    await settled(p);
    const rs = await rows(p);
    const i = rs.findIndex(r => r.t === 'QA 시험 가사없음');
    await p.click(R(i + 1, '.bk-main'));
    await p.click(R(i + 1, '.lrc-results li:first-child button'));
    const h1 = await head(p);
    const m = await marks(p);
    await p.click('#blkSave');
    await p.until(`!document.querySelector('#bulkDialog').open`, 5000);
    const s = await p.eval(`(()=>{const s=songById(${q(ids.nolyr)}); return {ly:s.lyrics, off:s.lyricOffset, a:s.artist}})()`);
    const others = await p.eval(`state.songs.filter(lacksLyrics).length`);
    const t = await sawToast(p, /가사 1곡 넣음/, m, 3000);
    ok('C12', btn === `가사 없음 ${miss.length}곡 · 찾기` && h0.title === '가사 없는 곡 가사 찾기' && rs.length === miss.length && h1.save === '가사 1곡 저장'
      && s.ly.startsWith('[00:01.00]QA 시험 가사 첫 줄') && s.off === 0 && others === miss.length - 1 && t,
      `"${btn}" → "가사 없는 곡 가사 찾기" ${rs.length}줄 → 고른 1곡만 저장 (가사 타이밍 ${s.off}), 남은 가사 없음 ${others}곡`);
  });

  await step('폰 크기: 곡 추가 창 파일 칸이 여러 개 고르기', ['D16'], async () => {
    const ph = await openPage(ctx, PHONE, ctx.base + '/index.html');
    await ph.tap('#addSongBtn');
    const mul = await ph.eval(`document.querySelector('#songDialog').open && document.querySelector('#f-file').multiple`);
    ok('D16', mul, '폰 크기(412) 곡 추가 창: 파일 칸 multiple');
    await ph.close();
  });
  await stopAll(p);
}
