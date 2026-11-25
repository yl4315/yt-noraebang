// CR-244: 유튜브 재생목록 넣기 (V 구역, V14~V17). 검색 창 유튜브 탭에 재생목록 링크(list=)를 붙이면 미리 보기 카드 → [곡 목록에 다 넣기] (예약은 안 함).
// 진짜 유튜브에 닿지 않는다: 열쇠 없는 길은 tests/ui/fake-yt.js의 가짜 플레이어(window.__ytLists), 열쇠 길은 run.mjs가 가로챈 Data API playlistItems·videos
// (ctx.ytListApi 가짜 답), 검색 순서(금영 먼저)는 ctx.ytRules 가짜 검색 답. 열쇠는 가짜(ctx.ytFakeKey)만, 화면·저장소·기록에 그 글자가 없는지도 본다.
// 만든 곡(영상 번호 QAl…)·설정(nb-yt-www)·가짜 답은 끝에 지운다. 예약은 건드리지 않는다 (예약 목록이 그대로인지도 본다).
import path from 'node:path';
import { PC, READY_DEMO, q, marks, sawToast, sleep, stopAll, noHScroll } from './_lib.mjs';
export const areas = ['V'];

const KY = 'UCDqaUIUSJP5EVMEI178Zfag', TJ = 'UCZUhx8ClCv6paFW7qi3qljg';
const vid = (t, n) => 'QAl' + t + String(n).padStart(7, '0');   // 11글자 가짜 영상 번호 (QAl…은 이 점검이 만든 것)
const range = (t, a, b) => Array.from({ length: b - a + 1 }, (_, i) => vid(t, a + i));
const HAVE = vid('h', 1);   // 곡 목록에 미리 넣어 두는 곡 (목록에 있으면 건너뜀)
const PL = {
  NK: 'PLqaNoKey0001',    // 열쇠 없는 길 (가짜 플레이어)
  MISS: 'PLqaMissing01',  // 처음엔 없는 목록 (오류 → [다시 해 보기])
  WWW: 'PLqaWww000001',   // 프리미엄 설정을 켠 채
  BIGP: 'PLqaBigPlay01',  // 열쇠 없이 230개 (플레이어는 200개까지)
  K: 'PLqaKey000001',     // 열쇠 길
  KP: 'PLqaKeyPhone1',    // 열쇠 길 (폰 사진)
  Q: 'PLqaQuota0001',     // 열쇠 길인데 한도(403) → 열쇠 없는 길
  B: 'PLqaBig000001',     // 열쇠 길 230개
  S: 'PLqaShare0001',     // 폰 [공유]
};
const NK_IDS = [vid('n', 1), HAVE, ...range('n', 2, 4)];
// 가짜 플레이어가 줄 목록 (열쇠 없는 길). late = 목록 번호가 늦게 옴 (읽는 동안의 카드·플레이어 칸을 보려고)
const LISTS = {
  [PL.NK]: { ids: NK_IDS, late: 900 },
  [PL.WWW]: { ids: [vid('w', 1)] },
  [PL.BIGP]: { ids: range('b', 1, 230) },
  [PL.Q]: { ids: range('q', 1, 2) },
  [PL.S]: { ids: range('s', 1, 2) },
};
const VIDEOS = { [NK_IDS[0]]: { title: '[TJ노래방] QA 재생목록 첫 곡 - QA가수N / TJ Karaoke', author: 'TJ KARAOKE', dur: 30 } };
// 열쇠 길 가짜 답 (playlistItems·videos)
const K_IDS = [vid('k', 1), HAVE, vid('k', 2), vid('k', 3), vid('k', 4), vid('k', 5), vid('k', 6)];
const KP_IDS = [vid('p', 1), vid('p', 2), vid('p', 3), vid('p', 4), vid('p', 5)];
const API = {
  [PL.K]: { ids: K_IDS, priv: [vid('k', 6)] },
  [PL.KP]: { ids: KP_IDS },
  [PL.Q]: { status: 403, reason: 'quotaExceeded' },
  [PL.B]: { ids: range('c', 1, 230) },
};
const BLOCKED = new Set([vid('k', 2), vid('k', 4), vid('p', 2), vid('p', 4)]);   // 퍼가기 막힘 (embeddable false)
const GONE = new Set([vid('k', 5)]);                                             // videos 답에 없음 (지움)
const TITLE = v => `[KY 금영노래방] QA 재생목록 ${v.slice(-2)} - QA가수K / KY Karaoke`;
function api(kind, sp) {
  if (kind === 'playlistItems') {
    const L = API[sp.get('playlistId')];
    if (!L) return null;
    if (L.status) return { status: L.status, body: { error: { code: L.status, errors: [{ reason: L.reason }] } } };
    const start = +(sp.get('pageToken') || 0), n = +(sp.get('maxResults') || 50), part = L.ids.slice(start, start + n);
    return { status: 200, body: { nextPageToken: start + part.length < L.ids.length ? String(start + part.length) : undefined, pageInfo: { totalResults: L.ids.length },
      items: part.map(v => ({ contentDetails: { videoId: v }, status: { privacyStatus: (L.priv || []).includes(v) ? 'private' : 'public' } })) } };
  }
  const ids = (sp.get('id') || '').split(',').filter(Boolean);
  return { status: 200, body: { items: ids.filter(v => !GONE.has(v)).map(v => ({ id: v, snippet: { title: TITLE(v), channelTitle: 'KY Karaoke', channelId: KY },
    status: { embeddable: !BLOCKED.has(v), privacyStatus: 'public', uploadStatus: 'processed' } })) } };
}
// 열쇠 검색 가짜 답 (금영 먼저): TJ·그 밖·금영이 섞인 순서
const ORD = { T1: vid('t', 1), O1: vid('o', 1), K1: vid('y', 1), T2: vid('t', 2), K2: vid('y', 2) };
const sItem = (v, ch, title, chTitle) => ({ id: { videoId: v }, snippet: { title, channelTitle: chTitle, channelId: ch, thumbnails: { medium: { url: `https://i.ytimg.com/vi/${v}/mqdefault.jpg` } } } });
const ORDER_SEARCH = { items: [
  sItem(ORD.T1, TJ, '[TJ노래방] QA 순서 하나 - QA가수 / TJ Karaoke', 'TJ KARAOKE'),
  sItem(ORD.O1, 'UCqaOther0000000000000a', 'QA 순서 둘 노래방', 'QA 노래방'),
  sItem(ORD.K1, KY, '[KY 금영노래방] QA 순서 셋 - QA가수 / KY Karaoke', 'KY Karaoke'),
  sItem(ORD.T2, TJ, '[TJ노래방] QA 순서 넷 - QA가수 / TJ Karaoke', 'TJ KARAOKE'),
  sItem(ORD.K2, KY, '[KY 금영노래방] QA 순서 다섯 - QA가수 / KY Karaoke', 'KY Karaoke'),
] };

const setInput = (p, v) => p.eval(`(()=>{const i=document.querySelector('#searchInput'); i.value=${q(v)}; i.dispatchEvent(new Event('input')); i.focus(); return true})()`);
// 카드 읽기: 제목 · 줄 · 스위치 · 작은 글 · 단추
const card = p => p.eval(`(()=>{const c=document.querySelector('#searchList .yt-c-list'); if(!c) return null; const sw=c.querySelector('.yt-list-sw input'), b=c.querySelector('.yt-guide-btns button');
  const r=e=>{if(!e) return null; const x=e.getBoundingClientRect(); return {w:Math.round(x.width), h:Math.round(x.height), l:Math.round(x.left), r:Math.round(x.right)}};
  return {cls:c.className, head:(c.querySelector('.yt-card-h')||{}).textContent||'', lines:[...c.querySelectorAll('.yt-card-l')].map(x=>x.textContent), small:(c.querySelector('.yt-card-s')||{}).textContent||'',
    sw: sw ? {on:sw.checked, label:sw.parentNode.textContent.trim(), row:r(sw.parentNode)} : null, btn: b ? {text:b.textContent, primary:b.classList.contains('primary'), disabled:b.disabled, box:r(b)} : null,
    box:r(c), idx:[...c.parentNode.children].indexOf(c)}})()`);
const cues = (p, id) => p.eval(`__ytFake.calls.filter(c=>c[0]==='cueList' && c[1]===${q(id)}).length`);
const songOf = (p, v) => p.eval(`(()=>{const s=findYtSong(state.songs, ${q(v)}); return s ? {no:s.no, title:s.title, artist:s.artist, source:s.source, queued:state.queue.includes(s.id)} : null})()`);
const active = p => p.eval(`(()=>{const a=document.activeElement; return a===document.querySelector('#searchInput') ? 'input' : a && a.dataset && a.dataset.k ? a.dataset.k : a ? a.tagName : ''})()`);

export default async function ytlist(ctx) {
  const { ok, step } = ctx, p = ctx.p, KEY = ctx.ytFakeKey;
  const shot = async name => { try { await p.shot(path.join(ctx.shotsDir, name)); ctx.log(`  (사진 shots/${name})`); } catch (e) { ctx.log(`  (사진 못 찍음 ${name}: ${e.message})`); } };
  // 가짜 플레이어 API(__ytFake)는 처음 부를 때 받아 온다 (앞 점검이 새로 연 화면이면 아직 없음) → 먼저 불러 둔다
  const prep = (reset = true) => p.eval(`(async()=>{ try { await ytLoadApi(); } catch {} window.__ytOpened=[]; if(!window.__ytOpen0) window.__ytOpen0=window.open; window.open=(u)=>{ window.__ytOpened.push(String(u)); return null; };
    window.__ytVideos=Object.assign(window.__ytVideos||{}, ${q(VIDEOS)}); window.__ytLists=Object.assign(window.__ytLists||{}, ${q(LISTS)}); window.__ytBlockAutoplay=false;
    if (${reset}) { ytSetKey(null); Yt.keyBlocked=false; YtList.cache.clear(); ytListClose(); Yt.cache.clear(); } return true })()`);
  const rule0 = ctx.ytRules.length;
  ctx.ytListApi = api;
  const l0 = ctx.ytListLog.length;
  await stopAll(p);
  await p.emulate(PC);
  await prep();
  // 곡 목록에 미리 있는 곡 하나 (예약 없이)
  await p.eval(`ytAdd(${q(HAVE)}, { title: 'QA 재생목록 있던 곡 - QA가수H' })`);
  await p.until(`!!findYtSong(state.songs, ${q(HAVE)})`, 5000);

  try {
    await step('열쇠 없이: 재생목록 링크 → 읽는 동안 보이는 플레이어 칸(nocookie·틀지 않음) → "재생목록 5곡" · 있는 곡 건너뜀 · 제목은 틀 때 · 예약은 안 해요 → [곡 목록에 다 넣기] → 알림 · 예약 그대로 · 플레이어·칸 없앰', ['V14'], async () => {
      await p.eval(`openSearch('yt')`);
      const m0 = await marks(p), q0 = await p.eval('JSON.stringify(state.queue)'), c0 = await p.eval('__ytFake.calls.length');
      await setInput(p, `https://youtube.com/playlist?list=${PL.NK}&si=qaCopy`);
      const busy = await p.until(`!!document.querySelector('#searchList .yt-c-list-busy') && !!document.querySelector('.yt-list-box .fake-yt')`, 4000);
      const bx = await p.eval(`(()=>{const b=document.querySelector('.yt-list-box'); if(!b) return null; const r=b.getBoundingClientRect(); return {w:Math.round(r.width), h:Math.round(r.height), after:b.previousElementSibling===document.querySelector('#searchList'), shown:r.width>0&&r.height>0}})()`);
      const head0 = (await card(p))?.head || '';
      ok('V14', busy && bx && bx.shown && bx.h >= 200 && bx.w >= 200 && bx.after && head0 === '재생목록을 읽는 중…',
        `읽는 동안: 카드 "${head0}" · 플레이어 칸 ${bx ? `${bx.w}×${bx.h} 검색 목록 바로 뒤 ${bx.after}` : '없음!'}`);
      const ready = await p.until(`!!document.querySelector('#searchList .yt-c-list-ready')`, 10000);
      const c = await card(p);
      ok('V14', ready && c.head === '재생목록 5곡' && c.lines.includes('곡 목록에 있는 1곡은 건너뛰어요') && c.lines.includes('제목은 틀 때 보여요') && !c.sw &&
        c.small === '예약은 안 해요' && c.btn?.text === '곡 목록에 다 넣기' && c.btn.primary && !c.btn.disabled,
        `카드 "${c?.head}" · ${c?.lines.join(' / ')} · 작은 글 "${c?.small}" · 단추 [${c?.btn?.text}]`);
      const pl = await p.eval(`(()=>{const F=__ytFake, mine=F.players.filter(x=>x.list===${q(PL.NK)}), later=F.calls.slice(${c0});
        return {n:mine.length, host:mine.map(x=>x.o.host), gone:mine.every(x=>x.gone), box:document.querySelectorAll('.yt-list-box').length, play:later.filter(c=>c[0]==='play'||c[0]==='cue').length, obj:later.filter(c=>c[0]==='cueList').map(c=>c[2])}})()`);
      ok('V14', pl.n === 1 && pl.host[0] === 'https://www.youtube-nocookie.com' && pl.gone && pl.box === 0 && pl.play === 0 && pl.obj.join() === 'obj',
        `목록 플레이어 ${pl.n}개 (host ${pl.host.join()}) · 읽고 없앰 ${pl.gone} · 칸 ${pl.box}개 남음 · 재생·올리기 ${pl.play}번`);
      await shot('cr244-pc1280-preview.png');
      await p.click('#searchList .yt-c-list [data-k="add"]');
      const t = await sawToast(p, /^4곡 넣었어요 · 있던 1곡 건너뜀$/, m0, 6000);
      const songs = await Promise.all(NK_IDS.map(v => songOf(p, v)));
      const q1 = await p.eval('JSON.stringify(state.queue)');
      const first = songs[0];
      ok('V14', t && songs.every(Boolean) && songs.every(s => s.source === 'yt' && !s.queued) && q1 === q0 && first.title === 'QA 재생목록 첫 곡' && first.artist === 'QA가수N' &&
        songs.slice(2).every((s, i) => s.title === '유튜브 영상 ' + NK_IDS[i + 2]),
        `알림 "4곡 넣었어요 · 있던 1곡 건너뜀" ${t} · 새 곡 ${songs.filter(Boolean).length - 1}개 (첫 곡 "${first?.title}" · ${first?.artist}, 나머지 "유튜브 영상 …") · 예약 목록 그대로 ${q1 === q0}`);
      const done = await p.until(`!!document.querySelector('#searchList .yt-c-list-done')`, 4000);
      const d = await card(p);
      ok('V14', done && d.lines[0] === '4곡 넣었어요 · 있던 1곡 건너뜀' && d.btn?.text === '다 넣었어요' && d.btn.disabled && d.small === '곡 목록에서 골라 예약해요',
        `다 넣은 뒤 카드: "${d?.lines.join(' / ')}" · [${d?.btn?.text}] 막힘 ${d?.btn?.disabled} · "${d?.small}"`);
      await shot('cr244-done.png');
    });

    await step('링크 모양: 영상+목록은 영상 줄 아래 카드(다시 안 읽음) · 영상에 붙은 자동 믹스는 영상만 · 내 목록(WL)·믹스(RD)는 안내 · 못 읽은 목록은 또 읽지 않고 [다시 해 보기] · 200곡 한도 · 프리미엄 설정이면 www', ['V14'], async () => {
      const n0 = await cues(p, PL.NK);
      await setInput(p, `https://www.youtube.com/watch?v=${vid('v', 1)}&list=${PL.NK}&index=2`);
      await p.until(`!!document.querySelector('#searchList .yt-row') && !!document.querySelector('#searchList .yt-c-list-ready')`, 4000);
      const c = await card(p);
      const row = await p.eval(`(()=>{const r=document.querySelector('#searchList .yt-row'); return {idx:[...r.parentNode.children].indexOf(r), btns:[...r.querySelectorAll('.acts button')].map(b=>b.textContent)}})()`);
      ok('V14', !!c && row.idx === 0 && c.idx > row.idx && row.btns.join('/') === '예약하기/곡 목록에만' && c.head === '재생목록 5곡' && (await cues(p, PL.NK)) === n0,
        `영상+목록 링크: 영상 줄(${row.btns.join('·')}) 아래에 카드 "${c?.head}" · 목록 다시 읽음 ${(await cues(p, PL.NK)) - n0}번`);
      await setInput(p, `https://www.youtube.com/watch?v=${vid('v', 2)}&list=RD${vid('v', 2)}&start_radio=1`);
      await p.until(`!!document.querySelector('#searchList .yt-row')`, 3000);
      const mix = await p.eval(`({row:!!document.querySelector('#searchList .yt-row'), list:!!document.querySelector('#searchList .yt-c-list')})`);
      ok('V14', mix.row && !mix.list, `영상 링크에 자동 믹스(RD) → 영상 줄만 ${mix.row && !mix.list}`);
      await setInput(p, 'https://www.youtube.com/playlist?list=WL');
      await p.until(`!!document.querySelector('#searchList .yt-c-list-bad')`, 3000);
      const wl = await card(p), notLink = await p.eval(`!!document.querySelector('#searchList .yt-c-bad')`);
      await setInput(p, 'https://www.youtube.com/playlist?list=RDqaMix0001');
      await p.until(`/자동으로 만든 믹스/.test((document.querySelector('#searchList .yt-c-list-bad')||{}).textContent||'')`, 3000);
      const rd = await card(p);
      ok('V14', wl?.head === '이 재생목록은 넣을 수 없어요' && /나중에 볼 동영상/.test(wl.lines[0]) && !wl.btn && !notLink && rd?.head === '이 재생목록은 넣을 수 없어요' && /자동으로 만든 믹스/.test(rd.lines[0]) && !rd.btn,
        `내 목록(WL) "${wl?.lines[0]}" · 믹스(RD) "${rd?.lines[0]}" · 단추 없음 · "유튜브 링크가 아니에요"로 안 봄`);
      // 없는 목록 → 오류 카드 · 다시 그려도 또 읽지 않음 · [다시 해 보기]
      await setInput(p, `https://www.youtube.com/playlist?list=${PL.MISS}`);
      const err = await p.until(`!!document.querySelector('#searchList .yt-c-list-err')`, 10000);
      const e1 = await card(p);
      await p.eval(`renderYtTab()`); await sleep(2000); await p.eval(`renderYtTab()`);
      const once = await cues(p, PL.MISS);
      await p.eval(`window.__ytLists[${q(PL.MISS)}] = { ids: ${q(range('m', 1, 3))} }`);
      await p.click('#searchList .yt-c-list [data-k="retry"]');
      const back = await p.until(`/재생목록 3곡/.test((document.querySelector('#searchList .yt-c-list-ready .yt-card-h')||{}).textContent||'')`, 10000);
      ok('V14', err && e1.head === '재생목록을 읽지 못했어요' && /비공개 목록이거나/.test(e1.lines[0]) && e1.btn?.text === '다시 해 보기' && once === 1 && back && (await cues(p, PL.MISS)) === 2,
        `없는 목록 → "${e1?.head}" · "${e1?.lines[0]}" · 다시 그려도 읽은 수 ${once}번 · [다시 해 보기] → 다시 읽음 ${back}`);
      // 열쇠 없이 230개 → 플레이어는 200개 → "앞 200곡만"
      await setInput(p, `https://www.youtube.com/playlist?list=${PL.BIGP}`);
      await p.until(`!!document.querySelector('#searchList .yt-c-list-ready')`, 10000);
      const big = await card(p), bigAdd = await p.eval(`ytListPlanOf(YtList.st).add.length`);
      ok('V14', big.head === '재생목록 200곡' && big.lines.includes('앞 200곡만 넣어요') && bigAdd === 200, `열쇠 없이 230개 목록 → "${big.head}" · "${big.lines.join(' / ')}" · 넣을 곡 ${bigAdd}`);
      // 프리미엄 계정으로 틀기(CR-251 ②)를 켜면 목록 플레이어도 www.youtube.com
      await p.eval(`ytSetWww(true)`);
      await setInput(p, `https://www.youtube.com/playlist?list=${PL.WWW}`);
      await p.until(`!!document.querySelector('#searchList .yt-c-list-ready')`, 10000);
      const hw = await p.eval(`__ytFake.players.filter(x=>x.list===${q(PL.WWW)}).map(x=>x.o.host)`);
      await p.eval(`ytSetWww(false)`);
      ok('V14', hw.length === 1 && hw[0] === 'https://www.youtube.com', `설정을 켠 채 목록 플레이어 host ${hw.join()} (끄면 nocookie — 위 첫 목록)`);
    });

    await step('열쇠 길: playlistItems·videos로 제목·퍼가기 됨을 미리 → "2곡은 노래방 안에서 못 틀어요 (유튜브 앱에서는 돼요)" 기본 빼고 [그 곡도 넣기] 스위치 · 지운·비공개 곡은 뺌 · 리모컨 ↑↓ · 한도(403)면 열쇠 없는 길 · 230개 = 8번 · 열쇠 글자 없음', ['V15'], async () => {
      await p.eval(`ytSetKey(${q(KEY)}); Yt.keyBlocked=false; ytSetTab('yt', true)`);
      const m0 = await marks(p), c0 = await cues(p, PL.K), lg = ctx.ytListLog.length;
      await setInput(p, `https://www.youtube.com/playlist?list=${PL.K}`);
      await p.until(`!!document.querySelector('#searchList .yt-c-list-ready')`, 10000);
      const c = await card(p);
      const calls = ctx.ytListLog.slice(lg);
      ok('V15', c.head === '재생목록 5곡' && c.lines.join('|') === '곡 목록에 있는 1곡은 건너뛰어요|2곡은 노래방 안에서 못 틀어요 (유튜브 앱에서는 돼요)|지웠거나 비공개인 2곡은 빼요' &&
        c.sw && !c.sw.on && c.sw.label === '그 곡도 넣기' && c.btn?.text === '곡 목록에 다 넣기' && !c.btn.disabled &&
        calls.map(x => x.kind).join() === 'playlistItems,videos' && calls.every(x => x.key === '가짜 열쇠' && x.status === 200) && (await cues(p, PL.K)) === c0,
        `카드 "${c.head}" · ${c.lines.join(' / ')} · 스위치 [${c.sw?.label}] ${c.sw?.on ? '켜짐!' : '꺼짐'} · 부른 것 ${calls.map(x => x.kind + '(' + x.key + ')').join(', ')} · 플레이어 안 씀`);
      // 리모컨: 검색 칸 ↓ → 스위치 → ↓ 단추 → ↑ 스위치 → ↑ 검색 칸 · 칸에서 Enter는 [곡 목록에 다 넣기]로 옮기기만 (바로 넣지 않음)
      const nSongs = await p.eval('state.songs.length');
      await p.eval(`document.querySelector('#searchInput').focus()`);
      const path1 = [];
      for (const k of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp']) { await p.key(k); path1.push(await active(p)); }
      await p.key('Enter'); const afterEnter = await active(p);
      const same = (await p.eval('state.songs.length')) === nSongs;
      ok('V15', path1.join('>') === 'sw>add>sw>input' && afterEnter === 'add' && same, `리모컨 키: 검색 칸 ↓↓↑↑ → ${path1.join(' > ')} · Enter → ${afterEnter} (곡 수 그대로 ${same})`);
      // 스위치: 켜면 4곡, 끄면 2곡 (다시 그려도 스위치에 그대로)
      await p.click('#searchList .yt-list-sw input');
      const on = await p.eval(`({on:document.querySelector('#searchList .yt-list-sw input').checked, add:ytListPlanOf(YtList.st).add.length, f:document.activeElement===document.querySelector('#searchList .yt-list-sw input')})`);
      await p.click('#searchList .yt-list-sw input');
      const off = await p.eval(`({on:document.querySelector('#searchList .yt-list-sw input').checked, add:ytListPlanOf(YtList.st).add.length})`);
      ok('V15', on.on && on.add === 4 && on.f && !off.on && off.add === 2, `[그 곡도 넣기] 켜면 넣을 곡 ${on.add} (스위치에 그대로 ${on.f}) · 끄면 ${off.add}`);
      await p.click('#searchList .yt-c-list [data-k="add"]');
      const t = await sawToast(p, /^2곡 넣었어요 · 있던 1곡 건너뜀 · 못 트는 2곡 뺌$/, m0, 6000);
      const k1 = await songOf(p, vid('k', 1)), k3 = await songOf(p, vid('k', 3)), k2 = await songOf(p, vid('k', 2)), k5 = await songOf(p, vid('k', 5));
      await p.until(`!!document.querySelector('#searchList .yt-c-list-done')`, 4000);
      const d = await card(p);
      ok('V15', t && k1 && k3 && !k2 && !k5 && /QA 재생목록 01/.test(k1.title) && k1.title !== '유튜브 영상 ' + vid('k', 1) && !k1.queued && d.sw && !d.sw.on && d.btn?.text === '다 넣었어요',
        `알림 "2곡 넣었어요 · 있던 1곡 건너뜀 · 못 트는 2곡 뺌" ${t} · 제목 "${k1?.title}" · 못 트는 곡·지운 곡 안 넣음 · 다 넣은 뒤에도 스위치 남음 ${!!d.sw}`);
      // 한도(403) → Yt.keyBlocked · 열쇠 없는 길(가짜 플레이어)로 같은 목록
      const lq = ctx.ytListLog.length;
      await setInput(p, `https://www.youtube.com/playlist?list=${PL.Q}`);
      await p.until(`!!document.querySelector('#searchList .yt-c-list-ready')`, 10000);
      const cq = await card(p), blocked = await p.eval('Yt.keyBlocked'), qcalls = ctx.ytListLog.slice(lq);
      ok('V15', blocked && cq.head === '재생목록 2곡' && cq.lines.includes('제목은 틀 때 보여요') && qcalls.length === 1 && qcalls[0].status === 403 && (await cues(p, PL.Q)) === 1,
        `한도(403) → 열쇠 없는 길: "${cq.head}" · "${cq.lines.join(' / ')}" · Yt.keyBlocked ${blocked}`);
      await p.eval(`Yt.keyBlocked=false`);
      // 230개: 50개씩 4쪽(200개) + videos 4번 = 8번 · "재생목록 230곡" · 앞 200곡만
      const lb = ctx.ytListLog.length;
      await setInput(p, `https://www.youtube.com/playlist?list=${PL.B}`);
      await p.until(`!!document.querySelector('#searchList .yt-c-list-ready')`, 10000);
      const cb = await card(p), bAdd = await p.eval(`ytListPlanOf(YtList.st).add.length`), bcalls = ctx.ytListLog.slice(lb);
      ok('V15', cb.head === '재생목록 230곡' && cb.lines.includes('앞 200곡만 넣어요') && bAdd === 200 && bcalls.length === 8 && bcalls.filter(x => x.kind === 'videos').every(x => x.n <= 50),
        `230개 목록 → "${cb.head}" · "${cb.lines.join(' / ')}" · 넣을 곡 ${bAdd} · 부른 수 ${bcalls.length}번 (playlistItems ${bcalls.filter(x => x.kind === 'playlistItems').length} · videos ${bcalls.filter(x => x.kind === 'videos').length})`);
      const leak = await p.eval(`(async()=>{ const k=${q(KEY)}; const html=document.documentElement.outerHTML.includes(k);
        let ls=false; for(let i=0;i<localStorage.length;i++){const n=localStorage.key(i); if((n+(localStorage.getItem(n)||'')).includes(k)) ls=true;}
        let ss=false; for(let i=0;i<sessionStorage.length;i++){const n=sessionStorage.key(i); if((n+(sessionStorage.getItem(n)||'')).includes(k)) ss=true;}
        const db=JSON.stringify(await DB.all('songs')).includes(k), cache=JSON.stringify([...YtList.cache.values()]).includes(k)||JSON.stringify(YtList.st||{}).includes(k);
        return {html, ls, ss, db, cache}})()`);
      const logs = JSON.stringify(ctx.netLog).includes(KEY) || JSON.stringify(ctx.ytListLog).includes(KEY);
      ok('V15', !leak.html && !leak.ls && !leak.ss && !leak.db && !leak.cache && !logs,
        `열쇠 글자: 화면 ${leak.html ? '있음!' : '없음'} · localStorage ${leak.ls ? '있음!' : '없음'} · sessionStorage ${leak.ss ? '있음!' : '없음'} · 곡 저장소 ${leak.db ? '있음!' : '없음'} · 읽은 목록 ${leak.cache ? '있음!' : '없음'} · 점검 기록 ${logs ? '있음!' : '없음'}`);
    });

    await step('폰 390×844: 열쇠 길 미리 보기 + 못 트는 곡 안내 · 스위치 줄·단추 44 넘게 · 카드가 화면 안 · 가로 넘침 없음', ['V14', 'V15'], async () => {
      await stopAll(p);
      await p.emulate({ name: '390x844', width: 390, height: 844, mobile: true, touch: true });
      await p.eval(`openSearch('yt')`);
      await p.eval(`ytSetKey(${q(KEY)}); Yt.keyBlocked=false`);
      await setInput(p, `https://www.youtube.com/playlist?list=${PL.KP}`);
      await p.until(`!!document.querySelector('#searchList .yt-c-list-ready')`, 10000);
      await p.eval(`document.activeElement && document.activeElement.blur(); document.querySelector('#searchList .yt-c-list').scrollIntoView({block:'nearest'})`);
      await sleep(300);
      const c = await card(p), h = await noHScroll(p), vw = await p.eval('innerWidth');
      ok('V14', c.btn && c.btn.box.h >= 44 && c.btn.box.w >= 44 && c.box.l >= 0 && c.box.r <= vw && h,
        `폰 390: [${c.btn?.text}] ${c.btn?.box.w}×${c.btn?.box.h} · 카드 ${c.box.l}~${c.box.r} (화면 ${vw}) · 가로 스크롤 ${h ? '없음' : '있음!'}`);
      ok('V15', c.sw && c.sw.row.h >= 44 && c.lines.includes('2곡은 노래방 안에서 못 틀어요 (유튜브 앱에서는 돼요)') && !c.sw.on,
        `폰 390: 안내 "${c.lines.find(x => /못 틀어요/.test(x))}" · [그 곡도 넣기] 줄 ${c.sw?.row.w}×${c.sw?.row.h} (누르는 곳 = 줄 전체)`);
      await shot('cr244-phone390-preview.png');
      await p.eval('ytSetKey(null)');
      await stopAll(p);
      await p.emulate(PC);
    });

    await step('열쇠 검색 순서: 금영 공식 채널 영상만 앞으로 (순서만 · TJ·그 밖은 받은 순서 그대로 · 빼는 것 없음)', ['V16'], async () => {
      ctx.ytRules.push({ q: 'QA 금영 순서', body: ORDER_SEARCH });
      await p.eval(`openSearch('yt')`);
      await p.eval(`ytSetKey(${q(KEY)}); Yt.keyBlocked=false; ytSetTab('yt', true)`);
      await setInput(p, 'QA 금영 순서');
      await p.key('Enter');
      const got = await p.until(`Yt.rows.length===5`, 6000);
      const ids = await p.eval(`Yt.rows.map(r=>r.id)`);
      const dom = await p.eval(`[...document.querySelectorAll('#searchList .yt-row .yt-t')].map(x=>x.textContent)`);
      const want = [ORD.K1, ORD.K2, ORD.T1, ORD.O1, ORD.T2];
      ok('V16', got && ids.join() === want.join() && dom.length === 5 && /QA 순서 셋/.test(dom[0]) && /QA 순서 다섯/.test(dom[1]) && /QA 순서 하나/.test(dom[2]),
        `받은 순서 TJ·그 밖·금영·TJ·금영 → 보이는 순서 ${dom.map(x => x.replace(/^.*QA 순서 (\S+).*$/, '$1')).join(' · ')} (5개 다 있음)`);
      await p.eval('ytSetKey(null)');
      await stopAll(p);
    });

    await step('폰 유튜브 [공유] → 노래방으로 재생목록: 주소 ?text=…playlist?list= → 유튜브 탭에 미리 보기 카드 · 검색 칸에 깨끗한 목록 링크 · 주소 칸 지움 · 영상 확인 창은 안 뜸', ['V17'], async () => {
      const { identifier } = await p.s('Page.addScriptToEvaluateOnNewDocument', { source: `window.__ytLists=${q(LISTS)};` });
      const share = `${ctx.base}/index.html?title=${encodeURIComponent('QA 재생목록 공유')}&text=${encodeURIComponent(`https://youtube.com/playlist?list=${PL.S}&si=qaShare`)}`;
      try { await p.goto(share, READY_DEMO, 150000); }
      finally { await p.s('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {}); }
      await prep(false);
      const shown = await p.until(`!document.querySelector('#searchOv').hidden && Yt.tab==='yt' && !!document.querySelector('#searchList .yt-c-list-ready')`, 15000);
      const d = await p.eval(`({v:document.querySelector('#searchInput').value, search:location.search, dlg:document.querySelector('#ytShareDialog').open})`);
      const c = await card(p);
      ok('V17', shown && d.v === `https://www.youtube.com/playlist?list=${PL.S}` && d.search === '' && !d.dlg && c?.head === '재생목록 2곡' && c.btn?.text === '곡 목록에 다 넣기',
        `공유 → 검색 창 유튜브 탭 카드 "${c?.head}" · 검색 칸 "${d.v.replace(PL.S, '(목록)')}" · 주소 칸 남은 것 "${d.search}" · 영상 확인 창 ${d.dlg ? '뜸!' : '안 뜸'}`);
      await stopAll(p);
    });
  } finally {
    // 정리: 만든 곡(QAl…)·가짜 window.open·열쇠·설정·가짜 답. 예약·♡·부른 횟수는 건드리지 않았지만 같이 거른다
    try {
      await stopAll(p);
      await p.emulate(PC);
      const n = await p.eval(`(async()=>{ ytSetKey(null); Yt.keyBlocked=false; if (window.__ytOpen0) window.open = window.__ytOpen0;
        if (Yt.www) ytSetWww(false); localStorage.removeItem('nb-yt-www');
        if (typeof ytListClose==='function') ytListClose(); if (typeof YtList==='object') YtList.cache.clear(); Yt.cache.clear();
        const gone = state.songs.filter(s=>isYtSong(s) && /^QAl/.test(s.ytId||'')), ids = new Set(gone.map(s=>s.id));
        state.queue = state.queue.filter(id=>!ids.has(id)); saveQueue(); renderQueue();
        for (const pr of Profiles.list) if (pr.favorites) pr.favorites = pr.favorites.filter(id=>!ids.has(id));
        for (const id of ids) delete plays[id];
        for (const s of gone) { try { await DB.del('songs', s.id); } catch {} }
        state.songs = state.songs.filter(s=>!ids.has(s.id));
        if (!state.song || ids.has(state.song.id)) await selectSong(state.songs.find(s=>s.demo) || state.songs[0]);
        renderSongs(); return gone.length })()`);
      ctx.log(`  (정리: 만든 유튜브 곡 ${n}개 지움)`);
      await p.until('state.song && !!state.song.buffer', 15000);
    } catch (e) { ctx.log(`  ! 재생목록 점검 정리 중 오류: ${e.message}`); }
    ctx.ytRules.splice(rule0);
    ctx.ytListApi = null;
    ctx.log(`  (가짜 Data API 부름 ${ctx.ytListLog.length - l0}번 · 진짜 유튜브 0)`);
  }
}
