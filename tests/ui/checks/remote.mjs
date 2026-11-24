// 흐름 13·14: 휴대폰 리모컨 (두 번째 탭을 폰 크기로 → ?pin= 주소 → 버튼·숫자판·검색·예약·내 목록 → PC 화면이 실제로 바뀌는지),
// 설정 창 "새 코드 만들기" → 휴대폰 "코드가 바뀌었어요", 서버 없이 연 화면(정적 서버 = Pages와 같은 상태)에는 리모컨 칸이 없음
import path from 'node:path';
import { PC, PHONE, openPage, txt, visible, isHidden, marks, sawToast, sawFlash, sleep, q, stopAll, selectNo } from './_lib.mjs';
export const areas = ['N', 'L'];

export default async function remote(ctx) {
  const { ok, step } = ctx, p = ctx.p, ids = ctx.ids;
  await stopAll(p);
  await p.eval(`state.queue=[]; saveQueue(); renderQueue(); if(state.armed) setArmed(false)`);
  await selectNo(p, 10001);
  // PC가 받은 명령 기록 (remoteRun을 감싸서 이름만 적고 그대로 실행)
  await p.eval(`if(!window.__cmds){ window.__cmds=[]; const o=remoteRun; remoteRun=c=>{ __cmds.push(c.cmd); return o(c); }; }`);
  let ph = null, pin = null;
  const pcs = () => p.eval(`({playing:state.playing, no:state.song?.no, q:state.queue.map(id=>songById(id)?.no), key:state.key||0, armed:state.armed, vol:settings.mrVol, tv:state.tv, me:me().name, favs:me().favorites.slice()})`);
  const tap = async sel => { await ph.tap(sel); await sleep(150); };
  const cmd = (name, until, ms = 4000) => p.until(until, ms);

  await step('PC: 리모컨 정보(코드·QR·고정), 설정 창 리모컨 칸', ['N2', 'N18', 'P5'], async () => {
    await p.until('Remote.on && !!Remote.info', 5000);
    const info = await p.eval(`({...Remote.info})`);
    pin = info.pin;
    await p.click('#settingsBtn');
    const qrOk = await p.until(`!!document.querySelector('#remoteSet img.qr') && !!document.querySelector('#remoteInfo img.qr')`, 8000);
    const set = await p.eval(`({t:document.querySelector('#remoteSet').textContent, ctl:!document.querySelector('#remoteCtl').hidden, each:document.querySelector('#remoteNewEach').checked, hint:document.querySelector('#remotePinHint').textContent, qr:document.querySelectorAll('#remoteSet img.qr').length})`);
    await p.click('#cloudClose');
    ok('N2', /^\d{4}$/.test(pin) && info.fixed === true && info.url === `http://192.0.2.1:5199/remote.html?pin=${pin}` && set.t.includes(`코드 ${pin}`) && (qrOk || ctx.conds.W === false) && set.qr <= 1 && !set.each && /코드가 바뀌지 않아서/.test(set.hint),
      `코드 ${pin} (고정) · QR 주소에 ?pin=${pin} · 설정 창 QR ${set.qr}개 · "켤 때마다 새 코드" 꺼짐`);
    // 다른 사이트(Origin)가 코드를 바꾸려 하면 403, 이 PC 화면은 됨(아래 N16)
    const r = await fetch(`${ctx.base}/api/remote/pin`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: '{"action":"new"}' });
    const still = await p.eval(`fetch('/api/remote/info').then(r=>r.json()).then(i=>i.pin)`);
    ok('N18', set.ctl && r.status === 403 && still === pin, `같은 와이파이로 켠 서버(lan): 코드 버튼 보임 · 다른 사이트의 코드 바꾸기 → ${r.status} (코드 그대로)`);
  });

  // CR-228 ④ 기본 길: 내 폰 리모컨 TV QR은 server.py 없이 연 화면(Pages)에서만. server.py로 연 이 화면은 켜도 옛 QR(주소·코드) 그대로 (옛 길 보존)
  await step('server.py로 연 화면: 내 폰 리모컨을 켜도 TV 대기 화면은 옛 QR·주소·코드 그대로', ['L6'], async () => {
    const box = `(()=>{const b=document.querySelector('#remoteInfo'); return {h:b.hidden, t:b.textContent, qr:b.querySelectorAll('img.qr').length, my:!!b.querySelector('.my-tv')}})()`;
    const b0 = await p.eval(box);
    await p.eval(`(()=>{ window.__myOn=My.on; My.on=true; myTvRender(); })()`);       // 허브 없이 켠 것처럼만 (방은 안 엶)
    await sleep(400);
    const b1 = await p.eval(box);
    await p.eval(`(()=>{ My.on=window.__myOn; myTvRender(); })()`);
    const b2 = await p.eval(box);
    ok('L6', !b0.h && !b1.h && !b2.h && !b1.my && b1.t === b0.t && b1.t.includes(`코드 ${pin}`) && b1.qr === b0.qr && b2.t === b0.t,
      `켬: 옛 글 그대로("${b1.t.slice(0, 16)}…" · 코드 ${pin}) · QR ${b1.qr}개 · 내 폰 리모컨 글 ${b1.my ? '있음' : '없음'} · 다시 끔: 옛 QR 그대로 보임`);
  });

  await step('휴대폰 탭: ?pin= 주소로 열면 바로 연결, 주소에서 코드 지움, 연결·사용자 표시, 홈 화면 추가 안내', ['N20', 'N5', 'N3', 'N21'], async () => {
    ph = await openPage(ctx, PHONE, null);
    await ph.goto(`${ctx.base}/remote.html?pin=${pin}`, `!document.querySelector('#app').hidden`);
    const st = await ph.eval(`({url:location.search, saved:localStorage.getItem('yt-remote-pin'), conn:document.querySelector('#conn span').textContent, on:document.querySelector('#conn').classList.contains('on'), who:document.querySelector('#whoName').textContent, pinView:document.querySelector('#pinView').hidden, a2:!document.querySelector('#a2hs').hidden, a2t:document.querySelector('#a2hs').textContent})`);
    ok('N20', st.url === '' && st.saved === pin, `주소의 ?pin= 지움 (지금 주소 "${st.url}"), 기억한 코드 ${st.saved}`);
    ok('N5', st.conn === '연결됨' && st.on && st.who === (await p.eval('me().name')), `"${st.conn}" · 사용자 "${st.who}"`);
    ok('N3', st.pinView && st.conn === '연결됨', 'QR 주소(?pin=)로 열면 코드 입력 없이 연결');
    await tap('#a2hsClose');
    const closed = await ph.eval(`document.querySelector('#a2hs').hidden && localStorage.getItem('nb-remote-a2hs')==='1'`);
    await ph.goto(`${ctx.base}/remote.html`, `!document.querySelector('#app').hidden`);
    const stays = await ph.eval(`document.querySelector('#a2hs').hidden`);
    ok('N21', st.a2 && /크롬 메뉴\(⋮\) → 홈 화면에 추가/.test(st.a2t) && closed && stays, '연결 뒤 "크롬 메뉴(⋮) → 홈 화면에 추가" 한 줄 · 닫으면 다시 안 나옴');
  });
  // CR-242 N3: 폰 리모컨 알림도 앱과 같게 글 길이만큼 (예전엔 화면 반 폭에서 줄이 바뀜), 화면 - 32px까지 · 띄어쓰기 없는 긴 글도 넘치지 않고 줄 바꿈. 사진 cr242/remote-360-*.png
  await step('CR-242 N3 폰 리모컨 알림 폭 (360): 짧은 글은 글 길이만큼, 긴 글은 화면 - 32px까지 넓게, 띄어쓰기 없는 글은 넘치지 않음', ['N12'], async () => {
    const n242 = path.join(ctx.OUT, 'cr242'), R = {};
    const PHONE_360 = { name: '360x800', width: 360, height: 800, mobile: true, touch: true };
    const LONG = '노래방 PC와 연결이 잠깐 끊겼어요 · 같은 와이파이인지 보고 잠시 뒤 다시 눌러 보세요';
    const NOSPACE = 'QA시험아주긴곡제목띄어쓰기없음'.repeat(3);
    const at = async (text, shot) => {        // 리모컨 알림은 1.8초라 띄우자마자 잰다
      await ph.eval(`toast(${q(text)})`); await sleep(60);
      const b = await ph.eval(`(()=>{const t=document.querySelector('#toast'); if(t.hidden) return null; const r=t.getBoundingClientRect(), rg=document.createRange(); rg.selectNodeContents(t);
        const tops=new Set([...rg.getClientRects()].filter(x=>x.width>0).map(x=>Math.round(x.top))), cs=getComputedStyle(t);
        return {vw:innerWidth, w:Math.round(r.width), lines:tops.size, l:Math.round(r.left), r:Math.round(innerWidth-r.right), over:t.scrollWidth>t.clientWidth+1,
          need:Math.ceil(rg.getBoundingClientRect().width+parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight)+parseFloat(cs.borderLeftWidth)+parseFloat(cs.borderRightWidth)),
          pad:cs.padding, sh:cs.boxShadow, bot:cs.bottom, gap:Math.round(innerHeight-r.bottom)}})()`);
      if (shot) await ph.shot(path.join(n242, shot));
      return b;
    };
    await ph.emulate(PHONE_360); await sleep(150);
    try {
      R.short = await at('예약했어요 · 3번째', 'remote-360-toast-short.png');
      R.long = await at(LONG, 'remote-360-toast-long.png');
      R.nospace = await at(NOSPACE, 'remote-360-toast-nospace.png');
      // CR-243 ②: 여백·그림자 (사진 cr243/remote-360-toast.png)
      R.c243 = await at(LONG, null); await ph.shot(path.join(ctx.OUT, 'cr243', 'remote-360-toast.png')).catch(() => {});
    } finally { await ph.emulate(PHONE); await ph.eval(`(()=>{const t=document.querySelector('#toast'); t.hidden=true})()`).catch(() => {}); }
    const side = b => !!b && !b.over && b.l >= 15.5 && b.r >= 15.5;
    const f = b => b ? `${b.w}px ${b.lines}줄 (좌 ${b.l}·우 ${b.r}${b.over ? ' 넘침' : ''})` : '안 뜸';
    ok('N12', side(R.short) && R.short.lines === 1 && Math.abs(R.short.w - R.short.need) <= 2
      && side(R.long) && R.long.lines >= 2 && R.long.w >= R.long.vw - 32 - 2 && side(R.nospace) && R.nospace.lines >= 2,
      `CR-242 N3 리모컨 알림 360: 짧은 글 ${f(R.short)} (글 길이 ${R.short?.need}px) · 긴 글 ${f(R.long)} (화면 - 32 = ${(R.long?.vw ?? 360) - 32}px) · 띄어쓰기 없는 글 ${f(R.nospace)}`);
    // CR-243 ②: 리모컨 알림 여백·그림자도 앱 알림과 같게 (10px 16px · 0 10px 30px), 자리(아래 84px)·폭(글 길이만큼, 화면 - 32px까지)은 그대로
    const app = await p.eval(`(()=>{const cs=getComputedStyle(document.querySelector('#toast')); return {pad:cs.padding, sh:cs.boxShadow}})()`).catch(() => null);
    const c = R.c243;
    ok('N12', !!c && c.pad === '10px 16px' && c.sh === 'rgba(0, 0, 0, 0.4) 0px 10px 30px 0px' && !!app && c.pad === app.pad && c.sh === app.sh
      && c.bot === '84px' && side(c) && c.w >= c.vw - 32 - 2,
      `CR-243 ② 리모컨 알림 360: 여백 ${c?.pad} · 그림자 ${c?.sh} (앱 알림 ${app?.pad} · ${app?.sh}) · 아래 ${c?.bot} (화면 아래 끝과 ${c?.gap}px) · 긴 글 ${f(c)}`);
  });

  await step('리모컨 탭 버튼 11개 → PC가 그대로 실행, 진동·안내, 지금 곡 카드', ['N7', 'N12', 'N6', 'N13'], async () => {
    const res = {};
    await ph.eval('window.scrollTo(0,0)');
    await tap('[data-cmd="start"]'); res.start = await cmd('start', 'state.playing');
    // 휴대폰은 1초마다 상태를 받는다: PC가 1초 넘게 부른 상태가 휴대폰에 올 때까지
    await ph.until(`/▶ 부르는 중/.test(document.querySelector('#now .meta')?.textContent) && !/^0:00/.test(document.querySelector('#now .meta span:last-child')?.textContent)`, 8000);
    const now = await ph.eval(`({no:document.querySelector('#now .no').textContent, t:document.querySelector('#now .t').textContent, meta:document.querySelector('#now .meta').textContent, w:parseFloat(document.querySelector('#now .bar i').style.width)})`);
    const pcT = await p.eval('Math.round(curTime())');
    const phT = (now.meta.match(/(\d+):(\d\d) \/ 0:5\d$/) || []).slice(1).map(Number);
    ok('N6', now.no === '10001' && now.t === '작은 방의 노래' && /▶ 부르는 중/.test(now.meta) && now.w > 0 && phT.length === 2 && Math.abs(phT[0] * 60 + phT[1] - pcT) <= 2, `지금 곡 카드 ${now.no} ${now.t} "${now.meta}" (PC ${pcT}초)`);
    await tap('[data-cmd="pause"]'); res.pause = await cmd('pause', '!state.playing && state.offset>0');
    await tap('[data-cmd="pause"]'); res.pause = res.pause && await cmd('pause', 'state.playing');
    let m = await marks(p); await tap('[data-cmd="jump"]'); res.jump = await p.until(`__ui.flashes.length>${m.f}`, 4000);
    await tap('[data-cmd="key"][data-delta="-1"]'); res['key-'] = await cmd('key', `document.querySelector('#keyOut').textContent==='-1'`, 60000);
    await ph.until(`document.querySelector('#keyK').firstChild.textContent==='키 -1'`, 5000);
    const keyK = await ph.eval(`document.querySelector('#keyK').firstChild.textContent`);
    await tap('[data-cmd="keyReset"]'); res.keyReset = await cmd('keyReset', `document.querySelector('#keyOut').textContent==='원래 키'`);
    await tap('[data-cmd="key"][data-delta="1"]'); res['key+'] = await cmd('key', `document.querySelector('#keyOut').textContent==='+1'`, 60000);
    await tap('[data-cmd="keyReset"]'); await cmd('keyReset', `document.querySelector('#keyOut').textContent==='원래 키'`);
    await tap('[data-cmd="rec"]'); res.rec = await cmd('rec', 'state.armed');
    await ph.until(`document.querySelector('#recK small').textContent==='켜짐'`, 5000);
    const recK = await ph.eval(`document.querySelector('#recK small').textContent`);
    await tap('[data-cmd="rec"]'); await cmd('rec', '!state.armed');
    const v0 = await p.eval('settings.mrVol');
    await tap('[data-cmd="mr"][data-delta="-5"]'); res['mr-'] = await cmd('mr', `settings.mrVol===${v0 - 5}`);
    await ph.until(`document.querySelector('#mrK').textContent==='볼륨 ${v0 - 5}'`, 5000);
    const mrK = await ph.eval(`document.querySelector('#mrK').textContent`);
    await tap('[data-cmd="mr"][data-delta="5"]'); res['mr+'] = await cmd('mr', `settings.mrVol===${v0}`);
    await tap('[data-cmd="cancel"]'); res.cancel = await cmd('cancel', '!state.playing && state.offset===0');
    await tap('[data-cmd="tv"]'); res.tv = await cmd('tv', 'state.tv');
    await p.eval('exitTV()');
    const bad = Object.entries(res).filter(([, v]) => !v).map(([k]) => k);
    ok('N7', !bad.length && keyK === '키 -1' && recK === '켜짐' && mrK === `볼륨 ${v0 - 5}`, bad.length ? `안 된 버튼: ${bad.join(',')}` : `11개 다 PC에서 실행 · 휴대폰 표시: "${keyK}", 녹음 "${recK}", "${mrK}"`);
    const vib = await ph.eval('__ui.vib.slice()');
    // 회사 진동 (js/haptics.js, CR-018): 누르기 tap [50], 취소는 warning [50,100,50]만
    const kinds = vib.map(v => JSON.stringify(v));
    ok('N12', vib.length >= 11 && kinds.every(k => k === '[50]' || k === '[50,100,50]') && kinds.filter(k => k === '[50,100,50]').length === 1, `누를 때 진동 ${vib.length}번 (${[...new Set(kinds)].join(' ')}ms, 취소만 경고 진동)`);
  });

  await step('번호 키패드 예약·우선예약, 검색 탭(초성·♡·우선·예약), 예약 탭(지금·맨 위로·취소), 내 목록 탭(사용자·전체 예약·곡 예약)', ['N8', 'N9', 'N10', 'N11', 'N12'], async () => {
    await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
    for (const k of '10001') await ph.tap(`#pad3 button:not([data-k]):nth-child(${k === '0' ? 11 : +k})`);
    const ns = await ph.eval(`document.querySelector('#numSong').textContent`);
    const m0 = await marks(ph);
    await tap('#pad3 [data-k="res"]');
    const r1 = await cmd('reserve', `state.queue.length===1`);
    const toastPh = await sawToast(ph, /예약 · 작은 방의 노래/, m0);
    for (const k of String(ids.longNo)) await ph.tap(`#pad3 button:not([data-k]):nth-child(${k === '0' ? 11 : +k})`);
    await tap('#pad3 [data-k="pri"]');
    const r2 = await cmd('reserve', `state.queue.length===2 && songById(state.queue[0]).no===${ids.longNo}`);
    ok('N8', ns === '작은 방의 노래 · 예태 노래방 데모 MR' && r1 && r2, `번호 → "${ns}" · 예약 · 우선예약 (PC 예약 ${(await pcs()).q.join(',')})`);
    ok('N12', toastPh, '예약하면 휴대폰에 결과 안내 ("예약 · 작은 방의 노래")');
    // 검색 탭
    await tap('nav [data-tab="search"]');
    await ph.eval(`document.querySelector('#q').focus()`);
    await ph.type('ㅈㅇㅂ'); await sleep(200);
    const res = await ph.eval(`[...document.querySelectorAll('#results .item')].map(li=>li.querySelector('.no').textContent)`);
    const fav0 = await p.eval(`isFav(songById('demo'))`);
    await tap('#results .item:first-child .acts .fav');
    const favOk = await p.until(`isFav(songById('demo'))===${!fav0}`, 4000);
    await tap('#results .item:first-child .acts .fav');
    await p.until(`isFav(songById('demo'))===${fav0}`, 4000);
    await tap('#results .item:first-child .acts .sb:nth-child(2)');      // 우선
    const pri = await cmd('reserve', `state.queue.length===3 && state.queue[0]==='demo'`);
    await tap('#results .item:first-child .acts .p');                    // 예약
    const res2 = await cmd('reserve', `state.queue.length===4 && state.queue[3]==='demo'`);
    ok('N9', res[0] === '10001' && favOk && pri && res2, `초성 "ㅈㅇㅂ" → ${res.join(',')} · ♡ → PC 좋아요 · 우선 · 예약`);
    // 예약 탭
    const phQ = n => ph.until(`document.querySelectorAll('#queue .item').length===${n}`, 6000);
    await tap('nav [data-tab="queue"]');
    await phQ(4);
    const qn = await ph.eval(`[...document.querySelectorAll('#queue .item')].map(li=>li.querySelector('.no').textContent)`);
    const cnt = await ph.eval(`document.querySelector('#qCnt').textContent`);
    await tap('#queue .item:nth-child(2) .acts .sb:nth-child(2)');      // 둘째 줄 맨 위로
    const top = await cmd('top', `state.queue.length===4 && songById(state.queue[0]).no===${+qn[1]}`);
    await ph.until(`document.querySelector('#queue .item .no')?.textContent===${q(qn[1])}`, 6000);
    await tap('#queue .item:nth-child(4) .acts .x');                      // 넷째 줄 취소
    const un = await cmd('unreserve', `state.queue.length===3`);
    await phQ(3);
    await tap('#queue .item:nth-child(2) .acts .p');                      // 지금
    const nowOk = await cmd('now', `state.playing && state.queue.length===2`, 8000);
    await p.eval('stopPlayback()');
    ok('N10', qn.length === 4 && cnt === '4' && top && un && nowOk, `예약 ${qn.join(',')} · 맨 위로 · 취소 · 지금 부르기 → PC 시작`);
    // 내 목록 탭: 사용자 바꾸기, 전체 예약, 곡 예약
    await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
    const twoUsers = await p.eval('liveProfiles().length');
    if (twoUsers < 2) await p.eval(`(()=>{ const u={id:'qa-remote-user', name:'QA리모컨', favorites:[], playlists:[], updatedAt:Date.now()}; Profiles.list.push(u); saveProfiles(u); })()`);
    await p.eval(`(()=>{ const s=songById(${q(ids.long)}); if(!isFav(s)) toggleFav(s); })()`);
    await tap('nav [data-tab="mine"]');
    await ph.until(`document.querySelectorAll('#profiles .chip').length>=2 && document.querySelectorAll('#mine .group:first-child .item').length>0`, 6000);
    const me0 = await p.eval('me().name');
    const other = await ph.eval(`[...document.querySelectorAll('#profiles .chip')].find(b=>!b.classList.contains('on'))?.textContent.slice(1)`);
    await ph.eval(`[...document.querySelectorAll('#profiles .chip')].find(b=>!b.classList.contains('on')).scrollIntoView({block:'center'})`);
    const chipSel = await ph.eval(`'#profiles .chip:nth-child(' + ([...document.querySelectorAll('#profiles .chip')].findIndex(b=>!b.classList.contains('on'))+1) + ')'`);
    await tap(chipSel);
    const sw = await cmd('profile', `me().name===${q(other)}`);
    await tap(chipSel.replace(/nth-child\(\d+\)/, `nth-child(${await ph.eval(`[...document.querySelectorAll('#profiles .chip')].findIndex(b=>b.textContent.slice(1)===${q(me0)})+1`)})`));
    await cmd('profile', `me().name===${q(me0)}`);
    await ph.until(`document.querySelector('#profiles .chip.on')?.textContent.slice(1)===${q(me0)} && document.querySelectorAll('#mine .group:first-child .item').length>0`, 6000);
    await tap('#mine .group:first-child h3 .p');                          // 좋아요 전체 예약
    const all = await cmd('reserveMany', `state.queue.length===me().favorites.filter(songById).length && state.queue.length>0`);
    const n = await p.eval('state.queue.length');
    await tap('#mine .group:first-child .item:first-child .acts .p');     // 곡 예약
    const one = await cmd('reserve', `state.queue.length===${n + 1}`);
    if (twoUsers < 2) await p.eval(`Profiles.list=Profiles.list.filter(x=>x.id!=='qa-remote-user'); saveProfiles()`);
    ok('N11', !!other && sw && all && one, `사용자 바꾸기 (${me0} → ${other} → ${me0}) · 좋아요 전체 예약 ${n}곡 · 곡 예약`);
    await p.eval(`state.queue=[]; saveQueue(); renderQueue()`);
    await tap('nav [data-tab="remote"]');
  });

  await step('PC가 휴대폰 명령 16종을 받아 실행', ['N13'], async () => {
    const got = new Set(await p.eval('__cmds'));
    const all = ['start', 'pause', 'cancel', 'jump', 'reserve', 'reserveMany', 'unreserve', 'top', 'now', 'mr', 'key', 'keyReset', 'profile', 'fav', 'tv', 'rec'];
    const miss = all.filter(c => !got.has(c));
    ok('N13', !miss.length, miss.length ? `받지 못한 명령: ${miss.join(',')}` : `16종 다 받아 실행 (각 명령의 결과는 위 N7~N11에서 PC 상태로 확인)`);
  });

  await step('설정 창 "새 코드 만들기" → 대기 화면·설정 창 코드·QR이 바로 바뀜(겹치지 않음), 휴대폰은 "코드가 바뀌었어요" → 새 코드로 다시 연결', ['N16', 'N3'], async () => {
    await p.eval('enterTV()'); await sleep(200);
    await p.eval('exitTV()');
    await p.click('#settingsBtn');
    await p.click('#remoteNewPin');
    await p.until(`/새 코드로 바꿨어요: \\d{4}\\./.test(document.querySelector('#remotePinMsg').textContent)`, 5000);
    const msg = await txt(p, '#remotePinMsg');
    const npin = await p.eval('Remote.info.pin');
    await sleep(800);
    const boxes = await p.eval(`['#remoteInfo','#remoteSet'].map(s=>({t:document.querySelector(s).textContent, qr:document.querySelectorAll(s+' img.qr').length}))`);
    const qrUrl = await p.eval('Remote.info.url');
    await p.click('#cloudClose');
    // 이미 붙어 있던 휴대폰이 버튼을 누르면 "코드가 바뀌었어요". 진짜 휴대폰(다른 기기)은 1초마다 묻는 상태 확인이 먼저 막혀 "코드가 맞지 않아요…"가 보통 먼저 나온다.
    // 시험 탭은 이 PC(127.0.0.1)라 상태 확인이 코드 없이 통과해서 버튼 쪽 문구만 본다 (CR-149)
    await tap('[data-cmd="jump"]');
    const asked = await ph.until(`!document.querySelector('#pinView').hidden && document.querySelector('#pinErr').textContent==='코드가 바뀌었어요. 다시 넣어 주세요'`, 5000);
    await ph.tap('#pinIn'); await ph.type(npin); await tap('#pinGo');
    const re = await ph.until(`!document.querySelector('#app').hidden && document.querySelector('#conn span').textContent==='연결됨'`, 5000);
    ok('N16', npin !== pin && msg.includes(`새 코드로 바꿨어요: ${npin}.`) && boxes.every(b => b.t.includes(`코드 ${npin}`) && b.qr <= 1) && qrUrl.endsWith(`?pin=${npin}`) && asked,
      `${pin} → ${npin} · 대기 화면·설정 창 코드 바뀜, QR ${boxes.map(b => b.qr).join('/')}개(겹침 없음) · 휴대폰 "코드가 바뀌었어요"`);
    ok('N3', asked && re, '코드가 바뀌면 다시 넣으라고 함 → 새 코드로 다시 연결');
  });

  // CR-251 YT-r12: 검은 서버 창을 껐다 켜면 명령 번호가 0부터 다시 → 열려 있던 PC 화면이 알아채고 번호를 맞춘 뒤 폰 명령을 실행·상태를 다시 올린다.
  // 진짜 서버는 그대로 두고, PC 페이지의 fetch만 "새 서버"(번호를 지금부터 0으로·다른 boot 표)처럼 바꿔서 본다
  await step('서버를 껐다 켬 흉내: 화면이 번호를 맞추고 폰 명령을 그대로 실행 · 상태를 다시 올림 · 앞 요청이 끝나기 전엔 또 안 물음', ['N13'], async () => {
    await p.eval(`(() => {
      const of = window.fetch.bind(window); window.__rsOf = of; window.__rs = { base: null, pushes: 0, inflight: 0, maxIn: 0 };
      window.fetch = async (u, o) => {
        const s = String(u), rs = window.__rs;
        if (s.startsWith('/api/remote/state') && o && o.method === 'POST' && rs.base != null) rs.pushes++;
        if (!s.startsWith('/api/remote/poll')) return of(u, o);
        rs.inflight++; rs.maxIn = Math.max(rs.maxIn, rs.inflight);
        try {
          if (rs.base == null) return await of(u, o);
          const since = +new URL(s, location.href).searchParams.get('since') || 0;
          const j = await (await of('/api/remote/poll?since=' + (since + rs.base), o)).json();
          return new Response(JSON.stringify({ cmds: j.cmds, last: Math.max(0, j.last - rs.base), boot: 'ffff0000' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } finally { rs.inflight--; }
      };
    })()`);
    const since0 = await p.eval('Remote.since');
    await p.eval(`window.__rs.base = Remote.since`);            // 이 순간 서버를 새로 켠 것처럼 (새 서버 번호 0)
    const reset = await p.until(`Remote.since === 0 && Remote.boot === 'ffff0000'`, 4000);
    const pushed = await p.until(`window.__rs.pushes >= 1`, 4000);   // 상태가 안 바뀌어도 새 서버에 다시 올림
    const n0 = await p.eval('__cmds.length'), key0 = await p.eval('state.key||0');
    const r = await fetch(`${ctx.base}/api/remote/cmd`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: await p.eval('Remote.info.pin'), cmd: 'key', args: { delta: 1 } }) });
    const ran = await p.until(`__cmds.length === ${n0} + 1 && __cmds[__cmds.length-1] === 'key' && (state.key||0) === ${key0} + 1`, 4000);
    const one = await p.eval('window.__rs.maxIn');
    // 되돌리기: 받아 오기를 잠깐 막고 진짜 서버 번호로 맞춘 뒤 원래 fetch
    await p.eval(`(async () => { Remote.polling = true; window.fetch = window.__rsOf; const j = await (await fetch('/api/remote/poll?since=0', { cache: 'no-store' })).json(); Remote.since = j.last; Remote.boot = j.boot; Remote.polling = false; delete window.__rs; delete window.__rsOf; })()`);
    await p.eval(`setKey(${key0})`);
    ok('N13', since0 > 0 && reset && pushed && r.status === 200 && ran && one === 1,
      `새 서버(번호 0부터): 화면 번호 ${since0} → 0 ${reset ? '맞춤' : '(안 맞춤)'} · 상태 다시 올림 ${pushed ? '됨' : '안 됨'} · 폰 명령 "key" ${ran ? '실행' : '안 됨'} · 동시에 묻는 요청 최대 ${one}개`);
  });

  await step('홈 화면 아이콘용 manifest', ['N19'], async () => {
    const m = await ph.eval(`(async()=>{ const href=document.querySelector('link[rel=manifest]').getAttribute('href'); const j=await (await fetch(href)).json(); return {href, ...j} })()`);
    ok('N19', m.href === 'remote.webmanifest' && m.short_name === '노래방 리모컨' && m.start_url === 'remote.html' && m.display === 'standalone' && m.icons?.length >= 2, `remote.webmanifest "${m.short_name}" · 시작 ${m.start_url} · ${m.display}`);
  });
  await ph?.close();

  await step('서버 없이 연 화면(정적 서버, GitHub Pages와 같은 상태)에는 리모컨이 안 켜짐', ['N1'], async () => {
    const s = await openPage(ctx, PC, ctx.staticBase + '/index.html');
    await sleep(800);
    const st = await s.eval(`({on:Remote.on, info:document.querySelector('#remoteInfo').hidden, set:document.querySelector('#remoteSet').textContent, ctl:document.querySelector('#remoteCtl').hidden})`);
    const main = await p.eval('Remote.on');
    await s.close();
    ok('N1', main && !st.on && st.info && st.ctl && /"YT 노래방 켜기"로 연 화면에서만/.test(st.set), `서버(localhost) 화면 리모컨 켜짐 · 정적 서버 화면 꺼짐 (대기 화면 칸 없음, 설정 창 "${st.set.slice(0, 20)}…")`);
  });
  await stopAll(p);
}
