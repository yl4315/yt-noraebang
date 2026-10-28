// 흐름 9: 단축키 (한글 자판 값 포함). 앱이 e.key 글자로 비교해서 한글 자판 글자(ㄴ ㅣ …)를 그대로 넣어 본다
import { txt, visible, isHidden, marks, sawFlash, sawToast, sleep, q, stopAll, selectById } from './_lib.mjs';
export const areas = ['M', 'I'];

export default async function keys(ctx) {
  const { ok, step } = ctx, p = ctx.p, ids = ctx.ids;
  await stopAll(p);
  await p.eval(`state.queue=[]; saveQueue(); renderQueue(); document.activeElement && document.activeElement.blur()`);
  await selectById(p, ids.long);

  await step('Enter로 시작/일시정지, Esc 취소', ['M1', 'M3'], async () => {
    await p.key('Enter');
    const a = await p.until('state.playing', 3000);
    await p.key('Enter');
    const b = await p.eval('!state.playing && state.offset>0');
    ok('M1', a && b, `Enter 시작 ${a} · Enter 일시정지 ${b}`);
    await p.key(' '); await p.until('state.playing', 3000);
    const m = await marks(p);
    await p.key('Escape');
    const c = await p.eval('!state.playing && state.offset===0');
    ok('M3', c && await sawFlash(p, /^취소$/, m), 'Esc → 곡 취소 ("취소")');
  });

  await step('간주점프 J: 간주 중 다음 가사 3초 전으로, 아닐 때 안내', ['I11', 'M5'], async () => {
    await p.key(' '); await p.until('state.playing && curTime()>0.7', 3000);
    let m = await marks(p);
    await p.key('j');
    const notGap = await sawFlash(p, /간주 때만 점프할 수 있어요/, m);
    await p.eval('seekTo(3)'); await sleep(200);
    m = await marks(p);
    await p.key('ㅓ');       // 한글 자판 J 자리
    const jumped = await sawFlash(p, /^간주점프$/, m);
    const t = await p.eval('curTime()');
    await p.key(' ');
    ok('I11', notGap && jumped && t > 5.8 && t < 7, `가사 중 J → "간주 때만…" · 간주(3초) ㅓ → ${t.toFixed(1)}초 (다음 가사 9초의 3초 전)`);
    ok('M5', jumped, 'J 간주점프');
    await stopAll(p);
  });

  await step('[ ] 가사 타이밍 ±0.1초, Shift+[ ] ±1초', ['M7'], async () => {
    const o = () => p.eval('state.song.lyricOffset||0');
    await p.key('['); const a = await o();
    await p.key(']'); await p.key(']'); const b = await o();
    await p.key('{', { shift: true, code: 'BracketLeft' }); const c = await o();
    await p.key('}', { shift: true, code: 'BracketRight' }); await p.key('['); const d = await o();
    ok('M7', a === -0.1 && b === 0.1 && c === -0.9 && d === 0, `[ ${a} · ]] ${b} · Shift+[ ${c} · Shift+] [ ${d}`);
    await sleep(700);
  });

  await step(', . (< >) 키 내리기/올리기', ['M8'], async () => {
    const k = () => p.eval(`document.querySelector('#keyOut').textContent`);
    await p.key('.'); await p.until(`document.querySelector('#keyOut').textContent==='+1'`, 20000); const a = await k();
    await p.key(','); await p.until(`document.querySelector('#keyOut').textContent==='원래 키'`, 5000); const b = await k();
    await p.key('<', { shift: true, code: 'Comma' }); await p.until(`document.querySelector('#keyOut').textContent==='-1'`, 20000); const c = await k();
    await p.key('>', { shift: true, code: 'Period' }); await p.until(`document.querySelector('#keyOut').textContent==='원래 키'`, 5000); const d = await k();
    ok('M8', a === '+1' && b === '원래 키' && c === '-1' && d === '원래 키', `. ${a} · , ${b} · < ${c} · > ${d}`);
  });

  await step('− = (+) 반주 볼륨 ±5', ['M9'], async () => {
    const v0 = await p.eval('settings.mrVol');
    await p.key('-'); const a = await p.eval('settings.mrVol');
    await p.key('='); const b = await p.eval('settings.mrVol');
    await p.key('+', { shift: true, code: 'Equal' }); const c = await p.eval('settings.mrVol');
    await p.key('-');
    ok('M9', a === v0 - 5 && b === v0 && c === v0 + 5, `${v0} → − ${a} → = ${b} → + ${c}`);
  });

  await step('R 녹음 켜기/끄기, T TV 화면, F 전체 화면(TV에서만)', ['M5'], async () => {
    await p.key('r'); const a = await p.eval('state.armed');
    await p.key('r'); const b = await p.eval('state.armed');
    const fs0 = await p.eval('__ui.fsReq');
    await p.key('f'); const notTv = (await p.eval('__ui.fsReq')) === fs0;
    await p.key('t'); const tv = await p.until('state.tv', 2000);
    await sleep(300);
    const fsTv = await p.eval('!!document.fullscreenElement');      // TV 화면을 열면 전체 화면을 시도한다
    await p.key('f'); await sleep(300);
    const fsOff = await p.eval('!document.fullscreenElement');
    const fs1 = await p.eval('__ui.fsReq');
    await p.key('f'); await sleep(300);
    const fsOn = await p.eval(`({req:__ui.fsReq, el:!!document.fullscreenElement})`);
    await p.key('t'); const out = await p.until('!state.tv && !document.fullscreenElement', 2000);
    ok('M5', a && !b && notTv && tv && fsTv && fsOff && fsOn.req > fs1 && fsOn.el && out, `R 켜고 끔 ${a && !b} · F(TV 밖) 아무것도 안 함 ${notTv} · T TV(전체 화면) ${tv && fsTv} · F 끔 ${fsOff} · F 켬 ${fsOn.el} · T 나감 ${out} · 전체 화면 오류 ${await p.eval('__ui.fsErr.join(" / ")')}`);
  });

  await step('한글 자판: ㄴ ㅣ ㅊ ㅡ ㅕ ㅓ ㅍ ㄱ ㅅ ㄹ ㅔ', ['M10'], async () => {
    const res = {};
    const ov = async (k, sel) => { await p.key(k); await sleep(80); const v = await visible(p, sel); await p.eval('closeOverlays()'); await sleep(50); return v; };
    res['ㄴ'] = await ov('ㄴ', '#searchOv');
    res['ㅣ'] = await ov('ㅣ', '#queueOv');
    res['ㅊ'] = await ov('ㅊ', '#chartOv');
    res['ㅡ'] = await ov('ㅡ', '#mineOv');
    const tmpUser = await p.eval(`liveProfiles().length<2 ? (()=>{ const u={id:'qa-key-user', name:'QA키', favorites:[], playlists:[], updatedAt:Date.now()}; Profiles.list.push(u); saveProfiles(); return true })() : false`);
    const u0 = await p.eval('me().name'); await p.key('ㅕ'); res['ㅕ'] = (await p.eval('me().name')) !== u0;
    while ((await p.eval('me().name')) !== u0) await p.key('ㅕ');
    if (tmpUser) await p.eval(`Profiles.list=Profiles.list.filter(x=>x.id!=='qa-key-user'); saveProfiles()`);
    let m = await marks(p); await p.key('ㅓ'); res['ㅓ'] = await sawFlash(p, /노래가 나올 때 쓸 수 있어요/, m);
    await p.key('ㄱ'); res['ㄱ'] = await p.eval('state.armed'); await p.key('ㄱ');
    await p.key('ㅅ'); res['ㅅ'] = await p.until('state.tv', 2000);
    await sleep(300);
    const f0 = await p.eval('!!document.fullscreenElement'); await p.key('ㄹ'); await sleep(300); res['ㄹ'] = (await p.eval('!!document.fullscreenElement')) !== f0;
    if (await p.eval('!!document.fullscreenElement')) { await p.key('ㄹ'); await sleep(300); }
    await p.key('ㅅ'); await p.until('!state.tv', 2000);
    for (const k of '10001') await p.key(k);
    m = await marks(p); await p.key('ㅔ'); res['ㅔ'] = await sawFlash(p, /우선예약\s+10001/, m);
    // ㅍ (V)는 동영상 곡에서 video 점검이 본다
    res['ㅍ'] = ctx.conds.V === false ? true : !!(await p.eval(`typeof toggleVideoLyrics==='function'`));
    await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
    const bad = Object.entries(res).filter(([, v]) => !v).map(([k]) => k);
    ok('M10', !bad.length, bad.length ? `안 된 키: ${bad.join(' ')}` : 'ㄴ 검색 · ㅣ 예약 목록 · ㅊ 인기차트 · ㅡ 내 목록 · ㅕ 사용자 · ㅓ 간주점프 · ㄱ 녹음 · ㅅ TV · ㄹ 전체 화면 · ㅔ 우선예약 (ㅍ는 동영상 점검)');
  });
  await stopAll(p);
}
