// 설정 창: 저장 공간 숫자·영구 저장, 저장 실패 경고(흉내), Drive 버튼 상태(연결 표시만 넣고 Google 없이), 인터넷 끊김
import { txt, visible, isHidden, marks, sawToast, sleep, q, stopAll } from './_lib.mjs';
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
  await stopAll(p);
}
