// 흐름 11: 녹음 (마이크 없이: 마이크가 꺼져 있으면 목소리 없이 녹음되고 1.5초가 넘으면 저장된다), 내 녹음, 싱크·믹스 조절, WAV
import fs from 'node:fs';
import { txt, visible, isHidden, marks, sawToast, sleep, q, stopAll, selectById, seedRec } from './_lib.mjs';
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
    await p.click(`${sel} .btns button:nth-child(3)`);
    const wav = await waitDownload(ctx, /^QA 시험 점수 녹음_\d{8}-\d{4}\.wav$/, since, 20000);
    const n0 = await nRecs();
    await p.click(`${sel} .btns .danger`);
    const armed = await txt(p, `${sel} .btns .danger`);
    await p.click(`${sel} .btns .danger`);
    const gone = await p.until(`state.recs.length===${n0 - 1} && !state.recs.some(r=>r.id===${q(ids.recScore)})`, 3000);
    const db = await p.eval(`DB.get('recs', ${q(ids.recScore)}).then(r=>!!r)`);
    ok('J6', listening && !!wav && armed === '삭제?' && gone && !db, `▶ 듣기 → ⏸ · WAV로 저장 ${wav ? wav.size + '바이트' : '안 됨'} · 삭제 "${armed}" → 한 번 더 → 지워짐`);
  });
  await p.click('#tabSongs');
  await stopAll(p);
}
