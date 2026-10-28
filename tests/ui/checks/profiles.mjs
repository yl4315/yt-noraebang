// 흐름 12: 사용자·좋아요·재생목록 (사용자 창, 재생목록 창, 내 목록 탭, TV 내 목록 창), 곡 목록 줄 재생목록·수정·삭제(터치 ⋯)
import { PHONE, openPage, txt, visible, isHidden, marks, sawFlash, sleep, q, stopAll } from './_lib.mjs';
export const areas = ['K', 'C'];

export default async function profiles(ctx) {
  const { ok, step } = ctx, p = ctx.p, ids = ctx.ids;
  await stopAll(p);
  await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
  const rowOf = id => p.eval(`state.songs.findIndex(s=>s.id===${q(id)})+1`);

  await step('사용자 창: 추가·바꾸기·이름 바꾸기·삭제(2명 이상), "OO님 차례예요", U', ['K2', 'K3'], async () => {
    await p.click('#profileBtn');
    const del0 = await p.eval(`[...document.querySelectorAll('#profList .acts button')].some(b=>b.textContent==='삭제')`);
    let m = await marks(p);
    await p.click('#profNew'); await p.type('QA엄마');
    await p.key('Enter');
    const added = await p.until(`me().name==='QA엄마' && document.querySelectorAll('#profList .prof-row').length===2`, 2000);
    const f1 = await sawFlash(p, /QA엄마님 차례예요/, m);
    await p.click('#profList .prof-row:not(.on) .acts .primary');      // 이 사용자로 (나)
    const back = await p.eval(`me().name==='나'`);
    // QA엄마 이름 바꾸기
    const idx = await p.eval(`[...document.querySelectorAll('#profList .prof-row')].findIndex(li=>li.querySelector('.nm b')?.textContent==='QA엄마')+1`);
    await p.click(`#profList .prof-row:nth-child(${idx}) .acts button:nth-child(2)`);
    await p.eval(`(()=>{const i=document.querySelector('#profList input.ren'); i.focus(); i.select()})()`);
    await p.type('QA엄마2'); await p.key('Enter');
    const renamed = await p.until(`Profiles.list.some(x=>!x.deleted && x.name==='QA엄마2')`, 2000);
    const del2 = await p.eval(`[...document.querySelectorAll('#profList .acts button')].filter(b=>b.textContent==='삭제').length`);
    await p.click('#profClose');
    // U로 다음 사용자
    m = await marks(p);
    await p.key('u');
    const u1 = await p.eval('me().name');
    const f2 = await sawFlash(p, /QA엄마2님 차례예요/, m);
    m = await marks(p);
    await p.key('ㅕ');
    const u2 = await p.eval('me().name');
    const f3 = await sawFlash(p, /나님 차례예요/, m);
    ok('K3', f1 && u1 === 'QA엄마2' && f2 && u2 === '나' && f3, `추가하면 "QA엄마님 차례예요" · U → ${u1} · ㅕ → ${u2}`);
    ctx.ids.mom = await p.eval(`Profiles.list.find(x=>x.name==='QA엄마2').id`);
    ok('K2', !del0 && added && back && renamed && del2 === 2, `1명일 땐 삭제 없음 · 추가 · 바꾸기 · 이름 바꾸기 · 2명이면 삭제 버튼 ${del2}개`);
  });

  await step('좋아요가 사용자마다 따로', ['K4'], async () => {
    const r1 = await rowOf(ids.long), r2 = await rowOf(ids.plain);
    await p.click(`#songList li:nth-child(${r1}) .fav-btn`);
    await p.eval(`switchProfile(Profiles.list.find(x=>x.name==='QA엄마2'))`);
    const momSees = await p.eval(`isFav(songById(${q(ids.long)}))`);
    await p.click(`#songList li:nth-child(${r2}) .fav-btn`);
    await p.eval(`switchProfile(Profiles.list.find(x=>x.name==='나'))`);
    const me1 = await p.eval(`({a:isFav(songById(${q(ids.long)})), b:isFav(songById(${q(ids.plain)})), t:document.querySelector('#songList li:nth-child(${r1}) .fav-btn').textContent})`);
    ok('K4', !momSees && me1.a && !me1.b && me1.t === '♥', `나: ♥ 긴 곡 / QA엄마2: ♥ 시간없는가사 — 서로 안 보임`);
  });

  await step('재생목록 창: 빈 안내, 새로 만들고 넣기, 체크로 빼고 넣기', ['K5', 'K9', 'C8'], async () => {
    const r1 = await rowOf(ids.long);
    await p.click(`#songList li:nth-child(${r1}) .acts [title="재생목록에 넣기"]`, { hover: `#songList li:nth-child(${r1})` });
    const open = await p.until(`document.querySelector('#plDialog').open`, 2000);
    const empty = await txt(p, '#plList');
    await p.click('#plNewName'); await p.type('QA 신나는 목록'); await p.key('Enter');
    const made = await p.eval(`({n:me().playlists.length, has:me().playlists[0]?.songs.includes(${q(ids.long)}), chk:document.querySelector('#plList input')?.checked})`);
    await p.click('#plList input');
    const removed = await p.eval(`!me().playlists[0].songs.includes(${q(ids.long)})`);
    await p.click('#plList input');
    const again = await p.eval(`me().playlists[0].songs.includes(${q(ids.long)})`);
    await p.click('#plClose');
    ok('K9', /^아직 재생목록이 없어요/.test(empty), `재생목록이 없으면 "${empty.slice(0, 14)}…"`);
    ok('K5', open && made.n === 1 && made.has && made.chk && removed && again, '"만들고 넣기" → 체크됨 · 체크 끄면 빠짐 · 켜면 다시 들어감');
    ok('C8', open && made.has, '곡 줄 재생목록 버튼 → 재생목록 넣기');
  });

  await step('곡 줄: 수정·삭제(3초 안에 한 번 더), 데모곡엔 없음, 터치 화면은 ⋯', ['C8'], async () => {
    const r = await rowOf(ids.plain), sel = `#songList li:nth-child(${r})`;
    await p.click(`${sel} .acts [title="수정"]`, { hover: sel });
    const edit = await p.until(`document.querySelector('#songDialog').open && document.querySelector('#dlgTitle').textContent==='곡 수정' && document.querySelector('#f-title').value==='QA 시험 시간없는가사'`, 2000);
    await p.click('#dlgCancel');
    await p.click(`${sel} .acts [title="삭제"]`, { hover: sel });
    const armed = await txt(p, `${sel} .acts .danger`);
    await sleep(3300);
    const reverted = await p.eval(`!document.querySelector('${sel} .acts .danger') && !!songById(${q(ids.plain)})`);
    const demoBtns = await p.eval(`[...document.querySelectorAll('#songList li:first-child .acts button')].map(b=>b.title).filter(t=>t==='수정'||t==='삭제').length`);
    // 터치 화면 (폰 412): ⋯를 눌러야 재생목록·수정·삭제가 보인다
    const ph = await openPage(ctx, PHONE, ctx.base + '/index.html');
    const i = await ph.eval(`state.songs.findIndex(s=>s.id===${q(ids.plain)})+1`), ps = `#songList li:nth-child(${i})`;
    const before = await ph.eval(`[...document.querySelectorAll('${ps} .acts .more')].every(b=>getComputedStyle(b).display==='none') && getComputedStyle(document.querySelector('${ps} .more-toggle')).display!=='none'`);
    await ph.tap(`${ps} .more-toggle`);
    const after = await ph.eval(`[...document.querySelectorAll('${ps} .acts .more')].filter(b=>getComputedStyle(b).display!=='none').map(b=>b.title)`);
    await ph.close();
    ok('C8', edit && armed === '삭제?' && reverted && demoBtns === 0 && before && after.join(',') === '재생목록에 넣기,수정,삭제',
      `수정 → 곡 수정 창 · 삭제 "${armed}" 3초 지나면 원래대로 · 데모곡 수정·삭제 없음 · 터치 ⋯ → ${after.join('·')}`);
  });

  await step('내 목록 탭: 보기·전체 예약·이름·삭제·▲·✕·새 재생목록, 빈 안내', ['K6', 'K9'], async () => {
    await p.click('#tabMine');
    // 재생목록에 곡 2개 (▲ 보려고)
    await p.eval(`me().playlists[0].songs.push(${q(ids.short)}); saveProfiles(me()); renderMine()`);
    const secs = await p.eval(`[...document.querySelectorAll('#mineBody .mine-sec')].map(s=>s.querySelector('h4 .ttl')?.textContent+' '+s.querySelector('h4 small')?.textContent)`);
    const who = await txt(p, '#mineWho');
    await p.click('#mineBody .mine-sec:nth-child(2) h4 .primary');      // 전체 예약
    const q1 = await p.eval(`state.queue.length`);
    await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
    await p.click('#mineBody .mine-sec:nth-child(2) .mine-row:nth-child(3) .icon-btn[title="위로"]');
    const order = await p.eval(`me().playlists[0].songs.slice()`);
    await p.click('#mineBody .mine-sec:nth-child(2) .mine-row:nth-child(2) .icon-btn[title="목록에서 빼기"]');
    const afterX = await p.eval(`me().playlists[0].songs.length`);
    await p.click('#mineBody .mine-sec:nth-child(2) h4 .ghost:not(.danger)');      // 이름
    await p.eval(`(()=>{const i=document.querySelector('#mineBody input.ren'); i.focus(); i.select()})()`);
    await p.type('QA 바꾼 목록'); await p.key('Enter');
    const renamed = await p.eval(`me().playlists[0].name`);
    await p.click('#newPlBtn');
    await p.type('QA 빈 목록'); await p.key('Enter');
    const emptyTxt = await p.eval(`[...document.querySelectorAll('#mineBody .mine-sec')].map(s=>s.querySelector('.mine-empty')?.textContent||'')`);
    // 빈 목록 삭제 (두 번)
    await p.click('#mineBody .mine-sec:nth-child(3) h4 .danger');
    await p.click('#mineBody .mine-sec:nth-child(3) h4 .danger');
    const n = await p.eval(`me().playlists.length`);
    // 좋아요 ✕ (좋아요 취소) → 빈 안내
    await p.click('#mineBody .mine-sec:nth-child(1) .mine-row .icon-btn[title="좋아요 취소"]');
    const favEmpty = await txt(p, '#mineBody .mine-sec:nth-child(1) .mine-empty');
    await p.click('#tabSongs');
    ok('K6', who === '나님의 목록' && secs.length === 2 && q1 === 2 && order[0] === ids.short && afterX === 1 && renamed === 'QA 바꾼 목록' && emptyTxt.length === 3 && n === 1,
      `${secs.join(' / ')} · 전체 예약 ${q1}곡 · ▲ 위로 · ✕ 빼기 · 이름 "${renamed}" · 새 재생목록 · 삭제`);
    ok('K9', emptyTxt[2] === '곡 목록에서 ＋를 눌러 이 목록에 곡을 넣어요' && favEmpty === '곡 목록에서 ♡를 누르면 여기에 모여요', `빈 목록 "${emptyTxt[2]}" · 빈 좋아요 "${favEmpty}"`);
  });

  await step('TV 내 목록 창(M): Enter 예약(묶음은 전체), P 우선예약, U 사용자', ['K7', 'M4', 'M11'], async () => {
    await p.eval(`state.queue=[]; saveQueue(); renderQueue(); toggleFav(songById(${q(ids.long)}))`);
    await p.key('m');
    const open = await visible(p, '#mineOv');
    const rows = await p.eval(`[...document.querySelectorAll('#mineList li')].map(li=>li.textContent.slice(0,20))`);
    await p.key('Enter');       // 첫 줄 = "♥ 좋아요" 묶음 → 전체 예약
    const q1 = await p.eval('state.queue.length');
    await p.key('ArrowDown');   // 좋아요 곡
    await p.key('p');
    const q2 = await p.eval(`state.queue.map(id=>songById(id).no)`);
    await p.key('u');
    const who = await p.eval('me().name');
    const ovWho = await txt(p, '#mineOvWho');
    await p.key('u');
    await p.key('Escape');
    const closed = await isHidden(p, '#mineOv');
    ok('K7', open && q1 === 1 && q2.length === 2 && who === 'QA엄마2' && ovWho.startsWith('QA엄마2님') && closed, `M 열림 · Enter 묶음 전체 예약 · P 우선예약 · U → ${who} · Esc 닫힘`);
    ok('M4', open, 'M 내 목록');
    ok('M11', q2.length === 2 && who === 'QA엄마2', '내 목록 창 안 ↑↓·Enter·P·U');
    await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
  });
  await stopAll(p);
}
