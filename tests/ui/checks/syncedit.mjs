// 흐름 10: 가사 싱크 편집기 (시간 없는 가사 4줄 곡에서 Space로 찍기, 되돌리기, 단축키, 저장·취소)
import { txt, visible, isHidden, marks, sawToast, sawFlash, sleep, q, stopAll, selectById } from './_lib.mjs';
export const areas = ['G', 'M'];

export default async function syncedit(ctx) {
  const { ok, step } = ctx, p = ctx.p, ids = ctx.ids;
  await stopAll(p);
  const sy = () => p.eval(`({sel:state.sync?.sel, times:state.lines.map(l=>isFinite(l.t)?Math.round(l.t*100)/100:null), hist:state.sync?.history.length, st:document.querySelector('#syStatus').textContent,
    playing:state.playing, t:curTime(), rate:state.rate, undo:document.querySelector('#syUndo').disabled})`);

  await step('가사가 없으면 안내, 있으면 편집기 열림', ['G1', 'G6'], async () => {
    await selectById(p, ids.bulkSkipped || ids.nolyr);
    const m = await marks(p);
    await p.click('#syncBtn');
    const t = await sawToast(p, /먼저 곡 수정\(연필 아이콘\)에서 가사를 넣어 주세요/, m);
    const closed = await isHidden(p, '#syncPanel');
    await selectById(p, ids.edit);
    await p.click('#syncBtn');
    const open = await p.eval(`!document.querySelector('#syncPanel').hidden && document.querySelector('#deck').hidden && !document.querySelector('#syncBadge').hidden && document.querySelectorAll('#syList .sy-row').length===5`);
    const s = await sy();
    ok('G1', t && closed && open, '가사 없는 곡 → 안내 · 가사 4줄 곡 → 편집기 (5줄: 4줄 + 끝)');
    ok('G6', s.st === '0 / 4줄 맞춤 · 시간이 없는 줄은 저장할 때 빠져요', `"${s.st}"`);
  });

  await step('멈춘 상태 Space → 먼저 재생, 재생 중 Space로 찍기 → 다음 줄', ['G8', 'G3', 'G6', 'M12'], async () => {
    await p.key(' ');
    await p.until('state.playing', 3000);
    const s0 = await sy();
    ok('G8', s0.playing && s0.hist === 0 && s0.times[0] === null, '멈춤에서 Space → 재생만 (시간 안 찍힘)');
    await sleep(700); await p.key(' ');
    await sleep(700); await p.key(' ');
    const s1 = await sy();
    ok('G3', s1.times[0] > 0.3 && s1.times[1] > s1.times[0] && s1.sel === 2 && s1.hist === 2, `찍은 시간 ${s1.times[0]}·${s1.times[1]}초, 다음 줄 ${s1.sel + 1}`);
    ok('G6', s1.st.startsWith('2 / 4줄 맞춤'), `"${s1.st}"`);
    ok('M12', s1.hist === 2, 'Space 찍기');
  });

  await step('⌫·Ctrl+Z 되돌리기: 그 줄 다시 고르고 3초 앞부터', ['G4', 'M12'], async () => {
    const before = await sy();
    const m = await marks(p);
    await p.key('Backspace');
    const a = await sy();
    const t = await sawToast(p, /취소했어요. 그 줄이 시작될 때 다시 누르세요/, m);
    await p.key('z', { ctrl: true });
    const b = await sy();
    ok('G4', a.times[1] === null && a.sel === 1 && a.t < before.t - 1 && t && b.times[0] === null && b.sel === 0 && b.undo,
      `⌫ → 2번째 줄 시간 지움·다시 고름·${before.t.toFixed(1)}→${a.t.toFixed(1)}초 · Ctrl+Z → 1번째 줄`);
    ok('M12', a.sel === 1 && b.sel === 0, '⌫·Ctrl+Z');
  });

  await step('↺ 3초, Enter 재생/일시정지, ↑↓ 줄 이동, 1~4 배속', ['G5', 'M12'], async () => {
    await p.eval('seekTo(5)'); await sleep(100);
    const r = await p.rect('#syBack'); await p.move(r.cx, r.cy);
    const t0 = await p.eval('curTime()');
    await p.mouse('mousePressed', r.cx, r.cy); await p.mouse('mouseReleased', r.cx, r.cy); await sleep(60);
    const t1 = await p.eval('curTime()');
    await p.key('Enter'); const paused = await p.eval('!state.playing');
    await p.key('Enter'); const resumed = await p.until('state.playing', 2000);
    await p.key('ArrowDown'); await p.key('ArrowDown'); const d = (await sy()).sel;
    await p.key('ArrowUp'); const u = (await sy()).sel;
    let m = await marks(p);
    await p.key('2'); const r2 = await sy(); const f2 = await sawFlash(p, /2배속/, m);
    await p.key('4'); const r4 = (await sy()).rate;
    await p.key('1'); const r1 = (await sy()).rate;
    const sp = await p.eval(`document.querySelector('#sySpeed').value`);
    ok('G5', t0 - t1 > 2.6 && t0 - t1 < 3.2 && paused && resumed && d === 2 && u === 1 && r2.rate === 2 && f2 && r4 === 4 && r1 === 1 && sp === '1',
      `↺ ${t0.toFixed(1)}→${t1.toFixed(1)}초 · Enter 멈춤/재생 · ↓↓ ${d + 1}줄 ↑ ${u + 1}줄 · 2·4·1 배속`);
    ok('M12', paused && resumed && r2.rate === 2, 'Enter·↑↓·1~4');
  });

  await step('줄 시간 버튼(2초 앞부터 듣기), ◀ ▶ 0.1초, Shift 1초', ['G2'], async () => {
    // 첫 줄을 찍어 둔다
    await p.eval('seekTo(4)'); await sleep(100);
    await p.eval('state.sync.sel=0; renderSyncList()');
    await p.key(' ');
    const t0 = (await sy()).times[0];
    await p.key(' ');           // 둘째 줄도
    await p.key('Enter');       // 멈춤
    await p.click('#syList .sy-row:nth-child(1) .sy-time');
    const after = await p.eval('({t:curTime(), playing:state.playing})');
    await p.click('#syList .sy-row:nth-child(1) .nud:nth-of-type(2)');      // ◀
    const minus = (await sy()).times[0];
    await p.click('#syList .sy-row:nth-child(1) .nud:nth-of-type(3)');      // ▶
    const plus = (await sy()).times[0];
    // Shift + ▶ (1초)
    const r = await p.rect('#syList .sy-row:nth-child(1) .nud:nth-of-type(3)');
    await p.move(r.cx, r.cy);
    await p.mouse('mousePressed', r.cx, r.cy, { modifiers: 8 }); await p.mouse('mouseReleased', r.cx, r.cy, { modifiers: 8 });
    await sleep(100);
    const plus1 = (await sy()).times[0];
    const near = (a, b) => Math.abs(a - b) < 0.02;
    ok('G2', after.playing && after.t >= t0 - 2.2 && after.t < t0 && near(minus, t0 - 0.1) && near(plus, t0) && near(plus1, t0 + 1),
      `시간 버튼 → ${after.t.toFixed(1)}초부터 재생 (찍은 ${t0}초의 2초 앞) · ◀ ${minus} · ▶ ${plus} · Shift+▶ ${plus1}`);
  });

  await step('저장하면 싱크 저장, 취소하면 그대로', ['G7'], async () => {
    // 남은 줄을 다 찍고 저장
    await p.eval('seekTo(0)'); await sleep(50);
    await p.eval('state.sync.sel=0; renderSyncList()');
    if (!(await p.eval('state.playing'))) await p.key(' ');
    for (let i = 0; i < 5; i++) { await sleep(450); await p.key(' '); }
    const s = await sy();
    const m = await marks(p);
    await p.click('#sySave');
    const saved = await p.until(`!state.sync && document.querySelector('#syncPanel').hidden`, 3000);
    const song = await p.eval(`(()=>{const s=songById(${q(ids.edit)}); const r=parseLyrics(s.lyrics); return {synced:r.synced, n:r.lines.filter(l=>l.text).length, off:s.lyricOffset}})()`);
    const t = await sawToast(p, /가사 싱크를 저장했어요/, m);
    const db = await p.eval(`DB.get('songs', ${q(ids.edit)}).then(s=>s.lyrics)`);
    // 취소: 다시 열고 한 줄 고친 뒤 취소
    await p.click('#syncBtn');
    await p.key(' '); await sleep(300); await p.key(' ');
    await p.click('#syCancel');
    const kept = await p.eval(`songById(${q(ids.edit)}).lyrics`);
    ok('G7', saved && song.synced && song.n === 4 && song.off === 0 && t && db === kept && /^\[00:/.test(kept), `저장 → 시간 있는 가사 ${song.n}줄 (기기에도) · 취소 → 그대로`);
  });
  await stopAll(p);
}
