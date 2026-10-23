// YT 노래방 · 녹음, 녹음 믹스, 내 녹음 목록, 싱크·믹스 조절
'use strict';

/* ---------------- 녹음: 목소리만 따로 받고, 반주는 어디를 틀었는지만 기록 ---------------- */
let take = null;
function startRecording() {
  if (!E.cap) { toast('이 브라우저는 녹음을 지원하지 않아요'); return; }
  if (take) { if (take.paused) { take.paused = false; capOn(take); } return; }
  take = { chunks: [], segs: [], paused: false, song: state.song, createdAt: Date.now(), score: null };
  if (state.playing) take.segs.push({ ctxStart: E.ctx.currentTime, songOffset: curTime(), ctxEnd: Infinity, key: state.key || 0 });
  capOn(take);
  if (!state.micOn) toast('마이크가 꺼져 있어서 목소리 없이 녹음돼요');
}
function pauseRecording() {
  if (take && !take.paused) { take.paused = true; capOff(); }
}
async function finishRecording(score) {
  if (!take) return;
  const t = take; take = null; t.score = score;
  updateTransportUI();
  await capOff();
  if (capTarget === t) capTarget = null;
  saveTake(t);
}
async function saveTake(t) {
  const sr = E.ctx.sampleRate;
  let total = 0; for (const c of t.chunks) total += c.data.length;
  if (total < sr * 1.5) return;
  const pcm = new Int16Array(total), runs = []; let o = 0;
  for (const c of t.chunks) {
    const last = runs[runs.length - 1];
    if (!last || last.frame + (o - last.out) !== c.frame) runs.push({ out: o, frame: c.frame });
    for (let i = 0; i < c.data.length; i++) { const v = clamp(c.data[i], -1, 1); pcm[o + i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
    o += c.data.length;
  }
  // 녹음 파일의 몇 초 지점에 반주 몇 초 지점이 나와야 하는지 계산
  const parts = [];
  runs.forEach((r, i) => {
    const len = (i + 1 < runs.length ? runs[i + 1].out : total) - r.out, rs = r.frame / sr, re = (r.frame + len) / sr;
    for (const s of t.segs) {
      const a = Math.max(rs, s.ctxStart), b = Math.min(re, s.ctxEnd);
      if (b > a) parts.push({ at: r.out / sr + (a - rs), offset: s.songOffset + (a - s.ctxStart), dur: b - a, key: s.key || 0 });
    }
  });
  const rec = {
    id: uid(), v: 2, title: t.song.title, artist: t.song.artist || '', songId: t.song.id, createdAt: t.createdAt,
    duration: total / sr, score: t.score, sr, vocal: new Blob([pcm.buffer], { type: 'application/octet-stream' }), parts,
    mix: { offset: settings.recOffset, vocal: settings.micVol, mr: settings.mrVol, echo: settings.echo, reverb: settings.reverb },
  };
  state.recs.unshift(rec);
  rec.updatedAt = rec.createdAt; Cloud.schedule();
  try { await DB.put('recs', rec); } catch { toast('녹음을 브라우저에 저장하지 못했어요. 새로고침 전에 WAV로 저장해 두세요.', 4500); }
  renderRecs();
  toast(`녹음 저장됨 · ${rec.title} (${fmt(rec.duration)}) · 박자가 어긋나면 '싱크·믹스 조절'에서 고치세요`, 4500);
}
async function setArmed(on) {
  state.armed = on;
  if (on && !state.micOn) await enableMic();
  if (state.playing && !state.sync) { if (on) startRecording(); else finishRecording(null); }
  updateTransportUI();
}
$('#recBtn').onclick = () => setArmed(!state.armed);

/* 녹음 믹스: 목소리 + 반주를 지정한 타이밍·볼륨으로 다시 합친다 (미리듣기와 WAV 내보내기 공용) */
const recCache = new Map();
async function loadRecAudio(rec) {
  if (recCache.has(rec.id)) return recCache.get(rec.id);
  ensureCtx();
  await ensureRecMedia(rec);
  const i16 = new Int16Array(await rec.vocal.arrayBuffer());
  const vb = new AudioBuffer({ numberOfChannels: 1, length: Math.max(1, i16.length), sampleRate: rec.sr });
  const d = vb.getChannelData(0); for (let i = 0; i < i16.length; i++) d[i] = i16[i] / 32768;
  const song = state.songs.find(s => s.id === rec.songId);
  let mr = null; if (song) { try { mr = await loadSongBuffer(song); } catch {} }
  const out = { vocalBuf: vb, mrBuf: mr, mrKeys: {} };
  // 키를 바꿔 부른 부분은 그 키의 반주로 섞는다
  if (mr) for (const k of new Set(rec.parts.map(p => p.key || 0))) if (k) { try { out.mrKeys[k] = (await keyBuffer(song, k)).mr; } catch {} }
  recCache.set(rec.id, out);
  return out;
}
function buildMix(c, out, data, parts, mix, from, when) {
  const sources = [];
  const mrG = c.createGain(); mrG.gain.value = mrGainValue(mix.mr); mrG.connect(out);
  // 반주 위치 기록이 없는 녹음은 사용자가 맞춘 '반주 시작 위치'로 대신한다
  const ps = parts.length ? parts : (data.mrBuf && mix.mrStart != null ? [{ at: 0, offset: mix.mrStart, dur: Math.max(0, data.mrBuf.duration - mix.mrStart) }] : []);
  if (data.mrBuf) for (const p of ps) {
    if (p.at + p.dur <= from) continue;
    const skip = Math.max(0, from - p.at), s = c.createBufferSource();
    s.buffer = (p.key && data.mrKeys?.[p.key]) || data.mrBuf; s.connect(mrG); s.start(when + Math.max(0, p.at - from), p.offset + skip, p.dur - skip); sources.push(s);
  }
  const chain = makeVocalChain(c); chain.set(mix); chain.output.connect(out);
  const v = c.createBufferSource(); v.buffer = data.vocalBuf; v.connect(chain.input);
  const vpos = from + mix.offset / 1000; // 목소리는 offset만큼 앞당겨 재생
  if (vpos < 0) v.start(when - vpos, 0); else if (vpos < data.vocalBuf.duration) v.start(when, vpos);
  sources.push(v);
  return {
    set(m) { chain.set(m); mrG.gain.setTargetAtTime(mrGainValue(m.mr), c.currentTime, 0.03); },
    stop() { for (const s of sources) { try { s.stop(); } catch {} s.disconnect(); } mrG.disconnect(); chain.disconnect(); },
  };
}
async function renderMix(rec, mix) {
  const data = await loadRecAudio(rec);
  const oc = new OfflineAudioContext(2, Math.ceil((rec.duration + 1.5) * rec.sr), rec.sr);
  buildMix(oc, oc.destination, data, rec.parts, mix, 0, 0);
  return oc.startRendering();
}

/* 녹음 미리듣기 플레이어 */
const P = { rec: null, mix: null, h: null, when: 0, from: 0, playing: false };
const pTime = () => P.playing ? clamp(P.from + E.ctx.currentTime - P.when, 0, P.rec.duration) : P.from;
async function pPlay(rec, mix, from = 0) {
  ensureCtx(); await E.ctx.resume();
  if (state.playing) pause();
  if (P.h) { P.h.stop(); P.h = null; }
  const data = await loadRecAudio(rec);
  P.rec = rec; P.mix = mix; P.from = from >= rec.duration - 0.1 ? 0 : from; P.when = E.ctx.currentTime + 0.05; P.playing = true;
  P.h = buildMix(E.ctx, E.master, data, rec.parts, mix, P.from, P.when);
  renderPlayerUI();
}
function pStop(reset) {
  if (P.playing) P.from = pTime();
  if (P.h) { P.h.stop(); P.h = null; }
  P.playing = false; if (reset) P.from = 0;
  renderPlayerUI();
}
function renderPlayerUI() {
  for (const b of document.querySelectorAll('[data-play]')) {
    const on = P.playing && P.rec?.id === b.dataset.play;
    b.textContent = on ? `⏸ ${fmt(pTime())}` : '▶ 듣기';
  }
  if (mxRec) {
    $('#mxPlay').innerHTML = P.playing ? ICON_PAUSE : ICON_PLAY;
    if (!mxSeeking) $('#mxSeek').value = pTime();
    $('#mxTime').textContent = `${fmt(pTime())} / ${fmt(mxRec.duration)}`;
  }
}

/* 녹음 목록 */
const urls = [];
function renderRecs() {
  urls.splice(0).forEach(u => URL.revokeObjectURL(u));
  const ul = $('#recList'); ul.textContent = '';
  $('#recCount').textContent = state.recs.length;
  $('#recEmpty').hidden = state.recs.length > 0;
  $('#recHint').hidden = !state.recs.some(r => r.v === 2);
  for (const r of state.recs) {
    const li = document.createElement('li'); li.className = 'rec';
    const d = new Date(r.createdAt);
    li.innerHTML = `<div class="row"><div style="min-width:0"><div class="t"></div><div class="sub"></div></div></div><div class="btns"></div>`;
    li.querySelector('.t').textContent = r.title;
    const noMr = r.v === 2 && !state.songs.some(s => s.id === r.songId);
    li.querySelector('.sub').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · ${fmt(r.duration)}${noMr ? ' · 반주 없음' : (r.v === 2 && !r.parts.length && r.mix.mrStart == null) ? ' · 반주 위치 맞추기 필요' : ''}`;
    if (r.score != null) li.querySelector('.row').append(Object.assign(document.createElement('span'), { className: 'score-chip', textContent: r.score + '점' }));
    const btns = li.querySelector('.btns');
    const mk = (txt, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small ' + cls; b.textContent = txt; b.onclick = () => fn(b); btns.append(b); return b; };
    if (!recMedia(r)) {
      // Drive에만 있는 녹음: 받아야 들을 수 있다
      li.querySelector('.sub').append(' · ☁ Drive');
      mk('기기로 받기', 'primary', async b => {
        b.disabled = true; b.textContent = '받는 중…';
        try { await ensureRecMedia(r); } catch (e) { toast(mediaErrText(e), 5000); }
        renderRecs();
      });
    } else if (r.v === 2) {
      const pb = mk('▶ 듣기', 'play', () => (P.playing && P.rec === r) ? pStop(false) : pPlay(r, r.mix, P.rec === r ? P.from : 0));
      pb.dataset.play = r.id;
      mk('싱크·믹스 조절', 'primary', () => openMix(r));
      mk('WAV로 저장', '', b => exportWav(r, r.mix, b));
    } else {
      // 예전 방식(반주와 목소리가 합쳐진 파일) 녹음
      const au = document.createElement('audio'); au.controls = true; au.preload = 'metadata';
      const url = URL.createObjectURL(r.blob); urls.push(url); au.src = url;
      au.addEventListener('loadedmetadata', () => { if (au.duration === Infinity) { au.currentTime = 1e7; au.addEventListener('timeupdate', () => { au.currentTime = 0; }, { once: true }); } }, { once: true });
      li.insertBefore(au, btns);
      const ext = (r.mime || '').includes('ogg') ? 'ogg' : (r.mime || '').includes('mp4') ? 'm4a' : 'webm';
      mk('다운로드', '', () => download(r.blob, fileName(r, ext)));
    }
    mk('삭제', 'ghost danger', b => confirmButton(b, async () => {
      if (P.rec === r) pStop(true);
      if (r.fileId) { const t = { ...pick(r, REC_FIELDS), deleted: true, updatedAt: Date.now() }; state.recTombs.push(t); try { await DB.put('recs', t); } catch {} Cloud.schedule(); }
      else { try { await DB.del('recs', r.id); } catch {} }
      recCache.delete(r.id);
      state.recs = state.recs.filter(x => x !== r); renderRecs();
    }));
    ul.append(li);
  }
  renderPlayerUI();
}
async function exportWav(rec, mix, b) {
  const label = b.textContent; b.disabled = true; b.textContent = '만드는 중…';
  try { download(encodeWav(await renderMix(rec, mix)), fileName(rec, 'wav')); }
  catch (e) { console.error(e); toast('WAV 파일을 만들지 못했어요'); }
  b.disabled = false; b.textContent = label;
}
function fileName(r, ext) {
  const d = new Date(r.createdAt), p = n => String(n).padStart(2, '0');
  return `${r.title.replace(/[\\/:*?"<>|]/g, '_')}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}
function download(blob, name) {
  const a = document.createElement('a'), u = URL.createObjectURL(blob);
  a.href = u; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}
function encodeWav(buf) {
  const ch = Math.min(2, buf.numberOfChannels), sr = buf.sampleRate, n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, sr, true);
  out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = clamp(data[c][i], -1, 1); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Blob([out], { type: 'audio/wav' });
}

/* 싱크·믹스 조절 창 */
let mxRec = null, draft = null, mxSeeking = false, mxRestartTimer;
function openMix(rec) {
  pStop(true); if (state.playing) pause();
  mxRec = rec; draft = { ...rec.mix };
  P.rec = rec; P.from = 0;
  $('#mxTitle').textContent = rec.title;
  const d = new Date(rec.createdAt);
  $('#mxSub').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 녹음 · ${fmt(rec.duration)}`;
  $('#mxSeek').max = rec.duration;
  $('#mxWarn').hidden = state.songs.some(s => s.id === rec.songId);
  const needStart = !rec.parts.length;
  $('#mxStartBox').hidden = !needStart;
  if (needStart) {
    draft.mrStart ??= 0;
    loadRecAudio(rec).then(d => { if (d.mrBuf && mxRec === rec) { $('#mxStart').max = d.mrBuf.duration.toFixed(2); fillMixUI(); } });
  }
  fillMixUI();
  $('#mixDialog').showModal();
  renderPlayerUI();
}
function fillMixUI() {
  $('#mxOff').value = draft.offset;
  $('#mxOffV').textContent = draft.offset === 0 ? '0ms' : draft.offset > 0 ? `목소리 ${draft.offset}ms 앞당김` : `목소리 ${-draft.offset}ms 늦춤`;
  for (const k of ['vocal', 'mr', 'echo', 'reverb']) { $('#mx-' + k).value = draft[k]; $('#mxv-' + k).textContent = draft[k]; }
  if (draft.mrStart != null) { $('#mxStart').value = draft.mrStart; $('#mxStartV').textContent = `반주 ${fmtMs(draft.mrStart)}부터`; }
}
function setMrStart(v) {
  draft.mrStart = clamp(Math.round(v * 100) / 100, 0, +$('#mxStart').max || 600); fillMixUI();
  if (P.playing) { clearTimeout(mxRestartTimer); mxRestartTimer = setTimeout(() => pPlay(mxRec, draft, pTime()), 120); }
}
$('#mxStart').addEventListener('input', e => setMrStart(+e.target.value));
for (const b of document.querySelectorAll('[data-snudge]')) b.onclick = () => setMrStart((draft.mrStart || 0) + +b.dataset.snudge);
function setOffset(v) {
  draft.offset = clamp(Math.round(v), -300, 800); fillMixUI();
  if (P.playing) { clearTimeout(mxRestartTimer); mxRestartTimer = setTimeout(() => pPlay(mxRec, draft, pTime()), 120); }
}
$('#mxOff').addEventListener('input', e => setOffset(+e.target.value));
for (const b of document.querySelectorAll('[data-nudge]')) b.onclick = () => setOffset(draft.offset + +b.dataset.nudge);
for (const inp of document.querySelectorAll('[data-mx]')) inp.addEventListener('input', () => {
  draft[inp.dataset.mx] = +inp.value; fillMixUI(); P.h?.set(draft);
});
$('#mxPlay').onclick = () => P.playing ? pStop(false) : pPlay(mxRec, draft, P.from);
$('#mxSeek').addEventListener('input', () => { mxSeeking = true; $('#mxTime').textContent = `${fmt(+$('#mxSeek').value)} / ${fmt(mxRec.duration)}`; });
$('#mxSeek').addEventListener('change', () => {
  mxSeeking = false; const t = +$('#mxSeek').value;
  if (P.playing) pPlay(mxRec, draft, t); else { P.from = t; renderPlayerUI(); }
});
$('#mxWav').onclick = e => exportWav(mxRec, draft, e.currentTarget);
$('#mxClose').onclick = () => $('#mixDialog').close();
$('#mxSave').onclick = async () => {
  const r = mxRec; r.mix = { ...draft }; recTouch(r);
  try { await DB.put('recs', r); } catch { toast('저장하지 못했어요'); return; }
  settings.recOffset = clamp(draft.offset, 0, 600); settings.recOffsetTouched = true; applySettings(); saveSettings();
  $('#mixDialog').close();
  toast(`저장했어요 · 다음 녹음은 ${settings.recOffset}ms 보정으로 시작해요`, 3500);
};
$('#mixDialog').addEventListener('close', () => { pStop(true); mxRec = null; draft = null; });
