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
  if (ytSong()) { flash('유튜브 곡은 녹음하지 않아요 · 내 MR 곡에서만 돼요'); updateTransportUI(); return; }   // 영상 소리가 섞인 파일을 남기지 않음 (CR-030). 켜 둔 녹음은 다음 내 MR 곡에서 그대로
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
  // 옛 주소는 조금 뒤에 놓는다: 바로 다시 그리면(공유 형식 확인·동기화) 떼어 낸 <audio>가 아직 읽는 중이라 콘솔에 ERR_FILE_NOT_FOUND가 남는다
  const old = urls.splice(0); if (old.length) setTimeout(() => old.forEach(u => URL.revokeObjectURL(u)), 30000);
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
      shareButton(mk, r, () => r.mix);
      mk('WAV로 저장', '', b => exportWav(r, r.mix, b));
    } else {
      // 예전 방식(반주와 목소리가 합쳐진 파일) 녹음
      const au = document.createElement('audio'); au.controls = true; au.preload = 'metadata';
      const url = URL.createObjectURL(r.blob); urls.push(url); au.src = url;
      au.addEventListener('loadedmetadata', () => { if (au.duration === Infinity) { au.currentTime = 1e7; au.addEventListener('timeupdate', () => { au.currentTime = 0; }, { once: true }); } }, { once: true });
      li.insertBefore(au, btns);
      const ext = recBlobExt(r.mime);
      shareButton(mk, r, () => null);
      mk('다운로드', '', () => download(r.blob, fileName(r, ext)));
    }
    mk('삭제', 'ghost danger', b => confirmButton(b, async () => {
      if (P.rec === r) pStop(true);
      if (r.fileId) { const t = { ...pick(r, REC_FIELDS), deleted: true, updatedAt: Date.now() }; state.recTombs.push(t); try { await DB.put('recs', t); } catch {} Cloud.schedule(); }
      else { try { await DB.del('recs', r.id); } catch {} }
      recCache.delete(r.id);
      if (Share.made?.recId === r.id) { Share.made = null; Share.ready = null; }
      state.recs = state.recs.filter(x => x !== r); renderRecs();
    }));
    ul.append(li);
  }
  renderPlayerUI(); renderShareUI();
}
async function exportWav(rec, mix, b) {
  const label = b.textContent; b.disabled = true; b.textContent = '만드는 중…';
  try { download(encodeWav(await renderMix(rec, mix)), fileName(rec, 'wav')); }
  catch (e) { console.error(e); toast('WAV 파일을 만들지 못했어요'); }
  b.disabled = false; b.textContent = label;
}
// 파일 이름 규칙 하나 (core recFileName): WAV 저장·작은 파일 저장·공유·예전 녹음 다운로드가 같이 쓴다 (CR-031 R9)
const fileName = (r, ext) => recFileName(r.title, r.createdAt, ext);
/* ---------------- 녹음 나누기 (CR-031): 폰은 [공유] → 공유 창, PC는 [작은 파일로 저장] ----------------
   작은 파일 형식은 이 기기에서 고른다: AAC 되면 m4a · 안 되고 Opus 되면 ogg · 둘 다 안 되면 WAV (core smallFormatPick).
   만든 파일은 메모리에 하나만 (같은 녹음·같은 종류·같은 믹스 값일 때 다시 씀). 디스크·IndexedDB·Drive에 저장하지 않는다.
   공유 창은 누른 지 5초쯤 안에만 열려서, 만드는 데 그보다 오래 걸리면 단추가 [보내기]로 바뀌어 한 번 더 누른다 */
const WAV_NOTE = '이 브라우저는 작은 파일을 못 만들어서 WAV로 보내요 (파일이 커요)';
const Share = { fmt: new Map(), pick: 'wav', small: false, busy: null, made: null, ready: null, tick: 0 };
// 이 샘플레이트에서 쓸 형식 (기기마다 한 번만 물어본다)
function smallFormatFor(sr) {
  if (!Share.fmt.has(sr)) Share.fmt.set(sr, (async () => {
    if (typeof AudioEncoder !== 'function' || typeof AudioData !== 'function') return 'wav';
    const ok = async f => { try { return !!(await AudioEncoder.isConfigSupported(smallEncoderConfig(f, sr, 2))).supported; } catch { return false; } };
    return smallFormatPick({ aac: await ok('m4a'), opus: await ok('ogg') });
  })());
  return Share.fmt.get(sr);
}
async function shareProbe() {
  const f = await smallFormatFor(48000), was = Share.small;
  Share.pick = f; Share.small = f !== 'wav';
  if (Share.small !== was && state.recs.length) renderRecs();
}
// 공유 창에 이 형식 파일을 실을 수 있으면 그 종류(mime), 아니면 null
function shareTypeFor(fmt) {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return null;
  const f = SMALL_FORMATS[fmt];
  for (const type of f.share) { try { if (navigator.canShare({ files: [new File([new Uint8Array(1)], 'a.' + f.ext, { type })] })) return type; } catch {} }
  return null;
}
// 줄·창에 단추 하나 (조건이 안 맞으면 안 만든다 — 지금과 같음). mix() = 지금 보낼 믹스 값 (창에서는 조절 중인 값)
function shareChoiceFor(r) {
  const legacy = r.v !== 2, fmt = legacy ? recBlobExt(r.mime) : Share.small ? Share.pick : 'wav';
  return shareChoice({ touch: isTouch(), share: !!shareTypeFor(fmt), small: Share.small, legacy });
}
function shareButton(mk, r, mix) {
  const choice = shareChoiceFor(r);
  if (!choice) return null;
  const b = mk(shareBtnText({ act: choice.act }), '', shareTap);
  b.dataset.share = r.id; b.shareInfo = { rec: r, mix, choice };
  return b;
}
const shareKeyOf = i => shareKey(i.rec.id, i.mix(), i.choice.file);
function renderShareUI() {
  const now = performance.now();
  for (const b of document.querySelectorAll('[data-share]')) {
    const i = b.shareInfo; if (!i) continue;
    const k = shareKeyOf(i), busy = Share.busy?.key === k;
    b.textContent = shareBtnText({ act: i.choice.act, busyMs: busy ? now - Share.busy.t0 : null, ready: Share.ready === k && Share.made?.key === k });
    b.disabled = busy;
  }
}
async function shareTap(b) {
  const i = b.shareInfo; if (!i) return;
  const key = shareKeyOf(i);
  if (Share.busy) { if (Share.busy.key !== key) toast('다른 녹음을 만드는 중이에요 · 끝나면 눌러 주세요'); return; }
  if (Share.made?.key === key) return deliver(i.choice, Share.made, true);     // 이미 만든 파일: 다시 안 만든다
  Share.busy = { key, t0: performance.now() }; Share.ready = null; Share.made = null;
  clearInterval(Share.tick); Share.tick = setInterval(renderShareUI, 250); renderShareUI();
  if (i.choice.file === 'wav') toast(WAV_NOTE, 4500);
  let made = null;
  try { made = await makeShareFile(i.rec, i.mix(), i.choice.file); }
  catch (e) { console.error(e); toast('공유할 파일을 만들지 못했어요 · 다시 눌러 주세요'); }
  const took = performance.now() - Share.busy.t0;
  Share.busy = null; clearInterval(Share.tick); Share.tick = 0;
  if (!made) { renderShareUI(); return; }
  Share.made = { key, recId: i.rec.id, ...made };
  if (i.choice.act === 'share' && shareNeedsTap(took)) return askTap(key);
  renderShareUI();
  deliver(i.choice, Share.made, false);
}
function askTap(key) {
  Share.ready = key; renderShareUI();
  if ([...document.querySelectorAll('[data-share]')].some(b => b.shareInfo && shareKeyOf(b.shareInfo) === key)) toast('준비됐어요 · [보내기]를 눌러 주세요', 4000);
}
async function deliver(choice, made, tapped) {
  if (choice.act === 'save') {
    download(made.blob, made.name);
    toast(`저장했어요 · ${made.name} (${sizeLabel(made.blob.size)})`, 3500);
    return;
  }
  Share.ready = null; renderShareUI();
  try { await navigator.share({ files: [new File([made.blob], made.name, { type: made.type })], title: made.title }); }
  catch (e) {
    if (e?.name === 'AbortError') return;                                       // 공유 창을 그냥 닫음: 안내 없음
    if (e?.name === 'NotAllowedError' && !tapped) return askTap(made.key);      // 누른 지 오래됨 → [보내기]로 한 번 더
    console.error(e); toast('보내지 못했어요 · 잠시 뒤 다시 눌러 보세요. 계속 안 되면 [WAV로 저장]으로 저장해서 보내 주세요', 5000);
  }
}
// 보낼 파일: 예전 방식 녹음은 파일 그대로, 아니면 믹스를 다시 만들어 작은 파일(안 되면 WAV)로
async function makeShareFile(rec, mix, file) {
  if (file === 'orig') {
    const ext = recBlobExt(rec.mime);
    return { blob: rec.blob, name: fileName(rec, ext), type: shareTypeFor(ext) || SMALL_FORMATS[ext].share[0], title: rec.title, fmt: ext };
  }
  const buf = await renderMix(rec, mix);
  let fmt = file === 'small' ? await smallFormatFor(buf.sampleRate) : 'wav', blob = null;
  if (fmt !== 'wav') { try { blob = await encodeSmall(buf, fmt); } catch (e) { console.error(e); fmt = 'wav'; toast(WAV_NOTE, 4500); } }
  else if (file === 'small') toast(WAV_NOTE, 4500);
  if (fmt === 'wav') blob = encodeWav(buf);
  return { blob, name: fileName(rec, SMALL_FORMATS[fmt].ext), type: shareTypeFor(fmt) || SMALL_FORMATS[fmt].share[0], title: rec.title, fmt };
}
// AudioEncoder(WebCodecs)로 줄이고 틀(m4a 또는 Ogg)에 담는다. 외부 코드 없음
async function encodeSmall(buf, fmt) {
  const sr = buf.sampleRate, ch = Math.min(2, buf.numberOfChannels), frames = [];
  let desc = null, err = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); frames.push(b);
      const d = meta?.decoderConfig?.description;
      if (d && !desc) desc = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)) : new Uint8Array(d.slice(0));
    },
    error: e => { err = e; },
  });
  try {
    enc.configure(smallEncoderConfig(fmt, sr, ch));
    const data = [...Array(ch)].map((_, c) => buf.getChannelData(c)), N = 4096;
    for (let i = 0; i < buf.length; i += N) {
      if (err) throw err;
      const n = Math.min(N, buf.length - i), plane = new Float32Array(n * ch);
      for (let c = 0; c < ch; c++) plane.set(data[c].subarray(i, i + n), c * n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(i * 1e6 / sr), data: plane });
      enc.encode(ad); ad.close();
      while (enc.encodeQueueSize > 16 && !err) await new Promise(r => setTimeout(r, 5));   // 앞이 밀리면 잠깐 기다림 (메모리·화면 멈춤 방지)
    }
    await enc.flush();
  } finally { if (enc.state !== 'closed') enc.close(); }
  if (err) throw err;
  if (!frames.length) throw new Error('인코더가 아무것도 내지 않았어요');
  if (fmt === 'm4a') {
    const asc = desc && desc.length >= 2 ? desc : aacConfig(sr, ch);
    return new Blob(m4aParts({ frames: desc ? frames : frames.map(aacRawFrame), asc, sampleRate: sr, channels: ch }), { type: SMALL_FORMATS.m4a.mime });
  }
  return new Blob(oggOpusParts({ packets: frames, head: desc, channels: ch, sampleRate: sr, samples: buf.length }), { type: SMALL_FORMATS.ogg.mime });
}
shareProbe();

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
  const sb = $('#mxShare'), choice = shareChoiceFor(rec);
  sb.hidden = !choice; sb.shareInfo = choice ? { rec, mix: () => draft || rec.mix, choice } : null;
  fillMixUI();
  $('#mixDialog').showModal();
  renderPlayerUI();
}
function fillMixUI() {
  $('#mxOff').value = draft.offset;
  $('#mxOffV').textContent = draft.offset === 0 ? '0ms' : draft.offset > 0 ? `목소리 ${draft.offset}ms 앞당김` : `목소리 ${-draft.offset}ms 늦춤`;
  for (const k of ['vocal', 'mr', 'echo', 'reverb']) { $('#mx-' + k).value = draft[k]; $('#mxv-' + k).textContent = draft[k]; }
  if (draft.mrStart != null) { $('#mxStart').value = draft.mrStart; $('#mxStartV').textContent = `반주 ${fmtMs(draft.mrStart)}부터`; }
  renderShareUI();     // 믹스를 바꾸면 창의 [보내기]는 풀려 다시 [공유] (믹스 값이 열쇠)
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
$('#mxShare').onclick = e => shareTap(e.currentTarget);
$('#mxClose').onclick = () => $('#mixDialog').close();
$('#mxSave').onclick = async () => {
  const r = mxRec; r.mix = { ...draft }; recTouch(r);
  try { await DB.put('recs', r); } catch { toast('저장하지 못했어요'); return; }
  settings.recOffset = clamp(draft.offset, 0, 600); settings.recOffsetTouched = true; applySettings(); saveSettings();
  $('#mixDialog').close();
  toast(`저장했어요 · 다음 녹음은 ${settings.recOffset}ms 보정으로 시작해요`, 3500);
};
$('#mixDialog').addEventListener('close', () => { pStop(true); mxRec = null; draft = null; $('#mxShare').shareInfo = null; });
