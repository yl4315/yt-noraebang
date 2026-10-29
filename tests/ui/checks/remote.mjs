// 흐름 13·14: 휴대폰 리모컨 (두 번째 탭을 폰 크기로 → ?pin= 주소 → 버튼·숫자판·검색·예약·내 목록 → PC 화면이 실제로 바뀌는지),
// 설정 창 "새 코드 만들기" → 휴대폰 "코드가 바뀌었어요", 서버 없이 연 화면(정적 서버 = Pages와 같은 상태)에는 리모컨 칸이 없음
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
    ok('N12', vib.length >= 11 && vib.every(v => v === 12), `누를 때 진동 ${vib.length}번 (${[...new Set(vib)].join(',')}ms)`);
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
    ok('N8', ns === '작은 방의 노래 · YT 노래방 데모 MR' && r1 && r2, `번호 → "${ns}" · 예약 · 우선예약 (PC 예약 ${(await pcs()).q.join(',')})`);
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
    await p.until(`/새 코드 \\d{4}로 바꿨어요/.test(document.querySelector('#remotePinMsg').textContent)`, 5000);
    const msg = await txt(p, '#remotePinMsg');
    const npin = await p.eval('Remote.info.pin');
    await sleep(800);
    const boxes = await p.eval(`['#remoteInfo','#remoteSet'].map(s=>({t:document.querySelector(s).textContent, qr:document.querySelectorAll(s+' img.qr').length}))`);
    const qrUrl = await p.eval('Remote.info.url');
    await p.click('#cloudClose');
    // 이미 붙어 있던 휴대폰이 버튼을 누르면
    await tap('[data-cmd="jump"]');
    const asked = await ph.until(`!document.querySelector('#pinView').hidden && document.querySelector('#pinErr').textContent==='코드가 바뀌었어요. 다시 넣어 주세요'`, 5000);
    await ph.tap('#pinIn'); await ph.type(npin); await tap('#pinGo');
    const re = await ph.until(`!document.querySelector('#app').hidden && document.querySelector('#conn span').textContent==='연결됨'`, 5000);
    ok('N16', npin !== pin && msg.includes(`새 코드 ${npin}로 바꿨어요`) && boxes.every(b => b.t.includes(`코드 ${npin}`) && b.qr <= 1) && qrUrl.endsWith(`?pin=${npin}`) && asked,
      `${pin} → ${npin} · 대기 화면·설정 창 코드 바뀜, QR ${boxes.map(b => b.qr).join('/')}개(겹침 없음) · 휴대폰 "코드가 바뀌었어요"`);
    ok('N3', asked && re, '코드가 바뀌면 다시 넣으라고 함 → 새 코드로 다시 연결');
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
