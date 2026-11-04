// CR-089: MR 만들기 — 곡 목록 버튼 → 집 AI 서버 "MR 만들기 창"(여기서는 가짜 창 tests/ui/fake-mr, 다른 포트 = 다른 origin)
// → 창끼리 메시지(hello/welcome/files/ack/nack) → "여러 곡 한 번에 넣기" 창. 설정 창 서버 주소 칸. 집 AI 서버에는 요청하지 않는다.
// 가짜 창은 노래방이 window.open으로 연 진짜 탭이고, 점검은 CDP로 그 탭에 붙어 파일을 보내게 하고 받은 답(__got)을 읽는다.
import fs from 'node:fs';
import path from 'node:path';
import { txt, visible, marks, sawToast, sleep, q, stopAll } from './_lib.mjs';
import { waitDownload } from './record.mjs';
import { cand } from '../fixtures.mjs';
export const areas = ['U'];

const MADE = 'QA 시험 만든곡 - QA가수M (MR).mp3';     // 서비스 이름 규칙 "제목 - 가수 (MR).mp3" (제목에 MR 글자를 넣지 않음: 노래방이 MR 꼬리표로 뗀다)

/** 노래방이 연 창(탭)을 주소로 찾아 CDP로 붙는다 */
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
const popups = async (ctx, prefix) => (await ctx.browser.send('Target.getTargets')).targetInfos.filter(x => x.type === 'page' && x.url.startsWith(prefix)).length;
async function closePopups(ctx, prefix) {
  for (const t of (await ctx.browser.send('Target.getTargets')).targetInfos) if (t.type === 'page' && t.url.startsWith(prefix)) await ctx.browser.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
  await ctx.p.eval(`Mr.win=null; Mr.linked=false; clearTimeout(Mr.timer); mrHideMsg()`);
  await sleep(200);
}
const msgState = p => p.eval(`({shown:!document.querySelector('#mrMsg').hidden, text:document.querySelector('#mrMsgTxt').textContent, retry:!document.querySelector('#mrRetry').hidden})`);
const bulkHead = p => p.eval(`({open:document.querySelector('#bulkDialog').open, info:document.querySelector('#blkInfo').hidden?'':document.querySelector('#blkInfo').textContent,
  rows:[...document.querySelectorAll('#blkList .bk-row')].map(li=>({no:li.querySelector('.no').textContent, t:li.querySelector('.t').textContent, a:li.querySelector('.a').textContent, st:li.querySelector('.bk-st').textContent}))})`);

export default async function mr(ctx) {
  const { ok, step } = ctx, p = ctx.p;
  await stopAll(p);
  const FAKE = await ctx.startFakeMr();          // http://127.0.0.1:<포트> (노래방과 다른 origin)
  const made = [];                               // 이 점검이 만든 곡 id (끝에 지움)
  let pop = null;

  await step('곡 목록 버튼 자리·세기, 코드 점검 (sw.js·스크립트 순서·서버로 요청 없음)', ['U1'], async () => {
    const lay = await p.eval(`(()=>{const a=document.querySelector('#addSongBtn'), m=document.querySelector('#mrBtn'), miss=document.querySelector('#missBtn');
      const kids=[...document.querySelector('#songsPanel').children]; return {after:kids.indexOf(m)===kids.indexOf(a)+1, beforeMiss:kids.indexOf(m)<kids.indexOf(miss),
      cls:m.className, text:m.textContent, w:Math.round(m.getBoundingClientRect().width), aw:Math.round(a.getBoundingClientRect().width), primary:m.classList.contains('primary'),
      scripts:[...document.scripts].map(s=>s.getAttribute('src')).filter(Boolean)}})()`);
    const order = ['js/bulk.js', 'js/mr.js', 'js/main.js'].map(s => lay.scripts.indexOf(s));
    ok('U1', lay.after && lay.beforeMiss && !lay.primary && lay.text === '내 노래 파일에서 MR 만들기' && Math.abs(lay.w - lay.aw) <= 1,
      `"+ 곡 추가" 바로 아래 보통 단추 "${lay.text}" (너비 ${lay.w} = ${lay.aw})`);
    const sw = fs.readFileSync(path.join(ctx.ROOT, 'sw.js'), 'utf8'), js = fs.readFileSync(path.join(ctx.ROOT, 'js', 'mr.js'), 'utf8');
    const shell = /const SHELL = '([^']+)'/.exec(sw)?.[1];
    const noFetch = !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|EventSource/.test(js);
    const noTail = !/\.ts\.net|\b100\.\d+\.\d+\.\d+\b/.test(js + fs.readFileSync(path.join(ctx.ROOT, 'js', 'core.js'), 'utf8') + fs.readFileSync(path.join(ctx.ROOT, 'index.html'), 'utf8'));
    ctx.common('MR 만들기 코드 점검: sw.js SHELL·목록에 js/mr.js, 스크립트 순서 bulk→mr→main, mr.js가 서버로 요청하지 않음, tailnet 뒷부분·IP 없음',
      shell === 'yt-shell-v7' && sw.includes("'./js/mr.js'") && order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2] && noFetch && noTail,
      `SHELL ${shell}, 순서 ${order.join('<')}, 요청 코드 ${noFetch ? '없음' : '있음!'}, 뒷부분·IP ${noTail ? '없음' : '있음!'}`);
  });

  await step('설정 창 서버 주소 칸: 기본값·틀린 주소 안내·저장(끝 / 뗌)·기본값으로·저장 안 하고 닫기·L2 안내 줄', ['U3'], async () => {
    await p.eval(`localStorage.removeItem('nb-mrserver')`);
    await p.click('#settingsBtn');
    const lay = await p.eval(`(()=>{const secs=[...document.querySelectorAll('#cloudDialog .set-sec')].map(s=>s.querySelector('h3').textContent); const i=secs.indexOf('MR 만들기 (집 AI 서버)');
      return {i, prev:secs[i-1], next:secs[i+1], val:document.querySelector('#mrServer').value, hints:[...document.querySelectorAll('#mrSec .hint')].map(h=>h.hidden?'':h.textContent).filter(Boolean)}})()`);
    const save = async v => { await p.eval(`(()=>{const i=document.querySelector('#mrServer'); i.value=${q(v)}; i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await p.click('#mrSave');
      return p.eval(`({ls:localStorage.getItem('nb-mrserver'), val:document.querySelector('#mrServer').value, msg:document.querySelector('#mrSetMsg').hidden?'':document.querySelector('#mrSetMsg').textContent, err:document.querySelector('#mrSetMsg').classList.contains('err')})`); };
    const bad1 = await save('dgxspark-yena:8765'), bad2 = await save('http://me:pw@dgxspark-yena:8765');
    const good = await save(FAKE + '/');
    await p.click('#mrReset');
    const reset = await p.eval(`({ls:localStorage.getItem('nb-mrserver'), val:document.querySelector('#mrServer').value, msg:document.querySelector('#mrSetMsg').textContent})`);
    const same = await save('http://dgxspark-yena:8765/');
    // 틀린 값을 쳐 두고 저장 없이 닫으면 → 다시 열 때 저장된 값 (지금은 기본값)
    await p.eval(`document.querySelector('#mrServer').value='http://고치다 만 주소'`);
    await p.click('#cloudClose'); await p.click('#settingsBtn');
    const reopened = await p.eval(`({val:document.querySelector('#mrServer').value, msg:document.querySelector('#mrSetMsg').hidden})`);
    const fin = await save(FAKE);
    await p.click('#cloudClose');
    ok('U3', lay.i > 0 && lay.prev === '백업 파일' && lay.next === '휴대폰 리모컨' && lay.val === 'http://dgxspark-yena:8765'
      && lay.hints.includes("주소창에 '안전하지 않음'이 보여도 집 Tailscale 안에서만 열리는 창이에요") && lay.hints.includes('이 기기에만 저장돼요. 집 밖에서는 Tailscale을 켜 주세요.'),
      `칸 자리 "${lay.prev}" 아래·"${lay.next}" 위, 기본값 ${lay.val}, 안내 ${lay.hints.length}줄 (L2 줄 있음)`);
    ok('U3', bad1.ls === null && bad1.err && bad1.msg === '주소는 http:// 또는 https://로 시작해야 해요 (예: http://dgxspark-yena:8765)' && bad2.ls === null && bad2.err && /@/.test(bad2.msg),
      `틀린 주소는 저장 안 함: "${bad1.msg}" · "${bad2.msg}"`);
    ok('U3', good.ls === FAKE && good.val === FAKE && !good.err && /^저장했어요/.test(good.msg) && reset.ls === null && reset.val === 'http://dgxspark-yena:8765' && reset.msg === '기본값으로 돌렸어요'
      && same.ls === null && same.val === 'http://dgxspark-yena:8765' && reopened.val === 'http://dgxspark-yena:8765' && reopened.msg && fin.ls === FAKE,
      `저장 → nb-mrserver "${good.ls}"(끝 / 뗌) · [기본값으로] → 지움 · 기본값과 같은 주소 → 지움 · 저장 안 하고 닫으면 다시 열 때 저장된 값`);
    // 백업 파일·Drive 곡 목록에는 안 들어감
    const lib = await p.eval(`JSON.stringify(buildLibrary({ songs: state.songs, tombs: state.tombs, profiles: Profiles.list, recs: state.recs, recTombs: state.recTombs }))`);
    await p.click('#settingsBtn');
    await p.eval(`document.querySelector('#bkRecs').checked=false; document.querySelector('#bkVideo').checked=false`);
    const since = ctx.downloads().length;
    await p.click('#bkExport');
    const d = await waitDownload(ctx, /^YT노래방_백업_\d{8}\.ytbackup$/, since, 20000);
    await p.eval(`document.querySelector('#bkRecs').checked=true; document.querySelector('#bkVideo').checked=true`);
    await p.click('#cloudClose');
    let head = '';
    if (d) { const buf = fs.readFileSync(d.file), hl = buf.readUInt32LE(6); head = buf.subarray(10, 10 + hl).toString('utf8'); }
    ok('U3', !!d && head.includes('"songs"') && !head.includes('mrserver') && !head.includes(FAKE) && lib.includes('"songs"') && !lib.includes('mrserver') && !lib.includes(FAKE),
      `백업 파일 머리(${head.length}B)와 Drive library.json 모양에 서버 주소·nb-mrserver 없음`);
  });

  await step('[MR 만들기] → 가짜 MR 창이 설정 주소로 열림 → hello/welcome → files → 여러 곡 넣기 창(안내 줄·제목·가수·가사 자동) → ack → 저장 → 새로고침 뒤에도 남음', ['U1', 'U6'], async () => {
    ctx.lrcRules.length = 0;
    ctx.lrcRules.push({ q: '^QA 시험 만든곡', body: [cand(301, 'QA 시험 만든곡', 'QA가수M', 3)] });
    await closePopups(ctx, FAKE);
    await p.click('#mrBtn');
    pop = await attachPopup(ctx, FAKE);
    const linked = pop && await pop.until('window.__linked');
    const info = pop && await pop.ev(`({url:location.href, name:window.name, opener:!!window.opener})`);
    const nb = await p.eval(`({linked:Mr.linked, origin:Mr.origin, msg:document.querySelector('#mrMsg').hidden})`);
    ok('U1', !!pop && linked && info.url === FAKE + '/' && info.name === 'yena-mr' && info.opener && nb.linked && nb.origin === FAKE && nb.msg,
      `창 ${info?.url} (이름 ${info?.name}, opener ${info?.opener ? '있음' : '없음'}) · hello → welcome → 노래방 "이어짐"`);
    // 이어진 창이 열려 있을 때 다시 누르면 다시 열지 않음 (올리는 중인 곡이 끊기지 않게)
    await pop.ev(`window.__mark = 1`);
    const m0 = await marks(p);
    await p.click('#mrBtn');
    const t = await sawToast(p, /MR 만들기 창이 이미 열려 있어요/, m0, 3000);
    await sleep(400);
    const kept = await pop.ev(`window.__mark === 1`).catch(() => false);
    ok('U1', t && kept && await popups(ctx, FAKE) === 1, '이어진 창이 열려 있으면 다시 열지 않고 알림 "MR 만들기 창이 이미 열려 있어요 …"');

    const n0 = await p.eval('state.songs.length'), nextNo = await p.eval('nextSongNumbers(state.songs,1)[0]');
    const sent = await pop.ev(`sendFiles([{name:${q(MADE)}, type:'audio/mpeg', sec:3}])`);
    const opened = await p.until(`document.querySelector('#bulkDialog').open`, 5000);
    const h = await bulkHead(p);
    const acked = await pop.until(`__got.some(m=>m.type==='ack' && m.n===1)`, 4000);
    ok('U6', opened && h.info === 'MR 만들기로 만든 곡 1개예요. 제목·가수를 확인해 주세요' && h.rows.length === 1 && h.rows[0].t === 'QA 시험 만든곡' && h.rows[0].a === 'QA가수M' && h.rows[0].no === String(nextNo) && acked,
      `"${h.info}" · 줄 ${h.rows[0]?.no} "${h.rows[0]?.t} / ${h.rows[0]?.a}" · 창에 ack {n:1}`);
    await p.until(`!Bulk.running`, 30000, 200);
    const st = (await bulkHead(p)).rows[0]?.st || '';
    await p.click('#blkSave');
    await p.until(`!document.querySelector('#bulkDialog').open && state.songs.length>${n0}`, 10000);
    const s = await p.eval(`(()=>{const s=state.songs.find(x=>x.title==='QA 시험 만든곡'); return s?{id:s.id,no:s.no,a:s.artist,mime:s.mime,size:s.blob?.size,lyr:!!s.lyrics}:null})()`);
    if (s) made.push(s.id);
    await p.goto(ctx.base + '/index.html', 'typeof state!=="undefined" && state.song && !!state.song.buffer');
    const back = await p.eval(`(()=>{const s=state.songs.find(x=>x.title==='QA 시험 만든곡'); return s?{no:s.no,a:s.artist,lyr:!!s.lyrics,blob:!!s.blob}:null})()`);
    ok('U6', !!s && s.no === nextNo && s.a === 'QA가수M' && s.mime === 'audio/mpeg' && s.size === sent?.[0]?.size && s.lyr && /가사 자동/.test(st) && !!back && back.no === nextNo && back.lyr && back.blob,
      `[저장] → ${s?.no}번 "QA 시험 만든곡 / ${s?.a}" (audio/mpeg ${s?.size}B, 가사 자동 "${st}") · 새로고침 뒤에도 남음`);
    ctx.lrcRules.length = 0;
    if (pop) await pop.detach();
    await closePopups(ctx, FAKE);      // 노래방을 새로고침하면 Mr.win을 잃는다: 창도 닫는다
  });

  await step('못 열 때 안내: 팝업 막힘 · 10초 안에 인사 없음 → [다시 열기] · 인터넷 끊김이면 창을 열지 않음', ['U2'], async () => {
    await p.eval(`window.__wo = window.open; window.open = () => null`);
    await p.click('#mrBtn');
    const blocked = await msgState(p);
    await p.eval(`window.open = window.__wo`);
    ok('U2', blocked.shown && blocked.text === '새 창이 막혔어요. 주소창 오른쪽에서 이 사이트의 팝업을 허용해 주세요' && blocked.retry, `팝업 막힘 → "${blocked.text}" + [다시 열기]`);

    // 인사하지 않는 주소 (가짜 서버의 없는 곳 = 404 화면): 10초 동안 기다린 뒤 안내
    await p.eval(`localStorage.setItem('nb-mrserver', ${q(FAKE + '/no-such-place')})`);
    const t0 = Date.now();
    await p.click('#mrBtn');
    await sleep(3000);
    const early = await msgState(p);
    const shown = await p.until(`!document.querySelector('#mrMsg').hidden`, 12000, 200);
    const sec = (Date.now() - t0) / 1000;
    const late = await msgState(p);
    ok('U2', !early.shown && shown && sec >= 9.5 && late.text === '⟳ 집 AI 서버에 못 닿았어요 · Tailscale이 켜져 있는지 확인해 주세요' && late.retry && await p.eval('MR_HELLO_MS') === 10000,
      `인사 없음 → ${sec.toFixed(1)}초 뒤 "${late.text}" + [다시 열기] (3초엔 안내 없음)`);
    // 주소를 고치고 [다시 열기] → 이어지면 안내가 사라짐
    await p.eval(`localStorage.setItem('nb-mrserver', ${q(FAKE)})`);
    await p.click('#mrRetry');
    const again = await p.until(`Mr.linked && document.querySelector('#mrMsg').hidden`, 8000);
    ok('U2', again && await popups(ctx, FAKE) === 1, '[다시 열기] → 같은 창(yena-mr)이 다시 열려 이어지고 안내가 사라짐');
    await closePopups(ctx, FAKE);

    // 인터넷 끊김: 창을 열지 않고 안내만 (앱 화면은 그대로)
    await p.offline(true); await sleep(300);
    await p.click('#mrBtn');
    await sleep(500);
    const off = await msgState(p), n = await popups(ctx, FAKE);
    await p.offline(false); await sleep(300);
    ok('U2', off.shown && /인터넷이 끊겨/.test(off.text) && off.retry && n === 0, `인터넷 끊김 → 창 안 엶, "${off.text}"`);
    await p.eval('mrHideMsg()');
  });

  await step('이상한 메시지는 무시: 약속 밖 모양·다른 주소·열지 않은 창 (답 없음), 파일 아님·120MB 넘음·MR 파일 아님 (nack bad) — 곡이 안 생기고 오류도 없음', ['U6'], async () => {
    await p.click('#mrBtn');
    pop = await attachPopup(ctx, FAKE);
    await pop.until('window.__linked');
    const n0 = await p.eval('state.songs.length'), e0 = p.events.filter(e => e.kind === 'pageerror').length;
    const got = () => pop.ev('__got.slice(1).map(m=>m.type+(m.reason?":"+m.reason:""))');   // 0번은 welcome
    // 약속 밖 모양 (app·v가 다름) → 답 없음
    await pop.ev(`sendRaw({app:'other', v:1, type:'files', files:[makeFile({name:'QA 시험 - QA (MR).mp3'})]})`);
    await pop.ev(`sendRaw({app:'yena-mr', v:2, type:'files', files:[makeFile({name:'QA 시험 - QA (MR).mp3'})]})`);
    await sleep(600);
    const g1 = await got();
    // 노래방에 직접 넣은 메시지: 보낸 주소가 다름 / 내가 연 창이 아님 → 답 없음
    await p.eval(`(()=>{ const f=new File([new Uint8Array(64)], 'QA 시험 - QA (MR).mp3', {type:'audio/mpeg'}), d={app:'yena-mr', v:1, type:'files', files:[f]};
      dispatchEvent(new MessageEvent('message', {data:d, origin:'http://evil.test', source:Mr.win}));
      dispatchEvent(new MessageEvent('message', {data:d, origin:${q(FAKE)}, source:window})); })()`);
    await sleep(600);
    const g2 = await got(), open2 = await p.eval(`document.querySelector('#bulkDialog').open`);
    // 내 창이 보낸 틀린 파일 → nack bad
    await pop.ev(`sendRaw({app:'yena-mr', v:1, type:'files', files:['QA 시험 - QA (MR).mp3']})`);
    await pop.ev(`sendRaw({app:'yena-mr', v:1, type:'files', files:[makeFile({name:'QA 시험 메모.txt', type:'text/plain', text:'memo'})]})`);
    await pop.ev(`sendBig()`);
    await pop.until(`__got.filter(m=>m.type==='nack').length>=3`, 15000);
    const g3 = await got();
    const after = await p.eval(`({n:state.songs.length, open:document.querySelector('#bulkDialog').open})`);
    const e1 = p.events.filter(e => e.kind === 'pageerror').length;
    ok('U6', g1.length === 0 && g2.length === 0 && !open2 && g3.join(',') === 'nack:bad,nack:bad,nack:bad' && after.n === n0 && !after.open && e1 === e0,
      `약속 밖 2개·다른 주소·열지 않은 창 → 답 없음, 파일 아님·MR 아님·121MB → ${g3.join(', ')}, 곡 ${after.n - n0}개 생김, 페이지 오류 ${e1 - e0}`);
  });

  await step('다른 창이 열려 있으면 받지 않음 (nack busy, 알림, 열려 있던 창·입력 그대로) → 닫고 다시 보내면 받음', ['U7'], async () => {
    await pop.ev(`__got.length = 0`);
    await p.click('#addSongBtn');
    await p.until(`document.querySelector('#songDialog').open`, 3000);
    await p.eval(`(()=>{const i=document.querySelector('#f-title'); i.value='QA 시험 입력 중'; i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const m0 = await marks(p);
    await pop.ev(`sendFiles([{name:${q(MADE)}, type:'audio/mpeg', sec:3}])`);
    const nack = await pop.until(`__got.some(m=>m.type==='nack' && m.reason==='busy')`, 4000);
    const t = await sawToast(p, /열려 있는 창을 닫고 MR 만들기 창에서 \[노래방으로 보내기\]를 다시 눌러 주세요/, m0, 3000);
    const kept = await p.eval(`({song:document.querySelector('#songDialog').open, bulk:document.querySelector('#bulkDialog').open, title:document.querySelector('#f-title').value})`);
    await p.click('#dlgCancel').catch(async () => p.eval(`document.querySelector('#songDialog').close()`));
    await p.until(`!document.querySelector('#songDialog').open`, 3000);
    // 창의 [노래방으로 보내기] = 같은 파일을 다시 보냄
    await pop.ev(`sendFiles([{name:${q(MADE)}, type:'audio/mpeg', sec:3}])`);
    const opened = await p.until(`document.querySelector('#bulkDialog').open`, 5000);
    const acked = await pop.until(`__got.some(m=>m.type==='ack')`, 4000);
    const h = await bulkHead(p);
    ok('U7', nack && t && kept.song && !kept.bulk && kept.title === 'QA 시험 입력 중' && opened && acked && h.rows[0]?.t === 'QA 시험 만든곡',
      `곡 추가 창이 열린 채 → nack busy + 알림, 창·입력("${kept.title}") 그대로 · 닫고 다시 보냄 → 여러 곡 넣기 창 + ack`);
    await p.until(`!Bulk.running`, 30000, 200);
    await p.click('#blkCancel');
    await p.until(`!document.querySelector('#bulkDialog').open`, 3000);
  });

  // 정리: 창 닫기, 만든 곡·설정 지우기
  if (pop) await pop.detach();
  await closePopups(ctx, FAKE).catch(() => {});
  await p.eval(`(async()=>{ for (const id of ${q(made)}) { const s=songById(id); if (s) await deleteSong(s); } localStorage.removeItem('nb-mrserver'); })()`).catch(() => {});
  await ctx.stopFakeMr();
  await stopAll(p);
}
