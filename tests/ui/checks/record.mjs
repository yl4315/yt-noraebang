// 흐름 11: 녹음 (마이크 없이: 마이크가 꺼져 있으면 목소리 없이 녹음되고 1.5초가 넘으면 저장된다), 내 녹음, 싱크·믹스 조절, WAV,
// 녹음 나누기 (CR-031: 폰 [공유]·PC [작은 파일로 저장], 공유는 흉내)
import fs from 'node:fs';
import path from 'node:path';
import { PHONE, READY_DEMO, openPage, clipShot, txt, visible, isHidden, marks, sawToast, sleep, q, stopAll, selectById, seedRec } from './_lib.mjs';
export const areas = ['J', 'F'];

export async function waitDownload(ctx, re, since, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const d = ctx.downloads().slice(since).find(x => re.test(x.name) && x.state === 'completed');
    if (d) return { ...d, size: fs.statSync(d.file).size, head: fs.readFileSync(d.file).subarray(0, 12) };
    await sleep(150);
  }
  return null;
}

export default async function record(ctx) {
  const { ok, step } = ctx, p = ctx.p, ids = ctx.ids;
  await stopAll(p);
  await p.eval(`state.queue=[]; saveQueue(); renderQueue(); if(state.armed) setArmed(false)`);
  await selectById(p, ids.short);
  const nRecs = () => p.eval('state.recs.length');

  await step('마이크 없이 녹음: "목소리 없이 녹음돼요" → 일시정지 → 끝나면 저장', ['J14', 'J1', 'J2', 'J4', 'J3', 'F1'], async () => {
    // toast()를 부른 글도 적어 둔다 (화면에 보였는지와, 앱이 안내를 부르기는 했는지를 나눠 보려고)
    await p.eval(`if(!window.__toastCalls){ window.__toastCalls=[]; const o=toast; toast=(m,ms)=>{ __toastCalls.push(m); return o(m,ms); }; }`);
    const n0 = await nRecs();
    await p.click('#recBtn');
    await p.until('state.armed', 3000);
    const lbl0 = await txt(p, '#recLbl');
    const m = await marks(p), c0 = await p.eval('__toastCalls.length');
    await p.key(' ');
    await p.until('state.playing && !!take', 3000);
    const lbl1 = await p.eval(`({l:document.querySelector('#recLbl').textContent, b:!document.querySelector('#recBadge').hidden && document.querySelector('#recBadge').textContent==='● REC'})`);
    await sleep(600);
    await p.key(' ');
    const lbl2 = await p.eval(`({l:document.querySelector('#recLbl').textContent, b:document.querySelector('#recBadge').hidden, p:state.playing})`);
    await p.key(' ');
    const saved = await p.until(`state.recs.length===${n0 + 1}`, 15000);
    const t = await sawToast(p, /녹음 저장됨 · QA 시험 짧은 곡 \(0:0\d\)/, m, 3000);
    const r = await p.eval(`(()=>{const r=state.recs[0]; return {v:r.v, title:r.title, parts:r.parts.length, dur:r.duration, size:r.vocal.size, count:document.querySelector('#recCount').textContent}})()`);
    ids.recNew = await p.eval('state.recs[0].id');
    const seen = await sawToast(p, /마이크가 꺼져 있어서 목소리 없이 녹음돼요/, m, 200);
    const asked = await p.eval(`__toastCalls.slice(${c0}).includes('마이크가 꺼져 있어서 목소리 없이 녹음돼요')`);
    const after = await p.eval(`__toastCalls.slice(${c0}).slice(0,3).join(' → ')`);
    ok('J14', seen, seen ? '마이크 꺼진 채 녹음 → "마이크가 꺼져 있어서 목소리 없이 녹음돼요"'
      : `녹음을 켜 둔 채 처음부터 시작하면 안내가 화면에 안 보임: 앱은 ${asked ? '불렀지만' : '부르지도 않고'} 같은 순간 다른 알림에 덮임 (${after})`);
    ok('F1', lbl0.startsWith('녹음 대기') && lbl1.l === '녹음 중' && lbl1.b && lbl2.l === '녹음 일시정지', `녹음 상태 글: "${lbl0}" → "${lbl1.l}"(● REC ${lbl1.b}) → "${lbl2.l}"`);
    ok('J1', saved && r.title === 'QA 시험 짧은 곡', '녹음을 켜고 시작하면 녹음됨 (목소리 없이)');
    ok('J2', lbl2.l === '녹음 일시정지' && lbl2.b && !lbl2.p && saved, '일시정지하면 녹음도 멈춤(REC 숨김), 끝나면 저장');
    ok('J4', t, `저장 알림 "녹음 저장됨 · QA 시험 짧은 곡 (…)"`);
    ok('J3', r.v === 2 && r.parts >= 1 && r.size > 0 && r.count === String(n0 + 1), `목소리 따로(${r.size}바이트) + 반주 위치 ${r.parts}조각 → 다시 섞을 수 있음`);
    // 노래 중에 녹음을 켜면 (마이크 꺼짐) 안내가 보인다
    await p.click('#recBtn'); await p.until('!state.armed', 2000);
    await p.key(' '); await p.until('state.playing', 3000);
    const m3 = await marks(p);
    await p.click('#recBtn');
    const seenMid = await sawToast(p, /마이크가 꺼져 있어서 목소리 없이 녹음돼요/, m3, 2500);
    await p.click('#stopBtn'); await sleep(800);
    ok('J14', seenMid, '노래 중에 녹음을 켜면 (마이크 꺼짐) "마이크가 꺼져 있어서 목소리 없이 녹음돼요"');
    const n1 = await nRecs();
    // 1.5초 미만은 버림 (녹음은 켜 둔 채)
    await p.key(' '); await p.until('state.playing', 3000);
    await sleep(700);
    await p.click('#stopBtn');
    await sleep(1200);
    const n2 = await nRecs();
    ok('J2', n2 === n1, `0.7초만 녹음하고 정지 → 저장 안 함 (녹음 ${n2}개 그대로)`);
    // 녹음을 못 하는 브라우저 흉내: 캡처 노드가 없으면
    const m2 = await marks(p), c2 = await p.eval('__toastCalls.length');
    await p.eval(`window.__cap=E.cap; E.cap=null`);
    await p.key(' '); await p.until('state.playing', 3000);
    const j14b = await sawToast(p, /이 브라우저는 녹음을 지원하지 않아요/, m2, 1500);
    const asked2 = await p.eval(`__toastCalls.slice(${c2}).includes('이 브라우저는 녹음을 지원하지 않아요')`);
    await p.click('#stopBtn');
    await p.eval(`E.cap=window.__cap`);
    await p.click('#recBtn');
    ok('J14', j14b, j14b ? '녹음을 못 하는 브라우저면 "이 브라우저는 녹음을 지원하지 않아요"' : `녹음을 못 하는 브라우저 안내도 처음부터 시작하면 안 보임 (앱은 ${asked2 ? '불렀지만 덮임' : '안 부름'})`);
    if (!seen || !j14b) ctx.finding('J14', '녹음을 켜 둔 채(마이크 꺼짐) 처음부터 시작하면 play()가 "마이크가 꺼져 있어서 목소리 없이 녹음돼요"(또는 "이 브라우저는 녹음을 지원하지 않아요") 바로 다음에 "마이크를 켜면 녹음하고 점수도 받을 수 있어요"를 띄워서 앞 안내가 한 번도 안 보임 (js/playback.js play: startRecording() 뒤 toast). 노래 중에 녹음을 켜면 보임');
  });

  await step('내 녹음 탭: 날짜·길이·점수, "반주 없음"·"반주 위치 맞추기 필요", Drive에만 있는 녹음, 예전 방식 녹음', ['J5', 'J7', 'J8'], async () => {
    const base = Date.now() - 2 * 3600e3;
    ids.recScore = await seedRec(p, { songId: ids.long, title: 'QA 시험 점수 녹음', score: 88, createdAt: base });
    ids.recNoParts = await seedRec(p, { songId: ids.long, title: 'QA 시험 반주 위치 없음', parts: false, createdAt: base - 60e3 });
    ids.recLegacy = await seedRec(p, { songId: ids.long, title: 'QA 시험 예전 녹음', v2: false, createdAt: base - 120e3 });
    ids.recDrive = await seedRec(p, { songId: ids.long, title: 'QA 시험 Drive 녹음', fileId: 'qa-rec-file', media: false, createdAt: base - 180e3 });
    await p.click('#tabRecs');
    const rows = await p.eval(`[...document.querySelectorAll('#recList li.rec')].map(li=>({t:li.querySelector('.t').textContent, sub:li.querySelector('.sub').textContent, chip:li.querySelector('.score-chip')?.textContent||'', btns:[...li.querySelectorAll('.btns button')].map(b=>b.textContent), audio:!!li.querySelector('audio[controls]')}))`);
    const by = t => rows.find(r => r.t === t) || {};
    const dateRe = /^\d{1,2}월 \d{1,2}일 \d\d:\d\d · \d:\d\d/;
    ok('J5', rows.every(r => dateRe.test(r.sub)) && by('QA 시험 점수 녹음').chip === '88점' && / · 반주 없음$/.test(by('QA 시험 깨진 파일').sub) && / · 반주 위치 맞추기 필요$/.test(by('QA 시험 반주 위치 없음').sub)
      && !(await isHidden(p, '#recHint')), `${rows.length}개: 날짜·길이 "${rows[0]?.sub}" · 점수 칩 · "반주 없음" · "반주 위치 맞추기 필요"`);
    const dr = by('QA 시험 Drive 녹음');
    ok('J7', dr.btns?.includes('기기로 받기') && /☁ Drive/.test(dr.sub), `Drive에만 있는 녹음: "${dr.sub}" + "기기로 받기"`);
    const lg = by('QA 시험 예전 녹음');
    const since = ctx.downloads().length;
    const i = rows.findIndex(r => r.t === 'QA 시험 예전 녹음') + 1;
    await p.click(`#recList li.rec:nth-child(${i}) .btns button`);
    const d = await waitDownload(ctx, /^QA 시험 예전 녹음_\d{8}-\d{4}\.webm$/, since);
    ok('J8', lg.audio && lg.btns?.includes('다운로드') && !!d, `예전 방식 녹음: 플레이어 + "다운로드" → ${d ? d.name : '받아지지 않음'}`);
  });

  await step('싱크·믹스 조절: 듣기, 목소리 타이밍(−300~+800), 볼륨·에코·리버브, WAV 내보내기, 저장', ['J3', 'J9', 'J11', 'J12'], async () => {
    const rowSel = id => p.eval(`[...document.querySelectorAll('#recList li.rec')].findIndex(li=>li.querySelector('[data-play="${id}"]'))+1`);
    let i = await rowSel(ids.recNew);
    await p.click(`#recList li.rec:nth-child(${i}) .btns .primary`);
    const open = await p.until(`document.querySelector('#mixDialog').open`, 3000);
    const head = await p.eval(`({t:document.querySelector('#mxTitle').textContent, start:document.querySelector('#mxStartBox').hidden, warn:document.querySelector('#mxWarn').hidden, min:document.querySelector('#mxOff').min, max:document.querySelector('#mxOff').max})`);
    await p.click('#mxPlay');
    const playing = await p.until(`P.playing && pTime()>0.4`, 6000);
    const tm = await txt(p, '#mxTime');
    await p.click('#mxPlay');
    ok('J3', open && playing && /^0:0\d \/ 0:0\d$/.test(tm), `싱크·믹스 조절에서 목소리+반주 다시 섞어 듣기 (${tm})`);
    // 목소리 타이밍
    const off = () => p.eval(`({v:+document.querySelector('#mxOff').value, t:document.querySelector('#mxOffV').textContent})`);
    const o0 = await off();
    await p.click('[data-nudge="10"]'); const o1 = await off();
    await p.click('[data-nudge="-1"]'); const o2 = await off();
    ok('J9', head.min === '-300' && head.max === '800' && o1.v === o0.v + 10 && o2.v === o0.v + 9 && /목소리 \d+ms 앞당김/.test(o1.t), `범위 ${head.min}~${head.max} · +10 → "${o1.t}" · −1 → ${o2.v}`);
    // 볼륨·에코·리버브 (키보드로 슬라이더)
    const knobs = {};
    for (const k of ['vocal', 'mr', 'echo', 'reverb']) {
      const b = await txt(p, `#mxv-${k}`);
      await p.eval(`document.querySelector('#mx-${k}').focus()`); await p.key('ArrowLeft'); await p.key('ArrowLeft');
      knobs[k] = [b, await txt(p, `#mxv-${k}`)];
    }
    const changed = Object.entries(knobs).filter(([, [a, b]]) => +b === +a - 2).map(([k]) => k);
    // WAV 내보내기
    const since = ctx.downloads().length;
    await p.click('#mxWav');
    const wav = await waitDownload(ctx, /^QA 시험 짧은 곡_\d{8}-\d{4}\.wav$/, since, 20000);
    // 저장 → 다음 녹음 기본 싱크로도
    const m = await marks(p);
    await p.click('#mxSave');
    const t = await sawToast(p, new RegExp(`저장했어요 · 다음 녹음은 ${Math.min(600, Math.max(0, o2.v))}ms 보정으로 시작해요`), m);
    const db = await p.eval(`DB.get('recs', ${q(ids.recNew)}).then(r=>r.mix)`);
    const rec = await p.eval(`({off:settings.recOffset, touched:settings.recOffsetTouched})`);
    ok('J12', !!wav && wav.size > 44 && wav.head.toString('latin1', 0, 4) === 'RIFF' && t && db.offset === o2.v && rec.off === Math.min(600, Math.max(0, o2.v)),
      `WAV ${wav ? wav.name + ' ' + wav.size + '바이트' : '없음'} · 저장 → 녹음에 저장, 다음 녹음 기본 싱크 ${rec.off}ms`);
    // 곡이 지워진 녹음: 경고
    i = await rowSel(ids.recDeleted);
    await p.click(`#recList li.rec:nth-child(${i}) .btns .primary`);
    await p.until(`document.querySelector('#mixDialog').open`, 3000);
    const warn = await p.eval(`!document.querySelector('#mxWarn').hidden && document.querySelector('#mxWarn').textContent.includes('삭제돼서')`);
    await p.click('#mxClose');
    ok('J11', changed.length === 4 && db.vocal === +knobs.vocal[1] && head.warn && warn, `목소리·반주·에코·리버브가 바뀌고 저장됨 (${changed.join(',')}) · 곡이 지워진 녹음은 경고`);
    await p.eval(`Object.assign(settings,{recOffset:120, recOffsetTouched:false}); applySettings(); saveSettings()`);
  });

  await step('반주 위치 기록이 없는 녹음은 반주 시작 위치 맞추기', ['J10'], async () => {
    const i = await p.eval(`[...document.querySelectorAll('#recList li.rec')].findIndex(li=>li.querySelector('[data-play="${ids.recNoParts}"]'))+1`);
    await p.click(`#recList li.rec:nth-child(${i}) .btns .primary`);
    await p.until(`document.querySelector('#mixDialog').open`, 3000);
    const box = await visible(p, '#mxStartBox');
    await p.until(`+document.querySelector('#mxStart').max>1`, 5000);
    await p.click('[data-snudge="1"]'); await p.click('[data-snudge="0.1"]');
    const v = await txt(p, '#mxStartV');
    await p.click('#mxSave');
    const saved = await p.eval(`DB.get('recs', ${q(ids.recNoParts)}).then(r=>r.mix.mrStart)`);
    ok('J10', box && v === '반주 00:01.10부터' && Math.abs(saved - 1.1) < 0.001, `반주 시작 위치 칸 → +1초 +0.1 → "${v}" 저장`);
    await p.eval(`Object.assign(settings,{recOffset:120, recOffsetTouched:false}); applySettings(); saveSettings()`);
  });

  await step('내 녹음: 듣기·WAV로 저장·삭제(한 번 더 눌러 확인)', ['J6'], async () => {
    const i = await p.eval(`[...document.querySelectorAll('#recList li.rec')].findIndex(li=>li.querySelector('[data-play="${ids.recScore}"]'))+1`);
    const sel = `#recList li.rec:nth-child(${i})`;
    await p.click(`${sel} [data-play]`);
    const listening = await p.until(`/^⏸ /.test(document.querySelector('${sel} [data-play]').textContent)`, 5000);
    await p.click(`${sel} [data-play]`);
    const since = ctx.downloads().length;
    const wi = await p.eval(`[...document.querySelectorAll('${sel} .btns button')].findIndex(b=>b.textContent==='WAV로 저장')+1`);   // CR-031: 3번째는 [작은 파일로 저장]
    await p.click(`${sel} .btns button:nth-child(${wi})`);
    const wav = await waitDownload(ctx, /^QA 시험 점수 녹음_\d{8}-\d{4}\.wav$/, since, 20000);
    const n0 = await nRecs();
    await p.click(`${sel} .btns .danger`);
    const armed = await txt(p, `${sel} .btns .danger`);
    await p.click(`${sel} .btns .danger`);
    const gone = await p.until(`state.recs.length===${n0 - 1} && !state.recs.some(r=>r.id===${q(ids.recScore)})`, 3000);
    const db = await p.eval(`DB.get('recs', ${q(ids.recScore)}).then(r=>!!r)`);
    ok('J6', listening && !!wav && armed === '삭제?' && gone && !db, `▶ 듣기 → ⏸ · WAV로 저장 ${wav ? wav.size + '바이트' : '안 됨'} · 삭제 "${armed}" → 한 번 더 → 지워짐`);
  });

  /* ---------------- 녹음 나누기 (CR-031) ----------------
     진짜 OS 공유 창이 PC에 뜨지 않게, 폰 탭은 문서를 열기 전에 navigator.share·canShare를 흉내로 바꾼다.
     내려받기는 점검 임시 폴더(ctx.dlDir)로만. 사진은 결과 폴더 cr031/ (스크린샷 비교 shots/와 따로) */
  const crDir = path.join(ctx.OUT, 'cr031');
  const rowOf = (pg, title) => pg.eval(`(()=>{const L=[...document.querySelectorAll('#recList li.rec')]; const i=L.findIndex(li=>li.querySelector('.t').textContent===${q(title)}); return i<0?null:{i:i+1, sel:'#recList li.rec:nth-child('+(i+1)+')', btns:[...L[i].querySelectorAll('.btns button')].map(b=>b.textContent), share:!!L[i].querySelector('[data-share]')}})()`);
  // 페이지 안에서 소리 파일 읽기 (decodeAudioData): 길이·채널·소리 크기
  const DECODE = blobExpr => `(async()=>{ try { const ab=await (${blobExpr}).arrayBuffer(); const ac=new OfflineAudioContext(2, 4800, 48000); const b=await ac.decodeAudioData(ab); let pk=0; const d=b.getChannelData(0); for (let i=0;i<d.length;i+=5) pk=Math.max(pk,Math.abs(d[i])); return {ok:true, dur:b.duration, ch:b.numberOfChannels, pk} } catch(e) { return {ok:false, err:String(e)} } })()`;
  const fromB64 = b64 => `new Blob([Uint8Array.from(atob(${q(b64)}),c=>c.charCodeAt(0))])`;
  const SEC = 3, WANT = SEC + 1.5;            // 믹스 길이 = 녹음 + 1.5초
  const pcIds = [];

  await step('녹음 나누기 (PC 마우스 화면): [작은 파일로 저장] → 작은 파일·알림, 창 단추, [WAV로 저장] 그대로, 예전 녹음은 새 단추 없음', ['J16', 'J17', 'J18'], async () => {
    const fm = await p.eval(`(async()=>({f48: await smallFormatFor(48000), f44: await smallFormatFor(44100), pick: Share.pick, small: Share.small, enc: typeof AudioEncoder}))()`);
    ctx.log(`  작은 파일 형식 (이 Edge): 48kHz ${fm.f48} · 44.1kHz ${fm.f44} (AudioEncoder ${fm.enc})`);
    const base = Date.now() - 5 * 3600e3;
    pcIds.push(await seedRec(p, { songId: ids.short, title: 'QA 시험 나누기 녹음', sec: SEC, createdAt: base }));
    pcIds.push(await seedRec(p, { songId: ids.short, title: 'QA 시험 나누기 예전', v2: false, createdAt: base - 60e3 }));
    await p.click('#tabRecs');
    const r1 = await rowOf(p, 'QA 시험 나누기 녹음'), lg = await rowOf(p, 'QA 시험 나누기 예전');
    await clipShot(p, [r1.sel], path.join(crDir, 'pc-1280-rec-row.png'));
    // [작은 파일로 저장]
    const ext = fm.f48 === 'wav' ? 'wav' : fm.f48;
    let since = ctx.downloads().length, m = await marks(p);
    await p.click(`${r1.sel} [data-share]`);
    const small = await waitDownload(ctx, new RegExp(`^QA 시험 나누기 녹음_\\d{8}-\\d{4}\\.${ext}$`), since, 30000);
    const saved = await sawToast(p, new RegExp(`저장했어요 · QA 시험 나누기 녹음_\\d{8}-\\d{4}\\.${ext} \\(\\d+(\\.\\d)?(KB|MB)\\)`), m, 5000);
    const label = await txt(p, `${r1.sel} [data-share]`);
    // 같은 믹스 WAV (기존 단추 그대로)
    since = ctx.downloads().length;
    const wi = await p.eval(`[...document.querySelectorAll(${q(r1.sel + ' .btns button')})].findIndex(b=>b.textContent==='WAV로 저장')+1`);
    await p.click(`${r1.sel} .btns button:nth-child(${wi})`);
    const wav = await waitDownload(ctx, /^QA 시험 나누기 녹음_\d{8}-\d{4}\.wav$/, since, 20000);
    const dec = small ? await p.eval(DECODE(fromB64(fs.readFileSync(small.file).toString('base64')))) : { ok: false, err: '받은 파일 없음' };
    const magic = small ? (ext === 'm4a' ? small.head.toString('latin1', 4, 8) : small.head.toString('latin1', 0, 4)) : '';
    ctx.log(`  작은 파일 ${small ? small.name + ' ' + small.size + '바이트' : '없음'} · WAV ${wav ? wav.size + '바이트' : '없음'} · 읽기 ${JSON.stringify(dec)}`);
    // 싱크·믹스 조절 창의 단추
    await p.click(`${r1.sel} .btns .primary`);
    await p.until(`document.querySelector('#mixDialog').open`, 3000);
    const mx = await p.eval(`(()=>{const b=document.querySelector('#mxShare'); return {hidden:b.hidden, t:b.textContent, order:[...b.parentElement.querySelectorAll('button')].map(x=>x.textContent)}})()`);
    await clipShot(p, ['#mixDialog .dlg-btns'], path.join(crDir, 'pc-1280-mix-buttons.png'));
    await p.click('#mxClose');
    const want = ['▶ 듣기', '싱크·믹스 조절', '작은 파일로 저장', 'WAV로 저장', '삭제'];
    ok('J17', JSON.stringify(r1.btns) === JSON.stringify(want) && !!small && saved && label === '작은 파일로 저장' && !mx.hidden && mx.t === '작은 파일로 저장'
      && mx.order[0] === '작은 파일로 저장' && mx.order[1] === 'WAV로 내보내기' && !!wav && wav.head.toString('latin1', 0, 4) === 'RIFF' && JSON.stringify(lg.btns) === JSON.stringify(['다운로드', '삭제']),
      `PC 줄 [${r1.btns.join('] [')}] → ${small ? small.name : '안 받아짐'} + "저장했어요 · 이름 (크기)" · 창 [${mx.order.slice(0, 2).join('] [')}] · [WAV로 저장] ${wav ? wav.size + '바이트' : '안 됨'} · 예전 녹음 [${lg.btns.join('] [')}]`);
    ok('J16', fm.f48 !== 'wav' && !!small && !!wav && small.size * 5 < wav.size && magic === (ext === 'm4a' ? 'ftyp' : 'OggS') && dec.ok && Math.abs(dec.dur - WANT) < 0.1 && dec.ch === 2 && dec.pk > 0.001,
      `${ext} ${small ? small.size : 0}바이트 < WAV ${wav ? wav.size : 0}의 1/5 · 머리 "${magic}" · Edge에서 읽힘 ${dec.ok ? dec.dur.toFixed(3) + '초 (녹음 ' + SEC + ' + 1.5초)' : dec.err}`);
    const stem = small && wav && small.name.replace(/\.\w+$/, '') === wav.name.replace(/\.\w+$/, '');
    ok('J18', stem, `작은 파일·WAV 이름이 같은 규칙: ${small?.name} / ${wav?.name}`);
  });

  await step('녹음 나누기 (폰 손가락 화면 412×915, 공유는 흉내): [공유] → 파일 1개·제목만, [보내기] 5초 규칙, 닫음·실패 안내, 예전 녹음 그대로, Ogg·WAV 대신, 공유 안 되면 저장, 창은 조절 중인 값', ['J15', 'J16', 'J17', 'J18'], async () => {
    const FAKE = `(()=>{ window.__sh={mode:'auto', canShare:true, calls:[], files:[]};
      Object.defineProperty(navigator,'canShare',{configurable:true, value:d=>__sh.canShare && !!(d&&d.files&&d.files.length)});
      Object.defineProperty(navigator,'share',{configurable:true, value:async d=>{
        const active=!!(navigator.userActivation&&navigator.userActivation.isActive), f=d&&d.files&&d.files[0];
        const head=f?String.fromCharCode(...new Uint8Array(await f.slice(0,12).arrayBuffer())):'';
        __sh.calls.push({keys:Object.keys(d||{}).sort(), n:(d.files||[]).length, name:f&&f.name, type:f&&f.type, size:f&&f.size, head, title:d.title, active, mode:__sh.mode}); __sh.files.push(f);
        const mode=__sh.mode;
        if (mode==='abort') throw new DOMException('UI점검: 일부러 닫음','AbortError');
        if (mode==='notallowed' || (mode==='auto' && !active)) throw new DOMException('UI점검: 일부러 동작 없음','NotAllowedError');
        if (mode==='fail') throw new DOMException('UI점검: 일부러 보내기 실패','DataError');
      }}); })()`;
    const ph = await openPage(ctx, PHONE, null);
    const phIds = [];
    try {
      await ph.s('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
      await ph.goto(ctx.base + '/index.html', READY_DEMO, 150000);
      const base = Date.now() - 6 * 3600e3;
      phIds.push(await seedRec(ph, { songId: ids.short, title: 'QA 시험 폰 나누기', sec: SEC, createdAt: base }));
      phIds.push(await seedRec(ph, { songId: ids.short, title: 'QA 시험 폰 예전', v2: false, createdAt: base - 60e3 }));
      await ph.eval(`(()=>{ window.__rm=0; window.__rmDelay=0; window.__rmOrig=renderMix; renderMix=async(...a)=>{ __rm++; if(__rmDelay) await new Promise(r=>setTimeout(r,__rmDelay)); return __rmOrig(...a); }; })()`);
      await ph.tap('#tabRecs');
      const calls = () => ph.eval('__sh.calls.length'), rm = () => ph.eval('__rm'), last = () => ph.eval('__sh.calls[__sh.calls.length-1]');
      const btnText = sel => ph.eval(`(()=>{const b=document.querySelector(${q(sel)}); return b?{t:b.textContent, d:b.disabled}:null})()`);
      let r = await rowOf(ph, 'QA 시험 폰 나누기');
      const lg = await rowOf(ph, 'QA 시험 폰 예전'), dr = await rowOf(ph, 'QA 시험 Drive 녹음');
      const sb = `${r.sel} [data-share]`;
      await clipShot(ph, [r.sel], path.join(crDir, 'phone-412-rec-row.png'));
      await clipShot(ph, [lg.sel], path.join(crDir, 'phone-412-legacy-row.png'));
      const touch = await ph.eval(`isTouch()`);
      // ① [공유] → 바로 공유 창 (짧은 곡은 5초 안에 만들어짐)
      let c0 = await calls(), rm0 = await rm();
      await ph.tap(sb);
      await ph.until(`__sh.calls.length>${c0}`, 20000);
      const s1 = await last(), rm1 = await rm();
      // 같은 것을 또 누르면 다시 안 만든다
      await ph.tap(sb); await ph.until(`__sh.calls.length>${c0 + 1}`, 5000);
      const rm2 = await rm();
      // ② 공유 창을 그냥 닫음 → 안내 없음 / ③ 그 밖 실패 → 안내
      await ph.eval(`__sh.mode='abort'`);
      let m = await marks(ph); c0 = await calls();
      await ph.tap(sb); await ph.until(`__sh.calls.length>${c0}`, 5000);
      const abortQuiet = !(await sawToast(ph, /./, m, 1500));
      await ph.eval(`__sh.mode='fail'`);
      m = await marks(ph);
      await ph.tap(sb);
      const failMsg = await sawToast(ph, /^보내지 못했어요 · 잠시 뒤 다시 눌러 보세요\. 계속 안 되면 \[WAV로 저장\]으로 저장해서 보내 주세요$/, m, 5000);
      const afterFail = await btnText(sb);
      // ④ 공유 창이 "동작이 오래됐다"고 거절 (NotAllowedError) → [보내기] → 다시 안 만들고 바로 공유
      await ph.eval(`Share.made=null; __sh.mode='notallowed'`);
      m = await marks(ph); c0 = await calls(); rm0 = await rm();
      await ph.tap(sb);
      await ph.until(`document.querySelector(${q(sb)}).textContent==='보내기'`, 20000);
      const naToast = await sawToast(ph, /^준비됐어요 · \[보내기\]를 눌러 주세요$/, m, 3000);
      await ph.eval(`__sh.mode='auto'`);
      await ph.tap(sb); await ph.until(`__sh.calls.length>${c0 + 1}`, 5000);
      const na = { rmUp: (await rm()) - rm0, after: await btnText(sb), share: await last() };
      // ⑤ 만드는 데 5초 넘게 걸림 → "만드는 중… N초"(눌림 방지) → [보내기] + 안내 → 누르면 바로 공유 (다시 안 만듦)
      await ph.eval(`Share.made=null; __rmDelay=5200`);
      m = await marks(ph); c0 = await calls(); rm0 = await rm();
      await ph.tap(sb);
      await sleep(300);
      const busy0 = await btnText(sb);
      const mb = await marks(ph);
      await ph.tap(`${lg.sel} [data-share]`);                                         // 다른 녹음 [공유]
      const busyToast = await sawToast(ph, /^다른 녹음을 만드는 중이에요 · 끝나면 눌러 주세요$/, mb, 2000);
      await ph.until(`/^만드는 중… [2-4]초$/.test(document.querySelector(${q(sb)}).textContent)`, 6000);
      const busy2 = await btnText(sb);
      await clipShot(ph, [r.sel], path.join(crDir, 'phone-412-making.png'));
      const readyOk = await ph.until(`document.querySelector(${q(sb)}).textContent==='보내기'`, 20000);
      const readyToast = await sawToast(ph, /^준비됐어요 · \[보내기\]를 눌러 주세요$/, m, 3000);
      await ph.shot(path.join(crDir, 'phone-412-send-ready.png'));
      const noShareYet = (await calls()) === c0;
      await ph.eval(`__rmDelay=0`);
      await ph.tap(sb); await ph.until(`__sh.calls.length>${c0}`, 5000);
      const slow = { rmUp: (await rm()) - rm0, share: await last(), after: await btnText(sb) };
      // ⑥ 예전 방식 녹음: 파일 그대로 (만들기 없음)
      c0 = await calls(); rm0 = await rm();
      await ph.tap(`${lg.sel} [data-share]`); await ph.until(`__sh.calls.length>${c0}`, 5000);
      const lgs = { share: await last(), rmUp: (await rm()) - rm0 };
      // ⑦ AAC 못 함 → Ogg Opus (가짜로 AAC만 "안 됨")
      await ph.eval(`(async()=>{ window.__isc=AudioEncoder.isConfigSupported; AudioEncoder.isConfigSupported=c=>/^mp4a/.test(c.codec)?Promise.resolve({supported:false, config:c}):__isc.call(AudioEncoder,c); Share.fmt.clear(); Share.made=null; await shareProbe(); renderRecs(); })()`);
      c0 = await calls();
      r = await rowOf(ph, 'QA 시험 폰 나누기');
      await ph.tap(sb); await ph.until(`__sh.calls.length>${c0}`, 20000);
      const og = await last();
      const ogDec = await ph.eval(DECODE('__sh.files[__sh.files.length-1]'));
      await ph.eval(`(async()=>{ AudioEncoder.isConfigSupported=__isc; Share.fmt.clear(); Share.made=null; await shareProbe(); renderRecs(); })()`);
      // ⑧ 작은 파일을 못 만드는 브라우저 (AudioEncoder 없음) → WAV로 공유 + 안내
      await ph.eval(`(async()=>{ window.__AE=window.AudioEncoder; window.AudioEncoder=undefined; Share.fmt.clear(); Share.made=null; await shareProbe(); renderRecs(); })()`);
      m = await marks(ph); c0 = await calls();
      const noEncLabel = (await btnText(sb))?.t;
      await ph.tap(sb); await ph.until(`__sh.calls.length>${c0}`, 20000);
      const wv = await last();
      const wavNote = await sawToast(ph, /^이 브라우저는 작은 파일을 못 만들어서 WAV로 보내요 \(파일이 커요\)$/, m, 3000);
      await ph.eval(`(async()=>{ window.AudioEncoder=__AE; Share.fmt.clear(); Share.made=null; await shareProbe(); renderRecs(); })()`);
      // ⑨ 공유가 안 되는 브라우저 (canShare false) → [작은 파일로 저장]
      await ph.eval(`__sh.canShare=false; renderRecs()`);
      const saveLabel = (await btnText(sb))?.t;
      let since = ctx.downloads().length; m = await marks(ph);
      await ph.tap(sb);
      const phSave = await waitDownload(ctx, /^QA 시험 폰 나누기_\d{8}-\d{4}\.(m4a|ogg)$/, since, 30000);
      const phSaved = await sawToast(ph, /^저장했어요 · QA 시험 폰 나누기_\d{8}-\d{4}\.(m4a|ogg) \(\d+(\.\d)?(KB|MB)\)$/, m, 5000);
      await ph.eval(`__sh.canShare=true; Share.made=null; renderRecs()`);
      // ⑩ 싱크·믹스 조절 창 [공유]: 조절 중인 값으로 만든 파일, 값을 바꾸면 다시 만든다
      await ph.tap(`${r.sel} .btns .primary`);
      await ph.until(`document.querySelector('#mixDialog').open`, 3000);
      const mxt = await btnText('#mxShare');
      await clipShot(ph, ['#mixDialog .dlg-btns'], path.join(crDir, 'phone-412-mix-buttons.png'));
      c0 = await calls(); rm0 = await rm();
      await ph.tap('#mxShare'); await ph.until(`__sh.calls.length>${c0}`, 20000);
      await ph.tap('#mxShare'); await ph.until(`__sh.calls.length>${c0 + 1}`, 5000);
      const mxSame = (await rm()) - rm0;
      await ph.tap('[data-nudge="10"]');
      const draftOff = await ph.eval('draft.offset');
      await ph.tap('#mxShare'); await ph.until(`__sh.calls.length>${c0 + 2}`, 20000);
      const mx = { rmUp: (await rm()) - rm0, keyHasDraft: await ph.eval(`Share.made.key.includes('|small|'+draft.offset+',')`), share: await last() };
      await ph.tap('#mxClose');
      const recMixOff = await ph.eval(`state.recs.find(x=>x.id===${q(phIds[0])}).mix.offset`);
      // 판정
      const nameRe = /^QA 시험 폰 나누기_\d{8}-\d{4}\.m4a$/;
      const sh1 = s1.n === 1 && JSON.stringify(s1.keys) === '["files","title"]' && nameRe.test(s1.name) && s1.type === 'audio/x-m4a' && s1.size > 0 && s1.head.slice(4, 8) === 'ftyp' && s1.title === 'QA 시험 폰 나누기' && s1.active;
      ctx.log(`  폰 공유 ①: ${JSON.stringify(s1)} · 믹스 만들기 ${rm1}번`);
      ok('J15', touch && JSON.stringify(r.btns) === JSON.stringify(['▶ 듣기', '싱크·믹스 조절', '공유', 'WAV로 저장', '삭제']) && sh1 && rm2 === rm1
        && abortQuiet && failMsg && afterFail?.t === '공유' && naToast && na.rmUp === 1 && na.share.active && na.after?.t === '공유'
        && busy0?.t === '만드는 중…' && busy0.d && busyToast && /^만드는 중… [2-4]초$/.test(busy2?.t) && busy2.d && readyOk && readyToast && noShareYet && slow.rmUp === 1 && slow.share.active && nameRe.test(slow.share.name)
        && JSON.stringify(lg.btns) === JSON.stringify(['공유', '다운로드', '삭제']) && /^QA 시험 폰 예전_\d{8}-\d{4}\.webm$/.test(lgs.share.name) && lgs.share.size === 64 && lgs.rmUp === 0 && dr && !dr.share
        && mxt?.t === '공유' && mxSame === 1 && mx.rmUp === 2 && mx.keyHasDraft && recMixOff === 120 && draftOff === 130,
        `손가락 화면(hover:none ${touch}) 줄 [${r.btns.join('] [')}] · [공유] → 파일 ${s1.n}개 ${s1.name} ${s1.type} ${s1.size}바이트 "${s1.head.slice(4, 8)}", 칸 ${s1.keys.join('·')} · 또 누르면 다시 안 만듦 · 닫음 안내 ${abortQuiet ? '없음' : '나옴'} · 실패 안내 ${failMsg} · NotAllowed → [보내기] → 바로 공유 · 5초 넘음: "${busy0?.t}"(눌림 방지 ${busy0?.d}) → "${busy2?.t}" → [보내기] + 안내 → 공유(다시 만들기 ${slow.rmUp - 1}번) · 다른 녹음 누름 안내 ${busyToast} · 예전 녹음 ${lgs.share.name} ${lgs.share.size}바이트 그대로 · Drive 녹음 새 단추 없음 · 창 [공유]는 조절 값(타이밍 ${draftOff}ms)으로 다시 만듦`);
      ok('J16', /^QA 시험 폰 나누기_\d{8}-\d{4}\.ogg$/.test(og.name) && og.type === 'audio/ogg' && og.head.startsWith('OggS') && ogDec.ok && Math.abs(ogDec.dur - WANT) < 0.1 && ogDec.pk > 0.001
        && noEncLabel === '공유' && /\.wav$/.test(wv.name) && wv.type === 'audio/wav' && wv.head.startsWith('RIFF') && wavNote,
        `AAC 안 됨 → ${og.name} ${og.type} "${og.head.slice(0, 4)}" Edge에서 읽힘 ${ogDec.ok ? ogDec.dur.toFixed(3) + '초' : ogDec.err} · AudioEncoder 없음 → ${wv.name} "${wv.head.slice(0, 4)}" + 안내 ${wavNote}`);
      ok('J17', saveLabel === '작은 파일로 저장' && !!phSave && phSaved, `폰인데 공유가 안 되면 [${saveLabel}] → ${phSave ? phSave.name + ' ' + phSave.size + '바이트' : '안 받아짐'} + 알림 ${phSaved}`);
      ok('J18', nameRe.test(s1.name) && /\.webm$/.test(lgs.share.name) && /\.ogg$/.test(og.name) && /\.wav$/.test(wv.name), `공유 이름도 같은 규칙: ${s1.name} · ${og.name} · ${wv.name} · ${lgs.share.name}`);
    } finally {
      await ph.eval(`(async()=>{ for (const id of ${q(phIds)}) { try { await DB.del('recs', id); } catch {} } })()`).catch(() => {});
      await ph.close().catch(() => {});
    }
  });
  // 만든 시험 녹음 지우기 (PC 탭)
  await p.eval(`(async()=>{ const ids=${q(pcIds)}; for (const id of ids) { try { await DB.del('recs', id); } catch {} } state.recs=state.recs.filter(r=>!ids.includes(r.id)); Share.made=null; renderRecs(); })()`);
  await p.click('#tabSongs');
  await stopAll(p);
}
