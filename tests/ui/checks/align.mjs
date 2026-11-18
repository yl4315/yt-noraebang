// CR-227 2단계 W7·W8: 집 AI 가사 정렬을 노래방이 부른다 (여기서는 가짜 MR 창 tests/ui/fake-mr, 다른 포트 = 다른 origin).
// W7: 창이 MR을 만들며 같이 맞출 가사를 묻고(lyrics_req → lyrics), 만든 MR과 같은 차례의 시각(files.lrc)을 보낸다 → 여러 곡 넣기 창
// W8: [원곡 파일로 자동 싱크] → 같은 이름 창(yena-mr) → align_req → 창에서 원곡 파일 고르기 → aligned → 곡에 넣기 (low·이미 시각 있음은 물음)
// 집 AI·진짜 LRCLIB·허브에는 요청하지 않는다. 가사는 만든 시험 글만, 소리는 시험 사인파(fixtures)만.
import fs from 'node:fs';
import path from 'node:path';
import { seedSong, selectById, visible, marks, sawToast, sleep, q, stopAll } from './_lib.mjs';
import { LRC_SHORT, PLAIN } from '../fixtures.mjs';
export const areas = ['W'];

// 집 AI가 맞췄다고 흉내 낸 시각 (PLAIN과 같은 줄)
const LRC_AI = ['[00:00.40]QA 시험 시간 없는 첫 줄', '[00:01.40]QA 시험 시간 없는 둘째 줄', '[00:02.40]QA 시험 시간 없는 셋째 줄'].join('\n');
const LRC_AI2 = ['[00:00.30]QA 시험 하나', '[00:01.30]QA 시험 둘', '[00:02.30]QA 시험 셋'].join('\n');
const PLAIN_OUT = 'QA 시험 바깥 첫 줄\nQA 시험 바깥 둘째 줄';
const T = {   // 노래방 말 (core.js ALIGN_ERR_TEXT · autosync.js SYNC_TEXT와 같아야 함)
  aligning: '집 AI가 맞추는 중', aligned: '집 AI가 가사 시각을 맞췄어요', skip: '맞춘 가사 시각을 넣지 않았어요',
  no_vocals: '목소리가 없는 파일이에요(MR). 원곡 파일을 골라 주세요',
  no_match: '가사와 노래 소리가 맞지 않아 시각을 못 붙였어요',
  bad_lyrics: '가사를 읽지 못했어요 · 곡 수정에서 가사 글을 확인해 주세요',
  other: '가사 시각을 못 맞췄어요 · 잠시 뒤 다시 해 주세요',
  unreachable: '집 AI에 닿지 않아요 · 집에 가면 다시 해요',
  no_align: '집 AI가 아직 가사 시각 맞추기를 못 해요',
  closed: 'MR 만들기 창이 닫혔어요 · 다시 누르면 이어서 해요',
  blocked: '새 창이 막혔어요. 주소창 오른쪽에서 이 사이트의 팝업을 허용해 주세요',
  changed: '맞추는 사이에 가사를 고쳐서 넣지 않았어요 · 다시 눌러 주세요',
  low: '가사 시각이 많이 틀릴 수 있어요. 넣을까요?', over: '이미 시각이 있는 가사예요. 바꿀까요?',
};

/** 노래방이 연 창(탭)을 주소로 찾아 CDP로 붙는다 (mr.mjs와 같음) */
async function attachPopup(ctx, prefix, ms = 10000) {
  const b = ctx.browser, t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const { targetInfos } = await b.send('Target.getTargets');
    const t = targetInfos.find(x => x.type === 'page' && x.url.startsWith(prefix));
    if (t) {
      const { sessionId } = await b.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
      const ev = async expr => {
        const r = await b.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
        if (r.exceptionDetails) throw new Error('가짜 창 안 오류: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]);
        return r.result.value;
      };
      const until = async (expr, wait = 6000) => { const s0 = Date.now(); while (Date.now() - s0 < wait) { try { if (await ev(expr)) return true; } catch {} await sleep(100); } return false; };
      return { targetId: t.targetId, url: t.url, ev, until, detach: () => b.send('Target.detachFromTarget', { sessionId }).catch(() => {}) };
    }
    await sleep(150);
  }
  return null;
}
async function closePopups(ctx, prefix) {
  for (const t of (await ctx.browser.send('Target.getTargets')).targetInfos) if (t.type === 'page' && t.url.startsWith(prefix)) await ctx.browser.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
  await ctx.p.eval(`Mr.win=null; Mr.linked=false; Mr.caps=[]; clearTimeout(Mr.timer); mrHideMsg(); Align.want.clear(); clearInterval(Align.watch); Align.watch=0`);
  await sleep(200);
}
const bulkRows = p => p.eval(`({open:document.querySelector('#bulkDialog').open, info:document.querySelector('#blkInfo').hidden?'':document.querySelector('#blkInfo').textContent, sum:document.querySelector('#blkSum').textContent,
  rows:Bulk.rows.map(r=>({t:r.title, a:r.artist, st:r.st, show:r.el?r.el.querySelector('.bk-st').textContent:'', why:r.why, items:r.items.length, ai:!!r.ai, pick:!!(r.pick&&r.pick.ai)}))})`);
// 진행 막대 아래 한 줄(S1) 또는 곡 수정 창 가사 칸 아래 한 줄(S2)
const lineOf = (p, sel = '#syncLine') => p.eval(`(()=>{const b=document.querySelector(${q(sel)}), sv=b.querySelector('svg');
  return {shown:!b.hidden, state:b.dataset.state||'', text:(b.querySelector('.sl-text')||{}).textContent||'', btn:(b.querySelector('.sl-act')||{}).textContent||'',
    dots:b.querySelectorAll('.sl-dots i').length, away:!!sv && sv.innerHTML===syncIcon('away').innerHTML}})()`);
const songOf = (p, id) => p.eval(`(async()=>{const s=songById(${q(id)}); if(!s) return null; const r=await DB.get('songs', ${q(id)});
  return {lyrics:s.lyrics, chk:s.syncChk||0, off:s.lyricOffset, db:r?r.lyrics:null, dbChk:r?(r.syncChk||0):null}})()`);

export default async function align(ctx) {
  const { ok, step } = ctx, p = ctx.p;
  await stopAll(p);
  const FAKE = await ctx.startFakeMr();
  const made = [];          // 이 점검이 만든 곡 id (끝에 지움)
  let pop = null;
  const got = expr => pop.ev(`__got.filter(m=>${expr})`);
  const waitReq = id => pop.until(`__got.some(m=>m.type==='align_req' && m.songId===${q(id)})`, 6000);
  const press = async sel => { await p.click(sel); await sleep(150); };
  // 물음 창 단추를 누르고 창이 닫힐 때까지 (사람처럼 바로 다음 것을 읽지 않음)
  const answer = async sel => { await press(sel); await p.until(`!document.querySelector('#alignDialog').open`, 2000); await sleep(150); };
  const shut = () => p.eval(`document.querySelectorAll('dialog[open]').forEach(d=>d.close())`);

  // 시험 곡: 시간 없는 가사(가) · 시각 있는 가사(나) · 시간 없는 가사(다, 물음용) · 가사 없음(라)
  const A = await seedSong(p, { title: 'QA 시험 정렬곡', artist: 'QA가수P', lyrics: PLAIN, wav: ctx.fx.plain });
  const B = await seedSong(p, { title: 'QA 시험 시각곡', artist: 'QA가수Q', lyrics: LRC_SHORT, wav: ctx.fx.short });
  const C = await seedSong(p, { title: 'QA 시험 물음곡', artist: 'QA가수X', lyrics: PLAIN, wav: ctx.fx.edit });
  const N = await seedSong(p, { title: 'QA 시험 빈가사곡', artist: 'QA가수Y', lyrics: '', wav: ctx.fx.nolyr });
  made.push(A.id, B.id, C.id, N.id);
  await p.eval(`localStorage.setItem('nb-mrserver', ${q(FAKE)})`);

  await step('W7 창이 가사를 물음(lyrics_req): 노래방 곡 가사(시간 없음만 글로) · LRCLIB /api/get(제목·가수·길이만) · 모르는 곡은 빈 글', ['W7'], async () => {
    await closePopups(ctx, FAKE);
    await p.click('#mrBtn');
    pop = await attachPopup(ctx, FAKE);
    const linked = pop && await pop.until('window.__linked');
    const welcome = linked ? (await got(`m.type==='welcome'`))[0] : null;
    const caps = await p.eval('Mr.caps');
    ok('W7', linked && JSON.stringify(welcome?.caps) === '["lyrics","align"]' && caps.includes('lyrics_req') && caps.includes('align_req'),
      `새 창 hello caps ${JSON.stringify(caps)} → welcome caps ${JSON.stringify(welcome?.caps)} (예전 창은 caps를 모르고 지나침)`);
    ctx.lrcGetRules.length = 0; ctx.lrcGetLog.length = 0;
    ctx.lrcGetRules.push({ track: '^QA 시험 바깥곡$', body: { id: 9101, trackName: 'QA 시험 바깥곡', artistName: 'QA가수R', duration: 180, instrumental: false, plainLyrics: PLAIN_OUT, syncedLyrics: null } });
    ctx.lrcGetRules.push({ track: '^QA 시험 바깥시각곡$', body: { id: 9102, trackName: 'QA 시험 바깥시각곡', artistName: 'QA가수S', duration: 200, instrumental: false, plainLyrics: PLAIN_OUT, syncedLyrics: LRC_SHORT } });
    const items = [
      { key: 'k1', name: 'QA 시험 정렬곡 - QA가수P (MR).mp3', duration: 5 },
      { key: 'k2', name: 'QA 시험 시각곡 - QA가수Q (MR).mp3', duration: 4 },
      { key: 'k3', name: 'QA 시험 바깥곡 - QA가수R (MR).mp3', duration: 180 },
      { key: 'k4', name: 'QA 시험 바깥시각곡 - QA가수S (MR).mp3', duration: 200 },
      { key: 'k5', name: 'QA 시험 모르는곡 - QA가수T (MR).mp3', duration: 100 },
    ];
    const ans = await pop.ev(`askLyrics(${q(items)})`);
    const by = Object.fromEntries((ans || []).map(x => [x.key, x]));
    const from = (await got(`m.type==='lyrics'`))[0];
    ok('W7', ans && ans.length === 5 && by.k1?.synced === false && by.k1?.text === PLAIN && by.k2?.synced === true && by.k2?.text === ''
      && by.k3?.synced === false && by.k3?.text === PLAIN_OUT && by.k4?.synced === true && by.k4?.text === '' && by.k5?.synced === false && by.k5?.text === '' && from?.origin === ctx.base,
      `답 ${(ans || []).map(x => `${x.key}:${x.synced ? '시각 있음' : x.text ? '글 ' + x.text.split('\n').length + '줄' : '빈 글'}`).join(' · ')} (노래방 주소에서만)`);
    const gl = ctx.lrcGetLog.filter(x => /^QA 시험 (바깥|모르는)/.test(x.track));
    const params = [...new Set(gl.flatMap(x => x.params))].sort().join(',');
    const leak = ctx.netLog.some(n => /QA 시험 시간 없는|QA 시험 하나/.test(decodeURIComponent(n.url)));
    ok('W7', gl.length === 3 && params === 'artist_name,duration,track_name' && gl.find(x => x.track === 'QA 시험 바깥곡')?.duration === '180' && !leak && !ctx.lrcGetLog.some(x => /^QA 시험 (정렬곡|시각곡)$/.test(x.track)),
      `LRCLIB /api/get ${gl.length}번 (노래방에 있는 곡은 묻지 않음), 보낸 값 ${params}, 가사 글은 밖으로 ${leak ? '나감!' : '안 나감'} · 물은 곡 ${ctx.lrcGetLog.map(x => x.track + '/' + x.duration).join(' · ')}`);
    // 이상한 lyrics_req는 답하지 않음 (key 모양·이름 없음·200개)
    await pop.ev(`__got.length=0`);
    await pop.ev(`sendRaw({app:'yena-mr',v:1,type:'lyrics_req',items:[{key:'../x',name:'a.mp3',duration:3}]})`);
    await pop.ev(`sendRaw({app:'yena-mr',v:1,type:'lyrics_req',items:[{key:'k1',name:'',duration:3}]})`);
    await pop.ev(`sendRaw({app:'yena-mr',v:1,type:'lyrics_req',items:Array.from({length:200},(x,i)=>({key:'k'+i,name:'a.mp3',duration:3}))})`);
    await sleep(800);
    ok('W7', (await got(`m.type==='lyrics'`)).length === 0, '모양이 틀린 lyrics_req 3개 → 답 없음');
    ctx.lrcGetRules.length = 0;
  });

  await step('W7 files+lrc → 여러 곡 넣기: 보통·높음은 "✔ 집 AI 시각 · 확인해 주세요" · 낮음은 후보로만(고르면 넣음) · 없는 곡은 예전처럼 → 저장 → 자동 싱크 · 확인해 주세요', ['W7', 'W9'], async () => {
    ctx.lrcRules.length = 0;       // 가사 검색은 0개 (집 AI 시각만 보이게)
    await pop.ev(`__got.length=0`);
    const n0 = await p.eval('state.songs.length');
    const names = ['QA 시험 정렬판 - QA가수U (MR).mp3', 'QA 시험 낮은판 - QA가수V (MR).mp3', 'QA 시험 그냥판 - QA가수W (MR).mp3'];
    const sent = await pop.ev(`sendFilesLrc(${q(names.map(name => ({ name, sec: 3 })))}, ${q([{ name: names[0], lrc: LRC_AI, score: 0.82, level: 'high' }, { name: names[1], lrc: LRC_AI2, score: 0.31, level: 'low' }, null])})`);
    const opened = await p.until(`document.querySelector('#bulkDialog').open`, 5000);
    const acked = await pop.until(`__got.some(m=>m.type==='ack' && m.n===3)`, 4000);
    await p.until(`!Bulk.running`, 30000, 200);
    const h = await bulkRows(p);
    const r = t => h.rows.find(x => x.t === t) || {};
    const hi = r('QA 시험 정렬판'), lo = r('QA 시험 낮은판'), no = r('QA 시험 그냥판');
    ok('W7', !!sent && opened && acked && hi.st === 'aligned' && hi.show === '✔ 집 AI 시각 · 확인해 주세요' && hi.pick && lo.st === 'ask' && lo.why === 'ailow' && lo.items === 1 && !lo.pick
      && no.st === 'none' && !no.ai && /집 AI 시각 1/.test(h.sum),
      `높음 "${hi.show}" · 낮음 "${lo.show}"(후보 ${lo.items}개, 저절로 안 넣음) · 없음 "${no.show}" · 머리 "${h.sum}" · 창에 ack {n:3}`);
    // 낮음 줄을 펴서 후보 글을 보고 고른다
    const item = await p.eval(`(()=>{const r=Bulk.rows.find(x=>x.title==='QA 시험 낮은판'); r.open=true; paintRow(r); const b=r.el.querySelector('.lrc-results li button');
      const out={nm:b.querySelector('.nm').textContent, s:b.querySelector('.s').textContent, tag:b.querySelector('.tag').textContent, plain:b.querySelector('.tag').classList.contains('plain'), msg:r.el.querySelector('.bk-msg').textContent};
      b.click(); return Object.assign(out,{st:r.st})})()`);
    ok('W7', item.s === 'QA가수V · 집 AI가 이 노래 소리로 맞춤' && item.tag === '집 AI 시각 · 많이 틀릴 수 있어요' && item.plain && /많이 틀릴 수 있어서 저절로 넣지 않았어요/.test(item.msg) && item.st === 'picked',
      `낮음 후보 "${item.s}" [${item.tag}] · 안내 "${item.msg.slice(0, 40)}…" → 고름`);
    await p.eval(`window.__ht=[]; window.__hto=hubTouch; hubTouch=function(s){__ht.push(s.id); return __hto(s)}`);
    await p.click('#blkSave');
    await p.until(`!document.querySelector('#bulkDialog').open && state.songs.length>=${n0 + 3}`, 10000);
    const saved = await p.eval(`state.songs.filter(s=>/^QA 시험 (정렬|낮은|그냥)판$/.test(s.title)).map(s=>({id:s.id,t:s.title,lyrics:s.lyrics,chk:s.syncChk||0}))`);
    const ht = await p.eval(`(()=>{const n=__ht.length; hubTouch=__hto; return n})()`);
    for (const s of saved) made.push(s.id);
    const sv = t => saved.find(x => x.t === t) || {};
    ok('W7', saved.length === 3 && sv('QA 시험 정렬판').lyrics === LRC_AI && sv('QA 시험 정렬판').chk === 1 && sv('QA 시험 낮은판').lyrics === LRC_AI2 && sv('QA 시험 낮은판').chk === 1
      && !sv('QA 시험 그냥판').lyrics && !sv('QA 시험 그냥판').chk && ht === 0,
      `저장 3곡: 높음·고른 낮음은 집 AI 시각 + 확인 표시, 없음은 가사 없이 · 허브는 새 곡 규칙(바로 보내지 않음, hubTouch ${ht}번)`);
    const id = sv('QA 시험 정렬판').id;
    if (id) {
      await selectById(p, id);
      const chk = await visible(p, '#syncChkBtn'), ab = await visible(p, '#alignBtn');
      ok('W9', chk && ab, `MR 만들기에서 집 AI 시각으로 넣은 곡: "자동 싱크 · 확인해 주세요" 단추 ${chk ? '보임' : '안 보임'} (확인 표시라 [원곡 파일로 자동 싱크]도 ${ab ? '보임' : '안 보임'})`);
    }
  });

  await step('W8 단추: 무대(시간 없는 가사·확인 표시 곡만)·곡 수정 창(가사가 있는 곡) · 가사 없음·데모곡은 안 보임', ['W8'], async () => {
    await shut();
    const vis = async () => ({ stage: await visible(p, '#alignBtn'), text: await p.eval(`document.querySelector('#alignBtn').textContent`) });
    await selectById(p, A.id); const a = await vis();
    await selectById(p, B.id); const b = await vis();
    await selectById(p, N.id); const n = await vis();
    const demo = await p.eval(`(async()=>{const d=state.songs.find(s=>s.demo); if(!d) return null; await selectSong(d); return !document.querySelector('#alignBtn').hidden})()`);
    const dlg = async id => { await p.eval(`openSongDialog(songById(${q(id)}))`); await p.until(`document.querySelector('#songDialog').open`, 3000); const v = await visible(p, '#alignBtn2'); await p.eval(`document.querySelector('#songDialog').close()`); await sleep(100); return v; };
    const dA = await dlg(A.id), dB = await dlg(B.id), dN = await dlg(N.id);
    await p.eval(`openSongDialog()`); await p.until(`document.querySelector('#songDialog').open`, 3000);
    const dNew = await visible(p, '#alignBtn2'); await p.eval(`document.querySelector('#songDialog').close()`);
    ok('W8', a.stage && a.text === '원곡 파일로 자동 싱크' && !b.stage && !n.stage && demo === false && dA && dB && !dN && !dNew,
      `무대: 시간 없는 가사 ${a.stage ? '보임' : '안 보임'} · 시각 있는 가사 ${b.stage ? '보임' : '안 보임'} · 가사 없음 ${n.stage ? '보임' : '안 보임'} · 데모 ${demo ? '보임' : '안 보임'} / 곡 수정 창: 가 ${dA ? '보임' : '-'} · 나 ${dB ? '보임' : '-'} · 가사 없음 ${dN ? '보임' : '안 보임'} · 새 곡 ${dNew ? '보임' : '안 보임'}`);
  });

  await step('W8 무대 [원곡 파일로 자동 싱크] → 이름 있는 창 yena-mr이 열림 → hello 뒤 align_req → "집 AI가 맞추는 중"(점 3개·그만두기) → aligned → 곡에 들어감·확인 표시·저장·허브 길', ['W8', 'W9'], async () => {
    await shut();
    if (pop) await pop.detach();
    await closePopups(ctx, FAKE);
    await selectById(p, A.id);
    await p.click('#alignBtn');
    const busy = await lineOf(p);
    const dis = await p.eval(`document.querySelector('#alignBtn').disabled`);
    pop = await attachPopup(ctx, FAKE);
    const info = pop && await pop.ev(`({url:location.href, name:window.name, opener:!!window.opener})`);
    const req = pop && await waitReq(A.id) ? (await got(`m.type==='align_req'`))[0] : null;
    ok('W8', !!pop && info.url === FAKE + '/' && info.name === 'yena-mr' && info.opener && !!req,
      `창 ${info?.url} (이름 ${info?.name}) · hello 뒤 align_req`);
    const keys = req ? Object.keys(req).sort().join(',') : '';
    ok('W8', req && keys === 'app,artist,lyrics,origin,songId,title,type,v' && req.songId === A.id && req.title === 'QA 시험 정렬곡' && req.artist === 'QA가수P' && req.lyrics === PLAIN,
      `align_req 칸 ${keys} · 가사 글 ${req?.lyrics?.split('\n').length}줄 (소리·다른 곡 정보 없음)`);
    ok('W8', busy.shown && busy.text === T.aligning && busy.dots === 3 && busy.btn === '그만두기' && busy.state === 'busy' && dis,
      `한 줄 "${busy.text}" 점 ${busy.dots}개 + [${busy.btn}] · 단추 ${dis ? '잠김' : '안 잠김'}`);
    await p.eval(`window.__ht=[]; window.__hto=hubTouch; hubTouch=function(s){__ht.push(s.id); return __hto(s)}`);
    await pop.ev(`__got.length=0`);
    await pop.ev(`sendAligned(${q({ songId: A.id, lrc: LRC_AI, score: 0.91, level: 'high' })})`);
    const acked = await pop.until(`__got.some(m=>m.type==='ack' && m.n===1 && m.songId===${q(A.id)})`, 4000);
    await p.until(`songById(${q(A.id)}).lyrics===${q(LRC_AI)}`, 4000);
    await sleep(300);
    const s = await songOf(p, A.id), l = await lineOf(p);
    const ht = await p.eval(`(()=>{const n=__ht.filter(x=>x===${q(A.id)}).length; hubTouch=__hto; return n})()`);
    const lines = await p.eval(`state.lines.filter(l=>l.text).length`);
    ok('W8', acked && s.lyrics === LRC_AI && s.db === LRC_AI && s.off === 0 && l.text === T.aligned && l.state === 'found' && ht === 1 && lines === 3,
      `aligned(high) → 창에 ack {n:1} · 곡 가사 = 맞춘 시각 (저장됨, 무대 줄 ${lines}개) · 한 줄 "${l.text}" · 허브 길 hubTouch ${ht}번`);
    ok('W9', s.chk === 1 && s.dbChk === 1 && await visible(p, '#syncChkBtn'), '집 AI가 맞춘 곡에 "자동 싱크 · 확인해 주세요" (저장에도 표시)');
    ok('W8', !(await p.eval(`document.querySelector('#alignBtn').disabled`)), '끝나면 단추가 다시 눌림');
  });

  await step('W8 low → 먼저 물음 "가사 시각이 많이 틀릴 수 있어요. 넣을까요?"(처음 초점 = 넣지 않기) → 넣지 않기 = 그대로 · 넣기 = 들어감', ['W8'], async () => {
    await shut();
    await selectById(p, C.id);
    const ask = async () => {
      await pop.ev(`__got.length=0`);
      await p.click('#alignBtn');
      await waitReq(C.id);
      await pop.ev(`sendAligned(${q({ songId: C.id, lrc: LRC_AI, score: 0.22, level: 'low' })})`);
      await p.until(`document.querySelector('#alignDialog').open`, 4000);
      return p.eval(`({title:document.querySelector('#alignTitle').textContent, txt:document.querySelector('#alignTxt').textContent, yes:document.querySelector('#alignYes').textContent,
        no:document.querySelector('#alignNo').textContent, focus:document.activeElement && document.activeElement.id})`);
    };
    const d1 = await ask();
    const acked = (await got(`m.type==='ack' && m.songId===${q(C.id)}`)).map(m => m.n).join(',');
    await answer('#alignNo');
    await p.until(`(AutoSync.last.get(${q(C.id)})||{}).text===${q(T.skip)}`, 2000);
    const s1 = await songOf(p, C.id), l1 = await lineOf(p);
    ok('W8', d1.title === T.low && d1.yes === '넣기' && d1.no === '넣지 않기' && d1.focus === 'alignNo' && /QA 시험 물음곡/.test(d1.txt) && acked === '1'
      && s1.lyrics === PLAIN && !s1.chk && l1.text === T.skip && l1.btn === '직접 맞추기',
      `low → 물음 "${d1.title}" [${d1.yes}] [${d1.no}] 초점 ${d1.focus} · 넣지 않기 → 가사 그대로, 한 줄 "${l1.text}" + [${l1.btn}] (ack ${acked})`);
    // Esc(창 닫기)도 넣지 않음
    await ask();
    await p.eval(`document.querySelector('#alignDialog').close()`); await sleep(200);
    const s2 = await songOf(p, C.id);
    await ask();
    await answer('#alignYes');
    await p.until(`songById(${q(C.id)}).lyrics===${q(LRC_AI)}`, 3000);
    const s3 = await songOf(p, C.id), l3 = await lineOf(p);
    ok('W8', s2.lyrics === PLAIN && s3.lyrics === LRC_AI && s3.chk === 1 && s3.db === LRC_AI && l3.text === T.aligned,
      `창 닫기(Esc) → 그대로 · [넣기] → 들어감 + 확인 표시 · 한 줄 "${l3.text}"`);
  });

  await step('W8 이미 시각 있는 가사: 곡 수정 창 [원곡 파일로 자동 싱크] → 시각 뗀 가사 글을 보냄 → "이미 시각이 있는 가사예요. 바꿀까요?" · 고친 가사는 먼저 저장', ['W8'], async () => {
    await shut();
    await selectById(p, B.id);
    await p.eval(`openSongDialog(songById(${q(B.id)}))`); await p.until(`document.querySelector('#songDialog').open`, 3000);
    // 가사 칸을 고친 채 누르면 안내만
    await pop.ev(`__got.length=0`);
    await p.eval(`(()=>{const t=document.querySelector('#f-lyrics'); t.value=t.value+'\\n[00:04.00]QA 시험 고침'; t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await p.click('#alignBtn2');
    await sleep(500);
    const err = await p.eval(`({open:document.querySelector('#songDialog').open, err:document.querySelector('#dlgErr').hidden?'':document.querySelector('#dlgErr').textContent})`);
    const none = (await got(`m.type==='align_req'`)).length;
    await p.eval(`document.querySelector('#f-lyrics').value=songById(${q(B.id)}).lyrics; document.querySelector('#dlgErr').hidden=true`);
    ok('W8', err.open && err.err === '고친 가사를 먼저 저장한 뒤 눌러 주세요' && none === 0, `고친 가사 그대로 누름 → "${err.err}" (보내지 않음)`);
    await p.click('#alignBtn2');
    const closed = await p.until(`!document.querySelector('#songDialog').open`, 2000);
    await waitReq(B.id);
    const req = (await got(`m.type==='align_req'`))[0];
    ok('W8', closed && req?.lyrics === 'QA 시험 하나\nQA 시험 둘\nQA 시험 셋', `곡 수정 창이 닫히고 align_req (시각 뗀 줄 글 ${req?.lyrics?.split('\n').length}줄)`);
    await pop.ev(`sendAligned(${q({ songId: B.id, lrc: LRC_AI2, score: 0.88, level: 'high' })})`);
    await p.until(`document.querySelector('#alignDialog').open`, 4000);
    const d = await p.eval(`({title:document.querySelector('#alignTitle').textContent, yes:document.querySelector('#alignYes').textContent, no:document.querySelector('#alignNo').textContent, focus:document.activeElement && document.activeElement.id})`);
    await answer('#alignNo');
    await p.until(`(AutoSync.last.get(${q(B.id)})||{}).text===${q(T.skip)}`, 2000);
    const s = await songOf(p, B.id);
    ok('W8', d.title === T.over && d.yes === '바꾸기' && d.no === '바꾸지 않기' && d.focus === 'alignNo' && s.lyrics === LRC_SHORT && !s.chk,
      `물음 "${d.title}" [${d.yes}] [${d.no}] → 바꾸지 않기 → 원래 시각 그대로`);
    // S2: 곡 수정 창을 다시 열면 그 곡의 마지막 소식
    await p.eval(`openSongDialog(songById(${q(B.id)}))`); await p.until(`document.querySelector('#songDialog').open`, 3000);
    const l2 = await lineOf(p, '#syncLine2');
    await p.eval(`document.querySelector('#songDialog').close()`);
    ok('W8', l2.shown && l2.text === T.skip, `곡 수정 창 가사 칸 아래 한 줄(S2) "${l2.text}"`);
  });

  await step('W8 집 AI 오류 → 노래방 말: 목소리 없음(W10)·가사와 안 맞음·가사 못 읽음·그 밖 · 이상한 aligned는 무시', ['W8', 'W10'], async () => {
    await shut();
    await selectById(p, A.id);
    await p.eval(`(async()=>{const s=songById(${q(A.id)}); s.lyrics=${q(PLAIN)}; delete s.syncChk; await persistSong(s); computeLines(); autoSyncUI()})()`);
    const res = {};
    for (const code of ['no_vocals', 'no_match', 'bad_lyrics', 'worker_failed']) {
      await pop.ev(`__got.length=0`);
      await p.click('#alignBtn');
      await waitReq(A.id);
      await pop.ev(`sendAligned(${q({ songId: A.id, error: code })})`);
      await p.until(`document.querySelector('#syncLine').dataset.state==='none'`, 3000);
      res[code] = await lineOf(p);
      res[code].ack = (await got(`m.type==='ack'`)).length;
    }
    const s = await songOf(p, A.id);
    ok('W10', res.no_vocals.text === T.no_vocals && res.no_vocals.btn === '직접 맞추기', `목소리 없는 파일(MR) → "${res.no_vocals.text}" + [직접 맞추기]`);
    ok('W8', res.no_match.text === T.no_match && res.bad_lyrics.text === T.bad_lyrics && res.worker_failed.text === T.other && s.lyrics === PLAIN && Object.values(res).every(x => x.ack === 0 && x.btn === '직접 맞추기'),
      `no_match "${res.no_match.text}" · bad_lyrics "${res.bad_lyrics.text}" · 그 밖 "${res.worker_failed.text}" · 가사 그대로`);
    // 이상한 aligned: 시각 없는 글·점수 2·모르는 level·이상한 곡 id·64KB 넘음 → 그대로 "맞추는 중"
    await pop.ev(`__got.length=0`);
    await p.click('#alignBtn');
    await waitReq(A.id);
    const bad = [
      { songId: A.id, lrc: PLAIN, score: 0.9, level: 'high' }, { songId: A.id, lrc: LRC_AI, score: 2, level: 'high' }, { songId: A.id, lrc: LRC_AI, score: 0.9, level: 'great' },
      { songId: '../' + A.id, lrc: LRC_AI, score: 0.9, level: 'high' }, { songId: A.id, error: 'No Vocals!' },
    ];
    for (const b of bad) await pop.ev(`sendAligned(${q(b)})`);
    await pop.ev(`sendAligned({songId:${q(A.id)}, lrc:'[00:01.00]'+'가'.repeat(70000), score:0.9, level:'high'})`);
    await sleep(700);
    const still = await lineOf(p), s2 = await songOf(p, A.id), answers = (await got(`m.type==='ack'||m.type==='nack'`)).length;
    ok('W8', still.text === T.aligning && s2.lyrics === PLAIN && answers === 0, `모양이 틀린 aligned 6개 → 답 없음, 가사 그대로, 아직 "${still.text}"`);
    await p.eval(`(()=>{const b=[...document.querySelectorAll('#syncLine .sl-act')].find(x=>x.textContent==='그만두기'); b && b.click()})()`);
    await sleep(200);
  });

  await step('W8 [그만두기] → 창에 align_stop · 늦게 온 결과는 ack {n:0}(넣지 않음) · 노래방이 바쁘면 nack busy → 닫고 다시 보내면 넣음 · 맞추는 사이 가사를 고치면 넣지 않음', ['W8'], async () => {
    await shut();
    await selectById(p, A.id);
    await pop.ev(`__got.length=0`);
    await p.click('#alignBtn');
    await waitReq(A.id);
    await p.click('#syncLine .sl-act');
    await sleep(300);
    const stop = (await got(`m.type==='align_stop'`))[0], l = await lineOf(p);
    await pop.ev(`sendAligned(${q({ songId: A.id, lrc: LRC_AI, score: 0.9, level: 'high' })})`);
    const late = await pop.until(`__got.some(m=>m.type==='ack' && m.n===0 && m.songId===${q(A.id)})`, 3000);
    const s = await songOf(p, A.id);
    ok('W8', stop?.songId === A.id && !l.shown && late && s.lyrics === PLAIN && !(await p.eval(`document.querySelector('#alignBtn').disabled`)),
      `[그만두기] → align_stop {songId} · 한 줄 사라짐 · 늦게 온 결과 → ack {n:0}, 가사 그대로`);

    // 바쁨: 곡 추가 창이 열려 있음 → nack busy + 알림 → 닫고 다시 보냄 → 넣음
    await pop.ev(`__got.length=0`);
    await p.click('#alignBtn');
    await waitReq(A.id);
    await p.click('#addSongBtn');
    await p.until(`document.querySelector('#songDialog').open`, 3000);
    const m0 = await marks(p);
    await pop.ev(`sendAligned(${q({ songId: A.id, lrc: LRC_AI, score: 0.9, level: 'high' })})`);
    const nack = await pop.until(`__got.some(m=>m.type==='nack' && m.reason==='busy' && m.songId===${q(A.id)})`, 3000);
    const t = await sawToast(p, /열려 있는 창을 닫고 MR 만들기 창에서 \[노래방으로 보내기\]를 다시 눌러 주세요/, m0, 3000);
    const kept = await p.eval(`({open:document.querySelector('#songDialog').open, lyr:songById(${q(A.id)}).lyrics})`);
    await p.eval(`document.querySelector('#songDialog').close()`); await sleep(150);
    await pop.ev(`sendAligned(${q({ songId: A.id, lrc: LRC_AI, score: 0.9, level: 'high' })})`);
    const ack = await pop.until(`__got.some(m=>m.type==='ack' && m.n===1 && m.songId===${q(A.id)})`, 3000);
    await p.until(`songById(${q(A.id)}).lyrics===${q(LRC_AI)}`, 3000);
    ok('W8', nack && t && kept.open && kept.lyr === PLAIN && ack && (await songOf(p, A.id)).lyrics === LRC_AI,
      '다른 창이 열려 있음 → nack busy {songId} + 알림, 창·가사 그대로 → 닫고 [노래방으로 보내기] → ack {n:1}, 들어감');

    // 맞추는 사이 가사를 고침 → 옛 가사의 시각이라 넣지 않음
    await selectById(p, C.id);
    await p.eval(`(async()=>{const s=songById(${q(C.id)}); s.lyrics=${q(PLAIN)}; delete s.syncChk; await persistSong(s); computeLines(); autoSyncUI()})()`);
    await pop.ev(`__got.length=0`);
    await p.click('#alignBtn');
    await waitReq(C.id);
    await p.eval(`(async()=>{const s=songById(${q(C.id)}); s.lyrics=${q(PLAIN + '\nQA 시험 더한 줄')}; await persistSong(s); computeLines()})()`);
    await pop.ev(`sendAligned(${q({ songId: C.id, lrc: LRC_AI, score: 0.9, level: 'high' })})`);
    const ack0 = await pop.until(`__got.some(m=>m.type==='ack' && m.n===0 && m.songId===${q(C.id)})`, 3000);
    await sleep(200);
    const lc = await lineOf(p), sc = await songOf(p, C.id);
    ok('W8', ack0 && lc.text === T.changed && sc.lyrics === PLAIN + '\nQA 시험 더한 줄', `가사를 고친 사이 온 결과 → ack {n:0} · "${lc.text}" · 고친 가사 그대로`);
  });

  await step('W8 못 할 때: 예전 창(caps 없음) · 집 밖(인터넷 끊김·창이 인사 없음) "집 AI에 닿지 않아요 · 집에 가면 다시 해요"(와이파이 끊김 아이콘, 단추 없음) · 창 닫힘 · 팝업 막힘', ['W8'], async () => {
    await shut();
    await selectById(p, A.id);
    await p.eval(`(async()=>{const s=songById(${q(A.id)}); s.lyrics=${q(PLAIN)}; delete s.syncChk; await persistSong(s); computeLines(); autoSyncUI()})()`);
    // 예전 창: caps 없는 hello
    await pop.ev(`__got.length=0`);
    await pop.ev(`sendRaw({app:'yena-mr',v:1,type:'hello',base:location.origin,https:null})`);
    await p.until(`Mr.caps.length===0`, 2000);
    await p.click('#alignBtn');
    await sleep(300);
    const old = await lineOf(p), oldReq = (await got(`m.type==='align_req'`)).length;
    ok('W8', old.text === T.no_align && !old.btn && oldReq === 0, `예전 창 → "${old.text}" (align_req 안 보냄)`);
    await pop.ev(`sendRaw({app:'yena-mr',v:1,type:'hello',base:location.origin,https:null,caps:['lyrics_req','align_req']})`);
    await p.until(`Mr.caps.includes('align_req')`, 2000);

    // 창 닫힘: 맞추는 중에 창을 닫음
    await pop.ev(`__got.length=0`);
    await p.click('#alignBtn');
    await waitReq(A.id);
    await pop.detach();
    await ctx.browser.send('Target.closeTarget', { targetId: pop.targetId }).catch(() => {});
    pop = null;
    await p.until(`document.querySelector('#syncLine .sl-text') && document.querySelector('#syncLine .sl-text').textContent===${q(T.closed)}`, 4000);
    const cl = await lineOf(p);
    ok('W8', cl.text === T.closed && !cl.btn && !(await p.eval(`Align.want.size`)), `맞추는 중 창이 닫힘 → "${cl.text}"`);

    // 인터넷 끊김
    await closePopups(ctx, FAKE);
    await p.offline(true); await sleep(200);
    await p.click('#alignBtn');
    await sleep(200);
    const off = await lineOf(p);
    const opened = (await ctx.browser.send('Target.getTargets')).targetInfos.some(x => x.type === 'page' && x.url.startsWith(FAKE));
    await p.offline(false); await sleep(200);
    // 창이 인사 없음 (가짜 서버의 없는 곳 = 404 화면): 기다리는 시간을 줄여서 본다 (진짜는 10초)
    await p.eval(`localStorage.setItem('nb-mrserver', ${q(FAKE + '/no-such-place')}); Mr.helloMs=2500`);
    await p.click('#alignBtn');
    const t0 = Date.now();
    await p.until(`document.querySelector('#syncLine').dataset.state==='none'`, 8000, 200);
    const sec = (Date.now() - t0) / 1000, far = await lineOf(p);
    await p.eval(`Mr.helloMs=MR_HELLO_MS; localStorage.setItem('nb-mrserver', ${q(FAKE)})`);
    ok('W8', off.text === T.unreachable && off.away && !off.btn && !opened && far.text === T.unreachable && far.away && !far.btn && sec >= 2,
      `인터넷 끊김 → 창을 열지 않고 "${off.text}" · 인사 없음 → ${sec.toFixed(1)}초 뒤 같은 글 (와이파이 끊김 아이콘, 단추 없음)`);
    await closePopups(ctx, FAKE);

    // 팝업 막힘
    await p.eval(`window.__wo = window.open; window.open = () => null`);
    await p.click('#alignBtn');
    await sleep(200);
    const bl = await lineOf(p);
    await p.eval(`window.open = window.__wo`);
    ok('W8', bl.text === T.blocked && !bl.btn, `팝업 막힘 → "${bl.text}"`);

    // 다시 누르면 창이 열려 이어서 됨
    await p.click('#alignBtn');
    pop = await attachPopup(ctx, FAKE);
    const again = pop && await waitReq(A.id);
    ok('W8', !!again, '다시 누름 → 창(yena-mr)이 열리고 align_req');
    if (pop) await pop.ev(`sendAligned(${q({ songId: A.id, error: 'canceled' })})`);
    await sleep(300);
  });

  await step('W7·W8 코드 점검: sw.js SHELL 그대로(새 파일 없음) · mr.js가 서버로 요청하지 않음 · 가사 글이 밖으로 안 나감', ['W8'], async () => {
    const sw = fs.readFileSync(path.join(ctx.ROOT, 'sw.js'), 'utf8'), js = fs.readFileSync(path.join(ctx.ROOT, 'js', 'mr.js'), 'utf8');
    const shell = /const SHELL = '([^']+)'/.exec(sw)?.[1];
    const noFetch = !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|EventSource/.test(js);
    const star = /postMessage\([^)]*['"]\*['"]\s*\)/.test(js);
    const leak = ctx.netLog.filter(n => /QA 시험 (시간 없는|하나|바깥 첫)/.test(decodeURIComponent(n.url)));
    ctx.common('가사 정렬 코드 점검: SHELL yt-shell-v8 그대로 · mr.js 요청 코드 없음 · postMessage에 * 없음 · 가사 글이 주소에 안 나감',
      shell === 'yt-shell-v8' && noFetch && !star && !leak.length, `SHELL ${shell}, 요청 코드 ${noFetch ? '없음' : '있음!'}, * ${star ? '있음!' : '없음'}, 가사 글 주소 ${leak.length}건`);
    ok('W8', shell === 'yt-shell-v8' && noFetch && !star, `SHELL ${shell} · 창에는 정한 주소로만 보냄`);
  });

  // 정리: 창 닫기, 만든 곡·설정 지우기
  if (pop) await pop.detach();
  await closePopups(ctx, FAKE).catch(() => {});
  await p.eval(`(async()=>{ for (const id of ${q(made)}) { const s=songById(id); if (s) await deleteSong(s); } localStorage.removeItem('nb-mrserver'); Mr.helloMs=MR_HELLO_MS; })()`).catch(() => {});
  ctx.lrcGetRules.length = 0; ctx.lrcRules.length = 0;
  await ctx.stopFakeMr();
  await stopAll(p);
}
