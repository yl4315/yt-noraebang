// CR-243 ① TV 보통 무대 알림 자리 (디자인실 시안 A · 보고서 mock-cr-243 6장 "확인할 줄" 1~7)
// 곡이 보이는 TV 무대에서 아래 알림(#toast)이 가사 두 줄 바로 위에 뜨고, 가사·예약 알림(flash)·조작 막대와 겹치지 않는지 숫자로 잰다.
//   1 TV 1920 막대 보임·숨김 · 2 PC 1280 막대 숨김(긴 알림 2줄) · 3 폰 가로 915·844 막대 보임·더 보기 줄·숨김 × 짧은·긴·실패 알림 + flash
//   4 폰 915 + 글자 130%(704×317 배율 1.3) · 5 노래 시작 제목 카드 · 6 막대가 숨을 때·다시 나올 때 (끝 자리만 잼, 움직이는 도중은 미확인)
//   7 다른 자리 그대로: 대기 화면·무대 창(곡 검색·예약 목록)·번호 상자 = 막대 위 8px · TV 닫힘 = 아래 24px · 창 안 알림 · 유튜브 띠
//   K1(디자인 보기) 윗줄 분홍 채움 글 top = 흰 글 top (TV 1920·폰 915, 부르는 중 = 데모곡 16초쯤 윗줄 약 30%)
// 데모곡(가짜 자료)만 쓰고, 사진은 결과 폴더 cr243/ (QR이 보이는 대기 화면은 찍지 않음)
import path from 'node:path';
import { PC, TV, PHONE_L, openPage, sleep, q, stopAll, selectById, enterTVNoFs } from './_lib.mjs';
export const areas = ['E', 'L', 'J'];

const PH844 = { name: '844x390', width: 844, height: 390, mobile: true, touch: true };
const PH130 = { name: '915x412 글자 130%', width: 704, height: 317, dsf: 1.3, mobile: true, touch: true };
// 앱이 쓰는 알림 글 (playback.js · recording.js) + 예약 알림 모양 (karaoke.js)
const SHORT = '마이크를 켜면 녹음하고 점수도 받을 수 있어요';
// 긴 알림: 녹음 저장 안내에 조금 긴 곡 제목 (디자인실이 잰 긴 알림처럼 TV 1920 한 줄 · PC 1280·폰 두 줄 · 130% 세 줄)
const LONG = "녹음 저장됨 · 작은 방의 노래 (시험용 조금 긴 곡 제목) (0:45) · 박자가 어긋나면 '싱크·믹스 조절'에서 고칠 수 있어요";
const FAIL = '이 곡의 반주를 불러오지 못했어요. 곡을 다시 골라 주세요';
const FLASH = '우선예약  10001  작은 방의 노래';

// 알림 자리 재기: 가사 두 줄의 보이는 글(흰 글 .base · 부른 만큼 보이는 분홍 채움 글 .fill)·박자 점(●, 떠 있을 때)과 겹침·틈, 글자 칸을 덮은 몫(%), 가사 칸(.lyrics 상자, 참고만)과 틈, flash와 겹침(%), 보이는 막대와 겹침, 제목 카드 글과 겹침, 화면 안
// 분홍 글: .fill 상자(inset:0) 왼쪽부터 --p 만큼(clip-path), 높이는 흰 글 한 줄. pkTop·pkBot = 분홍 top - 흰 top (보이든 안 보이든 상자로 잼)
// (윗줄 가사 .line.top은 머리 줄 .top 규칙(43줄 flex·위아래 14px)을 끊는다 — CR-243 K1 display:block · 아래 14px만 남김. 그래서 흰 글 자리는 그대로, 가사 칸 위 끝은 14px 빈 여백)
const MEAS = `(()=>{
  const R=e=>{if(!e) return null; const r=e.getBoundingClientRect(); return r.width>0&&r.height>0?{l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height}:null};
  const vis=e=>{if(!e||e.hidden) return false; const cs=getComputedStyle(e); return cs.display!=='none'&&cs.visibility!=='hidden'&&+cs.opacity>0};
  const area=(a,b)=>a&&b?Math.max(0,Math.min(a.r,b.r)-Math.max(a.l,b.l))*Math.max(0,Math.min(a.b,b.b)-Math.max(a.t,b.t)):0;
  const pct=(a,b)=>a&&b?Math.round(area(a,b)/(b.w*b.h)*100):null;
  const t=document.querySelector('#toast'), tv=document.querySelector('#tv'), bar=document.querySelector('#tvRemote'), fl=document.querySelector('#flash');
  const T=vis(t)?R(t):null;
  const line=id=>{const e=document.querySelector(id+' .base'); return e&&e.textContent.trim()?R(e):null};
  const pink=(id,B)=>{const ln=document.querySelector(id), f=ln.querySelector('.fill'), F=R(f); if(!B||!F||!f.textContent.trim()) return null;
    const p=Math.min(100,Math.max(0,parseFloat(ln.style.getPropertyValue('--p'))||0)), w=F.w*p/100;
    return {dy:Math.round((F.t-B.t)*10)/10, p:Math.round(p), w:Math.round(w), vis:w>0.5?{l:F.l,t:F.t,r:F.l+w,b:F.t+B.h,w,h:B.h}:null}};
  const top=line('#lineTop'), bot=line('#lineBottom'), ly=R(document.querySelector('#stage .lyrics'));
  const pT=pink('#lineTop',top), pB=pink('#lineBottom',bot);
  const dots=[...document.querySelectorAll('#stage .lyrics .dots')].filter(e=>e.textContent.trim()).map(R).filter(Boolean), parts=[top,bot,pT&&pT.vis,pB&&pB.vis,...dots].filter(Boolean);
  const F=vis(fl)?R(fl):null, B=!tv.hidden&&vis(bar)&&!tv.classList.contains('hide-ui')?R(bar):null;
  const tc=vis(document.querySelector('#titleCard'))?['#cardTitle','#cardArtist'].map(s=>R(document.querySelector(s))):null;
  const rg=document.createRange(); rg.selectNodeContents(t); const lines=new Set([...rg.getClientRects()].filter(x=>x.width>0).map(x=>Math.round(x.top))).size;
  const barH=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-h'))||0, cs=getComputedStyle(t);
  return {vw:innerWidth, vh:innerHeight, tv:!tv.hidden, ui:!tv.classList.contains('hide-ui'), more:bar.classList.contains('more-open'), idle:document.querySelector('#stage').classList.contains('idle'),
    shown:!!T, w:T?Math.round(T.w):0, h:T?Math.round(T.h):0, lines, tTop:T?Math.round(T.t*10)/10:null, tBot:T?Math.round((innerHeight-T.b)*10)/10:null,
    top:pct(T,top), bot:pct(T,bot), lyHit:parts.some(x=>area(T,x)>0), dots:dots.length, txtGap:T&&parts.length?Math.round((Math.min(...parts.map(x=>x.t))-T.b)*10)/10:null, boxGap:T&&ly?Math.round((ly.t-T.b)*10)/10:null,
    fl:F?pct(T,F):null, flHit:Math.round(area(T,F)), flGap:T&&F?Math.round((T.t-F.b)*10)/10:null, bar:B?Math.round(area(T,B)):null, barGap:T&&B?Math.round((B.t-T.b)*10)/10:null,
    tc:tc?tc.map(x=>Math.round(area(T,x))):null, tcGap:T&&tc&&tc[1]?Math.round((T.t-tc[1].b)*10)/10:null, barH, inView:!!T&&T.t>=7.5&&T.b<=innerHeight+0.5,
    home:t.parentElement===document.body?'body':t.parentElement.id, bottomCss:cs.bottom, tr:cs.transitionProperty+' '+cs.transitionDuration,
    pkTop:pT?pT.dy:null, pkBot:pB?pB.dy:null, pkP:pT?pT.p:null, pkW:pT?pT.w:null, pkBotP:pB?pB.p:null, whTop:top?Math.round(top.t*10)/10:null, whBot:bot?Math.round(bot.t*10)/10:null}})()`;

const showAt = async (pg, text, withFlash) => {
  await pg.eval(`(()=>{ toast(${q(text)}, 60000); ${withFlash ? `flash(${q(FLASH)}, 60000)` : `clearTimeout(flashTimer); document.querySelector('#flash').hidden=true`} })()`);
  await sleep(450);       // 알림 자리 바뀜 0.2초 · flash 나타남 0.25초가 끝난 뒤
  return pg.eval(MEAS);
};
const offAll = pg => pg.eval(`(()=>{clearTimeout(toastTimer); clearTimeout(flashTimer); document.querySelector('#toast').hidden=true; document.querySelector('#flash').hidden=true})()`).catch(() => {});
// 막대 자리: shown(보임) · more(더 보기 줄, 손가락 화면) · hidden(숨김 = 노래 중 3초 뒤 앱이 붙이는 hide-ui). 멈춘 곡에서는 앱이 스스로 바꾸지 않는다
const setBar = async (pg, mode) => {
  await pg.eval(`(()=>{const tv=document.querySelector('#tv'); if(${q(mode)}==='hidden'){ tv.classList.add('hide-ui'); setMore(false); } else { tv.classList.remove('hide-ui'); setMore(${q(mode)}==='more'); } })()`);
  await sleep(450);
};
// 부르는 중 화면: 데모곡을 16초 자리에서 멈춤 (가사 두 줄·조작 막대가 보이고 제목 카드는 없음)
const atLine = async pg => {
  await pg.eval(`if(!state.playing) play()`); await pg.until('state.playing', 5000);
  await pg.eval('seekTo(16)'); await sleep(500); await pg.eval('pause()');
  await pg.until(`!state.playing && !!document.querySelector('#lineBottom .base').textContent.trim() && !!document.querySelector('#lineTop .base').textContent.trim()`, 3000);
};

const fmt = m => !m ? '못 잼' : !m.shown ? `${m.vw}×${m.vh} 알림 안 뜸`
  : `${m.vw}×${m.vh} ${m.more ? '더 보기 줄' : m.ui ? '막대 보임' : '막대 숨김'} · 알림 ${m.w}×${m.h} ${m.lines}줄 위 ${m.tTop}·아래 ${m.tBot} · 가사와 틈 ${m.txtGap}px${m.dots ? ' (박자 점 포함)' : ''} (가사 칸 ${m.boxGap}) · 가림 윗줄 ${m.top ?? '-'}% 아랫줄 ${m.bot ?? '-'}%`
    + ` · flash ${m.fl == null ? '없음' : m.fl + '% (틈 ' + m.flGap + ')'} · 막대 ${m.bar == null ? '숨음' : m.bar ? '겹침 ' + m.bar + 'px²' : '0 (틈 ' + m.barGap + ')'}`
    + (m.pkTop == null ? '' : ` · 분홍-흰 top 윗줄 ${m.pkTop}px (${m.pkP}%)`);
// K1: 윗줄 분홍 채움 글이 보이고(부르는 중) 그 top이 흰 글 top과 같다. 아랫줄도 같다 (아랫줄 분홍은 이 자리에서 0%라 상자로만 잼)
const pinkOk = m => !!m && m.pkTop != null && m.pkW > 0 && Math.abs(m.pkTop) <= 0.5 && (m.pkBot == null || Math.abs(m.pkBot) <= 0.5);
const fk = m => !m ? '못 잼' : `${m.vw}×${m.vh} 윗줄 분홍 ${m.pkW}px(${m.pkP}%) top - 흰 top ${m.pkTop}px · 아랫줄 ${m.pkBot ?? '-'}px · 흰 글 top ${m.whTop}·${m.whBot}px`;
// 가사 두 줄·flash·막대와 겹침 0, 화면 안 (flash: 떠 있어야 하는 때)
const clear = (m, wantFlash = true) => !!m && m.shown && m.top === 0 && m.bot === 0 && !m.lyHit && (!wantFlash || (m.fl !== null && m.flHit === 0)) && !m.bar && m.inView;

export default async function tvtoast(ctx) {
  const { ok, step } = ctx, p = ctx.p;
  const dir = path.join(ctx.OUT, 'cr243');
  const shot = (pg, name) => pg.shot(path.join(dir, name + '.png')).catch(() => {});
  const pcSize = p.size || PC;
  await stopAll(p);
  await p.eval(`state.queue=[]; saveQueue(); renderQueue(); if(state.armed) setArmed(false)`);
  await selectById(p, 'demo');
  const M = {};        // 잰 값 (기록·보고용)

  // 1·2: 마우스 화면 TV 1920 · PC 1280 (800), 막대 보임·숨김, 긴 알림 + flash
  await step('CR-243 #1·#2 TV 1920·PC 1280 막대 보임·숨김: 긴 알림이 가사 두 줄 바로 위, 가사·flash·막대와 겹침 0', ['E3'], async () => {
    try {
      await p.emulate(TV); await enterTVNoFs(p); await atLine(p);
      for (const size of [TV, PC]) {
        await p.emulate(size); await sleep(400);
        const w = size.width;
        for (const mode of ['shown', 'hidden']) {
          await setBar(p, mode);
          M[`${w}-${mode}`] = await showAt(p, LONG, true);
          await shot(p, `${w === 1920 ? 'tv1920' : 'pc1280'}-${mode === 'shown' ? 'bar' : 'hidden'}`);
          await offAll(p);
        }
      }
    } finally { await offAll(p); await setBar(p, 'shown').catch(() => {}); }
    for (const k of ['1920-shown', '1920-hidden', '1280-shown', '1280-hidden']) ctx.log(`  CR-243 #1·#2 ${k}: ${fmt(M[k])}`);
    ok('E3', ['1920-shown', '1920-hidden'].every(k => clear(M[k])) && M['1920-shown'].txtGap >= 0,
      `CR-243 디자인 6장 #1 TV 1920 긴 알림 + flash: 막대 보임 ${fmt(M['1920-shown'])} | 막대 숨김 ${fmt(M['1920-hidden'])}`);
    ok('E3', ['1280-shown', '1280-hidden'].every(k => clear(M[k])) && M['1280-hidden'].lines === 2,
      `CR-243 디자인 6장 #2 PC 1280×800 긴 알림 2줄: 막대 숨김(노래 중) ${fmt(M['1280-hidden'])} | 막대 보임 ${fmt(M['1280-shown'])}`);
  });

  // 3·4·5(915)·6(915): 손가락 화면 폰 가로 (?tv=1, 같은 저장소의 새 탭)
  let ph = null;
  try {
    ph = await openPage(ctx, PHONE_L, ctx.base + '/?tv=1', 'typeof state!=="undefined" && state.tv && !!state.song && !!state.song.buffer');
    await selectById(ph, 'demo');
    await ph.eval(`if(state.armed) setArmed(false)`);

    await step('CR-243 #3 폰 가로 915·844 막대 보임·더 보기 줄·숨김 × 짧은·긴·실패 알림 + flash: 가사 두 줄·flash·막대와 겹침 0', ['E3'], async () => {
      await atLine(ph);
      const bad = [], rows = [];
      try {
        for (const size of [PHONE_L, PH844]) {
          await ph.emulate(size); await sleep(400);
          for (const mode of ['shown', 'more', 'hidden']) {
            await setBar(ph, mode);
            for (const [kind, text] of [['짧은', SHORT], ['긴', LONG], ['실패', FAIL]]) {
              const m = await showAt(ph, text, true);
              const key = `${size.width}-${mode}-${kind}`;
              M[key] = m; rows.push(key);
              if (!clear(m)) bad.push(`${key}: ${fmt(m)}`);
              if (size === PHONE_L && kind === '긴' && mode !== 'more') await shot(ph, `phone915-${mode === 'shown' ? 'bar' : 'hidden'}`);
              await offAll(ph);
            }
          }
        }
      } finally { await offAll(ph); await setBar(ph, 'shown').catch(() => {}); await ph.emulate(PHONE_L); }
      for (const k of rows) ctx.log(`  CR-243 #3 ${k}: ${fmt(M[k])}`);
      const near = rows.map(k => M[k]).filter(m => m && m.shown);
      const minGap = (f) => Math.min(...near.map(f).filter(x => x != null));
      ok('E3', bad.length === 0 && rows.length === 18,
        `CR-243 디자인 6장 #3 폰 가로 915·844 × 막대 3가지 × 알림 3가지 = ${rows.length}가지 겹침 0` + (bad.length ? ` — 겹침: ${bad.join(' | ')}`
          : ` (가장 가까운 틈: 가사 ${minGap(m => m.txtGap)}px · flash ${minGap(m => m.flGap)}px · 막대 ${minGap(m => m.barGap)}px) · 915 막대 보임 긴 알림 ${fmt(M['915-shown-긴'])}`));
    });

    await step('CR-243 #4 폰 915 + 글자 130%: 알림이 화면 안(위 8px 이상), 막대 보임 때 가사 가림 0 (더 보기 줄은 윗줄을 가려도 됨)', ['E3'], async () => {
      try {
        await ph.emulate(PH130); await sleep(500);
        await setBar(ph, 'shown');
        M['130-shown'] = await showAt(ph, LONG, false);
        await shot(ph, 'phone915-130-bar');
        await offAll(ph);
        M['130-shown-flash'] = await showAt(ph, LONG, true);
        await offAll(ph);
        await setBar(ph, 'more');
        M['130-more'] = await showAt(ph, LONG, false);
        await offAll(ph);
      } finally { await offAll(ph); await setBar(ph, 'shown').catch(() => {}); await ph.emulate(PHONE_L); await sleep(300); }
      for (const k of ['130-shown', '130-shown-flash', '130-more']) ctx.log(`  CR-243 #4 ${k}: ${fmt(M[k])}`);
      const a = M['130-shown'], b = M['130-more'];
      ok('E3', !!a && a.inView && a.top === 0 && a.bot === 0 && !a.lyHit && !a.bar && !!b && b.inView && b.tTop >= 7.5 && !b.bar,
        `CR-243 디자인 6장 #4 915 + 130% (704×317 배율 1.3) 긴 알림: 막대 보임 ${fmt(a)} | 더 보기 줄 (윗줄은 가려도 됨) ${fmt(b)} | 막대 보임 + flash (보고만) ${fmt(M['130-shown-flash'])}`);
    });
  } catch (e) {
    ctx.log(`  ! CR-243 폰 탭: ${e.message}`); ok('E3', false, `CR-243 폰 탭을 열지 못함: ${e.message}`);
  }

  // K1: 1·3에서 잰 부르는 중 화면 (데모곡 16초쯤, 윗줄 약 30%) — 분홍 채움 글이 흰 글과 같은 높이 (d1a847a까지는 -14px)
  await step('CR-243 K1 윗줄 분홍 채움 글 top = 흰 글 top (TV 1920·폰 915, 부르는 중)', ['E3'], async () => {
    const a = M['1920-shown'], b = M['915-shown-짧은'];
    // 앱 머리 줄 .top은 그대로 (flex · 위아래 14px): K1은 윗줄 가사 쪽만 끊는다
    const hd = await p.eval(`(()=>{const h=document.querySelector('header.top'), cs=getComputedStyle(h); return {d:cs.display, pt:cs.paddingTop, pb:cs.paddingBottom, h:Math.round(h.getBoundingClientRect().height*10)/10, vw:innerWidth}})()`);
    const hdOk = hd.d === 'flex' && hd.pt === '14px' && hd.pb === '14px';
    ctx.log(`  CR-243 K1 TV 1920 ${fk(a)} | 폰 915 ${fk(b)} | 머리 줄 ${JSON.stringify(hd)}`);
    ok('E3', pinkOk(a) && pinkOk(b) && hdOk, `CR-243 디자인 보기 K1 윗줄 분홍 글 top = 흰 글 top (TV 1920·폰 915): TV 1920 ${fk(a)} | 폰 915 ${fk(b)} | 머리 줄 .top ${hd.d} 위아래 ${hd.pt}·${hd.pb} 높이 ${hd.h}px (${hd.vw}폭)`);
  });

  // 5: 노래 시작 제목 카드 (노래 중 처음 4.5초) + "마이크를 켜면…" — TV 1920 · PC 1280 (PC 탭) · 폰 915 (폰 탭)
  const titleAt = async (pg) => {
    await pg.eval(`(()=>{ stopPlayback(); play(); })()`);
    await pg.until('state.playing && curTime()>0.8', 5000);
    const m = await showAt(pg, SHORT, false);
    const t = await pg.eval('curTime()');
    await pg.eval('pause()'); await offAll(pg);
    m.t = Math.round(t * 10) / 10;
    return m;
  };
  await step('CR-243 #5 노래 시작 제목 카드 + "마이크를 켜면…" 알림: 곡 제목·가수와 겹침 0 (TV 1920·PC 1280·폰 915)', ['L7'], async () => {
    const T5 = {};
    try {
      await p.emulate(TV); await sleep(300);
      T5[1920] = await titleAt(p);
      await p.emulate(PC); await sleep(300);
      T5[1280] = await titleAt(p);
      if (ph) { await ph.emulate(PHONE_L); await sleep(300); T5[915] = await titleAt(ph); }
    } finally { await offAll(p); if (ph) await offAll(ph); }
    const f5 = m => m ? `${m.vw}폭 ${m.t}초 제목 카드 ${m.tc ? '보임' : '안 보임'} · 제목·가수와 겹침 ${m.tc ? m.tc.join('·') : '-'}px² · 가수 줄과 틈 ${m.tcGap}px · 가사 가림 ${m.top ?? '-'}%·${m.bot ?? '-'}%` : '못 잼';
    ctx.log(`  CR-243 #5 ${[1920, 1280, 915].map(w => f5(T5[w])).join(' | ')}`);
    ok('L7', [1920, 1280, 915].every(w => { const m = T5[w]; return !!m && m.shown && !!m.tc && m.tc.every(x => x === 0) && m.tcGap >= 0 && m.inView; }),
      `CR-243 디자인 6장 #5 노래 시작 제목 카드 + 짧은 알림: ${[1920, 1280, 915].map(w => f5(T5[w])).join(' | ')}`);
  });

  // 6: 노래 중 막대가 숨을 때(앱의 3초 타이머)·다시 나올 때(pokeUI = 리모컨·마우스·화면 누르기): 알림이 가사와 같이 움직여 끝 자리에서 겹침 0
  const barMove = async (pg) => {
    await pg.eval(`(()=>{ if(!state.playing) play(); seekTo(16); pokeUI(); })()`);
    await pg.until('state.playing', 4000);
    await pg.eval(`toast(${q(LONG)}, 60000)`); await sleep(450);
    const up = await pg.eval(MEAS);
    const hid = await pg.until(`document.querySelector('#tv').classList.contains('hide-ui')`, 5000);
    await sleep(450);
    const down = await pg.eval(MEAS);
    await pg.eval('pokeUI()'); await sleep(450);
    const back = await pg.eval(MEAS);
    const lyTr = await pg.eval(`(()=>{const cs=getComputedStyle(document.querySelector('#stage .lyrics')); return cs.transitionProperty+' '+cs.transitionDuration})()`);
    await pg.eval('pause()'); await offAll(pg);
    return { up, down, back, hid, lyTr };
  };
  await step('CR-243 #6 막대가 숨을 때·다시 나올 때 알림이 가사와 같이 내려가고 올라감 (0.2초, 끝 자리 겹침 0 · 움직이는 도중은 미확인)', ['L9'], async () => {
    const S = {};
    try {
      await p.emulate(TV); await sleep(300);
      S[1920] = await barMove(p);
      if (ph) { await ph.emulate(PHONE_L); await sleep(300); S[915] = await barMove(ph); }
    } finally { await offAll(p); if (ph) await offAll(ph); }
    const good = s => !!s && s.hid && !s.down.ui && s.up.ui && s.back.ui
      && [s.up, s.down, s.back].every(m => m.shown && (m.top ?? 0) === 0 && (m.bot ?? 0) === 0 && !m.lyHit && !m.bar && m.inView)
      && s.down.tBot < s.up.tBot - 4 && Math.abs(s.back.tBot - s.up.tBot) <= 1           // 숨으면 내려가고, 나오면 제자리
      && Math.abs(s.down.txtGap - s.up.txtGap) <= 2 && Math.abs(s.back.txtGap - s.up.txtGap) <= 2    // 가사와 같이 (틈이 그대로)
      && /bottom 0\.2s/.test(s.up.tr) && /bottom 0\.2s/.test(s.lyTr);
    const f6 = s => s ? `${s.up.vw}폭 알림 아래 ${s.up.tBot} → 숨김 ${s.down.tBot} → 다시 ${s.back.tBot}px · 가사와 틈 ${s.up.txtGap}/${s.down.txtGap}/${s.back.txtGap}px · 가림 ${[s.up, s.down, s.back].map(m => (m.top ?? 0) + '·' + (m.bot ?? 0)).join(' / ')}% · 막대 겹침 ${[s.up, s.back].map(m => m.bar ?? '-').join('·')} · 가사(분홍 포함) 겹침 ${[s.up, s.down, s.back].map(m => m.lyHit ? '있음' : '0').join('/')} · 알림 "${s.up.tr}" · 가사 "${s.lyTr}"` : '못 잼';
    ctx.log(`  CR-243 #6 ${f6(S[1920])} | ${f6(S[915])}`);
    ok('L9', good(S[1920]) && good(S[915]), `CR-243 디자인 6장 #6 막대 숨음·다시 나옴 (끝 자리, 움직이는 도중은 미확인): TV 1920 ${f6(S[1920])} | 폰 915 ${f6(S[915])}`);
  });
  if (ph) await ph.close().catch(() => {});

  // 7: 다른 자리는 예전 그대로 (847befc와 같은 셈)
  await step('CR-243 #7 다른 자리 그대로: 대기 화면·무대 창(곡 검색·예약 목록)·번호 상자 = 막대 위 8px · TV 닫힘 = 아래 24px · 창 안 알림 · 유튜브 띠', ['J17'], async () => {
    const S = {};
    const barOk = m => !!m && m.shown && Math.abs(m.tBot - (m.barH + 8)) <= 1;
    try {
      await stopAll(p); await p.emulate(TV); await enterTVNoFs(p); await sleep(300);
      S.idle = await showAt(p, LONG, false); await offAll(p);                 // 대기 화면 (QR이 보여서 사진 없음)
      await atLine(p);
      await p.eval('openSearch()'); await sleep(200);
      S.search = await showAt(p, LONG, false); S.search.panel = await p.eval(`document.querySelector('#searchOv').parentElement.id`); await offAll(p);
      await p.eval('closeOverlays(); openQueue()'); await sleep(200);
      S.queue = await showAt(p, LONG, false); await offAll(p);
      await p.eval('closeOverlays(); numKey("1")'); await sleep(200);
      S.num = await showAt(p, LONG, false); S.num.box = await p.eval(`!document.querySelector('#numBox').hidden`); await offAll(p);
      await p.eval(`numBuf=''; updateNumBox()`);
      // 유튜브 띠 (CSS 자리만): 띠 모드 이름표를 붙인 그 자리에서 재고 바로 뗀다 (앱이 다시 그리기 전에)
      await p.eval(`toast(${q(LONG)}, 60000)`); await sleep(300);
      S.yt = await p.eval(`(()=>{const tv=document.querySelector('#tv'); tv.classList.add('yt-mode'); const cs=getComputedStyle(document.querySelector('#toast'));
        const o={left:cs.left, bottom:cs.bottom, tr:cs.transform}; tv.classList.remove('yt-mode'); return o})()`);
      await offAll(p);
      await stopAll(p); await p.emulate(PC); await sleep(300);
      S.out = await showAt(p, LONG, false); await offAll(p);                   // TV 닫힘 = 화면 아래 24px (CR-241 그대로)
      await p.eval('openProfiles()'); await p.until(`document.querySelector('#profileDialog').open`, 3000);
      await p.eval(`toast(${q(LONG)}, 60000)`); await sleep(300);
      S.dlg = await p.eval(`(()=>{const t=document.querySelector('#toast'), d=document.querySelector('#profileDialog'), cs=getComputedStyle(t);
        return {home:t.parentElement.id, top:cs.top, want:Math.max(12, Math.round(d.getBoundingClientRect().top) - t.offsetHeight - 8)+'px'}})()`);
      await offAll(p);
    } finally { await offAll(p); await stopAll(p); await p.emulate(pcSize); }
    const fb = m => m ? `아래 ${m.tBot}px (막대 ${m.barH}px + 8)` : '못 잼';
    const outOk = !!S.out && S.out.shown && !S.out.tv && Math.abs(S.out.tBot - 24) <= 1;
    const dlgOk = !!S.dlg && S.dlg.home === 'profileDialog' && S.dlg.top === S.dlg.want;
    const ytOk = !!S.yt && S.yt.left === '14px' && S.yt.bottom === '12px' && S.yt.tr === 'none';
    ctx.log(`  CR-243 #7 대기 ${fb(S.idle)} · 곡 검색 ${fb(S.search)} (창 부모 #${S.search?.panel}) · 예약 목록 ${fb(S.queue)} · 번호 상자 ${fb(S.num)} (상자 보임 ${S.num?.box}) · TV 닫힘 아래 ${S.out?.tBot}px · 창 안 ${JSON.stringify(S.dlg)} · 띠 ${JSON.stringify(S.yt)}`);
    ok('J17', S.idle?.idle && barOk(S.idle) && barOk(S.search) && S.search.panel === 'stage' && barOk(S.queue) && barOk(S.num) && S.num.box && outOk && dlgOk && ytOk,
      `CR-243 디자인 6장 #7 다른 자리 그대로: 대기 화면 ${fb(S.idle)} · 곡 검색 ${fb(S.search)} · 예약 목록 ${fb(S.queue)} · 번호 상자 ${fb(S.num)} · TV 닫힘 아래 ${S.out?.tBot}px · 창 안 알림 위 ${S.dlg?.top} (창 위 끝 - 8 = ${S.dlg?.want}) · 유튜브 띠 왼쪽 ${S.yt?.left} 아래 ${S.yt?.bottom}`);
  });
  await stopAll(p);
}
