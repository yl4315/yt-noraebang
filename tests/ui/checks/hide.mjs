// CR-229 숨김 정리 (W13): 기본 화면(고급 꺼짐)에서는 복잡한 칸이 안 보이고, 설정 창 "더 보기 (고급)"을 켜면 예전처럼 모두 보인다.
// 다른 점검들은 고급을 켠 화면(_lib.mjs openPage)에서 전처럼 돌고, 이 점검만 { ...ctx, adv: false }로 새 탭을 연다 (허브 점검 바로 앞에 돎).
// 숨기는 것은 화면 칸뿐: 저장된 설정 값(nb-…)이 안 바뀌는지도 본다. 서버 없는 정적(Pages 흉내)에서는 옛 휴대폰 리모컨이 아예 안 보이고,
// PC 서버(리모컨 켜짐)에서는 고급 안에만 보인다. 폰 412×915에서 설정 창 길이가 줄었는지 잰다. 디자인실·검수용 사진 cr229-*.png.
// "새 코드 만들기"는 누르지 않는다. 끝나면 nb-advanced를 다른 점검과 같은 '1'로, nb-deck은 처음 값으로 돌린다.
import path from 'node:path';
import fs from 'node:fs';
import { PC, TV, PHONE, PHONE_L, READY_DEMO, openPage, isHidden, visible, sleep, q, stopAll } from './_lib.mjs';
export const areas = ['W'];

// 새 탭에서 한 번만: 고급·음향 설정 접힘 기억을 지워 "처음 쓰는 사람" 화면으로 (새로 고침에서는 안 지움 → 기억 시험)
const FRESH = `try{if(!sessionStorage.getItem('__ui-fresh')){sessionStorage.setItem('__ui-fresh','1');localStorage.removeItem('nb-advanced');localStorage.removeItem('nb-deck')}}catch{}`;
// 저장된 설정 값 (nb-advanced·nb-deck은 이번에 새로 생긴 화면 기억이라 뺌)
const SNAP = `JSON.stringify(Object.keys(localStorage).filter(k=>k.startsWith('nb-')&&k!=='nb-advanced'&&k!=='nb-deck').sort().map(k=>[k,localStorage.getItem(k)]))`;
const TV_READY = 'typeof state!=="undefined" && state.tv && !!state.song.buffer';

export default async function hide(ctx) {
  const { ok, step } = ctx, p0 = ctx.p;
  const shotDir = ctx.shotsDir; fs.mkdirSync(shotDir, { recursive: true });
  const shot = async (p, name) => { try { await p.eval(`(()=>{const t=document.querySelector('#toast'); if(t) t.hidden=true})()`); await sleep(350); await p.shot(path.join(shotDir, name)); ctx.log('  사진 ' + name); } catch (e) { ctx.log('  (사진 실패 ' + name + ': ' + e.message + ')'); } };
  const open = async (size, url, ready = READY_DEMO) => {
    const p = await openPage({ ...ctx, adv: false }, size, null);
    await p.s('Page.addScriptToEvaluateOnNewDocument', { source: FRESH });
    await p.goto(url, ready, 150000);
    return p;
  };
  const hiddenAll = (p, sels) => Promise.all(sels.map(async s => [s, await isHidden(p, s)]));
  const list = xs => xs.map(([s, h]) => `${s} ${h ? '숨음' : '보임'}`).join(' · ');
  await stopAll(p0);
  // 저장된 설정(음향 칸 값)이 꼭 있게: 마이크 볼륨 칸을 같은 값 그대로 한 번 "움직임" → saveSettings (값은 안 바뀜)
  await p0.eval(`(()=>{const i=document.querySelector('#s-micVol'); i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const before =await p0.eval(`({snap:${SNAP}, deck:localStorage.getItem('nb-deck')})`);
  let h = null, ph = null, st = null, tv = null;
  try {
    await step('PC 1280 기본(고급 꺼짐): 아래 조작부 — 음향 설정 접힘, 볼륨 2개만, 나머지는 "더 보기 ›" 안, 가사 타이밍은 "가사 맞추기 ›" 한 줄', ['W13'], async () => {
      h = await open(PC, ctx.base + '/index.html');
      const a = await h.eval(`({adv:document.documentElement.classList.contains('adv'), ls:localStorage.getItem('nb-advanced'), deck:document.querySelector('#deckMore').open})`);
      ok('W13', !a.adv && a.ls === null && !a.deck, `처음 연 화면: 고급 ${a.adv ? '켜짐' : '꺼짐'} (nb-advanced ${a.ls}) · 음향 설정 ${a.deck ? '펴짐' : '접힘'}`);
      await h.eval(`document.querySelector('#deckMore').scrollIntoView({block:'center'})`);
      await h.click('#deckMore > summary');
      await sleep(150);
      const d1 = await h.eval(`({open:document.querySelector('#deckMore').open, ls:localStorage.getItem('nb-deck')})`);
      const hid = await hiddenAll(h, ['#s-echo', '#s-reverb', '#s-guide', '#s-recOffset', '#measureBtn', '.deck .toggles', '#lyrTools']);
      const vis = await hiddenAll(h, ['#s-mrVol', '#s-micVol', '#deckMore .knobs .fold-btn', '#lyrFold .fold-btn', '.deck .keys']);
      ok('W13', d1.open && d1.ls === '1' && hid.every(x => x[1]) && vis.every(x => !x[1]), `음향 설정 펴기 → nb-deck ${d1.ls} · 숨음: ${list(hid)} · 보임: ${list(vis)}`);
      await h.eval(`document.querySelector('.deck').scrollIntoView({block:'start'})`);
      await shot(h, 'cr229-01-deck-default-1280x800.png');
      // "더 보기 ›" → 그 자리에서 펴짐 (고급은 그대로 꺼짐)
      await h.click('#deckMore .knobs .fold-btn');
      await h.click('#lyrFold .fold-btn');
      await sleep(150);
      const un = await hiddenAll(h, ['#s-echo', '#s-reverb', '#s-guide', '#s-recOffset', '#measureBtn', '.deck .toggles', '#lyrTools', '#syncBtn']);
      const ar = await h.eval(`({deck:document.querySelector('#deckMore').classList.contains('unfold'), lyr:document.querySelector('#lyrFold .fold-btn').getAttribute('aria-expanded'), btn:getComputedStyle(document.querySelector('#deckMore .knobs .fold-btn')).display, adv:document.documentElement.classList.contains('adv'), sync:document.querySelector('#syncBtn').textContent, demo:!!state.song.demo})`);
      ok('W13', ar.deck && ar.lyr === 'true' && ar.btn === 'none' && !ar.adv && un.slice(0, 7).every(x => !x[1]) && (ar.demo ? un[7][1] : !un[7][1]) && ar.sync === '가사 맞추기',
        `"더 보기 ›"·"가사 맞추기 ›" 누름 → 그 자리에서 펴짐 (${list(un.slice(0, 7))}), 펴기 단추 사라짐, 고급은 꺼진 채 · [${ar.sync}] (${ar.demo ? '데모곡이라 숨음' : '보임'})`);
      await h.eval(`document.querySelector('.deck').scrollIntoView({block:'start'})`);
      await shot(h, 'cr229-02-deck-unfold-1280x800.png');
      // 음향 설정 접힘 기억: 새로 고침 → 편 채로, 접고 새로 고침 → 접힌 채로
      await h.goto(ctx.base + '/index.html', READY_DEMO, 150000);
      const r1 = await h.eval(`({open:document.querySelector('#deckMore').open, un:document.querySelector('#deckMore').classList.contains('unfold')})`);
      await h.eval(`document.querySelector('#deckMore').scrollIntoView({block:'center'})`);
      await h.click('#deckMore > summary'); await sleep(150);
      const ls0 = await h.eval(`localStorage.getItem('nb-deck')`);
      await h.goto(ctx.base + '/index.html', READY_DEMO, 150000);
      const r2 = await h.eval(`document.querySelector('#deckMore').open`);
      ok('W13', r1.open && !r1.un && ls0 === '0' && !r2, `음향 설정 편 상태 기억: 새로 고침 → ${r1.open ? '펴짐' : '접힘'}(세부 칸은 다시 접힘 ${!r1.un}) · 접기 → nb-deck ${ls0} → 새로 고침 → ${r2 ? '펴짐' : '접힘'}`);
    });

    await step('PC 1280 기본: 검색 줄 단추 ♡ · [우선] · [예약](보조), 칸 안내 글', ['W13'], async () => {
      await h.eval('openSearch()');
      await h.until(`document.querySelectorAll('#searchList li .acts button').length>=3`, 3000);
      const s = await h.eval(`(()=>{const li=document.querySelector('#searchList li'); const bs=[...li.querySelectorAll('.acts button')];
        return {t:bs.map(b=>b.textContent), aria:bs.map(b=>b.getAttribute('aria-label')||''), prim:bs.filter(b=>b.classList.contains('primary')).length, ph:document.querySelector('#searchInput').placeholder}})()`);
      ok('W13', /^[♡♥]$/.test(s.t[0]) && s.t[1] === '우선' && s.aria[1] === '우선예약' && s.t[2] === '예약' && s.prim === 0 && s.ph === '제목·가수·번호, 초성(ㅂㅍㅈ)으로 찾기',
        `줄 단추 ${s.t.join(' · ')} (읽어 주는 이름 "${s.aria[1]}", 주 색 단추 ${s.prim}) · 칸 "${s.ph}"`);
      await shot(h, 'cr229-03-search-1280x800.png');
      await stopAll(h);
    });

    await step('PC 1280 기본: 설정 창 — 곡 창고만 보이고 "더 보기 (고급)"은 접힘 · 켜면 예전 칸이 모두 보이고 이 기기에 기억 · 저장된 설정 값 그대로', ['W13'], async () => {
      await h.click('#settingsBtn');
      await h.until(`document.querySelector('#storeSum').textContent.length>0`, 3000);
      const cid = await h.eval('!!Cloud.clientId');
      const SET_HID = ['#advBox', '#travelSec', '#bkExport', '#mrSec', '#mrServer', '#remoteSec', '#storeTxt', '#storeCounts', '#dlAllBtn', '#persistTxt'];
      const off = await hiddenAll(h, SET_HID);
      const offV = await hiddenAll(h, ['#storeSec .fold-btn', '#advBtn', '.set-foot']);
      const o = await h.eval(`({sum:document.querySelector('#storeSum').textContent, aria:document.querySelector('#advBtn').getAttribute('aria-expanded'), cadv:getComputedStyle(document.querySelector('#clientAdv')).display})`);
      ok('W13', off.every(x => x[1]) && offV.every(x => !x[1]) && o.aria === 'false' && /^곡 \d+개/.test(o.sum) && (cid ? o.cadv === 'none' : o.cadv !== 'none'),
        `고급 꺼짐: 숨음 ${list(off)} · 보임 ${list(offV)} · 요약 "${o.sum}" · 클라이언트 ID 칸 ${o.cadv === 'none' ? '숨음' : '보임'}(ID ${cid ? '있음' : '없음'})`);
      await shot(h, 'cr229-04-settings-default-1280x800.png');
      // 곡 창고 한 줄 → 그 자리에서 펴짐
      await h.click('#storeSec .fold-btn'); await sleep(120);
      const st1 = await hiddenAll(h, ['#storeTxt', '#storeCounts', '#dlAllBtn', '#persistTxt']);
      const st1a = await h.eval(`document.querySelector('#storeSec .fold-btn').getAttribute('aria-expanded')`);
      ok('W13', st1.every(x => !x[1]) && st1a === 'true', `"이 기기에 저장된 곡" 누름 → ${list(st1)}`);
      // 고급 켜기
      const snap0 = await h.eval(SNAP);
      await h.click('#advBtn'); await sleep(150);
      const on = await hiddenAll(h, ['#advBox', '#travelSec', '#bkExport', '#mrSec', '#remoteSec', '#storeTxt']);
      const onH = await hiddenAll(h, ['#storeSec .fold-btn', '.set-foot']);
      const a = await h.eval(`({adv:document.documentElement.classList.contains('adv'), ls:localStorage.getItem('nb-advanced'), aria:document.querySelector('#advBtn').getAttribute('aria-expanded'), h3:document.querySelector('#remoteSec h3').textContent, first:document.querySelector('#advBox .set-sec').id, cadv:getComputedStyle(document.querySelector('#clientAdv')).display, addr:document.querySelector('#mrAddr').open})`);
      ok('W13', a.adv && a.ls === '1' && a.aria === 'true' && on.every(x => !x[1]) && onH.every(x => x[1]) && a.first === 'travelSec' && a.cadv !== 'none' && a.h3 === '옛 휴대폰 리모컨 (PC에서 켰을 때만 보여요)' && !a.addr,
        `"더 보기 (고급)" 누름 → nb-advanced ${a.ls}, aria-expanded ${a.aria} · 보임 ${list(on)} · 숨음 ${list(onH)} · 첫 구역 ${a.first} · PC 서버라 "${a.h3}" 보임 · 서버 주소 칸은 접힌 채`);
      await h.eval(`document.querySelector('#advBtn').scrollIntoView({block:'start'})`);
      await shot(h, 'cr229-05-settings-adv-1280x800.png');
      await h.click('#cloudClose');
      // 아래 조작부도 예전처럼 (PC: 음향 설정 펴짐·칸 다 보임 — 새로 고침 뒤)
      await h.goto(ctx.base + '/index.html', READY_DEMO, 150000);
      const k = await h.eval(`({adv:document.documentElement.classList.contains('adv'), deck:document.querySelector('#deckMore').open})`);
      const kv = await hiddenAll(h, ['#s-echo', '#s-reverb', '#s-guide', '#s-recOffset', '#measureBtn', '.deck .toggles', '#lyrTools', '.deck .keys', '#deckMore .knobs .fold-btn', '#lyrFold .fold-btn']);
      ok('W13', k.adv && k.deck && kv.slice(0, 8).every(x => !x[1]) && kv.slice(8).every(x => x[1]), `새로 고침 → 고급 기억(${k.adv ? '켜짐' : '꺼짐'}) · 음향 설정 ${k.deck ? '펴짐' : '접힘'}(PC 예전 규칙) · ${list(kv)}`);
      // 다시 끄기 → 기억
      await h.click('#settingsBtn');
      await h.click('#advBtn'); await sleep(150);
      const f1 = await h.eval(`({adv:document.documentElement.classList.contains('adv'), ls:localStorage.getItem('nb-advanced'), box:getComputedStyle(document.querySelector('#advBox')).display})`);
      await h.click('#cloudClose');
      await h.goto(ctx.base + '/index.html', READY_DEMO, 150000);
      const f2 = await h.eval(`document.documentElement.classList.contains('adv')`);
      const snap1 = await h.eval(SNAP);
      ok('W13', !f1.adv && f1.ls === '0' && f1.box === 'none' && !f2, `다시 누름 → 접힘 (nb-advanced ${f1.ls}) → 새로 고침 뒤에도 꺼짐`);
      const diff = (x, y) => { const A = new Map(JSON.parse(x)), B = new Map(JSON.parse(y)); return [...new Set([...A.keys(), ...B.keys()])].filter(k => A.get(k) !== B.get(k)); };
      const d0 = diff(before.snap, snap0), d1 = diff(snap0, snap1);
      ok('W13', !d0.length && !d1.length && JSON.parse(snap1).length > 0, `저장된 설정 값 nb- ${JSON.parse(snap1).length}개 (${JSON.parse(snap1).map(x => x[0]).join(', ')}): 펴고 접기·고급 켜고 끄기·새로 고침 전후 바뀐 것 ${[...d0, ...d1].join(', ') || '없음'}`);
    });

    await step('터치 화면(915×412 가로): 단축키 안내 글(F2)만 숨음 · 고급을 켜면 예전처럼 보임', ['W13'], async () => {
      await h.close(); h = null;
      ph = await open(PHONE_L, ctx.base + '/index.html');
      await ph.eval(`document.querySelector('#deckMore').open=true`);
      const t0 = await ph.eval(`({keys:getComputedStyle(document.querySelector('.deck .keys')).display, hover:matchMedia('(hover:none)').matches})`);
      await ph.eval('applyAdv(true)');
      const t1 = await ph.eval(`getComputedStyle(document.querySelector('.deck .keys')).display`);
      await ph.eval('applyAdv(false)');
      ok('W13', t0.hover && t0.keys === 'none' && t1 !== 'none', `터치(hover:none ${t0.hover}): 단축키 안내 ${t0.keys === 'none' ? '숨음' : '보임'} · 고급 켜면 ${t1 === 'none' ? '숨음' : '보임'} (PC 1280에서는 위에서 보임)`);
      await ph.close(); ph = null;
    });

    await step('폰 412×915: 설정 창 길이가 줄어듦 (고급 꺼짐 ↔ 켬)', ['W13'], async () => {
      ph = await open(PHONE, ctx.base + '/index.html');
      await ph.click('#settingsBtn');
      await ph.until(`document.querySelector('#storeSum').textContent.length>0`, 3000);
      const len = () => ph.eval(`(()=>{const m=document.querySelector('#cloudDialog .mix'), d=document.querySelector('#cloudDialog'); return {mix:m.scrollHeight, dlg:Math.round(d.getBoundingClientRect().height), sh:d.scrollHeight}})()`);
      const off = await len();
      await shot(ph, 'cr229-06-settings-default-412x915.png');
      await ph.click('#advBtn'); await sleep(150);
      const on = await len();
      await ph.eval(`document.querySelector('#advBtn').scrollIntoView({block:'start'})`);
      await shot(ph, 'cr229-07-settings-adv-412x915.png');
      await ph.click('#advBtn'); await sleep(100);
      await ph.click('#cloudClose');
      ok('W13', off.mix < on.mix * 0.75 && off.mix <= 1000, `설정 창 내용 길이 고급 꺼짐 ${off.mix}px ↔ 켬 ${on.mix}px (화면 915, 창 높이 ${off.dlg}px)`);
      await ph.close(); ph = null;
    });

    await step('TV 1920 대기 화면: 안내 한 줄 (고급 켜면 예전 안내 전체)', ['W13'], async () => {
      tv = await open(TV, ctx.base + '/?tv=1', TV_READY);
      await sleep(400);
      const m = () => tv.eval(`(()=>{const t=document.querySelector('.idle-tip'), s=document.querySelector('#idleTipShort'); return {h:Math.round(t.getBoundingClientRect().height), short:getComputedStyle(s).display, full:getComputedStyle(t.querySelector('.adv-full')).display, txt:s.querySelector('.for-keys').textContent.replace(/\\s+/g,' ').trim(), lines:s.querySelector('.for-keys').getClientRects().length}})()`);
      const off = await m();
      await shot(tv, 'cr229-08-tv-idle-1920x1080.png');
      await tv.eval('applyAdv(true)'); await sleep(100);
      const on = await m();
      await tv.eval('applyAdv(false)');
      const oneLine = off.lines === 1;
      ok('W13', off.short !== 'none' && off.full === 'none' && on.short === 'none' && on.full !== 'none' && off.h < on.h && oneLine && off.txt === '번호 → Enter 예약 · S 검색 · L 목록',
        `대기 안내: 꺼짐 "${off.txt}" 높이 ${off.h}px(한 줄 ${oneLine}) ↔ 고급 켬 예전 안내 ${on.h}px`);
      await tv.close(); tv = null;
    });

    await step('서버 없는 정적(Pages 흉내): 옛 휴대폰 리모컨이 고급을 켜도 안 보임', ['W13'], async () => {
      st = await open(PC, ctx.staticBase + '/index.html');
      await st.click('#settingsBtn');
      const s0 = await st.eval(`({on:Remote.on, hid:document.querySelector('#remoteSec').hidden})`);
      await st.click('#advBtn'); await sleep(150);
      const s1 = await st.eval(`({adv:document.documentElement.classList.contains('adv'), hid:document.querySelector('#remoteSec').hidden})`);
      const v1 = await hiddenAll(st, ['#remoteSec', '#remoteSet', '#travelSec', '#mrSec']);
      await st.click('#advBtn'); await sleep(100);
      await st.click('#cloudClose');
      ok('W13', !s0.on && s0.hid && s1.adv && s1.hid && v1[0][1] && v1[1][1] && !v1[2][1] && !v1[3][1], `정적: 리모컨 ${s0.on ? '켜짐' : '꺼짐'} · 고급 켜도 ${list(v1)}`);
      await st.eval(`localStorage.setItem('nb-advanced','1')`);     // 다른 점검과 같은 상태로
      await st.close(); st = null;
    });
  } finally {
    for (const t of [h, ph, st, tv]) if (t) await t.close().catch(() => {});
    // 같이 쓰는 PC 탭(같은 주소)의 화면 기억을 다른 점검과 같은 상태로 돌림
    await p0.eval(`(()=>{localStorage.setItem('nb-advanced','1'); const d=${q(before.deck)}; if(d===null) localStorage.removeItem('nb-deck'); else localStorage.setItem('nb-deck',d)})()`).catch(() => {});
  }
}
