// 흐름 3·4: 곡 추가·수정 창, 가사 찾기(가짜 답), 곡 목록 줄 버튼, 가사 타이밍·키, 곡 지우기, Drive 꼬리표(시험 데이터)
import { PC, txt, isHidden, visible, marks, sawToast, sawFlash, sleep, q, addSongViaDialog, selectById, selectNo, stopAll, seedSong, seedRec } from './_lib.mjs';
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
    ok('D6', res.length === 2 && res[0].tag === '싱크 있음 · 길이 비슷' && res[1].tag === '가사만' && /2개 찾음/.test(st) && after.ly.startsWith('[00:01.00]QA 시험 가사 첫 줄') && after.hid && /넣었어요/.test(after.st),
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
  await stopAll(p);
}
