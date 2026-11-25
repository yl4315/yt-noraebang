// CR-030: 유튜브 곡 (V 구역). 검색 창 탭 둘 · 링크 붙여넣기 · 폰 [공유] 받기 · 유튜브에서 열어 찾기 · 열쇠 검색 · IFrame 재생·조작 ·
// 재생 못 하는 영상 안내(CR-251: 101·150 큰 단추·TV QR) · 인터넷 탓에 못 튼 예약곡 건너뛰기(V18) · 안 틀어지는 영상 기억·예약 차례에 건너뛰기(V19) · 프리미엄 계정으로 틀기 설정(V13) · 곡 목록·예약·♡·차트 · 가사(LRCLIB)·싱크 편집 · 키·녹음 끔 · 눌러서 시작 · TV 띠.
// 진짜 유튜브에 닿지 않는다: IFrame API는 tests/ui/fake-yt.js(가짜 플레이어), 열쇠 검색은 ctx.ytRules 가짜 답, 썸네일은 회색 그림 (run.mjs 길 가로채기).
// 열쇠는 가짜(ctx.ytFakeKey)만 쓰고, 화면·저장소·기록에 그 글자가 없는지도 본다. window.open(유튜브 결과 열기)은 막고 주소만 적는다.
// 만든 유튜브 곡·예약·♡·부른 횟수는 끝에 지운다.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PC, PHONE, READY_DEMO, q, txt, marks, sawToast, sawFlash, sleep, stopAll, enterTVNoFs, noHScroll } from './_lib.mjs';
import { cand } from '../fixtures.mjs';
export const areas = ['V'];

const ID = { A: 'QAyt0000001', B: 'QAyt0000002', C: 'QAyt0000003', D: 'QAyt0000004', L: 'QAyt0000005', S: 'QAyt0000006', P: 'QAyt0000007', X: 'QAyt0000008', N: 'QAyt0000009', K: 'QAyt0000010' };
// 가짜 플레이어가 알려 줄 영상 정보 (제목·채널·길이·오류)
const VIDEOS = {
  [ID.A]: { title: 'QA 시험 유튜브 하나 - QA가수Y', author: 'QA 채널', dur: 8 },
  [ID.B]: { err: 150 },
  [ID.N]: { err: 100 },   // 지워짐·비공개 (CR-251: 큰 단추 없이 예전 그대로)
  [ID.K]: { err: 101 },   // 퍼가기 막힘 → 곡에 기억 (CR-251 YT-01, V19). 나중에 막힘이 풀린 것처럼 바꿔서 다시 시도도 본다
  [ID.C]: { title: '[TJ노래방] QA 시험 유튜브 둘 - QA가수Y / TJ Karaoke', author: 'TJ KARAOKE', dur: 30 },
  [ID.L]: { title: '[TJ노래방] QA 시험 가사곡 - QA가수L / TJ Karaoke', author: 'TJ KARAOKE', dur: 95 },
  [ID.P]: { title: 'QA 시험 링크곡 - QA가수P', author: 'QA 채널', dur: 30 },
  [ID.S]: { title: 'QA 시험 공유곡 - QA가수S', author: 'QA 채널', dur: 30 },
};
const SEARCH = {
  items: [
    { id: { videoId: ID.C }, snippet: { title: '[TJ노래방] QA 시험 유튜브 둘 - QA가수Y / TJ Karaoke', channelTitle: 'TJ KARAOKE', thumbnails: { medium: { url: `https://i.ytimg.com/vi/${ID.C}/mqdefault.jpg` } } } },
    { id: { videoId: ID.D }, snippet: { title: 'QA 시험 유튜브 셋 &amp; 넷 노래방', channelTitle: 'QA 노래방', thumbnails: { default: { url: `https://i.ytimg.com/vi/${ID.D}/default.jpg` } } } },
    { id: { videoId: ID.X }, snippet: { title: 'QA 시험 바깥 그림', channelTitle: 'QA 채널', thumbnails: { medium: { url: 'https://example.com/x.jpg' } } } },
    { id: { channelId: 'UCqa' }, snippet: { title: '채널은 빠짐' } },
  ],
};

const setInput = (p, v) => p.eval(`(()=>{const i=document.querySelector('#searchInput'); i.value=${q(v)}; i.dispatchEvent(new Event('input')); i.focus(); return true})()`);
const ytSongOf = (p, id) => p.eval(`(()=>{const s=findYtSong(state.songs, ${q(id)}); return s ? {id:s.id, no:s.no, title:s.title, artist:s.artist, source:s.source, ytId:s.ytId, ytDur:s.ytDur||0, lyrics:s.lyrics||'', queued:state.queue.includes(s.id)} : null})()`);
const clearQueue = p => p.eval(`(()=>{ state.queue.length=0; saveQueue(); renderQueue(); return true })()`);
/** 유튜브 곡 고르기: 플레이어에 올라갈 때까지(또는 오류) */
async function selYt(p, id) {
  await p.eval(`selectSong(findYtSong(state.songs, ${q(id)}))`);
  return p.until(`state.song && state.song.ytId===${q(id)} && Yt.loaded===${q(id)} && (Yt.st===5 || Yt.err!=null)`, 15000);
}
/** 영상 칸의 네 귀퉁이·가운데를 눌렀을 때 영상(가짜 플레이어)이 맞는지 = 노래방 요소가 위에 겹치지 않음 */
const boxHits = p => p.eval(`(()=>{const b=document.querySelector('#ytBox'), r=b.getBoundingClientRect(); if(!r.width) return {n:0, of:5};
  const pts=[[r.left+4,r.top+4],[r.right-4,r.top+4],[r.left+4,r.bottom-4],[r.right-4,r.bottom-4],[r.left+r.width/2,r.top+r.height/2]];
  const bad=pts.map(([x,y])=>{const e=document.elementFromPoint(x,y); return e && b.contains(e) ? '' : (e ? (e.id||e.className||e.tagName) : '없음')}).filter(Boolean);
  return {n:5-bad.length, of:5, bad, l:Math.round(r.left), t:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height)}})()`);

export default async function youtube(ctx) {
  const { ok, step } = ctx, p = ctx.p, KEY = ctx.ytFakeKey;
  const yt0 = ctx.ytLog.length;
  const shot = async name => { try { await p.shot(path.join(ctx.shotsDir, name)); ctx.log(`  (사진 shots/${name})`); } catch (e) { ctx.log(`  (사진 못 찍음 ${name}: ${e.message})`); } };
  const prep = () => p.eval(`(()=>{ window.__ytOpened=[]; if(!window.__ytOpen0) window.__ytOpen0=window.open;
    window.open=(u)=>{ window.__ytOpened.push(String(u)); return null; }; window.__ytVideos=${q(VIDEOS)}; window.__ytBlockAutoplay=false; ytSetKey(null); return true })()`);
  await stopAll(p);
  await p.emulate(PC);
  await prep();

  try {
    await step('검색 창 탭 둘: [내 MR 보관함 | 유튜브 노래방 검색], Tab으로 바꿈, "유튜브 곡 넣기" 단추', ['V1'], async () => {
      await p.eval('openSearch()');
      const a = await p.eval(`(()=>{const m=document.querySelector('#searchTabMr'), y=document.querySelector('#searchTabYt'), i=document.querySelector('#searchInput');
        return {sh:Math.round(m.parentElement.getBoundingClientRect().height), mrOn:m.classList.contains('on'), ytOn:y.classList.contains('on'), sel:m.getAttribute('aria-selected'), mh:Math.round(m.getBoundingClientRect().height), yh:Math.round(y.getBoundingClientRect().height),
          ph:i.placeholder, foot:!document.querySelector('#searchFoot').hidden, yfoot:!document.querySelector('#searchFootYt').hidden, rows:document.querySelectorAll('#searchList .ov-row').length,
          cards:document.querySelectorAll('#searchList .yt-card').length, mt:m.textContent.trim(), yt:y.textContent.trim()}})()`);
      ok('V1', a.mrOn && !a.ytOn && a.sel === 'true' && a.sh >= 48 && a.mh >= 44 && a.yh >= 44 && a.foot && !a.yfoot && a.rows > 0 && !a.cards && /MR/.test(a.mt) && /유튜브/.test(a.yt),
        `처음은 MR 탭 (탭 줄 높이 ${a.sh}, 단추 ${a.mh}·${a.yh}, MR 결과 ${a.rows}줄, 유튜브 카드 ${a.cards}, 글 "${a.mt}" | "${a.yt}")`);
      await p.key('Tab');
      const b = await p.eval(`({yt:Yt.tab, on:document.querySelector('#searchTabYt').classList.contains('on'), ph:document.querySelector('#searchInput').placeholder,
        foot:!document.querySelector('#searchFoot').hidden, yfoot:!document.querySelector('#searchFootYt').hidden, link:!!document.querySelector('#searchList .yt-c-link'), share:!!document.querySelector('#searchList .yt-c-share'),
        hint:document.querySelector('#searchHint').textContent, focus:document.activeElement===document.querySelector('#searchInput')})`);
      ok('V1', b.yt === 'yt' && b.on && /유튜브 링크/.test(b.ph) && !b.foot && b.yfoot && b.link && b.share && b.focus,
        `Tab → 유튜브 탭 (칸 안내 "${b.ph}", 링크·[공유] 안내 카드 ${b.link && b.share ? '있음' : '없음'}, 힌트 "${b.hint}")`);
      await p.key('Tab');
      const c = await p.eval(`({yt:Yt.tab, rows:document.querySelectorAll('#searchList .ov-row').length, cards:document.querySelectorAll('#searchList .yt-card').length})`);
      ok('V1', c.yt === 'mr' && c.rows > 0 && !c.cards, `Tab 한 번 더 → MR 탭 (결과 ${c.rows}줄)`);
      await p.key('Escape');
      const closed = await p.until(`document.querySelector('#searchOv').hidden`, 3000);
      await p.click('#ytAddBtn');
      const d = await p.until(`!document.querySelector('#searchOv').hidden && Yt.tab==='yt'`, 3000);
      ok('V1', closed && d, `Esc로 닫힘 ${closed} · 곡 목록 "유튜브 곡 넣기" → 유튜브 탭으로 열림 ${d}`);
    });

    await step('링크 붙여넣기 → 미리 보기 줄 → Enter = 곡 목록에 넣고 예약, 링크가 아니면 안내, 제목은 플레이어가 알려 줌', ['V2'], async () => {
      await clearQueue(p);
      const m0 = await marks(p);
      await setInput(p, '');
      await p.type(`https://youtu.be/${ID.P}?si=qa`);
      const pre = await p.until(`[...document.querySelectorAll('#searchList .yt-row')].some(li=>/유튜브 영상 1개/.test(li.textContent))`, 3000);
      const btns = await p.eval(`[...document.querySelectorAll('#searchList .yt-row .acts button')].map(b=>b.textContent+(b.classList.contains('primary')?'(주)':''))`);
      ok('V2', pre && btns[0] === '예약하기(주)' && btns[1] === '곡 목록에만', `미리 보기 줄 "유튜브 영상 1개" · 단추 ${btns.join(' / ')}`);
      await p.key('Enter');
      await p.until(`(()=>{const s=findYtSong(state.songs, ${q(ID.P)}); return !!s && state.queue.includes(s.id)})()`, 5000);
      const s = await ytSongOf(p, ID.P);
      const fl = await sawFlash(p, /^예약\s+\d+\s+유튜브 영상/, m0, 3000);
      const added = await p.eval(`__ui.toasts.slice(${m0.t}).some(x=>/추가됨/.test(x.text))`);
      ok('V2', !!s && s.source === 'yt' && s.title === '유튜브 영상 ' + ID.P && s.queued && fl && !added,
        s ? `${s.no}번 "${s.title}" 넣고 예약 (source ${s.source}, 알림은 예약 하나 ${fl && !added})` : '곡이 안 생김');
      await setInput(p, '');
      await p.type('https://example.com/watch?v=abc');
      const bad = await p.until(`/유튜브 링크가 아니에요/.test((document.querySelector('#searchList .yt-c-bad')||{}).textContent||'')`, 3000);
      ok('V2', bad, '유튜브가 아닌 링크 → "유튜브 링크가 아니에요"');
      await stopAll(p);
      await selYt(p, ID.P);
      const named = await p.until(`(()=>{const s=findYtSong(state.songs, ${q(ID.P)}); return s && s.title==='QA 시험 링크곡' && s.artist==='QA가수P'})()`, 5000);
      const head = await txt(p, '#songTtl');
      ok('V2', named && /QA 시험 링크곡/.test(head), `곡을 고르면 플레이어가 알려 준 제목으로 바뀜 → "${head}" (바깥 접속 더하지 않음)`);
    });

    await step('열쇠 없을 때: 제목을 치면 [유튜브에서 열어 찾기] (검색어 + 노래방), 유튜브 검색 API는 부르지 않음', ['V4'], async () => {
      await p.eval(`ytSetKey(null)`);
      await p.eval(`openSearch('yt')`);
      await setInput(p, '');
      await p.type('밤편지 QA');
      const card = await p.until(`!!document.querySelector('#searchList .yt-c-open #ytOpenBtn')`, 3000);
      const info = await p.eval(`(document.querySelector('#searchList .yt-info-line')||{}).textContent||''`);
      const m0 = await marks(p);
      await p.click('#ytOpenBtn');
      const url1 = await p.eval(`window.__ytOpened[window.__ytOpened.length-1]||''`);
      const want = 'https://www.youtube.com/results?search_query=' + encodeURIComponent('밤편지 QA 노래방');
      const tip = await sawToast(p, /\[공유\] → 노래방/, m0, 3000);
      ok('V4', card && url1 === want && tip && /열쇠가 없어서/.test(info), `[유튜브에서 열어 찾기] → ${url1.replace('https://www.youtube.com', '')} · 안내 알림 ${tip} · 안내 줄 ${info ? '있음' : '없음'}`);
      const n0 = await p.eval('window.__ytOpened.length');
      await p.eval(`document.querySelector('#searchInput').focus()`);
      await p.key('Enter');
      const n1 = await p.eval('window.__ytOpened.length');
      ok('V4', n1 === n0 + 1 && ctx.ytLog.length === yt0, `Enter도 유튜브를 열어 찾음 (${n1 - n0}번) · 검색 API 부름 ${ctx.ytLog.length - yt0}번`);
      await p.key('Escape');
    });

    await step('열쇠가 있을 때만 검색: 검색어 + 노래방, 썸네일·제목·채널·[예약], 같은 검색어는 다시 안 부름, 한도(403)면 열쇠 없는 길, 열쇠 글자는 어디에도 없음', ['V5'], async () => {
      ctx.ytRules.length = 0;
      ctx.ytRules.push({ q: '^QA 시험 유튜브 노래방$', body: SEARCH }, { q: '^QA 시험 한도 노래방$', status: 403, body: { error: { code: 403, message: 'quotaExceeded' } } });
      await p.eval(`ytSetKey(${q(KEY)})`);
      await p.eval(`openSearch('yt')`);
      const h = await p.eval(`({ph:document.querySelector('#searchInput').placeholder, hint:document.querySelector('#searchHint').textContent})`);
      await setInput(p, '');
      await p.type('QA 시험 유튜브');
      const find = await p.until(`!!document.querySelector('#searchList .yt-c-find')`, 3000);
      const before = ctx.ytLog.length;
      ok('V5', find && before === yt0 && /노래 제목/.test(h.ph) && /노래방/.test(h.hint), `열쇠 있음: 칸 "${h.ph}" · 치는 동안은 부르지 않음 (부름 ${before - yt0})`);
      await p.key('Enter');
      const got = await p.until(`document.querySelectorAll('#searchList .yt-row').length>=3`, 8000);
      const rows = await p.eval(`[...document.querySelectorAll('#searchList .yt-row')].map(li=>({t:li.querySelector('.yt-t').textContent, ch:li.querySelector('small').textContent,
        img:(li.querySelector('img.yt-thumb')||{}).src||'', iw:(li.querySelector('img.yt-thumb')||{}).width||0, btn:[...li.querySelectorAll('.acts button')].map(b=>b.textContent+(b.classList.contains('primary')?'(주)':'')).join('/')}))`);
      const call = ctx.ytLog[ctx.ytLog.length - 1] || {};
      ok('V5', got && ctx.ytLog.length === before + 1 && call.q === 'QA 시험 유튜브 노래방' && call.key === '가짜 열쇠' && call.embeddable === 'true' && call.type === 'video',
        `Enter → 검색 한 번 (q "${call.q}", 열쇠 ${call.key}, 퍼가기 되는 영상만 ${call.embeddable}, 영상만 ${call.type})`);
      ok('V5', rows.length === 3 && rows[0].img.startsWith('https://i.ytimg.com/') && rows[0].iw === 128 && rows[1].img.startsWith('https://i.ytimg.com/') && !rows[2].img
        && rows[1].t === 'QA 시험 유튜브 셋 & 넷 노래방' && rows.every(r => r.btn === '예약'),
        `결과 ${rows.length}줄 (채널 줄 빠짐): ${rows.map(r => `"${r.t}"·${r.ch}·${r.img ? '썸네일' : '그림 없음'}·[${r.btn}]`).join(' | ')}`);
      const foot = await p.eval(`({t:(document.querySelector('#searchList .yt-info-line')||{}).textContent||'', link:!!document.querySelector('#ytLinkBtn')})`);
      ok('V5', /하루 한도/.test(foot.t) && foot.link, `아래 줄 "${foot.t}" · [링크로 넣기] ${foot.link}`);
      await p.click('#searchList .yt-row.has-thumb .acts button');
      await p.until(`(()=>{const s=findYtSong(state.songs, ${q(ID.C)}); return !!s && state.queue.includes(s.id)})()`, 5000);
      const c = await ytSongOf(p, ID.C);
      ok('V5', !!c && c.title === 'QA 시험 유튜브 둘' && c.artist === 'QA가수Y' && c.queued, c ? `[예약] → ${c.no}번 "${c.title}" · ${c.artist} 넣고 예약` : '곡이 안 생김');
      await p.eval(`ytKeySearch('QA 시험 유튜브')`);
      await sleep(300);
      ok('V5', ctx.ytLog.length === before + 1, `같은 검색어 다시 → 부르지 않음 (부름 ${ctx.ytLog.length - before})`);
      const m0 = await marks(p);
      await setInput(p, '');
      await p.type('QA 시험 한도');
      await p.key('Enter');
      const blocked = await p.until('Yt.keyBlocked', 6000);
      const t403 = await sawToast(p, /한도가 찼어요/, m0, 3000);
      const after = await p.eval(`({open:!!document.querySelector('#searchList .yt-c-open #ytOpenBtn'), info:(document.querySelector('#searchList .yt-info-line')||{}).textContent||''})`);
      const n0 = await p.eval('window.__ytOpened.length'), c0 = ctx.ytLog.length;
      await p.eval(`document.querySelector('#searchInput').focus()`);
      await p.key('Enter');
      const n1 = await p.eval('window.__ytOpened.length');
      ok('V5', blocked && t403 && after.open && /한도가 찼어요/.test(after.info) && n1 === n0 + 1 && ctx.ytLog.length === c0,
        `한도(403) → 알림 ${t403} · [유튜브에서 열어 찾기]로 바뀜 ${after.open} · 다시 Enter는 열어 찾기 (API 부름 ${ctx.ytLog.length - c0})`);
      const leak = await p.eval(`(async()=>{ const k=${q(KEY)}; const html=document.documentElement.outerHTML.includes(k);
        let ls=false; for(let i=0;i<localStorage.length;i++){const n=localStorage.key(i); if((n+(localStorage.getItem(n)||'')).includes(k)) ls=true;}
        let ss=false; for(let i=0;i<sessionStorage.length;i++){const n=sessionStorage.key(i); if((n+(sessionStorage.getItem(n)||'')).includes(k)) ss=true;}
        const db=JSON.stringify(await DB.all('songs')).includes(k), cache=JSON.stringify([...Yt.cache.values()]).includes(k);
        return {html, ls, ss, db, cache}})()`);
      const logs = JSON.stringify(ctx.netLog).includes(KEY) || JSON.stringify(ctx.ytLog).includes(KEY);
      ok('V5', !leak.html && !leak.ls && !leak.ss && !leak.db && !leak.cache && !logs,
        `열쇠 글자: 화면 ${leak.html ? '있음!' : '없음'} · localStorage ${leak.ls ? '있음!' : '없음'} · sessionStorage ${leak.ss ? '있음!' : '없음'} · 곡 저장소 ${leak.db ? '있음!' : '없음'} · 점검 기록 ${logs ? '있음!' : '없음'}`);
      await p.key('Escape');
    });

    await step('IFrame 재생·조작: 가짜 플레이어(nocookie·컨트롤 있음), 재생·시간·일시정지·옮기기·끝, 영상 칸 200×200 이상·안 가림, 소리 빼기·녹화 코드 없음', ['V6', 'V10'], async () => {
      await stopAll(p); await clearQueue(p);
      await p.eval(`ytAdd(${q(ID.A)}, {title:'QA 시험 유튜브 하나 - QA가수Y'})`);
      const sel = await selYt(p, ID.A);
      const f = await p.eval(`({host:__ytFake.host, vars:__ytFake.vars, players:__ytFake.players.length, cue:__ytFake.calls.filter(c=>c[0]==='cue'&&c[1]===${q(ID.A)}).length})`);
      ok('V6', sel && f.host === 'https://www.youtube-nocookie.com' && f.vars && f.vars.controls === 1 && f.vars.playsinline === 1 && f.players === 1 && f.cue >= 1,
        `공식 IFrame API(가짜) · host ${f.host} · controls ${f.vars?.controls} · playsinline ${f.vars?.playsinline} · 플레이어 ${f.players}개`);
      await p.eval('play()');
      const on = await p.until('state.playing', 8000);
      const sc = await p.eval(`({score:!!state.score && typeof state.score.frames==='number', st:Yt.st})`);
      await sleep(1200);
      const t1 = await p.eval('curTime()');
      ok('V6', on && t1 > 0.5 && t1 < 5, `재생 → 시간 ${t1.toFixed(2)}초 흐름`);
      ok('V10', on && sc.score, `점수는 켜짐: 재생을 시작하면 점수 기록(마이크만 봄) ${sc.score}`);
      const box = await p.rect('#ytBox'), hits = await boxHits(p);
      const stageOn = await p.eval(`document.querySelector('#stage').classList.contains('yt-on')`);
      ok('V6', box?.visible && box.w >= 200 && box.h >= 200 && hits.n === 5 && stageOn, `영상 칸 ${Math.round(box?.w)}×${Math.round(box?.h)} · 귀퉁이·가운데 5곳 중 ${hits.n}곳이 영상${hits.bad?.length ? ' (가림: ' + hits.bad.join(',') + ')' : ''}`);
      await p.eval('pause()');
      const paused = await p.until('!state.playing && Yt.st===2', 3000);
      const t2 = await p.eval('curTime()'); await sleep(500); const t3 = await p.eval('curTime()');
      await p.eval('seekTo(5.5)');
      const off = await p.eval('state.offset');
      await p.eval('play()');
      const on2 = await p.until('state.playing', 6000);
      const t4 = await p.eval('curTime()');
      ok('V6', paused && Math.abs(t3 - t2) < 0.15 && off === 5.5 && on2 && t4 >= 5.3 && t4 < 7.5, `일시정지 (${t2.toFixed(2)} → ${t3.toFixed(2)}) · 5.5초로 옮겨 다시 재생 → ${t4.toFixed(2)}초`);
      const ended = await p.until('!state.playing && Yt.st===5', 9000);
      const fin = await p.eval(`({off:state.offset, cues:__ytFake.calls.filter(c=>c[0]==='cue'&&c[1]===${q(ID.A)}).length})`);
      ok('V6', ended && fin.off === 0 && fin.cues >= 2, `영상이 끝나면 곡 끝 처리 (처음으로, 다시 올려 둠 ${fin.cues}번)`);
      const js = fs.readFileSync(path.join(ctx.ROOT, 'js', 'yt.js'), 'utf8');
      const banned = ['createMediaElementSource', 'captureStream', 'MediaRecorder', 'getDisplayMedia', 'AudioContext', 'decodeAudioData', '.download'].filter(w => js.includes(w));
      const official = js.includes("'https://www.youtube.com/iframe_api'") && !/<iframe/i.test(js);
      ok('V6', !banned.length && official, `yt.js: 소리 빼기·녹화·내려받기 코드 ${banned.length ? banned.join(',') : '없음'} · 공식 iframe_api만 ${official}`);
    });

    await step('키·녹음 끔 안내 (흐리게 + 한 줄), 눌러도 바뀌지 않음, 내 MR 곡은 그대로', ['V10'], async () => {
      await stopAll(p);
      await selYt(p, ID.A);
      const a = await p.eval(`(()=>{const ks=[...document.querySelectorAll('[data-key-step], #keyReset')], rec=document.querySelector('#recBtn');
        return {keys:ks.length && ks.every(b=>b.classList.contains('yt-off')), rec:rec.classList.contains('yt-off'), op:+getComputedStyle(rec).opacity, out:document.querySelector('#keyOut').textContent,
          note:!document.querySelector('#ytNote').hidden, noteT:document.querySelector('#ytNote').textContent}})()`);
      ok('V10', a.keys && a.rec && Math.abs(a.op - 0.4) < 0.05 && a.note && a.out === '유튜브 곡은 원래 키',
        `키 단추·녹음 단추 흐리게 (투명도 ${a.op}) · "${a.out}" · 한 줄 "${a.noteT}"`);
      let m0 = await marks(p);
      await p.eval('setArmed(true)');
      const fr = await sawFlash(p, /녹음하지 않아요/, m0, 2500);
      m0 = await marks(p);
      await p.eval('setKey(2)');
      const fk = await sawFlash(p, /키를 바꿀 수 없어요/, m0, 2500);
      const st = await p.eval('({armed:state.armed, key:state.key})');
      ok('V10', fr && fk && st.armed === false && st.key === 0, `녹음 누름 → 안내 ${fr}, 키 + → 안내 ${fk} (녹음 대기 ${st.armed}, 키 ${st.key})`);
      await p.eval(`selectSong(state.songs.find(s=>s.demo) || state.songs.find(s=>!isYtSong(s)))`);
      await p.until('state.song && !!state.song.buffer && !isYtSong(state.song)', 15000);
      const b = await p.eval(`({keys:[...document.querySelectorAll('[data-key-step]')].some(b=>b.classList.contains('yt-off')), rec:document.querySelector('#recBtn').classList.contains('yt-off'),
        note:!document.querySelector('#ytNote').hidden, box:document.querySelector('#ytBox').classList.contains('off'), yt:document.querySelector('#stage').classList.contains('yt')})`);
      ok('V10', !b.keys && !b.rec && !b.note && b.box && !b.yt, `내 MR 곡으로 바꾸면 키·녹음 그대로, 영상 칸 숨음 ${b.box}`);
    });

    await step('곡 목록 "유튜브" 표시 · MR 탭 검색에도 나옴 · 예약 · ♡ · 인기 차트 · 곡 수정 창(파일 칸 대신 유튜브 영상 줄)', ['V8'], async () => {
      await stopAll(p); await clearQueue(p);
      const list = await p.eval(`(()=>{const s=findYtSong(state.songs, ${q(ID.A)}); const li=[...document.querySelectorAll('#songList li')].find(li=>li.textContent.includes(s.title));
        return {tag:!!li && !!li.querySelector('.ytag'), t:li ? li.querySelector('.ytag')?.textContent : ''}})()`);
      await p.eval('openSearch()');
      await setInput(p, 'QA 시험 유튜브 하나');
      const sr = await p.eval(`[...document.querySelectorAll('#searchList .ov-row')].map(li=>({t:li.textContent, tag:!!li.querySelector('.ytag')}))`);
      await p.key('Enter');
      const q1 = await p.until(`(()=>{const s=findYtSong(state.songs, ${q(ID.A)}); return state.queue.includes(s.id)})()`, 3000);
      ok('V8', list.tag && list.t === '유튜브' && sr.length >= 1 && sr[0].tag && /QA 시험 유튜브 하나/.test(sr[0].t) && q1, `곡 목록 꼬리표 "${list.t}" · MR 탭 검색 ${sr.length}줄(유튜브 표시 ${sr[0]?.tag}) · Enter 예약 ${q1}`);
      await p.key('Escape');
      await p.eval(`toggleFav(findYtSong(state.songs, ${q(ID.A)}))`);
      const fav = await p.eval(`isFav(findYtSong(state.songs, ${q(ID.A)}))`);
      await p.eval('openChart()');
      const ch = await p.eval(`(()=>{const s=findYtSong(state.songs, ${q(ID.A)}); const li=[...document.querySelectorAll('#chartList li')].find(li=>li.textContent.includes(s.title)); return li ? li.textContent : ''})()`);
      await p.eval('closeOverlays()');
      ok('V8', fav && /\d+회 부름/.test(ch), `♡ ${fav} · 인기 차트 "${ch.replace(/\s+/g, ' ').trim().slice(0, 60)}"`);
      await p.eval(`openSongDialog(findYtSong(state.songs, ${q(ID.A)}))`);
      const dlg = await p.eval(`({open:document.querySelector('#songDialog').open, file:!document.querySelector('#fileRow').hidden, info:!document.querySelector('#ytInfo').hidden,
        t:document.querySelector('#ytInfoTxt').textContent, href:document.querySelector('#ytInfoLink').href})`);
      await p.eval(`document.querySelector('#songDialog').close()`);
      ok('V8', dlg.open && !dlg.file && dlg.info && dlg.href === 'https://www.youtube.com/watch?v=' + ID.A, `곡 수정 창: 파일 칸 ${dlg.file ? '보임!' : '숨김'} · "${dlg.t}" · 유튜브 링크 ${dlg.href.replace('https://www.youtube.com', '')}`);
      await clearQueue(p);
    });

    await step('재생 못 하는 영상(오류 150): 안내 + 유튜브에서 열기, 예약곡이 있으면 3초 뒤 다음 곡 · 인터넷 끊김 안내', ['V7'], async () => {
      await stopAll(p); await clearQueue(p);
      await p.eval(`(async()=>{ const b=await ytAdd(${q(ID.B)}, {title:'QA 시험 막힌 영상 - QA가수B'}); const a=findYtSong(state.songs, ${q(ID.A)}); state.queue.push(b.id, a.id); saveQueue(); renderQueue(); startNext(); })()`);
      const shown = await p.until(`!document.querySelector('#ytErr').hidden && state.song && state.song.ytId===${q(ID.B)}`, 8000);
      const e = await p.eval(`({h:document.querySelector('#ytErrHead').textContent, w:document.querySelector('#ytErrWhy').textContent, link:!document.querySelector('#ytErrLink').hidden, href:document.querySelector('#ytErrLink').href,
        box:document.querySelector('#ytBox').classList.contains('off'), playing:state.playing,
        hide:['.title-card','.lyrics'].every(s=>getComputedStyle(document.querySelector('#stage '+s)).visibility==='hidden')})`);
      ok('V7', shown && /틀 수 없어요/.test(e.h) && /막았어요/.test(e.w) && e.link && e.href === 'https://www.youtube.com/watch?v=' + ID.B && e.box && !e.playing && e.hide,
        `"${e.h}" · "${e.w}" · [유튜브에서 열기] ${e.href.replace('https://www.youtube.com', '')} · 영상 칸 숨김 ${e.box} · 안내 뒤 곡 제목·가사 숨김 ${e.hide}`);
      const t0 = Date.now();
      const next = await p.until(`state.song && state.song.ytId===${q(ID.A)} && state.playing`, 12000);
      ok('V7', next && Date.now() - t0 >= 1500, `3초 안내 뒤 다음 예약곡 재생 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
      await stopAll(p);
      await p.offline(true);
      await selYt(p, ID.A).catch(() => {});
      const off = await p.until(`!document.querySelector('#ytErr').hidden && /인터넷이 끊겨서/.test(document.querySelector('#ytErrHead').textContent)`, 4000);
      await p.offline(false);
      const back = await p.until(`document.querySelector('#ytErr').hidden`, 6000);
      ok('V7', off && back, `인터넷 끊김 → "인터넷이 끊겨서 유튜브 곡을 틀 수 없어요" ${off} · 다시 되면 안내 사라짐 ${back}`);
    });

    await step('퍼가기 막힌 영상(150, CR-251 ①) 폰 390: 큰 [유튜브 앱으로 열기] + 한 줄 · 누르면 3초 뒤 다음 곡 멈춤 · 오류 100은 예전 작은 단추 · 글자 130%', ['V7'], async () => {
      await stopAll(p); await clearQueue(p);
      await p.emulate({ name: '390x844', width: 390, height: 844, mobile: true, touch: true });
      await p.eval(`(async()=>{ if(!findYtSong(state.songs, ${q(ID.B)})) await ytAdd(${q(ID.B)}, {title:'QA 시험 막힌 영상 - QA가수B'});
        if(!findYtSong(state.songs, ${q(ID.N)})) await ytAdd(${q(ID.N)}, {title:'QA 시험 지워진 영상 - QA가수N'}); return true })()`);
      const card = () => p.eval(`(()=>{const a=document.querySelector('#ytErrLink'), n=document.querySelector('#ytErrNote'), c=document.querySelector('#ytErr'), st=document.querySelector('#stage');
        const r=c.getBoundingClientRect(), s=st.getBoundingClientRect(), ar=a.getBoundingClientRect();
        return {shown:!c.hidden, link:!a.hidden && ar.width>0, app:a.classList.contains('yt-err-app'), primary:a.classList.contains('primary'), small:a.classList.contains('small'), label:a.innerText.trim(), href:a.href, target:a.target,
          bh:Math.round(ar.height), bw:Math.round(ar.width), clip:a.scrollWidth>a.clientWidth+1, note:!n.hidden && n.getBoundingClientRect().height>0, nt:n.textContent, tv:!document.querySelector('#ytErrTv').hidden,
          head: r.top >= st.querySelector('.song-head').getBoundingClientRect().bottom - 1,   // 위 곡 머리(번호·제목)와 안 겹침
          inside: r.top>=s.top-1 && r.bottom<=s.bottom+1 && r.left>=s.left-1 && r.right<=s.right+1, ch:Math.round(r.height), sh:Math.round(s.height), cw:Math.round(r.width), sw:Math.round(s.width)}})()`);
      const sel1 = await selYt(p, ID.B);
      await p.until(`Yt.err===150 && !document.querySelector('#ytErr').hidden`, 4000);
      await sleep(250);
      const a = await card(), h1 = await noHScroll(p);
      ok('V7', sel1 && a.shown && a.link && a.app && a.primary && !a.small && a.label === '유튜브 앱으로 열기' && a.href === 'https://www.youtube.com/watch?v=' + ID.B && a.target === '_blank' && a.bh >= 48 && !a.clip && a.note && /녹음·점수·예약곡 이어 부르기는 안 돼요/.test(a.nt) && !a.tv && a.inside && a.head && h1,
        `폰 390: 큰 [${a.label}] ${a.bw}×${a.bh} 새 창 ${a.href.replace('https://www.youtube.com', '')} · 한 줄 "${a.nt}" · 카드 ${a.cw}×${a.ch} 무대 ${a.sw}×${a.sh} 안 ${a.inside} · 곡 머리와 겹침 ${a.head ? '없음' : '있음!'} · 가로 스크롤 ${h1 ? '없음' : '있음!'}`);
      await p.eval(`(()=>{ const t=document.querySelector('#toast'); if(t) t.hidden=true; return true })()`);   // 디자인 사진: 곡 넣기 알림 없이
      await shot('cr251-blocked-phone-390x844.png');
      // 예약곡이 있을 때: 3초 안내가 도는 중에 큰 단추를 누르면 다음 곡으로 넘어가지 않는다 (예약은 그대로). 링크 열기는 막고 누름만 본다
      await stopAll(p); await clearQueue(p);
      // B는 앞 단계에서 "노래방에서 안 틀어짐"으로 기억됨 (CR-251 YT-01: 예약 차례면 바로 건너뜀) → 처음 못 트는 것처럼 표시를 지우고 본다
      await p.eval(`(()=>{ const b=findYtSong(state.songs, ${q(ID.B)}), x=findYtSong(state.songs, ${q(ID.A)}); delete b.ytBlocked; state.queue.push(b.id, x.id); saveQueue(); renderQueue(); startNext(); return true })()`);
      // 3초 안내를 보자마자 페이지 안에서 바로 누른다 (점검 도구 왕복이 느린 PC에서 3초 창을 놓치지 않게). 못 보면 마지막 모습을 남긴다
      const hit = await p.eval(`new Promise(res => { const t0 = performance.now(), B = ${q(ID.B)};
        const look = () => ({id: state.song && state.song.ytId, err: !document.querySelector('#ytErr').hidden, next: !document.querySelector('#nextCard').hidden, code: Yt.err, q: state.queue.length, at: Math.round(performance.now() - t0)});
        const f = () => { const o = look();
          if (o.id === B && o.err && o.next) { const l = document.querySelector('#ytErrLink'); l.addEventListener('click', e => e.preventDefault(), {once:true}); l.click(); o.left = nextAt == null ? 'none' : Math.round(nextAt - performance.now()); return res(Object.assign(o, {ok:true})); }
          if (performance.now() - t0 > 12000) return res(Object.assign(o, {ok:false}));
          setTimeout(f, 25) }; f() })`);
      const counting = !!hit.ok;
      if (!counting) ctx.log(`  (3초 안내를 못 봄: 곡 ${hit.id} · 카드 ${hit.err} · 다음 곡 ${hit.next} · 오류 ${hit.code} · 예약 ${hit.q} · ${hit.at}ms)`);
      await sleep(3800);
      const c = await p.eval(`({id:state.song && state.song.ytId, playing:state.playing, card:!document.querySelector('#nextCard').hidden, q:state.queue.map(id=>(state.songs.find(s=>s.id===id)||{}).ytId), err:!document.querySelector('#ytErr').hidden})`);
      ok('V7', counting && c.id === ID.B && !c.playing && !c.card && c.q.includes(ID.A) && c.err,
        `3초 안내 중 큰 단추를 누름 → 3.8초 뒤에도 그 곡 (다음 곡 카드 ${c.card ? '그대로!' : '닫힘'}, 예약 ${c.q.length}곡 그대로, 안내 ${c.err ? '보임' : '숨음'})`);
      await clearQueue(p);
      // 오류 100(지워짐·비공개)은 예전 그대로: 작은 [유튜브에서 열기], 한 줄 없음
      const sel2 = await selYt(p, ID.N);
      await p.until(`Yt.err===100 && !document.querySelector('#ytErr').hidden`, 4000);
      const b = await card();
      ok('V7', sel2 && b.shown && b.link && !b.app && b.small && !b.primary && b.label === '유튜브에서 열기' && !b.note && !b.tv,
        `오류 100: 작은 [${b.label}] ${b.bw}×${b.bh} · 큰 단추 ${b.app ? '있음!' : '없음'} · 한 줄 ${b.note ? '있음!' : '없음'}`);
      // 글자 130% (폰 390을 CSS 300 + 화면 배율 1.3으로): 카드가 무대 안, 단추 글이 잘리지 않음
      await p.emulate({ name: '300x649@1.3', width: 300, height: 649, dsf: 1.3, mobile: true, touch: true });
      await selYt(p, ID.B);
      await p.until(`Yt.err===150 && !document.querySelector('#ytErr').hidden`, 4000);
      await sleep(250);
      const d = await card(), h2 = await noHScroll(p);
      ok('V7', d.shown && d.app && d.note && d.inside && d.head && !d.clip && h2, `글자 130%: 카드 ${d.cw}×${d.ch} 무대 ${d.sw}×${d.sh} 안 ${d.inside} · 곡 머리와 겹침 ${d.head ? '없음' : '있음!'} · [${d.label}] ${d.bw}×${d.bh} 잘림 ${d.clip ? '있음!' : '없음'} · 가로 스크롤 ${h2 ? '없음' : '있음!'}`);
      await shot('cr251-blocked-phone-130pct.png');
      await stopAll(p);
      await p.emulate(PC);
      await sleep(300);
    });

    await step('퍼가기 막힌 영상(150, CR-251 ①) TV 1920: 링크 대신 "TV 유튜브 앱에서 이 곡 찾기" + 찾을 말 + 영상 QR(앱 안 toqr) · 나가면 큰 단추로', ['V7'], async () => {
      await stopAll(p); await clearQueue(p);
      await p.emulate({ name: '1920x1080', width: 1920, height: 1080 });
      await selYt(p, ID.B);
      await p.until(`Yt.err===150`, 4000);
      const opened0 = await p.eval(`window.__ytOpened.length`);
      await enterTVNoFs(p);
      const qr = await p.until(`!document.querySelector('#ytErr').hidden && !document.querySelector('#ytErrTv').hidden && !document.querySelector('#ytErrQr').hidden && document.querySelector('#ytErrQr').naturalWidth>0`, 6000);
      await sleep(300);
      const t = await p.eval(`(()=>{const c=document.querySelector('#ytErr'), r=c.getBoundingClientRect(), img=document.querySelector('#ytErrQr'), ir=img.getBoundingClientRect(), a=document.querySelector('#ytErrLink'), band=document.querySelector('#tvRemote').getBoundingClientRect();
        return {link:!a.hidden && a.getBoundingClientRect().width>0, head:document.querySelector('#ytErrTvHead').textContent, find:document.querySelector('#ytErrFind').textContent, tip:document.querySelector('#ytErrQrTip').textContent,
          note:!document.querySelector('#ytErrNote').hidden, qw:Math.round(ir.width), qh:Math.round(ir.height), nat:img.naturalWidth, src:/^data:image\\/png/.test(img.src),
          inView:r.top>=0 && r.bottom<=band.top+1 && r.left>=0 && r.right<=innerWidth, cw:Math.round(r.width), ch:Math.round(r.height), bandTop:Math.round(band.top), bottom:Math.round(r.bottom)}})()`);
      const opened = (await p.eval(`window.__ytOpened.length`)) - opened0;   // TV 화면에서 연 창 (앞 단계에서 연 것은 빼고)
      ok('V7', qr && !t.link && t.head === 'TV 유튜브 앱에서 이 곡 찾기' && /QA 시험 막힌 영상/.test(t.find) && /노래방/.test(t.find) && /QR/.test(t.tip) && t.note && t.qw >= 96 && t.qw === t.qh && t.qw % t.nat === 0 && t.src && t.inView && !opened,
        `TV: 링크 단추 ${t.link ? '보임!' : '없음'} · "${t.head}" 찾을 말 "${t.find}" · QR ${t.qw}×${t.qh} (칸당 ${t.qw / t.nat}px, 앱 안 그림) · 카드 ${t.cw}×${t.ch} 띠 위 ${t.inView} (${t.bottom} ≤ ${t.bandTop}) · 한 줄 ${t.note ? '보임' : '숨음!'} · 새 창 ${opened}개 · QR 기다림 ${qr}`);
      await shot('cr251-blocked-tv-1920x1080.png');
      await p.key('t');
      const out = await p.until(`document.querySelector('#tv').hidden && !document.querySelector('#ytErrLink').hidden && document.querySelector('#ytErrTv').hidden`, 3000);
      const back = await p.eval(`({app:document.querySelector('#ytErrLink').classList.contains('yt-err-app'), label:document.querySelector('#ytErrLink').innerText.trim()})`);
      ok('V7', out && back.app && back.label === '유튜브에서 열기', `TV에서 나가면 QR 대신 단추 [${back.label}] (PC 키보드 화면 글) ${out}`);
      await stopAll(p);
      await p.emulate(PC);
      await sleep(300);
    });

    await step('인터넷 탓에 못 튼 예약곡 (CR-251 YT-07): 예약 차례로 시작한 유튜브 곡이 인터넷 끊김·플레이어 시간 초과로 못 틀면 "못 틀어서 건너뛰어요" + 3초 뒤 다음 곡 · 늦게 준비된 플레이어는 버림 · 손으로 고른 곡은 안내만', ['V18'], async () => {
      await stopAll(p); await clearQueue(p);
      const card = () => p.eval(`({shown:!document.querySelector('#ytErr').hidden, h:document.querySelector('#ytErrHead').textContent, w:document.querySelector('#ytErrWhy').textContent,
        next:!document.querySelector('#nextCard').hidden, nt:document.querySelector('#nextTitle').textContent, skip:Yt.errSkip, song:state.song && state.song.id, playing:state.playing})`);
      // ① 인터넷 끊김: 예약 [유튜브 A, 데모] → A 차례에 끊김 안내 + 건너뜀 → 3초 뒤 데모 재생
      await p.offline(true);
      await p.eval(`(()=>{ const a=findYtSong(state.songs, ${q(ID.A)}); state.queue.push(a.id, 'demo'); saveQueue(); renderQueue(); startNext(); return true })()`);
      const s1 = await p.until(`!document.querySelector('#ytErr').hidden && state.song && state.song.ytId===${q(ID.A)} && !document.querySelector('#nextCard').hidden`, 5000);
      const t1 = Date.now(), c1 = await card();
      ok('V18', s1 && /인터넷이 끊겨서/.test(c1.h) && /못 틀어서 건너뛰어요/.test(c1.w) && c1.next && c1.skip && !c1.playing,
        `끊김: "${c1.h}" · "${c1.w}" · 다음 곡 카드 ${c1.next ? '"' + c1.nt + '"' : '없음!'}`);
      await shot('cr251-yt07-offline-skip-pc.png');
      const n1 = await p.until(`state.song && state.song.id==='demo' && state.playing`, 9000);
      const dt1 = (Date.now() - t1) / 1000;
      ok('V18', n1 && dt1 >= 1.5 && dt1 <= 6, `3초 뒤 다음 예약곡(데모, 인터넷 없이 됨) 재생 ${n1} (${dt1.toFixed(1)}초) · 예약 ${await p.eval('state.queue.length')}곡 남음`);
      await stopAll(p); await clearQueue(p);
      await p.offline(false);
      await sleep(200);
      // ② 플레이어 시간 초과 (느린 인터넷 흉내: 가짜 플레이어가 1.5초 뒤에야 준비, 앱은 0.4초만 기다림)
      await p.eval(`(async()=>{ await selectSong(songById('demo')); ytRebuild(); window.__ytReadyMs=1500; Yt.readyMs=400; return true })()`);
      const d0 = await p.eval(`window.__ytFake.calls.filter(c=>c[0]==='destroy').length`);
      await p.eval(`(()=>{ const a=findYtSong(state.songs, ${q(ID.A)}); state.queue.push(a.id, 'demo'); saveQueue(); renderQueue(); startNext(); return true })()`);
      const s2 = await p.until(`!document.querySelector('#ytErr').hidden && state.song && state.song.ytId===${q(ID.A)} && !document.querySelector('#nextCard').hidden`, 5000);
      const c2 = await card();
      ok('V18', s2 && /플레이어를 불러오지 못했어요/.test(c2.h) && /못 틀어서 건너뛰어요/.test(c2.w) && c2.next && c2.skip,
        `시간 초과: "${c2.h}" · "${c2.w}" · 다음 곡 카드 ${c2.next}`);
      const n2 = await p.until(`state.song && state.song.id==='demo' && state.playing`, 9000);
      await sleep(1700);   // 늦은 준비(1.5초)가 온 뒤
      const late = await p.eval(`({ready:Yt.ready, player:!!Yt.player, destroyed:window.__ytFake.calls.filter(c=>c[0]==='destroy').length - ${d0}})`);
      ok('V18', n2 && !late.ready && !late.player && late.destroyed >= 1,
        `3초 뒤 다음 곡 ${n2} · 늦게 준비된 플레이어: 준비됨 ${late.ready ? '켜짐!' : '꺼짐'} · 남은 플레이어 ${late.player ? '있음!' : '없음'} · 버림(destroy) ${late.destroyed}번`);
      await stopAll(p); await clearQueue(p);
      await p.eval(`(()=>{ window.__ytReadyMs=30; Yt.readyMs=15000; return true })()`);
      const again = await selYt(p, ID.A);
      const c3 = await p.eval(`({err:Yt.err, st:Yt.st, ready:Yt.ready, loaded:Yt.loaded, hid:document.querySelector('#ytErr').hidden})`);
      await p.eval('play()');
      const pl3 = await p.until(`state.playing && Yt.st===1`, 5000);
      ok('V18', again && c3.err == null && c3.st === 5 && c3.ready && c3.hid && pl3, `그다음 새 플레이어: 올려 둠(5) ${c3.st === 5} · 준비됨 ${c3.ready} · 안내 숨음 ${c3.hid} · 재생 ${pl3}`);
      await stopAll(p);
      // ③ 손으로 고른 곡: 예약곡이 있어도 안내만 (건너뛰지 않음)
      await p.eval(`(()=>{ state.queue.push('demo'); saveQueue(); renderQueue(); return true })()`);
      await p.offline(true);
      await p.eval(`selectSong(findYtSong(state.songs, ${q(ID.A)}))`);
      await p.until(`!document.querySelector('#ytErr').hidden`, 3000);
      await p.eval('play()');
      await sleep(3600);
      const c4 = await card();
      ok('V18', c4.shown && /인터넷이 끊겨서/.test(c4.h) && /다시 되면/.test(c4.w) && !/건너뛰어요/.test(c4.w) && !c4.next && !c4.skip && c4.song !== 'demo',
        `손으로 고른 곡: "${c4.w}" · 다음 곡 카드 ${c4.next ? '보임!' : '없음'} · 3.6초 뒤에도 그 곡 ${c4.song !== 'demo'}`);
      await p.offline(false);
      const back = await p.until(`document.querySelector('#ytErr').hidden`, 6000);
      ok('V18', back, `인터넷이 다시 되면 안내 사라짐 ${back}`);
      await stopAll(p); await clearQueue(p);
    });

    await step('노래방에서 안 틀어지는 영상 기억 (CR-251 YT-01): 오류 100·101·150이면 곡에 "노래방에서 안 틀어짐" (곡 목록·예약 목록·리모컨으로 가는 곡 목록) · 예약 차례가 오면 틀지 않고 바로 건너뜀 · 다시 골라서 틀어지면 표시 지움 · 곡은 지우지 않음', ['V19'], async () => {
      await stopAll(p); await clearQueue(p);
      await p.emulate(PC);
      const KS = `findYtSong(state.songs, ${q(ID.K)})`;
      await p.eval(`(async()=>{ window.__ytVideos[${q(ID.K)}]={err:101}; if(!${KS}) await ytAdd(${q(ID.K)}, {title:'QA 시험 퍼가기 막힘 - QA가수K'}); return true })()`);
      await sleep(500);
      const snap = () => p.eval(`(()=>{const s=${KS}; return JSON.stringify(Object.keys(s).filter(k=>!['buffer','guide','_loading','_dl','ytBlocked'].includes(k)).sort().map(k=>[k,s[k]]))})()`);
      const rowOf = `(()=>{const s=${KS}; return [...document.querySelectorAll('#songList li')].find(li=>li.querySelector('.no').textContent===String(s.no))})()`;
      const s0 = await snap();
      const bWas = await p.eval(`(findYtSong(state.songs, ${q(ID.B)})||{}).ytBlocked`);
      // ① 처음 못 튼 영상(101) → 곡에 오류 번호를 기억 (다른 칸·고친 시각은 그대로, 이 기기 저장소에도)
      const sel = await selYt(p, ID.K);
      const marked = await p.until(`Yt.err===101 && ${KS}.ytBlocked===101`, 4000);
      await sleep(400);
      const s1 = await snap();
      const rec = await p.eval(`(async()=>{const r=await DB.get('songs', ${KS}.id); return r ? (r.ytBlocked ?? 'none') : 'no-rec'})()`);
      const ui = await p.eval(`(()=>{const s=${KS}, li=${rowOf}, a=li && li.querySelector('.a'), t=li && li.querySelector('.stag.yblk');
        const rs=remoteState().songs.find(x=>x.id===s.id), my=myCleanSongs(remoteState().songs).find(x=>x.id===s.id), other=remoteState().songs.find(x=>x.id==='demo');
        return {tag:t ? t.textContent : '', tip:t ? t.title : '', rs:!!rs && rs.blocked===true, my:!!my && my.blocked===true, other:!!other && !('blocked' in other), lib:!SONG_FIELDS.includes('ytBlocked'), still:state.songs.includes(s)}})()`);
      ok('V19', sel && marked && s0 === s1 && rec === 101 && ui.tag === '노래방에서 안 틀어짐' && /예약하면 차례에 건너뛰어요/.test(ui.tip) && ui.rs && ui.my && ui.other && ui.lib && ui.still && bWas === 150,
        `오류 101 → 곡에 기억 ${marked} (저장소 ${rec}) · 다른 칸·고친 시각 그대로 ${s0 === s1} · 곡 목록 표시 "${ui.tag}" · 리모컨 곡 목록 blocked ${ui.rs}·내 폰 리모컨 ${ui.my} · 다른 곡엔 칸 없음 ${ui.other} · Drive 곡 칸(SONG_FIELDS)에 없음 ${ui.lib} · 곡 그대로 ${ui.still} · 오류 150 곡(B)도 기억 ${bWas}`);
      // 폰 390 곡 목록 사진 (표시가 줄 안에 다 보이는지)
      await p.emulate({ name: '390x844', width: 390, height: 844, mobile: true, touch: true });
      await sleep(400);
      await p.eval(`(()=>{ renderSongs(); const li=${rowOf}; li.scrollIntoView({block:'center'}); const t=document.querySelector('#toast'); if(t) t.hidden=true; return true })()`);
      await sleep(400);
      const ph = await p.eval(`(()=>{const li=${rowOf}, a=li.querySelector('.a'), t=li.querySelector('.stag.yblk'), r=t.getBoundingClientRect(), ar=a.getBoundingClientRect();
        return {inRow:r.right <= ar.right + 1 && r.width > 0, w:Math.round(r.width), aw:Math.round(ar.width), clip:t.scrollWidth > t.clientWidth + 1, h:Math.round(li.getBoundingClientRect().height)}})()`);
      const hs = await noHScroll(p);
      // 폰은 넓은 요소가 있으면 innerWidth까지 커져서 noHScroll만으로는 못 잡는다 → 화면 폭·배율도 본다
      // (PC 자리에 남은 숨은 플레이어 상자가 문서를 1040으로 늘려 폰이 0.375배로 줄었던 고장)
      const vp = await p.eval(`({w:document.documentElement.scrollWidth, iw:innerWidth, sc:visualViewport ? visualViewport.scale : 1, box:(()=>{const r=document.querySelector('#ytBox').getBoundingClientRect(); return Math.round(r.right)})()})`);
      const fit = vp.w <= 391 && vp.iw <= 391 && Math.abs(vp.sc - 1) < 0.01;
      ok('V19', ph.inRow && !ph.clip && hs && fit, `폰 390 곡 줄: 표시 ${ph.w}px (가수 줄 ${ph.aw}px 안 ${ph.inRow}) · 글 잘림 ${ph.clip ? '있음!' : '없음'} · 줄 높이 ${ph.h} · 가로 스크롤 ${hs ? '없음' : '있음!'} · 문서 폭 ${vp.w}·화면 폭 ${vp.iw}·배율 ${vp.sc}${fit ? '' : ' (줄어 보임!)'} · 숨은 플레이어 오른쪽 끝 ${vp.box}`);
      await shot('cr251-yt01-list-mark-390.png');
      await p.emulate(PC);
      await sleep(300);
      // ② 예약 차례: 틀지 않고 바로 건너뜀 (플레이어에 올리지 않음) → 다음 예약곡
      await stopAll(p);
      const cueK = () => p.eval(`window.__ytFake.calls.filter(c=>c[0]==='cue' && c[1]===${q(ID.K)}).length`);
      const c0 = await cueK(), m0 = await marks(p);
      await p.eval(`(()=>{ state.queue.push(${KS}.id, 'demo'); saveQueue(); renderQueue(); return true })()`);
      const qv = await p.eval(`(()=>{ openQueue(); const r={idle:(document.querySelector('#idleQueue small.yblk')||{}).textContent||'', ov:(document.querySelector('#queueList .ov-row .nm small.yblk')||{}).textContent||''}; closeOverlays(); return r })()`);
      await p.eval('startNext()');
      const fl = await sawFlash(p, /QA 시험 퍼가기 막힘 · 노래방에서 안 틀어져서 건너뛰었어요/, m0, 4000);
      const n1 = await p.until(`state.song && state.song.id==='demo' && state.playing`, 9000);
      const c1 = await cueK();
      ok('V19', fl && n1 && c1 === c0 && qv.idle === '노래방에서 안 틀어짐' && qv.ov === '노래방에서 안 틀어짐',
        `예약 목록 표시 (대기 화면 "${qv.idle}" · 예약 창 "${qv.ov}") · 차례에 알림 "…노래방에서 안 틀어져서 건너뛰었어요" ${fl} · 플레이어에 올림 ${c1 - c0}번 · 바로 다음 예약곡(데모) 재생 ${n1}`);
      // ③ TV 1920: 건너뛰는 알림 사진
      await stopAll(p);
      await p.emulate({ name: '1920x1080', width: 1920, height: 1080 });
      await enterTVNoFs(p);
      const m1 = await marks(p);
      await p.eval(`(()=>{ state.queue.push(${KS}.id, 'demo'); saveQueue(); renderQueue(); startNext(); return true })()`);
      const fl2 = await sawFlash(p, /노래방에서 안 틀어져서 건너뛰었어요/, m1, 4000);
      await sleep(500);
      const tf = await p.eval(`(()=>{const f=document.querySelector('#flash'), r=f.getBoundingClientRect(); return {vis:!f.hidden && r.width>0, inView:r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight, t:f.textContent, w:Math.round(r.width)}})()`);
      ok('V19', fl2 && tf.vis && tf.inView, `TV 1920: "${tf.t}" 화면 안 ${tf.inView} (${tf.w}px)`);
      await shot('cr251-yt01-skip-tv-1920x1080.png');
      await stopAll(p);
      await p.emulate(PC);
      await sleep(300);
      // ④ 다시 시도: 손으로 고르면 한 번 더 틀어 보고, 틀어지면 표시를 지운다 (막힘이 풀린 것처럼 가짜 영상을 바꿈)
      await clearQueue(p);
      await p.eval(`(()=>{ window.__ytVideos[${q(ID.K)}]={title:'QA 시험 퍼가기 막힘 - QA가수K', author:'QA 채널', dur:8}; return true })()`);
      const sel2 = await selYt(p, ID.K);
      const still = await p.eval(`${KS}.ytBlocked`);
      await p.eval('play()');
      const pl = await p.until(`state.playing && Yt.st===1`, 5000);
      const un = await p.until(`${KS}.ytBlocked===undefined`, 3000);
      await sleep(400);
      const rec2 = await p.eval(`(async()=>{const r=await DB.get('songs', ${KS}.id); return r ? ('ytBlocked' in r ? r.ytBlocked : 'none') : 'no-rec'})()`);
      const ui2 = await p.eval(`(()=>{const li=${rowOf}; return {tag:!!(li && li.querySelector('.stag.yblk')), rs:'blocked' in remoteState().songs.find(x=>x.id===${KS}.id)}})()`);
      ok('V19', sel2 && still === 101 && pl && un && rec2 === 'none' && !ui2.tag && !ui2.rs,
        `다시 고르면 한 번 더 틀어 봄 (올리는 동안 표시 ${still}) → 재생 ${pl} · 표시 지움 ${un} (저장소 ${rec2}) · 곡 목록 표시 ${ui2.tag ? '남음!' : '없음'} · 리모컨 칸 ${ui2.rs ? '남음!' : '없음'}`);
      await stopAll(p); await clearQueue(p);
    });

    await step('가사: 영상 길이를 알면 LRCLIB 싱크 가사 자동(제목·가수·길이 3초 안), 싱크 편집기 열림·2배속까지', ['V9'], async () => {
      await stopAll(p);
      ctx.lrcRules.unshift({ q: '^QA 시험 가사곡 QA가수L$', body: [cand(9501, 'QA 시험 가사곡', 'QA가수L', 95)] });
      const l0 = ctx.lrcLog.length;
      await p.eval(`ytAdd(${q(ID.L)}, {title:'[TJ노래방] QA 시험 가사곡 - QA가수L / TJ Karaoke', channel:'TJ KARAOKE'})`);
      await p.until(`Yt.lyrTried.get(findYtSong(state.songs, ${q(ID.L)}).id)==='nodur'`, 6000);
      const s0 = await ytSongOf(p, ID.L);
      const m0 = await marks(p);
      await selYt(p, ID.L);
      const got = await p.until(`/^\\[00:01\\.00\\]/.test(findYtSong(state.songs, ${q(ID.L)}).lyrics||'')`, 10000);
      const s1 = await ytSongOf(p, ID.L);
      const tip = await sawToast(p, /시각 붙은 가사를 넣었어요/, m0, 3000);
      const lines = await p.eval(`(state.lines||[]).filter(l=>String(l.text||'').trim()).length`);
      const qs = ctx.lrcLog.slice(l0).map(x => x.q);
      ok('V9', s0 && !s0.lyrics && got && s1.ytDur === 95 && tip && lines > 0 && qs.every(x => x === 'QA 시험 가사곡 QA가수L'),
        `길이 모를 때는 넣지 않음 → 영상 길이 ${s1?.ytDur}초를 알고 자동 (LRCLIB에 보낸 것 "${[...new Set(qs)].join('", "')}") · 가사 ${lines}줄 · 알림 ${tip}`);
      await p.eval('enterSync()');
      const sy = await p.until('!!state.sync', 5000);
      const m1 = await marks(p);
      await p.eval('setSyncRate(4)');
      const r = await p.eval('state.rate');
      const fr = await sawFlash(p, /2배속까지/, m1, 2500);
      await p.eval('exitSync(false)');
      await p.until('!state.sync', 4000);
      await p.eval('state.rate=1');
      ok('V9', sy && r === 2 && fr, `싱크 편집기 열림 ${sy} · 4배속 → ${r}배속 ("2배속까지예요" ${fr})`);
    });

    await step('폰에서 자동 시작이 막히면 "▶ 눌러서 시작" → 누르면 재생', ['V11'], async () => {
      await stopAll(p); await clearQueue(p);
      await p.eval(`(()=>{ window.__ytBlockAutoplay=true; __ytFake.calls.length=0; const a=findYtSong(state.songs, ${q(ID.A)}); state.queue.push(a.id); saveQueue(); renderQueue(); startNext(); return true })()`);
      const tap = await p.until(`!document.querySelector('#ytTap').hidden`, 7000);
      const blocked = await p.eval(`__ytFake.calls.some(c=>c[0]==='blocked') && !state.playing`);
      const r = await p.rect('#ytTap');
      if (tap) await p.click('#ytTap');
      const on = await p.until('state.playing', 5000);
      ok('V11', tap && blocked && r?.visible && r.w >= 120 && r.h >= 44 && on, `누르지 않은 재생 막힘 ${blocked} → "▶ 눌러서 시작" (${Math.round(r?.w)}×${Math.round(r?.h)}) → 누르면 재생 ${on}`);
      await p.eval('window.__ytBlockAutoplay=false');
      await stopAll(p);
    });

    await step('폰 412×915: 유튜브 탭(열쇠 없음)·재생 화면, 가로 넘침 없음, 영상 칸 200×200 이상', ['V1', 'V6'], async () => {
      await p.emulate(PHONE);
      await sleep(400);
      await p.eval(`ytSetKey(null)`);
      await p.eval(`window.__ytVideos[${q(ID.A)}].dur=300`);   // PC가 바쁠 때 8초 곡이 재는 사이에 끝나지 않게 (CR-251에서 봄)
      await selYt(p, ID.A);
      await p.eval(`openSearch('yt')`);
      await sleep(300);
      const a = await p.eval(`({h:Math.round(document.querySelector('#searchTabYt').getBoundingClientRect().height), share:!!document.querySelector('#searchList .yt-c-share')})`);
      const nh = await noHScroll(p);
      // 창 머리의 닫기(✕)·탭·입력칸이 영상 밑에 깔리지 않고 눌리는지 (가운데를 눌렀을 때 그 요소가 맞는지)
      const reach = () => p.eval(`(()=>{ const sc=document.querySelector('#searchOv'); sc.scrollIntoView({block:'nearest'});
        const ids=['#searchClose','#searchTabMr','#searchTabYt','#searchInput']; const bad=ids.filter(id=>{const e=document.querySelector(id), r=e.getBoundingClientRect();
          const h=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2); return !(h && (h===e || e.contains(h)))}); return {n:ids.length-bad.length, of:ids.length, bad}})()`);
      const r1 = await reach();
      const off1 = await p.eval(`document.querySelector('#ytBox').classList.contains('off')`);
      await shot('yt-phone-search-412x915.png');
      ok('V1', a.h >= 44 && a.share && nh && r1.n === r1.of && off1,
        `폰 유튜브 탭(멈춘 유튜브 곡): 탭 높이 ${a.h} · [공유] 안내 ${a.share} · 멈춘 영상은 창이 열린 동안 숨음 ${off1} · 닫기·탭·입력칸 눌림 ${r1.n}/${r1.of}${r1.bad.length ? ' (' + r1.bad.join(',') + ')' : ''} · 가로 넘침 ${nh ? '없음' : '있음!'}`);
      // 디자인 확인 CR-030 #1·#2: 폰에서 재생 전 곡 검색 창은 무대가 min(600px,78vh)로 길어지고, 줄 단추는 다음 줄(겹침 0, 높이 36), ✕ 48, MR 탭 칸 예시 글
      await p.eval(`ytSetTab('mr')`);
      await sleep(250);
      const g = await p.eval(`(()=>{const st=document.querySelector('#stage').getBoundingClientRect(), l=document.querySelector('#searchList'), lr=l.getBoundingClientRect(), x=document.querySelector('#searchClose').getBoundingClientRect();
        const hit=(a,b)=>a.width&&b.width&&!(a.right<=b.left+0.5||b.right<=a.left+0.5||a.bottom<=b.top+0.5||b.bottom<=a.top+0.5);
        let over=0, minH=99; const rows=[...l.querySelectorAll('.ov-row')];
        for (const r of rows) { const cells=[...r.children].filter(c=>!c.classList.contains('acts')).map(c=>c.getBoundingClientRect()); const bs=[...r.querySelectorAll('.acts .btn')].map(b=>b.getBoundingClientRect());
          for (const b of bs) { minH=Math.min(minH,b.height); for (const c of cells) if (hit(b,c)) over++; } }
        const full=rows.filter(r=>{const b=r.getBoundingClientRect(); return b.top>=lr.top-1&&b.bottom<=lr.bottom+1}).length;
        return {sh:Math.round(st.height), want:Math.round(Math.min(600, innerHeight*.78)), lh:Math.round(lr.height), rows:rows.length, full, over, minH:Math.round(minH), xw:Math.round(x.width), xh:Math.round(x.height),
          ph:document.querySelector('#searchInput').placeholder}})()`);
      ok('V1', Math.abs(g.sh - g.want) <= 2 && g.rows > 0 && g.over === 0 && g.minH >= 36 && g.xw >= 48 && g.xh >= 48 && g.full >= Math.min(5, g.rows) && g.ph === '제목·가수·번호, 초성(ㅂㅍㅈ)으로 찾기',
        `폰 곡 검색(재생 전, MR 탭): 무대 높이 ${g.sh} (= min(600, 78vh) ${g.want}) · 목록 ${g.lh}px에 다 보이는 줄 ${g.full}/${g.rows} · 줄 단추 겹침 ${g.over} · 단추 높이 ${g.minH} · ✕ ${g.xw}×${g.xh} · 칸 예시 "${g.ph}"`);
      await p.eval('closeOverlays()');
      await p.eval(`document.querySelector('#stage').scrollIntoView({block:'start'})`);
      await p.eval('play()');
      await p.until('state.playing', 8000);
      await sleep(400);
      const box = await p.rect('#ytBox'), hits = await boxHits(p), nh2 = await noHScroll(p);
      await shot('yt-phone-play-412x915.png');
      ok('V6', box?.visible && box.w >= 200 && box.h >= 200 && box.x >= 0 && box.x + box.w <= 412 + 1 && hits.n === 5 && nh2,
        `폰 재생: 영상 칸 ${Math.round(box?.w)}×${Math.round(box?.h)} (왼쪽 ${Math.round(box?.x)}) · 5곳 중 ${hits.n}곳 영상 · 가로 넘침 ${nh2 ? '없음' : '있음!'}`);
      // 재생 중에 곡 검색을 열면: 위 영상 · 아래 창 (무대가 창만큼 길어짐), 영상은 그대로 보이고 창은 영상 아래에서 시작
      await p.eval(`openSearch('yt')`);
      await p.until(`document.querySelector('#stage').classList.contains('yt-grow')`, 2000);
      await sleep(300);
      await p.eval(`document.querySelector('#stage').scrollIntoView({block:'start'})`);
      await sleep(200);
      const pb = await p.rect('#ytBox'), pp = await p.rect('#searchOv'), ph = await boxHits(p), r2 = await reach();
      await p.eval(`document.querySelector('#stage').scrollIntoView({block:'start'})`);
      await sleep(150);
      const nh3 = await noHScroll(p), playing2 = await p.eval('state.playing');
      await shot('yt-phone-search-playing-412x915.png');
      ok('V6', pb?.visible && pb.w >= 200 && pb.h >= 200 && pp && pp.y >= pb.y + pb.h - 1 && pp.h >= 360 && ph.n === 5 && r2.n === r2.of && nh3 && playing2,
        `폰 재생 중 곡 검색: 영상 ${Math.round(pb?.w)}×${Math.round(pb?.h)} 위 · 창 ${Math.round(pp?.h)} 높이 아래 (창 위 ${Math.round(pp?.y)} ≥ 영상 아래 ${Math.round(pb?.y + pb?.h)}) · 5곳 중 ${ph.n}곳 영상 · 닫기·탭·입력칸 눌림 ${r2.n}/${r2.of} · 노래 계속 ${playing2}`);
      await p.eval('closeOverlays()');
      const back = await p.until(`!document.querySelector('#stage').classList.contains('yt-grow')`, 2000);
      ok('V6', back, `창을 닫으면 무대가 원래 크기로 ${back}`);
      await stopAll(p);
      await p.eval(`window.__ytVideos[${q(ID.A)}].dur=8`);
      await p.emulate(PC);
      await sleep(300);
    });

    await step('TV 1920×1080: 영상은 위 칸, 아래 68 띠 [곡 검색][예약 목록][일시정지][다음 곡][나가기], 창을 열면 옆으로, 안 되는 키는 띠 안내, N 다음 곡, Esc 순서', ['V12'], async () => {
      await stopAll(p); await clearQueue(p);
      await p.emulate({ name: '1920x1080', width: 1920, height: 1080 });
      await p.eval(`window.__ytVideos[${q(ID.A)}].dur=300`);   // 띠·검색을 보는 동안 곡이 끝나 다음 곡으로 넘어가지 않게
      await selYt(p, ID.A);
      await enterTVNoFs(p);
      const mode = await p.until(`document.querySelector('#tv').classList.contains('yt-mode')`, 4000);
      // TV에서 Space는 예약곡이 있으면 "다음 예약곡 시작"(L 구역 그대로)이라, 예약이 빈 채로 A를 시작한 뒤 C를 예약한다
      await p.key(' ');
      const on = await p.until(`state.playing && state.song.ytId===${q(ID.A)}`, 8000);
      await p.eval(`reserve(findYtSong(state.songs, ${q(ID.C)}), false)`);
      await p.until(`/QA 시험 유튜브 둘/.test(document.querySelector('#ytBandNext').textContent)`, 3000);
      const band0 = await p.eval(`({t:document.querySelector('#ytBandTitle').textContent, n:document.querySelector('#ytBandNext').textContent})`);
      await sleep(600);
      const acts = await p.eval(`['search','queue','pause','start','next','exit','key-','rec','mr+'].map(a=>{const b=document.querySelector('#tvRemote [data-act="'+a+'"]'); const r=b&&b.getBoundingClientRect(); return a+':'+(r&&r.width>0?'보임':'숨김')})`);
      const rm = await p.rect('#tvRemote'), box = await p.rect('#ytBox'), hits = await boxHits(p);
      const vis = Object.fromEntries(acts.map(x => x.split(':')));
      const bandOk = ['search', 'queue', 'pause', 'next', 'exit'].every(a => vis[a] === '보임') && ['start', 'key-', 'rec', 'mr+'].every(a => vis[a] === '숨김');
      ok('V12', mode && on && rm && Math.abs(rm.h - 68) <= 2 && Math.abs(rm.y + rm.h - 1080) <= 2 && rm.w >= 1900 && bandOk && /QA 시험 유튜브 하나/.test(band0.t) && /QA 시험 유튜브 둘/.test(band0.n),
        `띠 ${Math.round(rm?.w)}×${Math.round(rm?.h)} 맨 아래 · 단추 ${acts.join(' ')} · "${band0.t}" "${band0.n}"`);
      ok('V12', box?.visible && box.y + box.h <= rm.y + 1 && box.w >= 1200 && hits.n === 5, `영상 ${Math.round(box?.w)}×${Math.round(box?.h)} 띠 위에만 (영상 아래 ${Math.round(box?.y + box?.h)} ≤ 띠 ${Math.round(rm?.y)}) · 5곳 중 ${hits.n}곳 영상`);
      await p.until(`!document.querySelector('#ytBand').classList.contains('note')`, 4000);   // 사진은 띠 안내(3초)가 지나 제목이 보일 때
      await shot('yt-tv-band-1920x1080.png');
      await p.eval(`toast('QA 시험 아래 알림')`);
      const tn = await p.until(`document.querySelector('#ytBand').classList.contains('note') && /QA 시험 아래 알림/.test(document.querySelector('.yt-band-note').textContent)`, 2000);
      const tHid = await p.eval(`document.querySelector('#toast').hidden`);
      ok('V12', tn && tHid, `아래 알림(toast)도 띠 안으로 ${tn} · 띠 제목·영상 위에 따로 뜬 알림 ${tHid ? '없음' : '있음!'}`);
      await p.key(',');
      const note = await p.until(`document.querySelector('#ytBand').classList.contains('note') && /키를 바꿀 수 없어요/.test(document.querySelector('.yt-band-note').textContent)`, 2500);
      const flashOn = await p.eval(`!document.querySelector('#flash').hidden && /키를 바꿀/.test(document.querySelector('#flash').textContent)`);
      ok('V12', note && !flashOn, `안 되는 키(,) → 띠 안 안내 ${note} · 영상 위 가운데 알림 ${flashOn ? '뜸!' : '없음'}`);
      await p.eval(`ytSetKey(${q(KEY)})`);
      await p.key('s');
      await p.until(`!document.querySelector('#searchOv').hidden`, 3000);
      await p.key('Tab');
      await p.type('QA 시험 유튜브');
      await p.key('Enter');
      await p.until(`document.querySelectorAll('#searchList .yt-row').length>=2`, 8000);
      await sleep(300);
      const sb = await p.rect('#ytBox'), sp = await p.rect('#searchOv'), split = await p.eval(`document.querySelector('#stage').classList.contains('yt-split')`);
      await shot('yt-tv-search-1920x1080.png');
      ok('V12', split && sb?.visible && sb.w >= 200 && sb.h >= 200 && sb.x + sb.w <= 960 + 2 && sp && sp.x >= sb.x + sb.w - 1 && (await p.eval('state.playing')),
        `곡 검색(S)을 열면 영상은 왼쪽 ${Math.round(sb?.w)}×${Math.round(sb?.h)}, 창은 오른쪽 (창 왼쪽 ${Math.round(sp?.x)}) · 노래 계속`);
      await p.key('Escape');
      const esc1 = await p.until(`document.querySelector('#searchOv').hidden`, 2000);
      const still = await p.eval('state.playing');
      await p.key('n');
      const nx = await p.until(`state.song && state.song.ytId===${q(ID.C)} && state.playing`, 8000);
      const nxWhy = nx ? '' : ' ' + await p.eval(`JSON.stringify({calls:__ytFake.calls.slice(-10), st:Yt.st, want:Yt.wantPlay, err:Yt.err, loaded:Yt.loaded, q:state.queue.length, tap:!document.querySelector('#ytTap')?.hidden})`);
      await p.key('Escape');
      const esc2 = await p.until(`!state.playing && /취소/.test(document.querySelector('.yt-band-note').textContent)`, 3000);
      ok('V12', esc1 && still && nx && esc2, `Esc ① 창만 닫음 (노래 계속 ${still}) · N → 다음 곡 "${(await p.eval('state.song.title'))}" ${nx}${nxWhy} · Esc ② 곡 취소 (띠에 "취소") ${esc2}`);
      await p.key('t');
      const out = await p.until(`document.querySelector('#tv').hidden || !state.tv`, 3000);
      await sleep(200);
      ok('V12', out && !(await p.eval(`document.querySelector('#tv').classList.contains('yt-mode') && !document.querySelector('#tv').hidden`)), `T → TV 화면 나감 ${out}`);
      await p.eval('ytSetKey(null)');
      await stopAll(p);
      await p.emulate(PC);
      await sleep(300);
    });

    await step('설정 "프리미엄 계정으로 틀기 (이 기기만)" (CR-251 ②): 켜면 host www.youtube.com·플레이어 다시 만듦·멈춘 채 다시 올림·알림·이 기기 열쇠만·백업에 없음, 끄면 nocookie', ['V13'], async () => {
      await stopAll(p); await clearQueue(p);
      await p.emulate(PC);
      await p.eval(`window.__ytVideos[${q(ID.A)}].dur=300`);   // 보는 동안 곡이 끝나지 않게
      await selYt(p, ID.A);
      await p.eval('play()');
      const on = await p.until(`state.playing && state.song.ytId===${q(ID.A)}`, 8000);
      await sleep(1200);
      const openSet = async () => { if (!(await p.eval(`document.querySelector('#cloudDialog').open`))) { await p.click('#settingsBtn'); await p.until(`document.querySelector('#cloudDialog').open`, 3000); } await p.scrollTo('#ytSec'); };
      await openSet();
      const s0 = await p.eval(`(()=>{const sec=document.querySelector('#ytSec'), c=document.querySelector('#ytWww');
        return {inAdv:document.querySelector('#advBox').contains(sec), prev:sec.previousElementSibling && sec.previousElementSibling.id, vis:sec.getBoundingClientRect().height>0, checked:c.checked, role:c.getAttribute('role'),
          name:sec.querySelector('.guest-sw b').textContent, sub:document.querySelector('#ytWwwSub').textContent, ls:localStorage.getItem('nb-yt-www'), host:__ytFake.host, n:__ytFake.players.length, calls:__ytFake.calls.length}})()`);
      ok('V13', on && s0.inAdv && s0.prev === 'remoteSec' && s0.vis && !s0.checked && s0.role === 'switch' && s0.name === '프리미엄 계정으로 틀기 (이 기기만)' && /^꺼짐/.test(s0.sub) && s0.ls === null && s0.host === 'https://www.youtube-nocookie.com',
        `설정 › 더 보기 (고급) › 유튜브 곡 (앞 #${s0.prev}) "${s0.name}" 꺼짐 · "${s0.sub}" · 저장 ${s0.ls} · host ${s0.host}`);
      const m0 = await marks(p);
      await p.click('#ytWww');
      const rebuilt = await p.until(`__ytFake.players.length>${s0.n} && Yt.loaded===${q(ID.A)} && Yt.st===5 && Yt.ready`, 6000);
      const tip = await sawToast(p, /유튜브 로그인 정보\(쿠키\)를 써요\. 광고가 계속 나오면 다시 꺼 주세요/, m0, 3000);
      await sleep(200);
      const s1 = await p.eval(`({ls:localStorage.getItem('nb-yt-www'), host:__ytFake.host, n:__ytFake.players.length, destroyed:__ytFake.calls.slice(${s0.calls}).some(c=>c[0]==='destroy'), oldDead:__ytFake.players[${s0.n - 1}].dead===true,
        playing:state.playing, want:Yt.wantPlay, plays:__ytFake.calls.slice(${s0.calls}).filter(c=>c[0]==='play').length, off:state.offset, sub:document.querySelector('#ytWwwSub').textContent, checked:document.querySelector('#ytWww').checked,
        frames:document.querySelectorAll('#ytFrame .fake-yt').length})`);
      await shot('cr251-settings-www-on-1280x800.png');
      ok('V13', rebuilt && tip && s1.ls === '1' && s1.host === 'https://www.youtube.com' && s1.n === s0.n + 1 && s1.destroyed && s1.oldDead && !s1.playing && !s1.want && !s1.plays && s1.checked && /^켜짐/.test(s1.sub) && s1.frames === 1 && s1.off > 0.5,
        `켬 → 저장 nb-yt-www=${s1.ls} · host ${s1.host} · 플레이어 ${s0.n}→${s1.n}개 (옛 것 destroy ${s1.destroyed}) · 재생 중이던 곡은 멈춘 채 다시 올림 (재생 ${s1.playing}, 자동 재생 ${s1.plays}번, 자리 ${s1.off.toFixed(1)}초) · 알림 ${tip} · "${s1.sub}"`);
      // 다시 재생하면 새 플레이어로 그 자리부터
      await p.eval(`document.querySelector('#cloudDialog').close()`);
      await p.eval('play()');
      const on2 = await p.until(`state.playing && Yt.st===1`, 6000);
      const t2 = await p.eval('curTime()');
      await p.eval('pause()');
      await p.until('!state.playing', 3000);
      // 백업 파일: 받기를 가로채서 머리(JSON)에 이 설정이 없는지
      const bk = await p.eval(`(async()=>{ const d0=window.download; let got=null; window.download=(f)=>{ got=f; };
        try { await exportBackup(); } finally { window.download=d0; }
        if (!got) return {ok:false}; const { head } = await unpackBackup(got); const j=JSON.stringify(head); return {ok:true, www:/yt-www|www\\.youtube\\.com/.test(j), keys:Object.keys(head).join(',')} })()`);
      ok('V13', on2 && t2 >= s1.off - 0.5 && bk.ok && !bk.www, `다시 재생 → 새 플레이어로 ${t2.toFixed(1)}초부터 ${on2} · 백업 파일 머리(${bk.keys})에 이 설정 ${bk.www ? '있음!' : '없음'}`);
      // 끄기 → nocookie로 다시, 열쇠 지움
      await openSet();
      const m1 = await marks(p), n1 = await p.eval('__ytFake.players.length');
      await p.click('#ytWww');
      const back = await p.until(`__ytFake.players.length>${n1} && Yt.loaded===${q(ID.A)} && Yt.st===5 && Yt.ready`, 6000);
      const tip2 = await sawToast(p, /유튜브 기본 플레이어로 돌아왔어요/, m1, 3000);
      const s2 = await p.eval(`({ls:localStorage.getItem('nb-yt-www'), host:__ytFake.host, www:Yt.www, sub:document.querySelector('#ytWwwSub').textContent, checked:document.querySelector('#ytWww').checked})`);
      ok('V13', back && tip2 && s2.ls === null && s2.host === 'https://www.youtube-nocookie.com' && !s2.www && !s2.checked && /^꺼짐/.test(s2.sub),
        `끔 → host ${s2.host} · 저장 ${s2.ls === null ? '지움' : s2.ls + '!'} · 알림 ${tip2} · "${s2.sub}"`);
      await p.eval(`document.querySelector('#cloudDialog').close()`);
      await p.eval(`window.__ytVideos[${q(ID.A)}].dur=8`);
      await stopAll(p);
    });

    await step('폰 유튜브 [공유] → 노래방: 주소 ?title=&text= → 확인 창 → [예약] · 주소 칸 지움 · manifest share_target · 공유 주소는 저장 안 함', ['V3'], async () => {
      await stopAll(p); await clearQueue(p);
      const share = `${ctx.base}/index.html?title=${encodeURIComponent('QA 시험 공유곡 - QA가수S')}&text=${encodeURIComponent('https://youtu.be/' + ID.S)}`;
      await p.goto(share, READY_DEMO, 150000);
      await prep();
      const open = await p.until(`document.querySelector('#ytShareDialog').open`, 5000);
      const d = await p.eval(`({t:document.querySelector('#ytShareTitle').textContent, search:location.search, list:!document.querySelector('#ytShareList').hidden})`);
      ok('V3', open && d.t === 'QA 시험 공유곡 · QA가수S' && d.search === '' && d.list, `확인 창 "${d.t}" · 주소 칸 지움 (남은 것 "${d.search}")`);
      await p.click('#ytShareReserve');
      await p.until(`(()=>{const s=findYtSong(state.songs, ${q(ID.S)}); return !!s && state.queue.includes(s.id)})()`, 5000);
      const s = await ytSongOf(p, ID.S);
      ok('V3', !!s && s.title === 'QA 시험 공유곡' && s.artist === 'QA가수S' && s.queued, s ? `[예약] → ${s.no}번 "${s.title}" · ${s.artist} 넣고 예약` : '곡이 안 생김');
      const man = JSON.parse(fs.readFileSync(path.join(ctx.ROOT, 'manifest.webmanifest'), 'utf8'));
      let old = null; try { old = JSON.parse(execFileSync('git', ['-C', ctx.ROOT, 'show', 'main:manifest.webmanifest'], { encoding: 'utf8' })); } catch {}
      const st = man.share_target || {};
      const same = !old || (old.start_url === man.start_url && old.scope === man.scope && JSON.stringify(old.shortcuts) === JSON.stringify(man.shortcuts));
      ok('V3', st.action === './' && st.method === 'GET' && st.params?.title === 'title' && st.params?.text === 'text' && st.params?.url === 'url' && same,
        `share_target ${st.method} "${st.action}" (title·text·url) · start_url·scope·바로가기 그대로 ${same}${old ? '' : ' (main과 비교 못 함)'}`);
      const cached = await p.eval(`(async()=>{ if(!self.caches) return false; for (const k of await caches.keys()) { const c=await caches.open(k); if ((await c.keys()).some(r=>/[?&](title|text|url)=/.test(r.url))) return true; } return false })()`);
      const sw = fs.readFileSync(path.join(ctx.ROOT, 'sw.js'), 'utf8');
      ok('V3', !cached && /title|text|url/.test(sw), `공유 주소는 서비스 워커 저장소에 ${cached ? '있음!' : '없음'}`);
    });
  } finally {
    // 정리: 만든 유튜브 곡·예약·♡·부른 횟수·점수, 가짜 window.open, 열쇠
    try {
      await stopAll(p);
      await p.emulate(PC);
      await p.eval(`(async()=>{ window.__ytBlockAutoplay=false; ytSetKey(null); if (window.__ytOpen0) window.open = window.__ytOpen0;
        if (Yt.www) ytSetWww(false); localStorage.removeItem('nb-yt-www');   // CR-251 ② 설정은 꺼진 채로
        const gone = state.songs.filter(s=>isYtSong(s)), ids = new Set(gone.map(s=>s.id));
        state.queue = state.queue.filter(id=>!ids.has(id)); saveQueue(); renderQueue();
        for (const pr of Profiles.list) if (pr.favorites) pr.favorites = pr.favorites.filter(id=>!ids.has(id));
        try { saveProfiles(me()); } catch {}
        for (const id of ids) delete plays[id];
        try { localStorage.setItem('nb-plays', JSON.stringify(plays)); } catch {}
        for (const s of gone) { try { await DB.del('songs', s.id); } catch {} }
        state.songs = state.songs.filter(s=>!ids.has(s.id));
        if (!state.song || ids.has(state.song.id)) await selectSong(state.songs.find(s=>s.demo) || state.songs[0]);
        renderSongs(); return gone.length })()`);
      await p.until('state.song && !!state.song.buffer', 15000);
      ctx.ytRules.length = 0;
      ctx.lrcRules.splice(0, ctx.lrcRules.length, ...ctx.lrcRules.filter(r => !/QA 시험 가사곡/.test(r.q)));
    } catch (e) { ctx.log(`  ! 유튜브 점검 정리 중 오류: ${e.message}`); }
  }
}
