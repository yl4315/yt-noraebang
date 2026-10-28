// 폰을 TV에 이어 쓰기 (CR-003): 터치 화면(hover:none) TV 조작 막대, 터치 안내, 세로면 "폰을 가로로", 숨은 막대 첫 톡
import { PHONE, PHONE_L, openPage, txt, visible, isHidden, marks, sawFlash, sleep, q, stopAll } from './_lib.mjs';
export const areas = ['L', 'I'];

export default async function touch(ctx) {
  const { ok, step } = ctx, ids = ctx.ids;
  await stopAll(ctx.p);
  await ctx.p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
  const p = await openPage(ctx, PHONE_L, ctx.base + '/?tv=1', 'typeof state!=="undefined" && state.tv && !!state.song.buffer');
  const bar = a => `#tvRemote [data-act="${a}"]`;

  await step('?tv=1 터치 안내 "화면을 한 번 누르면 전체 화면이 돼요", 첫 톡에 전체 화면', ['L16'], async () => {
    const a = await p.eval(`({covered:screenCovered(), flash:document.querySelector('#flash').hidden?'':document.querySelector('#flash').textContent, hint:FS_HINT})`);
    const f0 = await p.eval('__ui.fsReq');
    await p.tapXY(400, 150); await sleep(300);
    const b = await p.eval(`({fs:__ui.fsReq, el:!!document.fullscreenElement})`);
    if (a.covered) ok('L16', a.hint === '화면을 한 번 누르면 전체 화면이 돼요', '터치 안내 글은 맞음 (이 시험 창은 이미 덮인 것으로 보여 안내가 안 뜸)');
    else ok('L16', a.flash === '화면을 한 번 누르면 전체 화면이 돼요' && b.fs > f0, `터치 안내 "${a.flash}" · 첫 톡 → 전체 화면 요청`);
  });

  await step('터치 막대: 첫 줄 8칸(48px) + "⋯ 더 보기" 11개, 키 표시 숨김, 창은 위로 붙고 줄이 커짐', ['L17', 'L5'], async () => {
    const vis = () => p.eval(`[...document.querySelectorAll('#tvRemote [data-act]')].filter(b=>getComputedStyle(b).display!=='none' && b.getBoundingClientRect().width>0).map(b=>({a:b.dataset.act, t:b.textContent.trim(), h:Math.round(b.getBoundingClientRect().height), y:Math.round(b.getBoundingClientRect().top)}))`);
    const first = await vis();
    const kbd = await p.eval(`[...document.querySelectorAll('#tvRemote kbd, .num-keys, .ov-foot')].every(k=>getComputedStyle(k).display==='none' || k.closest('[hidden]'))`);
    await p.tap(bar('more'));
    const opened = await vis();
    const more = opened.filter(b => !first.some(f => f.a === b.a));
    const exp = await p.eval(`document.querySelector('${bar('more')}').getAttribute('aria-expanded')`);
    const L5t = await p.eval(`({keys:getComputedStyle(document.querySelector('.idle-tip .for-keys')).display, touch:document.querySelector('.idle-tip .for-touch').textContent, tdisp:getComputedStyle(document.querySelector('.idle-tip .for-touch')).display, user:document.querySelector('#idleUser').textContent, best:document.querySelector('#bestBox').textContent})`);
    // 창: 곡 검색을 열어 위로 붙는지, 줄 높이
    await p.tap(bar('more'));
    await p.tap(bar('search'));
    const ov = await p.eval(`({align:getComputedStyle(document.querySelector('#searchOv')).alignItems, row:Math.round(document.querySelector('#searchList .ov-row')?.getBoundingClientRect().height||0), x:Math.round(document.querySelector('#searchClose').getBoundingClientRect().height)})`);
    await p.tap('#searchClose');
    const wantFirst = ['start', 'pause', 'cancel', 'jump', 'num', 'search', 'queue', 'more'];
    const wantMore = ['chart', 'mine', 'user', 'rec', 'key-', 'key+', 'mr-', 'mr+', 'mic', 'fs', 'exit'];
    ok('L17', first.map(b => b.a).join() === wantFirst.join() && first.every(b => b.h === 48) && new Set(first.map(b => b.y)).size === 1 && kbd && exp === 'true'
      && more.map(b => b.a).join() === wantMore.join() && ov.align === 'flex-start' && ov.row >= 52 && ov.x >= 44,
      `첫 줄 ${first.length}칸 ${first[0]?.h}px · ⋯ 더 보기 → ${more.length}개 · 키 표시 숨김 · 창 위로 붙음, 줄 ${ov.row}px, ✕ ${ov.x}px`);
    ok('L5', L5t.keys === 'none' && L5t.tdisp !== 'none' && /아래 번호로 예약 · 곡 검색 · 예약 목록/.test(L5t.touch.replace(/\s+/g, ' ')) && /나 · ♥/.test(L5t.user) && /오늘 최고 점수/.test(L5t.best),
      `터치 화면 안내 "${L5t.touch.replace(/\s+/g, ' ').slice(0, 30)}…" (키 안내 숨김)`);
  });

  await step('숫자판을 열면 막대가 숨고, 숨은 막대의 첫 톡은 막대만 보임', ['I13', 'L9'], async () => {
    await p.tap(bar('num'));
    await sleep(450);      // 막대가 0.3초 동안 흐려진다
    const hidden = await p.eval(`({op:getComputedStyle(document.querySelector('#tvRemote')).opacity, pe:getComputedStyle(document.querySelector('#tvRemote')).pointerEvents, pad:!document.querySelector('#numPad').hidden})`);
    const sizes = await p.eval(`[...document.querySelectorAll('#numPad button')].map(b=>{const r=b.getBoundingClientRect(); return [b.dataset.k, Math.round(r.width), Math.round(r.height)]})`);
    const small = sizes.filter(x => x[0] !== 'close' && (x[1] < 44 || x[2] < 44)), close = sizes.find(x => x[0] === 'close');
    if (close && (close[1] < 44 || close[2] < 44)) ctx.finding('I13', `폰 가로(915×412) 화면 숫자판의 ✕ 닫기 버튼이 ${close[1]}×${close[2]}px로 손가락 권장 크기(44px)보다 작음 (숫자·예약 버튼은 44px 이상). 바깥 누르기·Esc로도 닫혀서 기능 실패는 아님`);
    await p.tap('#numPad [data-k="close"]');
    ok('I13', hidden.op === '0' && hidden.pe === 'none' && hidden.pad && small.length === 0, `터치: 숫자판 열면 막대 숨김 (투명도 ${hidden.op}) · 숫자·예약 버튼 44px 이상${small.length ? ' (작은 것 ' + JSON.stringify(small) + ')' : ''}`);
    // 노래 중 숨은 막대 첫 톡
    await p.tap(bar('start'));
    await p.until('state.playing', 4000);
    await p.until(`document.querySelector('#tv').classList.contains('hide-ui')`, 4500);
    const v0 = await p.eval('state.playing');
    const r = await p.rect(bar('pause'));
    await p.tapXY(r.cx, r.cy);
    const first = await p.eval(`({playing:state.playing, shown:!document.querySelector('#tv').classList.contains('hide-ui')})`);
    await p.tap(bar('pause'));
    const second = await p.eval('state.playing');
    ok('L9', v0 && first.playing && first.shown && !second, `숨은 막대 "일시정지" 자리 첫 톡 → 막대만 보임(노래 계속) · 다음 톡 → 일시정지`);
    await p.eval('stopPlayback()');
  });

  await step('세로 폰 TV 화면: "폰을 가로로 돌려 주세요", 전체 화면이면 가로 고정 요청', ['L19'], async () => {
    const hintL = await isHidden(p, '#rotateHint');
    await p.emulate(PHONE); await sleep(300);
    const hintP = await visible(p, '#rotateHint');
    const text = await txt(p, '#rotateHint');
    if (await p.eval('!!document.fullscreenElement')) { await p.eval('document.exitFullscreen()'); await sleep(300); }
    const o0 = await p.eval('__ui.orient.length');
    await p.eval(`document.documentElement.requestFullscreen()`);
    await sleep(400);
    const orient = await p.eval(`__ui.orient.slice(${o0})`);
    await p.emulate(PHONE_L);
    ok('L19', hintL && hintP && text.includes('폰을 가로로 돌려 주세요') && orient.includes('landscape'), `가로 숨김 · 세로 "${text}" · 전체 화면 → 가로 고정 요청 (${orient.join(',') || '없음'})`);
    if (await p.eval('!!document.fullscreenElement')) await p.eval('document.exitFullscreen()');
  });
  await p.close();
}
