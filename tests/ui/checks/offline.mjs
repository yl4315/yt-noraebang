// 흐름 14·16: 서버 없이 연 화면(정적 서버 = GitHub Pages와 같은 상태), 설치 파일(manifest·아이콘·바로가기),
// 오프라인: 정적 서버를 실제로 끄고 + 인터넷 끊김 흉내 → 앱 화면이 열리고(서비스 워커 저장본) 기기에 저장된 곡을 부를 수 있음
import { PC, openPage, txt, sleep, q, seedSong } from './_lib.mjs';
import { LRC_SHORT } from '../fixtures.mjs';
export const areas = ['A', 'R', 'L'];

export default async function offline(ctx) {
  const { ok, step } = ctx;
  let s = null;

  await step('정적 서버에서 앱이 열림, ?tv=1도 됨 (리모컨만 없음)', ['A6', 'L15'], async () => {
    await ctx.startStatic();
    s = await openPage(ctx, PC, ctx.staticBase + '/index.html');
    const st = await s.eval(`({n:state.songs.length, demo:!!state.song.buffer, remote:Remote.on, title:document.title})`);
    ok('A6', st.demo && !st.remote && st.title === 'YT 노래방', '서버 없이 연 화면(정적 서버)에서 앱이 열리고 데모곡 준비 (리모컨만 없음). 실제 Pages 주소는 사람');
    await s.goto(ctx.staticBase + '/?tv=1', 'typeof state!=="undefined" && state.tv && !!state.song.buffer');
    ok('L15', await s.eval('state.tv && !Remote.on'), 'GitHub Pages와 같은 상태(정적 서버)에서도 ?tv=1 → TV 화면');
    await s.eval('exitTV()');
  });

  await step('설치: manifest·아이콘, "TV 화면으로" 바로가기 주소', ['R1', 'R6'], async () => {
    const m = await s.eval(`(async()=>{ const href=document.querySelector('link[rel=manifest]').getAttribute('href'); const j=await (await fetch(href)).json();
      const icons=await Promise.all(j.icons.map(i=>fetch(i.src).then(r=>r.ok && r.headers.get('content-type').startsWith('image/')))); return {href, name:j.name, start:j.start_url, display:j.display, icons, sc:j.shortcuts} })()`);
    ok('R1', m.href === 'manifest.webmanifest' && m.name === 'YT 노래방' && m.start === './' && m.display === 'standalone' && m.icons.length === 3 && m.icons.every(Boolean), `manifest "${m.name}" · 아이콘 ${m.icons.length}개 다 읽힘. 실제 설치는 사람`);
    ok('R6', m.sc?.[0]?.name === 'TV 화면으로' && m.sc[0].url === './?tv=1', `바로가기 "${m.sc?.[0]?.name}" → ${m.sc?.[0]?.url} (그 주소로 열면 TV 화면: L15)`);
  });

  await step('오프라인: 정적 서버를 끄고 인터넷 끊김 흉내 → 앱 화면이 열림, 기기에 저장된 곡은 부를 수 있음', ['R2', 'R3'], async () => {
    // 서비스 워커가 화면 파일을 저장해 둘 때까지
    const sw = await s.until(`navigator.serviceWorker.controller && caches.has('yt-shell-v4')`, 20000, 250);
    await s.until(`caches.open('yt-shell-v4').then(c=>c.keys()).then(k=>k.length>=20)`, 20000, 250);
    const song = await seedSong(s, { title: 'QA 시험 오프라인 곡', artist: 'QA가수', lyrics: LRC_SHORT, wav: ctx.fx.short });
    await ctx.stopStatic();
    await s.offline(true);
    const down = await fetch(ctx.staticBase + '/index.html').then(() => false, () => true);
    await s.goto(ctx.staticBase + '/index.html', 'typeof state!=="undefined" && state.songs.length>1 && !!state.song.buffer', 60000);
    const st = await s.eval(`({online:navigator.onLine, n:state.songs.length, list:document.querySelectorAll('#songList li').length, ctrl:!!navigator.serviceWorker.controller})`);
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
