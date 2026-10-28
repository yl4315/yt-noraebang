// 스크린샷 (기획안 4장): 관리 화면 11 × (PC 1280·폰 412) + TV 화면 10 × (TV 1920·폰 가로 915) + 휴대폰 리모컨 6 (폰 412)
// + CR-003·CR-017 새 화면 (화면 숫자판 2, 터치 "⋯ 더 보기" 1, 여러 곡 넣기 창 2, 가사 없는 곡 찾기 창 2) = 55장.
// 매번 같은 사진이 나오게: 따로 켠 빈 Edge에 고정 시험 데이터를 넣고, 시각을 2026-10-24(토) 20:30으로 멈추고('움직임 줄이기' 흉내로 조명도 멈춤),
// 리모컨 코드는 2580·와이파이 주소는 문서용 가짜 주소. 알림(toast)은 찍기 전에 숨기고, 글 칸 커서는 투명하게.
// 화면을 그 상태로 만들 때는 앱 함수를 직접 부르기도 한다 (사진만 찍는 단계. 기능 확인은 다른 점검들이 화면을 눌러서 한다).
import fs from 'node:fs';
import path from 'node:path';
import { PC, TV, PHONE, PHONE_L, SPY, READY_DEMO, sleep, q, wavB64 } from './_lib.mjs';
import { LRC_LONG, LRC_SHORT, PLAIN, PLAIN4, cand } from '../fixtures.mjs';
import { pngSize } from '../compare.mjs';

const FIX = new Date(2026, 9, 24, 20, 30, 0).getTime();
const FREEZE = `(() => { const FIX=${FIX}, D=Date; class FD extends D { constructor(...a){ super(...(a.length?a:[FIX])); } static now(){ return FIX; } } window.Date=FD; })();`;
const STYLE = `document.addEventListener('DOMContentLoaded',()=>{ const s=document.createElement('style'); s.textContent='*{caret-color:transparent !important}'; document.head.append(s); });`;

export default async function shots(ctx) {
  const out = [], dir = ctx.shotsDir;
  fs.mkdirSync(dir, { recursive: true });
  const b = await ctx.newBrowser();
  const fx = ctx.fx;
  const open = async (size, url, ready = READY_DEMO) => {
    const p = await b.newPage();
    for (const source of [SPY, FREEZE, STYLE]) await p.s('Page.addScriptToEvaluateOnNewDocument', { source });
    await p.emulate(size);
    await p.media([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await p.goto(url, ready, 150000);
    await p.eval('document.fonts.ready');
    await p.move(2, 2);
    return p;
  };
  const shot = async (p, num, name, size, extra = {}) => {
    await p.eval(`(()=>{ const t=document.querySelector('#toast'); if(t) t.hidden=true; const f=document.querySelector('#flash'); if(f && !${!!extra.keepFlash}) f.hidden=true; document.activeElement && document.activeElement.blur && !${!!extra.keepFocus} && document.activeElement.blur(); })()`).catch(() => {});
    await p.eval('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    await sleep(extra.wait ?? 450);
    const file = `${String(num).padStart(2, '0')}-${name}-${size.name}.png`;
    const buf = await p.shot(path.join(dir, file));
    const { width: w, height: h } = pngSize(buf);
    const masks = extra.mask ? await p.eval(`[${extra.mask.map(s => q(s)).join(',')}].map(s=>document.querySelector(s)).filter(Boolean).map(e=>{const r=e.getBoundingClientRect(); return [Math.floor(r.x),Math.floor(r.y),Math.ceil(r.width)+1,Math.ceil(r.height)+1]})`) : [];
    const hs = await p.eval('document.documentElement.scrollWidth <= innerWidth + 1');
    out.push({ file, w, h, want: `${size.width}×${size.height}`, ok: w === size.width && h === size.height, hscroll: !hs, masks });
    ctx.log(`  사진 ${file}${w === size.width && h === size.height ? '' : ` (크기 다름 ${w}×${h})`}${hs ? '' : ' (가로 스크롤 있음)'}`);
  };
  const step = async (title, fn) => { try { await fn(); } catch (e) { ctx.log(`  ! 사진 단계 실패 (${title}): ${e.message}`); ctx.common(`스크린샷: ${title}`, false, e.message); } };

  try {
    // 고정 시험 데이터 넣기
    const seed = await open(PC, ctx.base + '/index.html');
    const w = { long: wavB64(fx.tagged), short: wavB64(fx.short), plain: wavB64(fx.plain), nolyr: wavB64(fx.nolyr), edit: wavB64(fx.edit) };
    await seed.eval(`(async()=>{
      const blob=b64=>{ const bin=atob(b64), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return new Blob([u],{type:'audio/wav'}); };
      const W=${q(w)}, T=${FIX};
      const songs=[
        {id:'qa-s1',no:10002,title:'QA 시험 노래',artist:'QA가수',lyrics:${q(LRC_LONG)},blob:blob(W.long)},
        {id:'qa-s2',no:10003,title:'QA 시험 시간없는가사',artist:'QA가수',lyrics:${q(PLAIN)},blob:blob(W.plain)},
        {id:'qa-s3',no:10004,title:'QA 시험 가사없음',artist:'QA가수',lyrics:'',blob:blob(W.nolyr)},
        {id:'qa-s4',no:10005,title:'QA 시험 짧은 곡',artist:'QA가수',lyrics:${q(LRC_SHORT)},blob:blob(W.short)},
        {id:'qa-s5',no:10006,title:'QA 시험 Drive에만',artist:'QA가수',lyrics:${q(LRC_SHORT)},blob:null,fileId:'qa-file-1',size:52000},
        {id:'qa-s6',no:10007,title:'QA 시험 편집',artist:'QA가수',lyrics:${q(PLAIN4)},blob:blob(W.edit)},
        {id:'qa-s7',no:10008,title:'QA 시험 가사없음 둘',artist:'',lyrics:'',blob:blob(W.nolyr)},
      ];
      for (const s of songs) await DB.put('songs', {lyricOffset:0, createdAt:T, updatedAt:T, mime:'audio/wav', size:s.blob?s.blob.size:s.size, video:false, videoLyrics:false, ...s});
      const sr=48000, n=sr*3, pcm=new Int16Array(n); for(let i=0;i<n;i++) pcm[i]=Math.round(3000*Math.sin(i/20));
      const mix={offset:120,vocal:80,mr:80,echo:25,reverb:35};
      await DB.put('recs',{id:'qa-r1',v:2,title:'QA 시험 짧은 곡',artist:'QA가수',songId:'qa-s4',createdAt:T,updatedAt:T,duration:3,score:88,sr,vocal:new Blob([pcm.buffer]),parts:[{at:0,offset:0,dur:3,key:0}],mix});
      await DB.put('recs',{id:'qa-r2',v:2,title:'QA 시험 노래',artist:'QA가수',songId:'qa-s1',createdAt:T-3600e3,updatedAt:T,duration:3,score:null,sr,vocal:new Blob([pcm.buffer]),parts:[],mix});
      await DB.put('recs',{id:'qa-r3',v:2,title:'QA 시험 지운 곡',artist:'QA가수',songId:'qa-gone',createdAt:T-7200e3,updatedAt:T,duration:3,score:76,sr,vocal:new Blob([pcm.buffer]),parts:[{at:0,offset:0,dur:3,key:0}],mix});
      localStorage.setItem('nb-profiles', JSON.stringify([
        {id:'qa-me',name:'나',favorites:['qa-s1','qa-s4'],playlists:[{id:'qa-pl1',name:'QA 신나는 목록',songs:['qa-s1','qa-s2']},{id:'qa-pl2',name:'QA 빈 목록',songs:[]}],updatedAt:T},
        {id:'qa-mom',name:'QA엄마',favorites:['qa-s2'],playlists:[],updatedAt:T}]));
      localStorage.setItem('nb-profile','qa-me');
      localStorage.setItem('nb-plays', JSON.stringify({'qa-s1':{n:5,last:T},'demo':{n:3,last:T-1},'qa-s4':{n:2,last:T-2}}));
      localStorage.setItem('nb-scores', JSON.stringify([{id:'qa-s4',no:10005,title:'QA 시험 짧은 곡',score:88,at:T,who:'나'},{id:'qa-s1',no:10002,title:'QA 시험 노래',score:91,at:T-60e3,who:'QA엄마'}]));
      localStorage.setItem('nb-queue', JSON.stringify(['qa-s1','qa-s4','demo']));
    })()`);
    await seed.close();

    // ---------- 관리 화면 11 × 2 ----------
    for (const size of [PC, PHONE]) {
      const p = await open(size, ctx.base + '/index.html');
      await p.until(`!!document.querySelector('#remoteSet img.qr') || ${ctx.conds.W === false}`, 8000);
      const touch = !!size.touch;
      await step('곡 목록', async () => { await p.eval(`showTab('songs'); window.scrollTo(0,0)`); await shot(p, 1, 'songs', size); });
      await step('내 목록', async () => { await p.eval(`showTab('mine'); window.scrollTo(0,0)`); if (touch) await p.eval(`document.querySelector('.side').scrollIntoView({block:'start'})`); await shot(p, 2, 'mine', size); });
      await step('내 녹음', async () => { await p.eval(`showTab('recs'); window.scrollTo(0,0)`); if (touch) await p.eval(`document.querySelector('.side').scrollIntoView({block:'start'})`); await shot(p, 3, 'recs', size); await p.eval(`showTab('songs'); window.scrollTo(0,0)`); });
      await step('곡 추가 창', async () => { await p.eval('openSongDialog()'); await shot(p, 4, 'add-dialog', size); await p.eval(`document.querySelector('#songDialog').close()`); });
      await step('곡 수정 창 (가사·가사 찾기 결과)', async () => {
        ctx.lrcRules.length = 0;
        ctx.lrcRules.push({ q: '^QA 시험 노래', body: [cand(901, 'QA 시험 노래', 'QA가수', 12), cand(902, 'QA 시험 노래 (Live)', 'QA가수', 200), cand(903, 'QA 시험 노래', '다른 가수', 180, false)] });
        await p.eval(`openSongDialog(songById('qa-s1'))`);
        await p.click('#lrcFind');
        await p.until(`!document.querySelector('#lrcResults').hidden`, 8000);
        await p.eval(`document.querySelector('#songDialog form').scrollTop=0`);
        await shot(p, 5, 'edit-dialog', size);
        await p.eval(`document.querySelector('#songDialog').close()`);
      });
      await step('설정 창', async () => { await p.eval('openCloudDialog()'); await p.until(`document.querySelector('#storeTxt').textContent.length>0`, 3000); await p.eval(`document.querySelector('#cloudDialog .mix').scrollTop=0`); await shot(p, 6, 'settings', size); await p.eval(`document.querySelector('#cloudDialog').close()`); });
      await step('사용자 창', async () => { await p.eval('openProfiles()'); await shot(p, 7, 'profiles', size); await p.eval(`document.querySelector('#profileDialog').close()`); });
      await step('재생목록 창', async () => { await p.eval(`openPlPick(songById('qa-s1'))`); await shot(p, 8, 'playlist', size); await p.eval(`document.querySelector('#plDialog').close()`); });
      await step('싱크·믹스 조절 창', async () => { await p.eval(`openMix(state.recs.find(r=>r.id==='qa-r1'))`); await sleep(500); await shot(p, 9, 'mix', size); await p.eval(`document.querySelector('#mixDialog').close()`); });
      await step('가사 싱크 편집기', async () => {
        await p.eval(`selectSong(songById('qa-s6'))`); await p.until(`state.song.id==='qa-s6' && !!state.song.buffer`, 10000);
        await p.eval('enterSync()'); await sleep(400);
        await p.eval(`document.querySelector('#syncPanel').scrollIntoView({block:'start'})`);
        await shot(p, 10, 'sync-editor', size);
        await p.eval('exitSync(false)');
        await p.eval(`selectSong(songById('demo'))`); await p.until(`state.song.demo && !!state.song.buffer`, 10000);
      });
      await step('아래 조작부 (음향 설정 펼침)', async () => {
        await p.eval(`document.querySelector('#deckMore').open=true; document.querySelector('#deck').scrollIntoView({block:'start'})`);
        await shot(p, 11, 'deck', size);
        await p.eval('window.scrollTo(0,0)');
      });
      // CR-017 새 화면: 여러 곡 넣기 창, 가사 없는 곡 찾기 창
      await step('여러 곡 넣기 창', async () => {
        ctx.lrcRules.length = 0;
        ctx.lrcRules.push(
          { q: '^QA가수A QA 시험 첫째$', body: [cand(911, 'QA 시험 첫째', 'QA가수A', 3)] },
          { q: '^QA 시험 둘째', body: [cand(912, 'QA 시험 둘째', 'QA가수B', 3, false), cand(913, 'QA 시험 둘째 (Live)', 'QA가수B', 3, false)] },
          { q: '^QA 시험 셋째 QA가수C$', body: [cand(914, 'QA 시험 셋째', 'QA가수C', 3)] },
          { q: '.*', body: [] });
        await p.click('#addSongBtn');
        await p.setFiles('#f-file', [...fx.bulk, ...fx.notMedia]);
        await p.until(`document.querySelector('#bulkDialog').open`, 4000);
        await p.until('!Bulk.running', 30000, 200);
        await p.eval(`document.querySelector('#blkList').scrollTop=0`);
        await shot(p, 30, 'bulk', size);
        await p.eval(`document.querySelector('#bulkDialog').close()`); await sleep(300);
      });
      await step('가사 없는 곡 찾기 창', async () => {
        ctx.lrcRules.length = 0;
        ctx.lrcRules.push({ q: '^QA 시험 가사없음 QA가수$', body: [cand(921, 'QA 시험 가사없음', 'QA가수', 3)] }, { q: '.*', body: [] });
        await p.click('#missBtn');
        await p.until(`document.querySelector('#bulkDialog').open`, 4000);
        await p.until('!Bulk.running', 30000, 200);
        await shot(p, 31, 'missing-lyrics', size);
        await p.eval(`document.querySelector('#bulkDialog').close()`); await sleep(300);
      });
      await p.close();
    }

    // ---------- TV 화면 10 × 2 (+ 숫자판, 터치 "⋯ 더 보기") ----------
    for (const size of [TV, PHONE_L]) {
      const p = await open(size, ctx.base + '/index.html');
      await p.until(`!!document.querySelector('#remoteInfo img.qr') || ${ctx.conds.W === false}`, 8000);
      const touch = !!size.touch;
      // 반주 시계를 멈춘 채 원하는 시각에 둔다 (같은 사진이 나오게)
      const freezeAt = async t => {
        await p.until('state.playing', 5000);
        await p.eval(`(async()=>{ await E.ctx.suspend(); state.offset=${t}; state.when=E.ctx.currentTime; state.rate=1; pokeUI(); })()`);
        await sleep(300);
      };
      const idle = async () => { await p.eval(`(async()=>{ if(E.ctx && E.ctx.state==='suspended') await E.ctx.resume(); cancelNext(); stopPlayback(); hideScore(); closeOverlays(); numBuf=''; updateNumBox(); state.queue=['qa-s1','qa-s4','demo']; saveQueue(); renderQueue(); if(!state.tv) await enterTV(); pokeUI(); })()`); await sleep(300); };
      await idle();
      if (await p.eval('!!document.fullscreenElement')) await p.eval('document.exitFullscreen()');
      await step('TV 대기 화면', async () => { await idle(); await shot(p, 12, 'tv-idle', size, { mask: ['#clock'] }); });
      await step('제목 카드', async () => { await idle(); await p.eval(`state.queue=[]; renderQueue(); selectSong(songById('demo')).then(()=>{ state.offset=0; play(); })`); await freezeAt(1.0); await shot(p, 13, 'tv-title-card', size); });
      await step('가사 두 줄', async () => { await p.eval(`(async()=>{ await E.ctx.resume(); })()`); await freezeAt(6.5); await shot(p, 14, 'tv-lyrics', size); });
      await step('번호 상자', async () => { for (const k of '10001') await p.key(k); await p.eval('pokeUI()'); await shot(p, 15, 'tv-number-box', size, { wait: 300 }); await p.eval(`numBuf=''; updateNumBox()`); });
      await step('곡 검색 창', async () => { await p.eval(`openSearch(); document.querySelector('#searchInput').value='QA'; runSearch(); pokeUI()`); await shot(p, 16, 'tv-search', size); await p.eval('closeOverlays()'); });
      await step('예약 목록 창', async () => { await p.eval(`state.queue=['qa-s1','qa-s4','demo']; renderQueue(); openQueue(); pokeUI()`); await shot(p, 17, 'tv-queue', size); await p.eval('closeOverlays()'); });
      await step('인기차트 창', async () => { await p.eval(`openChart(); pokeUI()`); await shot(p, 18, 'tv-chart', size); await p.eval('closeOverlays()'); });
      await step('내 목록 창', async () => { await p.eval(`openMineOv(); pokeUI()`); await shot(p, 19, 'tv-mine', size); await p.eval('closeOverlays()'); });
      await step('다음 곡 카운트다운', async () => {
        await p.eval(`(async()=>{ await E.ctx.resume(); stopPlayback(); state.queue=['qa-s1']; renderQueue(); scheduleNext(5000); pokeUI(); })()`);
        await shot(p, 20, 'tv-next', size, { wait: 250 });
        await p.eval('cancelNext()');
      });
      await step('점수 창', async () => { await p.eval(`showScore(92, true); pokeUI()`); await shot(p, 21, 'tv-score', size); await p.eval('hideScore()'); });
      await step('화면 숫자판', async () => {
        await idle();
        await p.eval(`openNumPad(false); for (const k of '10001') numKey(k); pokeUI()`);
        await shot(p, 28, 'tv-number-pad', size);
        await p.eval('cancelNumPad()');
      });
      if (touch) await step('터치 "⋯ 더 보기"', async () => { await idle(); await p.eval(`setMore(true); pokeUI()`); await shot(p, 29, 'tv-touch-more', size); await p.eval('setMore(false)'); });
      await p.eval('exitTV()');
      await p.close();
    }

    // ---------- 휴대폰 리모컨 6 ----------
    {
      const p = await open(PHONE, ctx.base + '/remote.html', 'document.readyState==="complete"');
      await p.eval(`localStorage.removeItem('yt-remote-pin'); localStorage.removeItem('nb-remote-a2hs')`);
      await p.goto(ctx.base + '/remote.html', `!document.querySelector('#pinView').hidden`);
      await step('코드 넣기', async () => { await shot(p, 22, 'remote-pin', PHONE); });
      // PC 화면(노래방 본체)이 있어야 상태가 오니, PC 탭을 하나 켜 둔다
      const pc = await open(PC, ctx.base + '/index.html');
      await pc.eval(`state.queue=['qa-s1','qa-s4','demo']; saveQueue(); renderQueue()`);
      await p.goto(ctx.base + '/remote.html?pin=2580', `!document.querySelector('#app').hidden && document.querySelector('#conn span').textContent==='연결됨'`);
      await sleep(1200);
      await step('홈 화면 추가 안내', async () => { await shot(p, 27, 'remote-a2hs', PHONE); });
      await p.eval(`document.querySelector('#a2hsClose').click()`);
      await step('리모컨 탭', async () => { await p.eval(`tab('remote'); window.scrollTo(0,0)`); await shot(p, 23, 'remote-buttons', PHONE); });
      await step('검색 탭', async () => { await p.eval(`tab('search'); document.querySelector('#q').value='QA'; renderSearch(); window.scrollTo(0,0)`); await shot(p, 24, 'remote-search', PHONE); });
      await step('예약 탭', async () => { await p.eval(`tab('queue'); window.scrollTo(0,0)`); await shot(p, 25, 'remote-queue', PHONE); });
      await step('내 목록 탭', async () => { await p.eval(`tab('mine'); window.scrollTo(0,0)`); await shot(p, 26, 'remote-mine', PHONE); });
      await pc.close();
      await p.close();
    }
  } finally {
    await b.closeAll();
  }
  out.sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify(out, null, 1));
  ctx.common(`스크린샷 ${out.length}장 (55장 기대)`, out.length === 55, out.length === 55 ? '' : `${out.length}장`);
  ctx.common('스크린샷 폭·높이가 정한 크기와 같음', out.every(s => s.ok), out.filter(s => !s.ok).map(s => s.file).join(', '));
  const phoneH = out.filter(s => /412x915|915x412/.test(s.file) && s.hscroll);
  ctx.common('폰 크기 화면에 가로 스크롤 없음 (문서 폭 = 화면 폭)', !phoneH.length, phoneH.map(s => s.file).join(', '));
  return out;
}
