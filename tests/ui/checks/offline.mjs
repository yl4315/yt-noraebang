// 흐름 14·16: 서버 없이 연 화면(정적 서버 = GitHub Pages와 같은 상태), 설치 파일(manifest·아이콘·바로가기),
// 오프라인: 정적 서버를 실제로 끄고 + 인터넷 끊김 흉내 → 앱 화면이 열리고(서비스 워커 저장본) 기기에 저장된 곡을 부를 수 있음
import fs from 'node:fs';
import { PC, READY_DEMO, openPage, txt, sleep, q, seedSong } from './_lib.mjs';
import { LRC_SHORT } from '../fixtures.mjs';
// 서비스 워커 저장소 이름은 sw.js의 SHELL (JS 파일을 더하면 버전이 오른다)
const SW_SRC = fs.readFileSync(new URL('../../../sw.js', import.meta.url), 'utf8');
const SHELL = /const SHELL = '([^']+)'/.exec(SW_SRC)[1], FONTS = /FONTS = '([^']+)'/.exec(SW_SRC)[1];
export const areas = ['A', 'R', 'L'];

export default async function offline(ctx) {
  const { ok, step } = ctx;
  let s = null;

  await step('정적 서버에서 앱이 열림, ?tv=1도 됨 (리모컨만 없음)', ['A6', 'L15'], async () => {
    await ctx.startStatic();
    s = await openPage(ctx, PC, ctx.staticBase + '/index.html');
    const st = await s.eval(`({n:state.songs.length, demo:!!state.song.buffer, remote:Remote.on, title:document.title})`);
    ok('A6', st.demo && !st.remote && st.title === '예태 노래방', '서버 없이 연 화면(정적 서버)에서 앱이 열리고 데모곡 준비 (리모컨만 없음). 실제 Pages 주소는 사람');
    await s.goto(ctx.staticBase + '/?tv=1', 'typeof state!=="undefined" && state.tv && !!state.song.buffer');
    ok('L15', await s.eval('state.tv && !Remote.on'), 'GitHub Pages와 같은 상태(정적 서버)에서도 ?tv=1 → TV 화면');
    await s.eval('exitTV()');
  });

  await step('설치: manifest·아이콘, "TV 화면으로" 바로가기 주소', ['R1', 'R6'], async () => {
    const m = await s.eval(`(async()=>{ const href=document.querySelector('link[rel=manifest]').getAttribute('href'); const j=await (await fetch(href)).json();
      const icons=await Promise.all(j.icons.map(i=>fetch(i.src).then(r=>r.ok && r.headers.get('content-type').startsWith('image/')))); return {href, name:j.name, start:j.start_url, display:j.display, icons, sc:j.shortcuts} })()`);
    ok('R1', m.href === 'manifest.webmanifest' && m.name === '예태 노래방' && m.start === './' && m.display === 'standalone' && m.icons.length === 3 && m.icons.every(Boolean), `manifest "${m.name}" · 아이콘 ${m.icons.length}개 다 읽힘. 실제 설치는 사람`);
    ok('R6', m.sc?.[0]?.name === 'TV 화면으로' && m.sc[0].url === './?tv=1', `바로가기 "${m.sc?.[0]?.name}" → ${m.sc?.[0]?.url} (그 주소로 열면 TV 화면: L15)`);
  });

  await step('오프라인: 정적 서버를 끄고 인터넷 끊김 흉내 → 앱 화면이 열림, 기기에 저장된 곡은 부를 수 있음', ['R2', 'R3'], async () => {
    // 서비스 워커가 화면 파일을 저장해 둘 때까지
    const sw = await s.until(`navigator.serviceWorker.controller && caches.has(${q(SHELL)})`, 20000, 250);
    await s.until(`caches.open(${q(SHELL)}).then(c=>c.keys()).then(k=>k.length>=20)`, 20000, 250);
    // CR-241 N6: 서비스 워커가 맡은 화면으로 한 번 더 열면, 이 화면이 쓴 Google 글꼴(CSS·글꼴 파일)이 글꼴 저장소(FONTS)에 다 들어감
    //   → 인터넷이 끊겨도 같은 글꼴 (밖 주소·글꼴 파일·CSP는 그대로)
    await s.goto(ctx.staticBase + '/index.html', READY_DEMO, 150000);
    const FONT_URLS = `performance.getEntriesByType('resource').map(e=>e.name).filter(u=>/^https:\\/\\/fonts\\.(googleapis|gstatic)\\.com\\//.test(u))`;
    const fontsKept = await s.until(`(async()=>{ const u=${FONT_URLS}; if(!u.some(x=>/gstatic/.test(x))) return false; const c=await caches.open(${q(FONTS)}); for (const x of u) if(!(await c.match(x))) return false; return true })()`, 20000, 250);
    const fc = await s.eval(`(async()=>{ const u=${FONT_URLS}, c=await caches.open(${q(FONTS)}), k=(await c.keys()).map(r=>r.url); let kept=0; for (const x of u) if (await c.match(x)) kept++;
      return {css:u.filter(x=>/googleapis/.test(x)).length, files:u.filter(x=>/gstatic/.test(x)).length, kept, all:k.length} })()`);
    ok('R2', fontsKept, `디자인 N6 글꼴 저장: 이 화면이 쓴 글꼴 CSS ${fc.css}개·글꼴 파일 ${fc.files}개 중 ${fc.kept}개가 서비스 워커 글꼴 저장소(${FONTS})에 있음 (저장소 전체 ${fc.all}개)`);
    const song = await seedSong(s, { title: 'QA 시험 오프라인 곡', artist: 'QA가수', lyrics: LRC_SHORT, wav: ctx.fx.short });
    await ctx.stopStatic();
    await s.offline(true);
    const down = await fetch(ctx.staticBase + '/index.html').then(() => false, () => true);
    await s.goto(ctx.staticBase + '/index.html', 'typeof state!=="undefined" && state.songs.length>1 && !!state.song.buffer', 60000);
    const st = await s.eval(`({online:navigator.onLine, n:state.songs.length, list:document.querySelectorAll('#songList li').length, ctrl:!!navigator.serviceWorker.controller})`);
    const ff = await s.eval(`(async()=>{ await document.fonts.ready; const f=[...document.fonts].filter(x=>/Noto Sans KR/.test(x.family)); return {n:f.length, loaded:f.filter(x=>x.status==='loaded').length, err:f.filter(x=>x.status==='error').length} })()`);
    ctx.log(`  끊긴 뒤 Noto Sans KR 글꼴 조각: 읽힘 ${ff.loaded} · 못 읽음 ${ff.err} · 전체 ${ff.n} (안 쓴 조각은 안 읽음)`);
    ok('R2', sw && down && !st.online && st.list === st.n && st.ctrl, `서버 꺼짐(${down}) + 인터넷 끊김 → 저장해 둔 화면으로 열림, 곡 목록 ${st.list}줄`);
    await s.eval(`selectSong(songById(${q(song.id)}))`);
    await s.until(`state.song.id===${q(song.id)} && !!state.song.buffer`, 10000);
    await s.eval('play()');
    const played = await s.until('state.playing && curTime()>0.8', 6000);
    await s.eval('stopPlayback()');
    ok('R3', played, '서버를 끈 뒤 기기에 저장된 곡을 골라 반주가 흐름. 실제 인터넷 없는 폰은 사람');
    await s.offline(false);
  });
  await s?.close();
  await ctx.startStatic();
}
