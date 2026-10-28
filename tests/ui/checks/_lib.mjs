// 화면 자동 점검(CR-019) · 점검들이 같이 쓰는 도구
import fs from 'node:fs';
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
  try { const ov = navigator.vibrate ? navigator.vibrate.bind(navigator) : null; navigator.vibrate = p => { ui.vib.push(p); return ov ? ov(p) : true; }; } catch {}
  try { const orf = Element.prototype.requestFullscreen; Element.prototype.requestFullscreen = function (...a) { ui.fsReq++; const pr = orf.apply(this, a); pr.catch(e => ui.fsErr.push(String(e && e.message || e))); return pr; }; } catch {}
  try { if (screen.orientation) { const ol = screen.orientation.lock ? screen.orientation.lock.bind(screen.orientation) : null; screen.orientation.lock = o => { ui.orient.push(o); return ol ? ol(o) : Promise.reject(new Error('no lock')); }; } } catch {}
  // 마이크 권한 거부 흉내: localStorage '__ui-mic'가 'deny'면 거부 (마이크 꺼진 채 녹음·안내를 보려고. nb- 키가 아니라 앱 데이터와 안 섞임)
  try { const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = c => localStorage.getItem('__ui-mic') === 'deny' ? Promise.reject(new DOMException('UI점검: 일부러 거부', 'NotAllowedError')) : gum(c); } catch {}
})();`;

/** 새 탭: 기록 장치를 넣고 화면 크기를 정한 뒤 주소를 연다 */
export async function openPage(ctx, size, url, ready = READY_DEMO, browser = ctx.browser, ms = 150000) {
  const p = await browser.newPage();
  await p.s('Page.addScriptToEvaluateOnNewDocument', { source: SPY });
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
