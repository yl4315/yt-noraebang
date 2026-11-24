// 설정 창: 저장 공간 숫자·영구 저장, 저장 실패 경고(흉내), Drive 버튼 상태(연결 표시만 넣고 Google 없이), 인터넷 끊김
// CR-242 N1: 창이 열린 채 뜬 알림은 창 안 위쪽 (PC 1280·폰 412·360 설정 창, 짧은 창들, 겹친 창, 창 닫은 뒤)
import path from 'node:path';
import { PC, PHONE, openPage, txt, visible, isHidden, marks, sawToast, sleep, q, stopAll, dlgToast, dlgToastOk, fmtDT } from './_lib.mjs';
export const areas = ['P', 'R', 'B', 'C'];

export default async function settings(ctx) {
  const { ok, step } = ctx, p = ctx.p, ids = ctx.ids;
  await stopAll(p);

  await step('저장 공간: 기기에 저장된 곡 수·Drive에만 있는 곡 수, 영구 저장 상태', ['P2', 'P4'], async () => {
    await p.click('#settingsBtn');
    await p.until(`document.querySelector('#storeCounts').textContent.length>0`, 3000);
    const want = await p.eval(`({l:state.songs.filter(s=>!s.demo&&s.blob).length, c:state.songs.filter(s=>!s.demo&&!s.blob&&s.fileId).length})`);
    const got = await p.eval(`({c:document.querySelector('#storeCounts').textContent, dl:document.querySelector('#dlAllBtn').textContent, dis:document.querySelector('#dlAllBtn').disabled})`);
    ok('P2', got.c === `기기에 저장된 곡 ${want.l}곡 · Drive에만 있는 곡 ${want.c}곡` && want.c >= 1 && got.dl === `Drive에만 있는 ${want.c}곡 모두 받기` && !got.dis, `"${got.c}" · "${got.dl}"`);
    const ps = await p.eval(`(async()=>({t:document.querySelector('#persistTxt').textContent, btn:!document.querySelector('#persistBtn').hidden, real:await navigator.storage.persisted()}))()`);
    if (ps.btn) { await p.click('#persistBtn'); await sleep(300); }
    const ps2 = await p.eval(`(async()=>({t:document.querySelector('#persistTxt').textContent, btn:!document.querySelector('#persistBtn').hidden, real:await navigator.storage.persisted()}))()`);
    ok('P4', /^영구 저장 (켜짐|꺼짐)/.test(ps.t) && (ps.real ? !ps.btn : ps.btn) && /^영구 저장 (켜짐|꺼짐)/.test(ps2.t) && (ps2.real ? !ps2.btn : ps2.btn), `"${ps.t.slice(0, 9)}" ${ps.btn ? '+ "영구 저장 켜기" 버튼 → 누름 → ' + ps2.t.slice(0, 9) : ''}`);
    await p.click('#cloudClose');
  });

  await step('브라우저에 곡을 저장하지 못하면 경고 (저장 실패 흉내)', ['R5'], async () => {
    await p.eval(`window.__put=DB.put; DB.put=()=>Promise.reject(new Error('UI점검: 일부러 낸 저장 실패'))`);
    const m = await marks(p);
    await p.eval(`openSongDialog(songById(${q(ids.long)}))`);
    await p.click('#dlgSave');
    const t = await sawToast(p, /브라우저 저장 공간에 저장하지 못했어요. 새로고침하면 사라질 수 있어요/, m, 3000);
    await p.eval(`DB.put=window.__put; persistSong(songById(${q(ids.long)}))`);
    ok('R5', t, '저장 실패 → "브라우저 저장 공간에 저장하지 못했어요. 새로고침하면 사라질 수 있어요."');
  });

  await step('Drive 버튼 상태 (연결 표시만 넣고): 동기화 전 → 인터넷 끊김 "오프라인" → 로그인 필요 "다시 연결", 끊기면 기기에 없는 곡 흐림', ['B3', 'R4', 'C4'], async () => {
    await p.eval(`localStorage.setItem('nb-gconnected','1')`);
    await p.goto(ctx.base + '/index.html', 'typeof state!=="undefined" && state.song && !!state.song.buffer');
    const a = await p.eval(`({t:document.querySelector('#cloudTxt').textContent, c:document.querySelector('#cloudBtn').className})`);
    const offOf = () => p.eval(`(()=>{const L=document.querySelector('#songList').children; return {drive:L[state.songs.findIndex(s=>s.id===${q(ids.driveOnly)})].classList.contains('off'), local:L[state.songs.findIndex(s=>s.id===${q(ids.long)})].classList.contains('off'), demo:L[0].classList.contains('off')}})()`);
    const on0 = await offOf();
    await p.offline(true); await sleep(400);
    const b = await p.eval(`({t:document.querySelector('#cloudTxt').textContent, c:document.querySelector('#cloudBtn').className, online:navigator.onLine})`);
    const off1 = await offOf();
    await p.offline(false); await sleep(400);
    const c = await p.eval(`document.querySelector('#cloudTxt').textContent`);
    const off2 = await offOf();
    // 로그인이 없는 채 동기화를 부르면 "Drive 다시 연결"
    await p.eval('Cloud.schedule(10)');
    const login = await p.until(`document.querySelector('#cloudTxt').textContent==='Drive 다시 연결'`, 5000);
    const cls = await p.eval(`document.querySelector('#cloudBtn').className`);
    await p.eval(`localStorage.removeItem('nb-gconnected')`);
    await p.goto(ctx.base + '/index.html', 'typeof state!=="undefined" && state.song && !!state.song.buffer');
    const back = await txt(p, '#cloudTxt');
    ok('R4', b.t === '오프라인' && /\boff\b/.test(b.c) && !b.online, `인터넷 끊김 → Drive 버튼 "${b.t}"`);
    ok('B3', a.t === 'Drive 동기화' && b.t === '오프라인' && c === 'Drive 동기화' && login && /\bwarn\b/.test(cls) && back === 'Drive 연결',
      `연결 표시 → "${a.t}" · 끊김 "${b.t}" · 다시 "${c}" · 로그인 필요 "Drive 다시 연결"(빨간 점) · 연결 표시 지우면 "${back}"`);
    ok('C4', !on0.drive && off1.drive && !off1.local && !off1.demo && !off2.drive, '인터넷이 끊기면 Drive에만 있는 곡만 흐려짐, 연결되면 원래대로');
  });
  // CR-242 N1: 창(dialog)은 맨 위 층(showModal)이라 예전엔 body에 있는 알림이 창 뒤로 숨었다. 이제 알림은 창 안 위쪽(창 위 끝 + 12px)에 보이고
  // 아래 [닫기] 줄을 안 가림 (창을 맨 위·맨 아래로 굴려도). 겹친 창(설정 위 손님 창)은 위 창 → 닫으면 아래 창 → 다 닫으면 화면 아래 (하나, 같은 글, 다시 안 뜸)
  await step('CR-242 N1 창이 열린 채 알림: 설정 창(PC 1280·폰 412·360)과 짧은 창들 안 위쪽에 보이고 [닫기]를 안 가림, 겹친 창, 창 닫으면 화면 아래', ['B4'], async () => {
    const MSG = 'Drive 폴더에 직접 넣은 파일을 가져오려면, 연결할 때 "Drive 파일 보기" 권한도 허용해 주세요';
    const SHORT = '저장했어요 · QA 시험 알림';
    const n242 = path.join(ctx.OUT, 'cr242'), R = {}, short = {};
    const PHONE_360 = { name: '360x800', width: 360, height: 800, mobile: true, touch: true };
    const twoEnds = async (pg, k, shot) => {      // 창 맨 위·맨 아래로 굴린 채 각각 잰다 (알림은 창과 같이 굴러가지 않음)
      await pg.eval(`document.querySelector('#cloudDialog').scrollTop=0; toast(${q(MSG)}, 60000)`); await sleep(100);
      const o = { top: await dlgToast(pg, '#cloudDialog') };
      if (shot) await pg.shot(path.join(n242, `${k}-settings-toast.png`));
      await pg.eval(`(d=>{d.scrollTop=d.scrollHeight})(document.querySelector('#cloudDialog'))`); await sleep(150);
      o.end = await dlgToast(pg, '#cloudDialog');
      if (shot) await pg.shot(path.join(n242, `${k}-settings-toast-bottom.png`));
      await pg.eval(`document.querySelector('#cloudDialog').scrollTop=0`);
      return o;
    };
    // PC 1280 (마우스 화면)
    await p.click('#settingsBtn'); await sleep(150);
    R['pc-1280'] = await twoEnds(p, 'pc-1280', true);
    // 겹친 창: 설정 창 위에 손님 창 (화면 그대로 열지 않고 창만 연다: 손님 방은 안 켬)
    await p.eval(`document.querySelector('#guestDialog').showModal(); toast(${q(SHORT)}, 60000)`); await sleep(100);
    const g = await dlgToast(p, '#guestDialog');
    await p.shot(path.join(n242, 'pc-1280-guest-over-settings-toast.png'));
    await p.eval(`document.querySelector('#guestDialog').close()`); await sleep(100);
    const back = await dlgToast(p, '#cloudDialog');
    const m = await marks(p);
    await p.click('#cloudClose'); await sleep(200);
    const out = await p.eval(`(()=>{const t=document.querySelector('#toast'), r=t.getBoundingClientRect(); return {home:t.parentElement===document.body, shown:!t.hidden, text:t.textContent, n:document.querySelectorAll('.toast').length,
      bottom:Math.round(innerHeight-r.bottom), w:Math.round(r.width), mid:Math.round(r.left+r.width/2-innerWidth/2)}})()`);
    const again = await p.eval(`__ui.toasts.slice(${m.t}).length`);
    await p.shot(path.join(n242, 'pc-1280-settings-closed-toast.png'));
    await p.eval(`clearTimeout(toastTimer); document.querySelector('#toast').hidden=true`);
    // 폰 412·360 (손가락 화면, 새 탭)
    const ph = await openPage(ctx, PHONE, ctx.base + '/index.html');
    try {
      await ph.tap('#settingsBtn'); await sleep(200);
      R['phone-412'] = await twoEnds(ph, 'phone-412', true);
      await ph.emulate(PHONE_360); await sleep(150);
      R['phone-360'] = await twoEnds(ph, 'phone-360', true);
      await ph.tap('#cloudClose'); await sleep(150);
      // 짧은 창들 (360, 긴 안내 2줄): 창 위 끝 바로 아래에 뜨고 아래 단추 줄을 안 가림. 창만 열고 닫는다 (속 내용은 비어 있어 실제보다 짧음)
      for (const id of ['ytShareDialog', 'profileDialog', 'plDialog', 'guestDialog']) {
        await ph.eval(`document.querySelector('#${id}').showModal(); toast(${q(MSG)}, 60000)`); await sleep(100);
        short[id] = await dlgToast(ph, '#' + id);
        if (id === 'guestDialog') await ph.shot(path.join(n242, 'phone-360-guest-toast.png'));
        await ph.eval(`document.querySelector('#${id}').close()`); await sleep(60);
      }
      short.home = await ph.eval(`document.querySelector('#toast').parentElement===document.body`);
      await ph.eval(`clearTimeout(toastTimer); document.querySelector('#toast').hidden=true`);
    } finally { await ph.close().catch(() => {}); }
    for (const [k, v] of Object.entries(R)) ctx.log(`  CR-242 N1 ${k} 설정 창: 맨 위 ${fmtDT(v.top)} | 맨 아래 ${fmtDT(v.end)}`);
    ctx.log(`  CR-242 N1 짧은 창 360: ${['ytShareDialog', 'profileDialog', 'plDialog', 'guestDialog'].map(id => id + ' ' + fmtDT(short[id])).join(' | ')}`);
    ok('B4', Object.values(R).every(v => dlgToastOk(v.top) && dlgToastOk(v.end)),
      `CR-242 N1 설정 창이 열린 채 알림 (창 안 위쪽, [닫기] 안 가림, 맨 위·맨 아래): ${Object.entries(R).map(([k, v]) => k + ' ' + fmtDT(v.top)).join(' / ')}`);
    ok('B4', ['ytShareDialog', 'profileDialog', 'plDialog', 'guestDialog'].every(id => dlgToastOk(short[id])) && short.home,
      `CR-242 N1 짧은 창 360 (아래 단추 줄 안 가림): ${['ytShareDialog', 'profileDialog', 'plDialog', 'guestDialog'].map(id => id.replace('Dialog', '') + ' 위 끝+' + short[id]?.dTop + ' 아래 단추 겹침 ' + (short[id]?.low.length ?? '안 뜸') + ' (겹친 단추 [' + (short[id]?.btns || []).join('][') + '])').join(' · ')} · 다 닫으면 화면으로 ${short.home}`);
    ok('B4', dlgToastOk(g) && back?.home === '#cloudDialog' && dlgToastOk(back) && out.home && out.shown && out.text === SHORT && out.n === 1 && Math.abs(out.bottom - 24) <= 1 && Math.abs(out.mid) <= 1 && again === 0,
      `CR-242 N1 겹친 창: 손님 창 ${g?.home} → 손님 창 닫음 ${back?.home} → 설정 창 닫음: 화면 아래 ${out.bottom}px 가운데 ${out.w}px "${out.text}" 보임 ${out.shown} · 알림 ${out.n}개 · 다시 뜸 ${again}번`);
  });
  await stopAll(p);
}
