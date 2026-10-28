// 조건 V: 시험 동영상을 브라우저 안에서 직접 만들어(캔버스 + 사인파, MediaRecorder) 동영상 곡으로 넣어 본다
import fs from 'node:fs';
import path from 'node:path';
import { txt, visible, marks, sawFlash, sleep, q, stopAll } from './_lib.mjs';
export const areas = ['C', 'D', 'M', 'T'];

export async function makeVideo(p, sec = 3) {
  const b64 = await p.eval(`(async()=>{
    const c=document.createElement('canvas'); c.width=320; c.height=180; const g=c.getContext('2d');
    const ac=new AudioContext(); const o=ac.createOscillator(); o.frequency.value=262; const gn=ac.createGain(); gn.gain.value=0.3; const d=ac.createMediaStreamDestination(); o.connect(gn); gn.connect(d); o.start();
    const st=new MediaStream([...c.captureStream(15).getVideoTracks(), ...d.stream.getAudioTracks()]);
    const mr=new MediaRecorder(st,{mimeType:'video/webm;codecs=vp8,opus'}); const parts=[]; mr.ondataavailable=e=>parts.push(e.data);
    let k=0; const draw=()=>{g.fillStyle='hsl('+(k*25%360)+',70%,45%)';g.fillRect(0,0,320,180);g.fillStyle='#fff';g.font='bold 40px sans-serif';g.fillText('QA 시험 '+(k++),40,105)};
    draw(); const iv=setInterval(draw,66);
    mr.start(); await new Promise(r=>setTimeout(r,${sec * 1000})); mr.stop(); await new Promise(r=>mr.onstop=r); clearInterval(iv); o.stop(); ac.close();
    const ab=await new Blob(parts).arrayBuffer(); let s=''; const u=new Uint8Array(ab); for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s);
  })()`, 30000);
  return Buffer.from(b64, 'base64');
}

export default async function video(ctx) {
  const { ok, step } = ctx, p = ctx.p, ids = ctx.ids;
  if (ctx.conds.V === false) { for (const id of ['C2', 'D8', 'M6', 'T2', 'T3', 'T1']) ctx.skip(id, '조건 V 안 됨'); return; }

  await step('시험 동영상 만들기 → 곡 추가 창: 동영상 선택 칸 → 저장 → "영상" 표시', ['D8', 'C2', 'T3'], async () => {
    const file = path.join(ctx.tmp, 'files', 'QA 시험 영상 - QA가수V.webm');
    fs.writeFileSync(file, await makeVideo(p, 3));
    ctx.fx.video = file;
    await p.click('#addSongBtn');
    await p.setFiles('#f-file', [file]); await sleep(200);
    const opt = await p.eval(`({h:document.querySelector('#videoOpts').hidden, v:document.querySelector('#f-video').checked, vl:document.querySelector('#f-videoLyrics').checked, t:document.querySelector('#f-title').value, a:document.querySelector('#f-artist').value,
      l1:document.querySelector('#videoOpts label:nth-child(1)').textContent, l2:document.querySelector('#videoOpts label:nth-child(2)').textContent})`);
    ok('D8', !opt.h && opt.v && !opt.vl && /동영상을 그대로 보여주기/.test(opt.l1) && /동영상 위에 가사도 보여주기/.test(opt.l2), `동영상 파일 → "${opt.l1.trim()}"(켬) · "${opt.l2.trim().slice(0, 14)}…"(끔)`);
    await p.eval(`document.querySelector('#f-lyrics').value='[00:00.30]QA 시험 영상 가사\\n[00:02.00]'`);
    await p.click('#dlgSave');
    await p.until(`!document.querySelector('#songDialog').open`, 3000);
    ids.video = await p.eval(`state.songs[state.songs.length-1].id`);
    await p.until(`state.song.id===${q(ids.video)} && !!state.song.buffer`, 15000);
    const row = await p.eval(`(()=>{const i=state.songs.findIndex(s=>s.id===${q(ids.video)}); const li=document.querySelector('#songList').children[i]; return {v:li.querySelector('.t .vtag')?.textContent, t:li.querySelector('.t').textContent}})()`);
    ok('C2', row.v === '영상', `동영상 곡 줄에 "영상" (${row.t})`);
    await p.key('s'); await p.type('QA 시험 영상'); await sleep(200);
    const sr = await p.eval(`document.querySelector('#searchList li .vtag')?.textContent || ''`);
    await p.key('Escape');
    ok('T3', row.v === '영상' && sr === '영상', `목록 "${row.v}" · 검색 결과 "${sr}"`);
  });

  await step('무대에 영상, 재생 중 따라감', ['T1'], async () => {
    const st = await p.eval(`({hv:document.querySelector('#stage').classList.contains('has-video'), vis:!document.querySelector('#stageVideo').hidden, src:!!document.querySelector('#stageVideo').src, lights:getComputedStyle(document.querySelector('.lights')).display})`);
    await p.key(' ');
    await p.until('state.playing && curTime()>1', 5000);
    const v = await p.eval(`({t:document.querySelector('#stageVideo').currentTime, paused:document.querySelector('#stageVideo').paused, ct:curTime()})`);
    await p.key(' ');
    ok('T1', st.hv && st.vis && st.src && st.lights === 'none' && !v.paused && v.t > 0.5, `영상 보임(조명 숨김), 재생 중 영상 ${v.t.toFixed(1)}초 / 반주 ${v.ct.toFixed(1)}초`);
    await p.click('#stopBtn');
  });

  await step('V 키·곡 수정 창으로 영상 위 가사 켜고 끄기', ['T2', 'M6'], async () => {
    let m = await marks(p);
    await p.key('v');
    const on = await p.eval(`({s:songById(${q(ids.video)}).videoLyrics, c:document.querySelector('#stage').classList.contains('show-lyrics')})`);
    const f1 = await sawFlash(p, /영상 위에 가사 보이기/, m);
    m = await marks(p);
    await p.key('ㅍ');      // 한글 자판의 V 자리
    const off = await p.eval(`({s:songById(${q(ids.video)}).videoLyrics, c:document.querySelector('#stage').classList.contains('show-lyrics')})`);
    const f2 = await sawFlash(p, /영상 가사만 보기/, m);
    ok('M6', on.s && on.c && f1 && !off.s && !off.c && f2, `V → 가사 보이기 · ㅍ → 영상 가사만`);
    await p.eval(`openSongDialog(songById(${q(ids.video)}))`);
    const shown = await visible(p, '#videoOpts');
    await p.click('#f-videoLyrics');
    await p.click('#dlgSave');
    await p.until(`!document.querySelector('#songDialog').open`, 3000);
    const saved = await p.eval(`({s:songById(${q(ids.video)}).videoLyrics, c:document.querySelector('#stage').classList.contains('show-lyrics'), db:0})`);
    const db = await p.eval(`DB.get('songs', ${q(ids.video)}).then(s=>s.videoLyrics)`);
    ok('T2', on.s && !off.s && shown && saved.s && saved.c && db === true, `V 키로 켜고 끔 · 곡 수정 창 "동영상 위에 가사도" 켜고 저장 → 저장됨`);
  });
  await stopAll(p);
}
