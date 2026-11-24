// 흐름 3·4: 곡 추가·수정 창, 가사 찾기(가짜 답), 곡 목록 줄 버튼, 가사 타이밍·키, 곡 지우기, Drive 꼬리표(시험 데이터)
// CR-242 N2: 손가락 화면은 곡 줄·아이콘·둥근 단추를 누른 뒤 hover 모양이 안 남음 (마우스 화면 hover·키보드 윤곽은 그대로)
import path from 'node:path';
import { PC, PHONE, openPage, clipShot, txt, isHidden, visible, marks, sawToast, sawFlash, sleep, q, addSongViaDialog, selectById, selectNo, stopAll, seedSong, seedRec } from './_lib.mjs';
import { LRC_LONG, LRC_SHORT, PLAIN, PLAIN4, cand } from '../fixtures.mjs';
export const areas = ['C', 'D', 'E', 'F', 'S'];

export default async function songs(ctx) {
  const { ok, step, fx } = ctx, p = ctx.p;
  ctx.ids = ctx.ids || {};
  const ids = ctx.ids;

  await step('곡 추가 창: 파일 → 제목·가수 자동, 제목 없이 저장 → 오류, 시간 있는 가사로 저장 → 새 번호', ['C10', 'D1', 'D2', 'D3', 'D4', 'D10'], async () => {
    await p.click('#addSongBtn');
    const opened = await p.until(`document.querySelector('#songDialog').open && document.querySelector('#dlgTitle').textContent==='곡 추가'`, 2000);
    ok('C10', opened, '"+ 곡 추가" → 곡 추가 창');
    const inp = await p.eval(`({accept:document.querySelector('#f-file').accept, multiple:document.querySelector('#f-file').multiple, lbl:document.querySelector('#fileLbl').textContent})`);
    await p.setFiles('#f-file', [fx.tagged]); await sleep(200);
    const filled = await p.eval(`({t:document.querySelector('#f-title').value, a:document.querySelector('#f-artist').value})`);
    ok('D2', filled.t === 'QA 시험 노래' && filled.a === 'QA가수', `"[TJ노래방] QA 시험 노래 - QA가수 (MR) _ TJ Karaoke.wav" → 제목 "${filled.t}" · 가수 "${filled.a}"`);
    await p.eval(`document.querySelector('#f-title').value=''`);
    // 빈 칸: 브라우저가 "필수 칸" 안내로 막는다 (제목 칸 required). 띄어쓰기만: 앱이 "제목을 입력해 주세요."
    const n0 = await p.eval('state.songs.length');
    await p.click('#dlgSave'); await sleep(200);
    const native = await p.eval(`({open:document.querySelector('#songDialog').open, miss:document.querySelector('#f-title').validity.valueMissing, n:state.songs.length})`);
    await p.eval(`document.querySelector('#f-title').value='   '`);
    await p.click('#dlgSave'); await sleep(200);
    const err = await p.eval(`({open:document.querySelector('#songDialog').open, e:document.querySelector('#dlgErr').hidden?'':document.querySelector('#dlgErr').textContent, n:state.songs.length})`);
    ok('D3', native.open && native.miss && native.n === n0 && err.open && err.e === '제목을 입력해 주세요.' && err.n === n0,
      `빈 제목 → 브라우저 필수 칸 안내로 저장 안 됨 · 띄어쓰기만 → "${err.e}"`);
    await p.eval(`document.querySelector('#f-title').value='QA 시험 노래'; document.querySelector('#f-lyrics').value=${q(LRC_LONG)}`);
    const m = await marks(p);
    await p.click('#dlgSave');
    await p.until(`!document.querySelector('#songDialog').open`, 3000);
    const s = await p.eval(`(()=>{const s=state.songs[state.songs.length-1]; return {id:s.id,no:s.no,t:s.title,a:s.artist,ly:s.lyrics}})()`);
    ids.long = s.id; ids.longNo = s.no;
    const toastOk = await sawToast(p, /10002번 'QA 시험 노래' 추가됨/, m);
    ok('D10', s.no === 10002 && toastOk, `새 번호 ${s.no} (가장 큰 번호 10001 + 1), 알림`);
    ok('D1', inp.accept === 'audio/*,video/*' && inp.multiple && /여러 개/.test(inp.lbl), `새로 넣을 때 파일 칸: 음악·동영상, 여러 개 고르기`);
    await p.until(`state.song && state.song.id===${q(s.id)} && !!state.song.buffer`, 10000);
    const lines = await p.eval(`({n:state.lines.filter(l=>l.text).length, auto:state.autoTimed, first:state.lines[0].t})`);
    ok('D4', s.ly === LRC_LONG && lines.n === 3 && !lines.auto && Math.abs(lines.first - 0.6) < 0.01, `시간 있는 가사 저장·읽힘 (${lines.n}줄, 첫 줄 ${lines.first}초)`);
    // 수정 창은 파일 하나, 바꿀 때만
    await p.eval(`openSongDialog(songById(${q(s.id)}))`);
    const ed = await p.eval(`({t:document.querySelector('#dlgTitle').textContent, multiple:document.querySelector('#f-file').multiple, lbl:document.querySelector('#fileLbl').textContent})`);
    await p.click('#dlgCancel');
    ok('D1', ed.t === '곡 수정' && !ed.multiple && /바꿀 때만/.test(ed.lbl), `수정 창: "${ed.lbl}", 여러 개 고르기 꺼짐`);
  });

  await step('시간 없는 가사·가사 없는 곡: 자동 배치, "가사 없이 반주만", "가사 없음" 표시', ['D4', 'E5', 'C11', 'C12'], async () => {
    const pl = await addSongViaDialog(p, { file: fx.plain, title: 'QA 시험 시간없는가사', artist: 'QA가수', lyrics: PLAIN });
    ids.plain = pl.id;
    await p.until(`state.song.id===${q(pl.id)} && !!state.song.buffer`, 10000);
    const a = await p.eval(`({auto:state.autoTimed, badge:!document.querySelector('#autoBadge').hidden, n:state.lines.filter(l=>l.text).length, t1:state.lines[1].t})`);
    ok('D4', a.auto && a.n === 3, `시간 없는 가사도 저장 (${a.n}줄)`);
    const nl = await addSongViaDialog(p, { file: fx.nolyr, title: 'QA 시험 가사없음', artist: '' });
    ids.nolyr = nl.id;
    await p.until(`state.song.id===${q(nl.id)} && !!state.song.buffer`, 10000);
    const top = await txt(p, '#lineTop .base');
    ok('E5', a.auto && a.badge && a.t1 > 0 && top === '가사 없이 반주만 나와요', `시간 없는 가사 → "가사 자동 배치" 배지·자동 시간, 가사 없음 → "${top}"`);
    const tags = await p.eval(`[...document.querySelectorAll('#songList li')].filter(li=>li.querySelector('.stag.nolyr')).map(li=>li.querySelector('.t').textContent)`);
    const demoTag = await p.eval(`!!document.querySelector('#songList li:first-child .stag.nolyr')`);
    ok('C11', tags.length === 1 && tags[0] === 'QA 시험 가사없음' && !demoTag, `"가사 없음" 표시: ${tags.join(',')} (데모곡 없음)`);
    const mb = await p.eval(`({h:document.querySelector('#missBtn').hidden, t:document.querySelector('#missBtn').textContent})`);
    ok('C12', !mb.h && mb.t === '가사 없음 1곡 · 찾기', `곡 목록 맨 위 "${mb.t}"`);
    ids.short = (await addSongViaDialog(p, { file: fx.short, title: 'QA 시험 짧은 곡', artist: 'QA가수', lyrics: LRC_SHORT })).id;
    ids.edit = (await addSongViaDialog(p, { file: fx.edit, title: 'QA 시험 편집', artist: 'QA가수', lyrics: PLAIN4 })).id;
  });

  await step('반주를 못 부르면 이유 안내 (깨진 파일)', ['E8'], async () => {
    const m = await marks(p);
    const b = await addSongViaDialog(p, { file: fx.broken, title: 'QA 시험 깨진 파일', artist: 'QA가수' });
    ids.broken = b.id;
    ok('E8', await sawToast(p, /MR 파일을 읽지 못했어요/, m, 6000), '깨진 MR → "MR 파일을 읽지 못했어요. mp3·m4a·wav 파일인지 확인해 주세요."');
  });

  await step('곡 지우기: 예약에서 빠지고, 녹음은 목소리만 남는다는 안내', ['C9'], async () => {
    ids.recDeleted = await seedRec(p, { songId: ids.broken, title: 'QA 시험 깨진 파일', parts: true, createdAt: Date.now() - 3600e3 });
    await p.eval(`reserve(songById(${q(ids.broken)}), false)`);
    const inQ = await p.eval(`state.queue.includes(${q(ids.broken)})`);
    const m = await marks(p);
    const sel = `#songList li:nth-child(${await p.eval(`state.songs.findIndex(s=>s.id===${q(ids.broken)})+1`)})`;
    await p.click(sel + ' .acts [title="삭제"]', { hover: sel });
    const armed = await txt(p, sel + ' .acts .danger');
    await p.click(sel + ' .acts .danger', { hover: sel });
    await p.until(`!songById(${q(ids.broken)})`, 3000);
    const gone = await p.eval(`!songById(${q(ids.broken)}) && !state.queue.includes(${q(ids.broken)})`);
    ok('C9', inQ && armed === '삭제?' && gone && await sawToast(p, /'QA 시험 깨진 파일' 삭제됨 · 이 곡의 녹음 1개는 이제 목소리만 들려요/, m), `예약에 있던 곡 삭제(두 번 눌러) → 예약에서 빠짐, 녹음 안내`);
  });

  await step('곡 목록 줄: 누르기·Enter로 고르기, 예약, ♡', ['C5', 'C6', 'C7', 'F6'], async () => {
    const idx = await p.eval(`state.songs.findIndex(s=>s.id===${q(ids.long)})+1`);
    await p.click(`#songList li:nth-child(${idx}) .meta`);
    const c1 = await p.until(`state.song.id===${q(ids.long)}`, 3000);
    await p.eval(`document.querySelector('#songList li:nth-child(1)').focus()`);
    await p.key('Enter');
    const c2 = await p.until(`state.song.no===10001`, 3000);
    ok('C5', c1 && c2, `줄 누르기 ${c1} · Enter ${c2}`);
    await p.until('!!state.song.buffer', 5000);
    const fs = await isHidden(p, '#syncBtn');
    await selectById(p, ids.long);
    ok('F6', fs && await visible(p, '#syncBtn'), '"가사 싱크 편집" 버튼: 데모곡 숨김, 내 곡 보임');
    await p.click(`#songList li:nth-child(${idx}) .acts .btn`);
    ok('C6', await p.eval(`state.queue.includes(${q(ids.long)})`), '"예약" 버튼 → 예약됨');
    await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
    await p.click(`#songList li:nth-child(${idx}) .fav-btn`);
    const fav = await p.eval(`({t:document.querySelector('#songList li:nth-child(${idx}) .fav-btn').textContent, f:isFav(songById(${q(ids.long)}))})`);
    await p.click(`#songList li:nth-child(${idx}) .fav-btn`);
    const unfav = await p.eval(`document.querySelector('#songList li:nth-child(${idx}) .fav-btn').textContent`);
    ok('C7', fav.t === '♥' && fav.f && unfav === '♡', `♡ → ${fav.t} → ${unfav}`);
  });

  // CR-251 YT-r1: 곡을 바꿔 고르면 앞 곡의 풀어 둔 반주(AudioBuffer)는 놓는다. 다음 예약 곡·데모는 둔다. 녹음 미리듣기 캐시는 최근 2개만
  await step('CR-251 YT-r1 다른 곡을 고르면 앞 곡 반주 메모리를 놓음 (다음 예약 곡·데모는 둠) · 녹음 미리듣기 캐시 최근 2개', ['C5'], async () => {
    const demoHad = await p.eval(`!!songById('demo')?.buffer`);
    // 크기 한도(SONG_MEM_BUDGET, YT-08 보완) 안이면 앞 곡 반주를 둔다 (시험 곡은 짧아서 다 들어감)
    await selectById(p, ids.long);
    await selectById(p, ids.short);
    const inBudget = await p.eval(`!!songById(${q(ids.long)}).buffer`);
    // 놓는 일을 보려고 이 단계만 한도 0으로. 끝나면 돌려 둠
    await p.eval(`window.__b251 = SONG_MEM_BUDGET; SONG_MEM_BUDGET = 0`);
    let a, b, c;
    try {
      await selectById(p, ids.long);
      await selectById(p, ids.short);
      a = await p.eval(`({ long: !!songById(${q(ids.long)}).buffer, short: !!state.song.buffer, demo: !!songById('demo')?.buffer })`);
      // 다음 예약 곡이면 둔다 (예약은 원래대로 돌려 둠)
      await selectById(p, ids.long);
      await p.eval(`window.__q251 = state.queue.slice(); state.queue = [${q(ids.long)}]`);
      await selectById(p, ids.short);
      b = await p.eval(`(()=>{ const r = { long: !!songById(${q(ids.long)}).buffer }; state.queue = window.__q251; delete window.__q251; saveQueue(); renderQueue(); return r; })()`);
      // 녹음 미리듣기: 만든 녹음 3개를 차례로 풀면 캐시에는 마지막 2개만 (시험 녹음은 목록·DB에 넣지 않고, 끝나면 캐시에서 뺌)
      c = await p.eval(`(async()=>{ const made = [1,2,3].map(i => ({ id: 'qa-r1-rec' + i, v: 2, sr: 44100, vocal: new Blob([new Int16Array(4410).buffer]), parts: [], songId: ${q(ids.short)} }));
        for (const r of made) await loadRecAudio(r);
        await loadRecAudio(made[1]);   // 다시 쓰면 맨 뒤로 → 1번이 아니라 3번이 남고 2번은 살아 있음
        const keys = [...recCache.keys()].filter(k => k.startsWith('qa-r1-rec'));
        for (const r of made) recCache.delete(r.id);
        return { size: keys.length, keys: keys.join(',') }; })()`);
    } finally {
      await p.eval(`SONG_MEM_BUDGET = window.__b251; delete window.__b251`);
    }
    ok('C5', inBudget && !a.long && a.short && (!demoHad || a.demo) && b.long && c.size === 2 && c.keys === 'qa-r1-rec3,qa-r1-rec2',
      `한도 안 앞 곡 반주 ${inBudget ? '둠' : '놓음'} · 한도 0 앞 곡 반주 ${a.long ? '그대로 (안 놓음)' : '놓음'} · 지금 곡 ${a.short ? '있음' : '없음'} · 데모 ${demoHad ? (a.demo ? '둠' : '놓음') : '(안 풀림)'} · 다음 예약 곡 ${b.long ? '둠' : '놓음'} · 녹음 캐시 ${c.size}개 (${c.keys})`);
  });

  await step('가사 타이밍 ±0.1초·±1초가 곡에 저장', ['F5'], async () => {
    await selectById(p, ids.long);
    await p.click('[data-lyr="0.1"]'); await p.click('[data-lyr="0.1"]');
    const a = await txt(p, '#lyrOff');
    await p.click('[data-lyr="-1"]');
    const b = await txt(p, '#lyrOff');
    await sleep(900);
    const saved = await p.eval(`DB.get('songs', ${q(ids.long)}).then(s=>s.lyricOffset)`);
    await p.click('[data-lyr="1"]'); await p.click('[data-lyr="-0.1"]'); await p.click('[data-lyr="-0.1"]');
    const c = await txt(p, '#lyrOff');
    await sleep(900);
    const saved0 = await p.eval(`DB.get('songs', ${q(ids.long)}).then(s=>s.lyricOffset)`);
    ok('F5', a === '0.2초 빠르게' && b === '0.8초 늦게' && saved === -0.8 && c === '맞춤' && saved0 === 0, `+0.1×2 "${a}" → −1 "${b}" (저장 ${saved}) → 되돌림 "${c}" (저장 ${saved0})`);
  });

  await step('키: 사용자·곡별로 기억, 바꾸기 실패 안내', ['F8', 'F7', 'F13'], async () => {
    await selectById(p, ids.long);
    await p.key('.'); await p.until(`document.querySelector('#keyOut').textContent==='+1'`, 20000);
    await p.key('.'); await p.until(`document.querySelector('#keyOut').textContent==='+2'`, 20000);
    const ui = await p.eval(`({out:document.querySelector('#keyOut').textContent, badge:document.querySelector('#keyBadge').hidden?'':document.querySelector('#keyBadge').textContent, saved:(me().keys||{})[${q(ids.long)}]})`);
    ok('F7', ui.out === '+2' && ui.badge === '키 +2', `키 ♯ 두 번 → 표시 "${ui.out}", 배지 "${ui.badge}" (키 바꾸기 끝남)`);
    await selectNo(p, 10001);
    const demoKey = await p.eval('state.key');
    await selectById(p, ids.long); await p.until('state.key===2', 20000);
    const back = await p.eval('state.key');
    // 다른 사용자는 따로
    await p.eval(`(()=>{ const u={id:'qa-user-2', name:'QA둘', favorites:[], playlists:[], updatedAt:Date.now()}; Profiles.list.push(u); saveProfiles(u); switchProfile(u); })()`);
    await selectById(p, ids.long); await sleep(300);
    const other = await p.eval('state.key');
    await p.eval(`switchProfile(Profiles.list.find(x=>x.name==='나')); Profiles.list=Profiles.list.filter(x=>x.id!=='qa-user-2'); saveProfiles()`);
    await selectById(p, ids.long); await p.until('state.key===2', 20000);
    const mine = await p.eval('state.key');
    ok('F8', ui.saved === 2 && demoKey === 0 && back === 2 && other === 0 && mine === 2, `이 곡 +2 저장 → 데모곡 ${demoKey} → 다시 이 곡 ${back} · 다른 사용자 ${other} · 돌아오면 ${mine}`);
    await p.click('#keyReset'); await p.until('state.key===0', 3000);
    // 실패 흉내: 키 바꾸는 작업자가 실패하게 (페이지 안에서만, 끝나면 되돌림)
    const m = await marks(p);
    await p.eval(`window.__pitch=pitchShift; pitchShift=()=>Promise.reject(new Error('UI점검: 일부러 낸 키 바꾸기 실패'))`);
    await p.key(',');
    const t = await sawToast(p, /키를 바꾸지 못했어요/, m, 5000);
    const k = await p.eval(`({k:state.key, out:document.querySelector('#keyOut').textContent})`);
    await p.eval(`pitchShift=window.__pitch; const p0=me(); if(p0.keys) delete p0.keys[${q(ids.long)}]; saveProfiles(p0)`);
    ok('F13', t && k.k === 0 && k.out === '원래 키', `"키를 바꾸지 못했어요" → 원래 키로 (${k.out})`);
  });

  await step('곡 수정 창에서 싱크 가사 찾기 (가짜 답): 결과 꼬리표·고르기, 못 찾음, 끊김, 바쁨', ['D6', 'D7', 'D5'], async () => {
    ctx.lrcRules.length = 0;
    ctx.lrcRules.push(
      { q: '^QA 시험 가사없음$', delay: 200, body: [cand(101, 'QA 시험 가사없음', 'QA가수', 3), cand(102, 'QA 시험 가사없음 (Live)', '다른 가수', 200, false)] },
      { q: '^QA 시험 바쁨', status: 503, times: 1 },
      { q: '^QA 시험 바쁨', body: [cand(103, 'QA 시험 바쁨', 'QA가수', 3)] },
      { q: '^QA 시험 없음', body: [] },
    );
    await selectById(p, ids.nolyr);
    await p.eval(`openSongDialog(songById(${q(ids.nolyr)}))`);
    await p.click('#lrcFind');
    await p.until(`!document.querySelector('#lrcResults').hidden`, 8000);
    const res = await p.eval(`[...document.querySelectorAll('#lrcResults li')].map(li=>({nm:li.querySelector('.nm').textContent, tag:li.querySelector('.tag').textContent}))`);
    const st = await txt(p, '#lrcStatus');
    await p.click('#lrcResults li:first-child button');
    const after = await p.eval(`({ly:document.querySelector('#f-lyrics').value, hid:document.querySelector('#lrcResults').hidden, st:document.querySelector('#lrcStatus').textContent})`);
    ok('D6', res.length === 2 && res[0].tag === '시각 있음 · 길이 비슷' && res[1].tag === '가사만' && /2개 찾음/.test(st) && after.ly.startsWith('[00:01.00]QA 시험 가사 첫 줄') && after.hid && /넣었어요/.test(after.st),
      `결과 2개 "${res.map(r => r.tag).join('" / "')}" · 고르면 가사가 들어감`);
    // 못 찾음
    await p.eval(`document.querySelector('#f-title').value='QA 시험 없음'; document.querySelector('#f-artist').value=''`);
    await p.click('#lrcFind');
    await p.until(`!document.querySelector('#lrcFind').disabled`, 8000);
    const none = await txt(p, '#lrcStatus');
    // 바쁨 → 다시 시도 → 찾음
    await p.eval(`document.querySelector('#f-title').value='QA 시험 바쁨'`);
    const seen = [];
    await p.click('#lrcFind');
    for (let i = 0; i < 40 && await p.eval(`document.querySelector('#lrcFind').disabled`); i++) { seen.push(await txt(p, '#lrcStatus')); await sleep(100); }
    const busyOk = seen.some(s => /가사 서버가 바빠서 다시 시도하는 중… \(2\/6\)/.test(s)) && (await p.eval(`document.querySelectorAll('#lrcResults li').length`)) === 1;
    ok('D5', busyOk, `바쁨(503) → "가사 서버가 바빠서 다시 시도하는 중… (2/6)" → 결과`);
    // 인터넷 끊김
    await p.offline(true);
    await p.click('#lrcFind');
    await p.until(`!document.querySelector('#lrcFind').disabled`, 20000);
    const off = await txt(p, '#lrcStatus');
    await p.offline(false);
    ok('D7', /찾지 못했어요/.test(none) && off === '인터넷 연결이 끊겨 있어요', `못 찾음 "${none.slice(0, 20)}…" · 끊김 "${off}"`);
    await p.click('#dlgCancel');
    ok('D6', !(await p.eval(`(songById(${q(ids.nolyr)}).lyrics||'').trim()`)), '취소하면 고른 가사는 저장 안 됨');
  });

  await step('Drive 꼬리표·기기 저장 (시험 데이터)', ['C3', 'D9'], async () => {
    ids.driveOnly = (await seedSong(p, { title: 'QA 시험 Drive에만', artist: 'QA가수', lyrics: LRC_SHORT, fileId: 'qa-file-1', blob: false })).id;
    ids.driveBoth = (await seedSong(p, { title: 'QA 시험 Drive와 기기', artist: 'QA가수', lyrics: LRC_SHORT, fileId: 'qa-file-2', wav: fx.nolyr })).id;
    const tagOf = id => p.eval(`(()=>{const i=state.songs.findIndex(s=>s.id===${q(id)}); const t=document.querySelector('#songList').children[i].querySelector('.stag:not(.nolyr)'); return t?t.textContent:''})()`);
    const cloud = await tagOf(ids.driveOnly);
    await p.eval(`Cloud.connected=true; renderSongs()`);           // 연결된 척 (메모리만, 저장 안 함): 올릴 곡 꼬리표
    const up = await tagOf(ids.long);
    await p.eval(`Cloud.connected=false; renderSongs()`);
    ok('C3', cloud === '☁ Drive' && up === '올릴 예정', `Drive에만 있는 곡 "${cloud}" · 연결됐을 때 기기에서 넣은 곡 "${up}"`);
    await p.eval(`openSongDialog(songById(${q(ids.driveBoth)}))`);
    const row = await p.eval(`({h:document.querySelector('#deviceRow').hidden, t:document.querySelector('#deviceTxt').textContent, ev:!document.querySelector('#evictBtn').hidden})`);
    const m = await marks(p);
    await p.click('#evictBtn');
    const t = await sawToast(p, /기기에서 지웠어요. Drive에는 그대로 있어요/, m);
    const row2 = await p.eval(`({t:document.querySelector('#deviceTxt').textContent, fetch:!document.querySelector('#fetchBtn').hidden, blob:!!songById(${q(ids.driveBoth)}).blob})`);
    await p.click('#dlgCancel');
    ok('D9', !row.h && /이 기기에 저장돼 있어요/.test(row.t) && row.ev && t && row2.t === 'Drive에만 있어요' && row2.fetch && !row2.blob, `"${row.t}" → 기기에서 지우기 → "${row2.t}", "기기에 저장" 버튼`);
  });
  // CR-242 N2: :hover 8가지(.song .icon-btn .round .sy-row .nud .lrc-results button .mine-row .guest-row)는 마우스 화면(@media (hover:hover))에서만.
  // 손가락 화면에서 누르면 그 요소(와 부모)에 :hover가 붙은 채 남는데, 이제 모양은 안 바뀜. 사진 cr242/phone-412-*-after-tap.png
  await step('CR-242 N2 손가락으로 누른 뒤 hover 모양 안 남음 (폰 412 곡 줄·⋯·■), 마우스 화면 hover·키보드 윤곽 그대로', ['C5'], async () => {
    const HOV = ['.song:hover', '.icon-btn:hover', '.round:hover', '.sy-row:hover', '.nud:hover', '.lrc-results button:hover', '.mine-row:hover', '.guest-row:hover'];
    const n242 = path.join(ctx.OUT, 'cr242');
    const look = (pg, sel) => pg.eval(`(()=>{const e=document.querySelector(${q(sel)}); if(!e) return null; const cs=getComputedStyle(e);
      return {bg:cs.backgroundColor, border:cs.borderTopColor, color:cs.color, outline:cs.outlineStyle==='none'?'none':cs.outlineStyle, hov:e.matches(':hover')}})()`);
    const same = (a, b) => !!a && !!b && a.bg === b.bg && a.border === b.border && a.color === b.color;
    const fmtL = o => o ? `${o.bg} / ${o.border} / ${o.color}` : '없음';
    // CSS.forcePseudoState로 hover·focus-visible을 붙여 잰다 (진짜 마우스 없이)
    const forced = async (pg, sel) => {
      const out = {};
      await pg.s('DOM.enable'); await pg.s('CSS.enable');
      try {
        const { root } = await pg.s('DOM.getDocument', { depth: 0 });
        const { nodeId } = await pg.s('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
        for (const st of [null, 'hover', 'focus-visible']) {
          await pg.s('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: st ? [st] : [] }); await sleep(250);
          out[st || 'base'] = await look(pg, sel);
        }
        await pg.s('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      } finally { await pg.s('CSS.disable').catch(() => {}); await pg.s('DOM.disable').catch(() => {}); }
      return out;
    };
    // ① 규칙: 8가지 :hover가 모두 (hover: hover) 안에만 있음
    const where = await p.eval(`(()=>{const want=${q(HOV)}, f={}; const walk=(rules,m)=>{for(const r of rules){ if(r.cssRules&&r.media) walk(r.cssRules, r.media.mediaText);
      else if(r.selectorText) for(const x of r.selectorText.split(',').map(y=>y.trim())) if(want.includes(x)) (f[x]=f[x]||[]).push(m||'(밖)'); }};
      for(const sh of document.styleSheets){ try{ walk(sh.cssRules,'') }catch{} } return f})()`);
    const rulesOk = HOV.every(h => where[h]?.length >= 1 && where[h].every(m => /^\(hover:\s*hover\)$/.test(m)));
    // ② 마우스 화면 (PC 탭): hover를 붙이면 모양이 바뀜 · 키보드 윤곽
    const ROW = '#songList > .song:not(.on)', ROUND = '#stopBtn';
    await p.move(1, 1);
    const pc = { row: await forced(p, ROW), icon: await forced(p, ROW + ' .fav-btn'), round: await forced(p, ROUND) };
    const pcOk = !same(pc.row.base, pc.row.hover) && !same(pc.icon.base, pc.icon.hover) && !same(pc.round.base, pc.round.hover) && pc.icon['focus-visible'].outline === 'solid' && pc.round['focus-visible'].outline === 'solid';
    // ③ 폰 412: hover를 붙여도 그대로 · 진짜로 누른 뒤에도 그대로 (누르기 전과 같음)
    const ph = await openPage(ctx, PHONE, ctx.base + '/index.html');
    let f = {}, b0 = {}, a1 = {}, touch = false;
    try {
      touch = await ph.eval(`matchMedia('(hover:none)').matches`);
      f = { row: await forced(ph, ROW), round: await forced(ph, ROUND) };
      const idx = await ph.eval(`[...document.querySelectorAll('#songList > .song')].findIndex(li=>!li.classList.contains('on'))+1`);
      const rowSel = `#songList > .song:nth-child(${idx})`, iconSel = rowSel + ' .more-toggle';
      f.icon = await forced(ph, iconSel);
      b0 = { row: await look(ph, rowSel), icon: await look(ph, iconSel), round: await look(ph, ROUND) };
      await ph.tap(iconSel); await sleep(200);                  // ⋯ 펴기 → 다시 접기 (곡은 안 바뀜). 줄과 ⋯에 :hover가 남음
      await ph.tap(iconSel); await sleep(300);
      a1 = { row: await look(ph, rowSel), icon: await look(ph, iconSel) };
      await clipShot(ph, [rowSel], path.join(n242, 'phone-412-song-row-after-tap.png'));
      await ph.tap(ROUND); await sleep(300);                     // ■ 정지 (재생 중이 아니라 아무 일 없음)
      a1.round = await look(ph, ROUND);
      await clipShot(ph, ['#playBtn', '#stopBtn', '#recBtn'], path.join(n242, 'phone-412-round-after-tap.png'));
    } finally { await ph.close().catch(() => {}); }
    const phForcedOk = ['row', 'icon', 'round'].every(k => same(f[k]?.base, f[k]?.hover)) && f.icon?.['focus-visible']?.outline === 'solid';
    const phTapOk = ['row', 'icon', 'round'].every(k => same(b0[k], a1[k]));
    ctx.log(`  CR-242 N2 규칙 자리: ${HOV.map(h => h + ' ' + (where[h] || ['없음']).join('/')).join(' · ')}`);
    ctx.log(`  CR-242 N2 폰 누르기 전→뒤: ${['row', 'icon', 'round'].map(k => k + ' ' + fmtL(b0[k]) + ' → ' + fmtL(a1[k]) + ' (:hover ' + a1[k]?.hov + ')').join(' | ')}`);
    ok('C5', rulesOk && pcOk && touch && phForcedOk && phTapOk,
      `CR-242 N2 :hover 8가지 모두 (hover: hover) 안 ${rulesOk} · 마우스 화면 hover 그대로 (곡 줄 ${pc.row.base?.bg} → ${pc.row.hover?.bg} · ♡ ${pc.icon.hover?.bg} · ■ 테두리 ${pc.round.base?.border} → ${pc.round.hover?.border}) · 키보드 윤곽 ${pc.icon['focus-visible']?.outline}`
      + ` / 폰(hover:none ${touch}) hover를 붙여도 그대로 ${phForcedOk} · 누른 뒤(:hover 줄 ${a1.row?.hov}·⋯ ${a1.icon?.hov}·■ ${a1.round?.hov}) 모양 그대로 ${phTapOk}`);
  });
  await stopAll(p);
}
