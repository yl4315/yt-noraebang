// 화면 자동 점검(CR-019) · 점검들이 같이 쓰는 도구
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from '../edge.mjs';
export { sleep };

// 화면 크기 (기획안 4장): PC 1280×800, TV 1920×1080, 폰 세로 412×915, 폰 가로 915×412 (배율 1)
export const PC = { name: '1280x800', width: 1280, height: 800 };
export const TV = { name: '1920x1080', width: 1920, height: 1080 };
export const PHONE = { name: '412x915', width: 412, height: 915, mobile: true, touch: true };
export const PHONE_L = { name: '915x412', width: 915, height: 412, mobile: true, touch: true };

export const READY = 'typeof state!=="undefined" && state.songs && state.songs.length>0 && state.song && (state.song.buffer || state.song.demo===undefined)';
export const READY_DEMO = 'typeof state!=="undefined" && state.songs && state.songs.length>0 && state.song && !!state.song.buffer';

// 모든 페이지에 먼저 넣는 기록 장치: 알림(toast)·가운데 알림(flash) 글을 놓치지 않게 기록, 진동·전체 화면·가로 고정 요청 기록.
// 앱 코드는 바꾸지 않는다 (브라우저 기능을 감싸서 부른 것만 적고 그대로 넘긴다).
export const SPY = `(() => {
  if (window.__ui) return;
  const ui = window.__ui = { toasts: [], flashes: [], vib: [], fsReq: 0, fsErr: [], orient: [] };
  const hook = () => {
    const t = document.getElementById('toast'), f = document.getElementById('flash');
    const watch = (el, arr) => { const rec = () => { const last = arr[arr.length - 1], now = performance.now();
        if (!el.hidden && el.textContent && (!last || last.text !== el.textContent || now - last.at > 300)) arr.push({ at: now, text: el.textContent }); };
      new MutationObserver(rec).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] }); };
    if (t) watch(t, ui.toasts); if (f) watch(f, ui.flashes);     // 휴대폰 리모컨 화면에는 toast만 있다
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
  // 보안 규칙(CSP, CR-227)이 막은 것: 콘솔 오류로 남겨 공통 점검이 잡게 (막힌 곳 이름만)
  document.addEventListener('securitypolicyviolation', e => { try { console.error('UI점검 CSP 막음: ' + e.effectiveDirective + ' ' + String(e.blockedURI || '').split('?')[0].slice(0, 80)); } catch {} });
  try { const ov = navigator.vibrate ? navigator.vibrate.bind(navigator) : null; navigator.vibrate = p => { ui.vib.push(p); return ov ? ov(p) : true; }; } catch {}
  try { const orf = Element.prototype.requestFullscreen; Element.prototype.requestFullscreen = function (...a) { ui.fsReq++; const pr = orf.apply(this, a); pr.catch(e => ui.fsErr.push(String(e && e.message || e))); return pr; }; } catch {}
  try { if (screen.orientation) { const ol = screen.orientation.lock ? screen.orientation.lock.bind(screen.orientation) : null; screen.orientation.lock = o => { ui.orient.push(o); return ol ? ol(o) : Promise.reject(new Error('no lock')); }; } } catch {}
  // 마이크 권한 거부 흉내: localStorage '__ui-mic'가 'deny'면 거부 (마이크 꺼진 채 녹음·안내를 보려고. nb- 키가 아니라 앱 데이터와 안 섞임)
  try { const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = c => localStorage.getItem('__ui-mic') === 'deny' ? Promise.reject(new DOMException('UI점검: 일부러 거부', 'NotAllowedError')) : gum(c); } catch {}
})();`;

// CR-229: 기능 점검은 "더 보기 (고급)"을 켠 화면(= 숨기기 전 화면)에서 전처럼 돈다. 탭마다 처음 한 번만 nb-advanced='1'을 넣는다
// (그 뒤 고급을 끄는 점검이 있어도 새로 고침에서 다시 켜지 않게 sessionStorage 표시). 숨김 점검(hide.mjs)은 { ...ctx, adv: false }로 연다
export const ADV_ON = `try{if(!sessionStorage.getItem('__ui-adv')){sessionStorage.setItem('__ui-adv','1');localStorage.setItem('nb-advanced','1')}}catch{}`;

/** 새 탭: 기록 장치를 넣고 화면 크기를 정한 뒤 주소를 연다 */
export async function openPage(ctx, size, url, ready = READY_DEMO, browser = ctx.browser, ms = 150000) {
  const p = await browser.newPage();
  await p.s('Page.addScriptToEvaluateOnNewDocument', { source: SPY });
  if (ctx.adv !== false) await p.s('Page.addScriptToEvaluateOnNewDocument', { source: ADV_ON });
  await p.emulate(size);
  if (url) await p.goto(url, ready, ms);      // 새 저장소(주소)에서 처음 열면 데모 반주를 합성해서 PC가 바쁘면 오래 걸린다
  return p;
}

/* 화면 읽기 */
export const q = JSON.stringify;
export const txt = (p, sel) => p.eval(`(document.querySelector(${q(sel)})||{}).textContent||''`);
export const isHidden = (p, sel) => p.eval(`(()=>{const e=document.querySelector(${q(sel)}); if(!e) return true; if(e.hidden) return true; const r=e.getBoundingClientRect(), cs=getComputedStyle(e); return cs.display==='none'||cs.visibility==='hidden'||r.width===0||r.height===0||+cs.opacity===0})()`);
export const visible = async (p, sel) => !(await isHidden(p, sel));
export const count = (p, sel) => p.eval(`document.querySelectorAll(${q(sel)}).length`);
export const val = (p, expr) => p.eval(expr);
/** 지금까지 나온 알림 중 re에 맞는 것이 있나 (since: 기록 위치) */
export const marks = async p => p.eval(`({t:__ui.toasts.length,f:__ui.flashes.length})`);
export async function sawToast(p, re, since = { t: 0 }, ms = 4000) {
  const ok = await p.until(`__ui.toasts.slice(${since.t || 0}).some(x=>${re}.test(x.text))`, ms);
  return ok;
}
export async function sawFlash(p, re, since = { f: 0 }, ms = 4000) {
  return p.until(`__ui.flashes.slice(${since.f || 0}).some(x=>${re}.test(x.text))`, ms);
}
export const lastToast = p => p.eval(`(__ui.toasts[__ui.toasts.length-1]||{}).text||''`);
export const lastFlash = p => p.eval(`(__ui.flashes[__ui.flashes.length-1]||{}).text||''`);
/** 가로 스크롤 없음: 문서 폭 = 화면 폭 */
export const noHScroll = p => p.eval(`document.documentElement.scrollWidth <= innerWidth + 1`);
/** 요소 몇 개를 둘러싼 칸만 찍는다 (CR-231: 바뀐 칸만, 허브 계정 줄 같은 다른 칸은 안 들어가게). 실패하면 null */
export async function clipShot(p, sels, file, pad = 8) {
  await p.eval(`document.querySelector(${q(sels[0])})?.scrollIntoView({block:'nearest'})`);
  await sleep(350);
  const r = await p.eval(`(()=>{let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; for (const s of ${q(sels)}) { const e=document.querySelector(s); if(!e) continue; const b=e.getBoundingClientRect(); if(!b.width||!b.height) continue;
    x0=Math.min(x0,b.left); y0=Math.min(y0,b.top); x1=Math.max(x1,b.right); y1=Math.max(y1,b.bottom); } return x1>x0 ? {x:x0+scrollX, y:y0+scrollY, w:x1-x0, h:y1-y0} : null})()`);
  if (!r) return null;
  const clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: Math.ceil(r.w + pad * 2), height: Math.ceil(r.h + pad * 2), scale: 1 };
  const res = await p.s('Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  return clip;
}
export const playing = p => p.eval('state.playing');
export const curT = p => p.eval('curTime()');

/** 곡 추가 창으로 곡 넣기 (화면 그대로: 버튼 → 파일 칸 → 칸 채우기 → 저장) */
export async function addSongViaDialog(p, { file, title, artist, lyrics }) {
  await p.click('#addSongBtn');
  await p.until(`document.querySelector('#songDialog').open`, 3000);
  if (file) { await p.setFiles('#f-file', [file]); await sleep(150); }
  if (title !== undefined) await p.eval(`(()=>{const i=document.querySelector('#f-title'); i.value=${q(title)}; i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  if (artist !== undefined) await p.eval(`(()=>{const i=document.querySelector('#f-artist'); i.value=${q(artist)}; i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  if (lyrics !== undefined) await p.eval(`(()=>{const i=document.querySelector('#f-lyrics'); i.value=${q(lyrics)}; i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const n = await p.eval('state.songs.length');
  await p.click('#dlgSave');
  await p.until(`state.songs.length>${n} && !document.querySelector('#songDialog').open`, 5000);
  return p.eval(`(()=>{const s=state.songs[state.songs.length-1]; return {id:s.id,no:s.no,title:s.title,artist:s.artist}})()`);
}
/** 곡을 고르고 반주가 준비될 때까지 */
export async function selectById(p, id) {
  await p.eval(`selectSong(songById(${q(id)}))`);
  await p.until(`state.song && state.song.id===${q(id)} && !!state.song.buffer && document.querySelector('#loading').hidden`, 15000);
}
export async function selectNo(p, no) {
  await p.eval(`selectSong(state.songs.find(s=>s.no===${no}))`);
  await p.until(`state.song && state.song.no===${no} && !!state.song.buffer && document.querySelector('#loading').hidden`, 20000);
}
/** 재생이 멈추고 처음으로 (창·TV·전체 화면 닫기, 포커스 풀기) */
export async function stopAll(p) {
  await p.eval(`(async()=>{ cancelNext(); if(state.sync) await exitSync(false); stopPlayback(); hideScore(); closeOverlays(); document.querySelectorAll('dialog[open]').forEach(d=>d.close()); if(state.tv) exitTV();
    if (document.fullscreenElement) await document.exitFullscreen().catch(()=>{}); document.activeElement && document.activeElement.blur && document.activeElement.blur(); })()`);
  await sleep(150);
}
export function wavB64(path) { return fs.readFileSync(path).toString('base64'); }

/** 시험 데이터 넣기(S): 빈 저장소에 곡을 직접 넣는다. o = { title, artist, lyrics, wav(경로), fileId, blob(false면 Drive에만), id, no, createdAt } */
export async function seedSong(p, o) {
  const b64 = o.wav && o.blob !== false ? wavB64(o.wav) : null;
  return p.eval(`(async()=>{
    const b64=${q(b64)}; let blob=null;
    if (b64) { const bin=atob(b64), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); blob=new Blob([u],{type:'audio/wav'}); }
    const s={ id:${q(o.id || null)}||uid(), no:${o.no || 'null'}||nextSongNumbers(state.songs,1)[0], title:${q(o.title)}, artist:${q(o.artist || '')}, lyrics:${q(o.lyrics || '')}, lyricOffset:0,
      createdAt:${o.createdAt || 'Date.now()'}, updatedAt:${o.createdAt || 'Date.now()'}, mime:'audio/wav', size:blob?blob.size:${o.size || 50000}, blob, video:false, videoLyrics:false ${o.fileId ? `, fileId:${q(o.fileId)}` : ''} };
    state.songs.push(s); await DB.put('songs', songRecord(s)); state.songs.sort((a,b)=>a.demo?-1:b.demo?1:a.no-b.no); renderSongs();
    return {id:s.id, no:s.no, title:s.title};
  })()`);
}
/** 시험 녹음 넣기(S). o = { songId, title, v2:true|false, parts:true|false, score, fileId, media:false(Drive에만), createdAt, mrStart } */
export async function seedRec(p, o) {
  return p.eval(`(async()=>{
    const sr=48000, n=Math.round(sr*${o.sec || 2}), pcm=new Int16Array(n); for(let i=0;i<n;i++) pcm[i]=Math.round(3000*Math.sin(i/20));
    const v2=${o.v2 !== false}, media=${o.media !== false};
    const r={ id:${q(o.id || null)}||uid(), title:${q(o.title)}, artist:'QA가수', songId:${q(o.songId || null)}, createdAt:${o.createdAt || 'Date.now()'}, updatedAt:${o.createdAt || 'Date.now()'}, duration:${o.sec || 2}, score:${o.score ?? 'null'} };
    if (v2) Object.assign(r, { v:2, sr, vocal: media ? new Blob([pcm.buffer],{type:'application/octet-stream'}) : null, parts: ${o.parts === false ? '[]' : `[{at:0, offset:0, dur:${o.sec || 2}, key:0}]`},
      mix:{ offset:120, vocal:80, mr:80, echo:25, reverb:35 ${o.mrStart != null ? `, mrStart:${o.mrStart}` : ''} } });
    else Object.assign(r, { blob: media ? new Blob([new Uint8Array(64)],{type:'audio/webm'}) : null, mime:'audio/webm' });
    ${o.fileId ? `r.fileId=${q(o.fileId)};` : ''}
    state.recs.unshift(r); state.recs.sort((a,b)=>b.createdAt-a.createdAt); await DB.put('recs', r); renderRecs();
    return r.id;
  })()`);
}

/** TV 화면에 들어간 뒤 전체 화면은 끈다 (전체 화면이면 첫 Esc를 브라우저가 가져가서 앱의 Esc 동작을 볼 수 없다) */
export async function enterTVNoFs(p) {
  await p.eval('enterTV()');
  // 전체 화면 요청은 조금 뒤에 이뤄진다 (PC가 바쁘면 더 늦게). 된 것을 본 뒤 끄고, 꺼진 것까지 보고 간다
  await p.until('!!document.fullscreenElement', 2500);
  if (await p.eval('!!document.fullscreenElement')) { await p.eval('document.exitFullscreen()'); await p.until('!document.fullscreenElement', 3000); }
  await sleep(300);
}

/** 단추 글 대비 (투명도까지 넣어서 뒤 칸 색 위에 보이는 색으로 잰다, WCAG 식). expr: 요소를 돌려주는 식. CR-241 record.mjs에서 옮김 (CR-242 N4도 씀) */
export const inkOf = (pg, expr) => pg.eval(`(()=>{const e=${expr}; if(!e) return null;
    const rgb=s=>{const m=s.match(/[\\d.]+/g).map(Number); return {r:m[0],g:m[1],b:m[2],a:m.length>3?m[3]:1}}, over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
    let back={r:0,g:0,b:0,a:1}; for(let p=e.parentElement;p;p=p.parentElement){const c=rgb(getComputedStyle(p).backgroundColor); if(c.a>0){back=over(c,back); break;}}
    const cs=getComputedStyle(e), op=+cs.opacity, bg=over(rgb(cs.backgroundColor),back), fg=over(rgb(cs.color),bg), seen=c=>over({...c,a:op},back);
    const lum=c=>{const f=v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}; return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b)};
    const a=lum(seen(fg)), b=lum(seen(bg)); return {t:e.textContent, op, color:cs.color, d:e.disabled, busy:e.getAttribute('aria-busy'), ratio:Math.round((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)*100)/100}})()`);
/** 눌림 막은 "…중" 단추가 흐리지 않음: 투명도 1 · 평소 단추와 같은 글 색 · 대비 4.5:1 이상 */
export const inkOk = (busy, ref) => !!busy && !!ref && busy.d && busy.op === 1 && busy.color === ref.color && busy.ratio >= 4.5;
export const fmtInk = (busy, ref) => busy && ref ? `"${busy.t}" 투명도 ${busy.op} · 대비 ${busy.ratio}:1 (눌림 막음 ${busy.d}) / [${ref.t}] ${ref.ratio}:1 · 글 색 같음 ${busy.color === ref.color}` : '못 잼';

/** CR-242 N1: 창(dialog)이 열린 채 뜬 알림 재기. 알림이 그 창 안에 있는지, 정말 보이는지(알림 위 5점을 눌러 보면 알림 자신: 잠깐 pointer-events를 켜서 잼),
 *  창 단추와 겹치는지(겹친 단추 글), 창 제목(h2)을 가리는지(ttl), 창 위 끝과의 거리(dTop: 알림 위 끝 - 창 위 끝, gap: 창 위 끝 - 알림 아래 끝), 크기·줄 수·좌우 여백, 화면의 .toast 수 */
export const dlgToast = (p, dlg) => p.eval(`(()=>{const d=document.querySelector(${q(dlg)}), t=document.querySelector('#toast'); if(!t||t.hidden) return null;
  const r=t.getBoundingClientRect(), dr=d&&d.open?d.getBoundingClientRect():null;
  const sh=new CSSStyleSheet(); sh.replaceSync('#toast{pointer-events:auto!important}'); document.adoptedStyleSheets=[...document.adoptedStyleSheets, sh];
  const pts=[[r.left+r.width/2,r.top+r.height/2],[r.left+5,r.top+5],[r.right-5,r.top+5],[r.left+5,r.bottom-5],[r.right-5,r.bottom-5]];
  const seen=pts.filter(([x,y])=>{const e=document.elementFromPoint(x,y); return !!e&&(e===t||t.contains(e))}).length;
  document.adoptedStyleSheets=document.adoptedStyleSheets.filter(s=>s!==sh);
  const hit=b=>{const a=b.getBoundingClientRect(); return a.width>0&&a.height>0&&a.left<r.right&&a.right>r.left&&a.top<r.bottom&&a.bottom>r.top};
  const name=b=>(b.textContent.trim()||b.title||b.getAttribute('aria-label')||b.id).slice(0,12);
  const btns=d?[...d.querySelectorAll('button')].filter(hit).map(name):[], low=d?[...d.querySelectorAll('.dlg-btns button')].filter(hit).map(name):[], h2=d&&d.querySelector('h2');
  const rg=document.createRange(); rg.selectNodeContents(t); const lines=new Set([...rg.getClientRects()].filter(x=>x.width>0).map(x=>Math.round(x.top))).size;
  return {inDlg:!!d&&d.contains(t), home:t.parentElement===document.body?'body':'#'+t.parentElement.id, n:document.querySelectorAll('.toast').length, seen, vw:innerWidth, w:Math.round(r.width), h:Math.round(r.height),
    top:Math.round(r.top), bottom:Math.round(innerHeight-r.bottom), l:Math.round(r.left), rr:Math.round(innerWidth-r.right), dTop:dr?Math.round(r.top-dr.top):null, gap:dr?Math.round(dr.top-r.bottom):null, dL:dr?Math.round(r.left-dr.left):null, dR:dr?Math.round(dr.right-r.right):null,
    lines, over:t.scrollWidth>t.clientWidth+1, btns, low, ttl:!!h2&&hit(h2)}})()`);
/** 창 안 알림이 맞음: 창 안 · 다 보임 · [닫기][저장] 줄과 안 겹침 · 창 바로 위(알림 아래 끝이 창 위 끝 - 8px, 창 위에 자리가 없으면 화면 위 12px: 디자인 보기 K1)
 *  · 창 안 폭(창 좌·우 8px 이상 안쪽) · 넘침 없음 · 알림 하나 */
export const dlgToastOk = b => !!b && b.inDlg && b.seen === 5 && b.low.length === 0 && (b.dTop == null || Math.abs(b.dTop + b.h + 8) <= 1 || b.top === 12)
  && (b.dL == null || (b.dL >= 8 && b.dR >= 8)) && !b.over && b.n === 1;
export const fmtDT = b => b ? `${b.vw}폭 ${b.home} ${b.w}×${b.h}px ${b.lines}줄 · 창 위 끝${b.dTop >= 0 ? '+' : ''}${b.dTop} (창 위 끝과 ${b.gap}px 띔 · 화면 위 ${b.top}) · 창 좌 ${b.dL}·우 ${b.dR} · 보임 ${b.seen}/5 · 겹친 단추 [${b.btns.join('][')}]${b.ttl ? ' 제목 가림' : ''}${b.low.length ? ' 아래 단추 겹침 [' + b.low.join('][') + ']' : ''}${b.over ? ' 넘침' : ''} · 알림 ${b.n}개` : '안 뜸';
