// 조건 M: Edge 가짜 마이크 (권한 창 없이 허용, 일정한 삐 소리)로 마이크 켜기·이름·알림·기본 싱크·소리 막대·자동 측정·점수 창
import { txt, visible, isHidden, marks, sawToast, sleep, q, stopAll, selectById } from './_lib.mjs';
export const areas = ['B', 'F', 'H', 'K', 'L'];

export default async function mic(ctx) {
  const { ok, step } = ctx, p = ctx.p, ids = ctx.ids;
  if (ctx.conds.M === false) { for (const id of ['B6', 'B7', 'B9', 'F4', 'F10', 'H1', 'H2', 'H3', 'K8', 'L8']) ctx.skip(id, '조건 M 안 됨'); return; }
  await stopAll(p);
  await p.eval(`localStorage.removeItem('__ui-mic'); Object.assign(settings,{recOffset:120, recOffsetTouched:false}); applySettings(); saveSettings()`);

  await step('마이크 켜기: 이름 표시·"마이크 연결됨" 알림·녹음 기본 싱크 자동', ['B6', 'B9', 'B7'], async () => {
    const m = await marks(p);
    await p.click('#micBtn');
    await p.until('state.micOn', 5000);
    const label = await p.eval('micLabel()');
    const ui = await p.eval(`({st:document.querySelector('#micStatus span').textContent, on:document.querySelector('#micStatus').classList.contains('on'), btn:document.querySelector('#micBtn span').textContent})`);
    const t = await sawToast(p, new RegExp('마이크 연결됨 · ' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), m);
    const want = await p.eval(`(()=>{ const inLat=E.micStream.getAudioTracks()[0].getSettings().latency||0.02, outLat=(E.ctx.outputLatency||0)+(E.ctx.baseLatency||0.01); return clamp(Math.round((inLat+outLat)*1000/5)*5,0,600) })()`);
    const got = await p.eval(`({v:settings.recOffset, ui:document.querySelector('#v-recOffset').textContent, s:+document.querySelector('#s-recOffset').value})`);
    ok('B6', ui.st === label && ui.on && ui.btn === '마이크 다시 연결', `마이크 이름 "${label}" · 버튼 "${ui.btn}"`);
    ok('B9', t, `"마이크 연결됨 · ${label}" 알림`);
    ok('B7', got.v === want && got.ui === want + 'ms' && got.s === want, `처음 켜면 녹음 기본 싱크 120 → ${got.v}ms (입력+출력 지연으로 계산)`);
  });

  await step('소리 막대가 움직임 (가짜 마이크 삐 소리)', ['F4'], async () => {
    const moved = await p.until(`parseFloat(document.querySelector('#levelBar').style.width)>5`, 6000, 50);
    ok('F4', moved, '마이크 소리 막대가 움직임 (가짜 마이크)');
  });

  await step('"내 목소리 같이 듣기"·"스피커로 반주 듣는 중" 켜고 끄기, 새로고침 뒤에도', ['F11', 'B9'], async () => {
    await p.click('#deckMore summary').catch(() => {});
    if (!(await p.eval(`document.querySelector('#deckMore').open`))) await p.eval(`document.querySelector('#deckMore').open=true`);
    await p.click('#t-monitor');
    const a = await p.eval(`({s:settings.monitor, ls:JSON.parse(localStorage.getItem('nb-settings')).monitor})`);
    const m = await marks(p);
    await p.click('#t-speakerMode');
    const b = await p.eval(`({s:settings.speakerMode, ls:JSON.parse(localStorage.getItem('nb-settings')).speakerMode})`);
    const again = await sawToast(p, /마이크 연결됨/, m, 5000);
    await p.click('#t-monitor'); await p.click('#t-speakerMode');
    const c = await p.eval(`({m:settings.monitor, s:settings.speakerMode})`);
    ok('F11', a.s && a.ls && b.s && b.ls && !c.m && !c.s, '두 칸 켜면 저장(nb-settings), 끄면 꺼짐');
    ok('B9', again, '다시 연결할 때도 "마이크 연결됨" 알림 (스피커 모드를 바꾸면 마이크를 다시 연다)');
  });

  await step('"자동 측정": 측정 중 → 결과 안내', ['F10'], async () => {
    const m = await marks(p);
    await p.click('#measureBtn');
    const busy = await p.eval(`({t:document.querySelector('#measureBtn').textContent, d:document.querySelector('#measureBtn').disabled})`);
    const done = await p.until(`document.querySelector('#measureBtn').textContent==='자동 측정' && !document.querySelector('#measureBtn').disabled`, 20000, 200);
    const t = await sawToast(p, /측정 완료|딸깍 소리를 못 들었어요|지연이 너무 길어요/, m, 2000);
    const last = await p.eval(`__ui.toasts.slice(${m.t}).map(x=>x.text).filter(x=>/측정|딸깍|지연/.test(x)).pop()||''`);
    ok('F10', busy.t === '측정 중…' && busy.d && done && t, `"측정 중…" → "${last.slice(0, 40)}…" (가짜 마이크라 실제 값은 기기에서)`);
    await p.eval(`Object.assign(settings,{recOffset:120, recOffsetTouched:false}); applySettings(); saveSettings()`);
  });

  await step('마이크를 켜고 끝까지 부르면 점수 창: 점수·한 줄 평·한 번 더·녹음 들어보기·닫기, 점수 기록에 사용자 이름', ['H1', 'H2', 'H3', 'K8'], async () => {
    await selectById(p, ids.short);
    if (!(await p.eval('state.armed'))) await p.click('#recBtn');
    const sing = async () => {
      await p.eval('state.offset=0'); await p.key(' ');
      await p.until('state.playing', 3000);
      return p.until(`!document.querySelector('#scoreOverlay').hidden`, 15000);
    };
    const n0 = await p.eval('scores.length');
    const shown = await sing();
    await p.until(`document.querySelector('#scoreNum').textContent===String(scores[0]?.score)`, 3000);
    const sc = await p.eval(`({num:+document.querySelector('#scoreNum').textContent, msg:document.querySelector('#scoreMsg').textContent, listen:!document.querySelector('#scoreListen').hidden, top:scores[0], me:me().name, n:scores.length, best:document.querySelector('#bestBox').textContent})`);
    ok('H1', shown && sc.num >= 52 && sc.num <= 100 && sc.msg.length > 3, `점수 ${sc.num}점 · "${sc.msg}"`);
    ok('H3', sc.n === n0 + 1 && sc.top.score === sc.num && sc.top.who === sc.me && sc.top.title === 'QA 시험 짧은 곡' && sc.best.includes(`${sc.num}점`), `점수 기록 ${sc.top.score}점 (${sc.top.who}) · 오늘 최고/최근에 보임`);
    ok('K8', sc.top.who === sc.me, `점수 기록에 사용자 이름 "${sc.top.who}"`);
    // 한 번 더
    await p.click('#scoreAgain');
    const again = await p.eval(`({h:document.querySelector('#scoreOverlay').hidden, p:state.playing})`);
    await p.until(`!document.querySelector('#scoreOverlay').hidden`, 15000);
    // 녹음 들어보기 → 내 녹음 탭
    await p.click('#scoreListen');
    const listen = await p.eval(`document.querySelector('#scoreOverlay').hidden && !document.querySelector('#recsPanel').hidden`);
    await p.click('#tabSongs');
    await sing();
    await p.click('#scoreClose');
    const closed = await isHidden(p, '#scoreOverlay');
    await p.eval('cancelNext()');
    ok('H2', sc.listen && again.h && again.p && listen && closed, '한 번 더 → 다시 시작 · 녹음 들어보기 → 내 녹음 탭 · 닫기');
    if (await p.eval('state.armed')) await p.click('#recBtn');
  });

  await step('TV 조작 막대 "마이크" 버튼', ['L8'], async () => {
    await p.eval('enterTV()'); await sleep(200); await p.move(960, 500);
    const m = await marks(p);
    await p.click('#tvRemote [data-act="mic"]');
    const t = await sawToast(p, /마이크 연결됨/, m, 5000);
    await p.eval('exitTV()');
    ok('L8', t, 'TV 조작 막대 "마이크" → 마이크 다시 연결 (가짜 마이크)');
  });
  await stopAll(p);
}
