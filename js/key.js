// YT 노래방 · 키 바꾸기 (템포 그대로, 음높이만)
'use strict';

/* ================= 키 바꾸기 ================= */
// 템포는 그대로 두고 음높이만 바꾼다: WSOLA로 길이를 늘린 뒤 다시 원래 길이로 줄이는 방식. 무거워서 워커에서 돌린다.
const PITCH_WORKER = `
onmessage = e => {
  const { id, semis, sr, chs } = e.data;
  const r = Math.pow(2, semis / 12), len = chs[0].length, C = chs.length;
  const N = Math.round(sr * 0.046) & ~1, Hs = N >> 1, Ha = Hs / r, tol = Math.round(sr * 0.012);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const mono = new Float32Array(len);
  for (const d of chs) for (let i = 0; i < len; i++) mono[i] += d[i] / C;
  const stLen = Math.ceil(len * r) + N * 2;
  const st = chs.map(() => new Float32Array(stLen)), wsum = new Float32Array(stLen);
  const frames = Math.floor((len - N) / Ha);
  let prev = 0;
  for (let k = 0; k <= frames; k++) {
    const nominal = Math.round(k * Ha);
    let best = nominal;
    if (k > 0 && prev + Hs * 2 < len) {
      const target = prev + Hs, lo = Math.max(0, nominal - tol), hi = Math.min(len - N - 1, nominal + tol);
      let bestC = -Infinity;
      for (let q = lo; q <= hi; q += 3) {
        let c = 0;
        for (let j = 0; j < Hs; j += 8) c += mono[q + j] * mono[target + j];
        if (c > bestC) { bestC = c; best = q; }
      }
    }
    if (best + N > len) break;
    const o = k * Hs;
    for (let c = 0; c < C; c++) { const src = chs[c], t = st[c]; for (let j = 0; j < N; j++) t[o + j] += src[best + j] * win[j]; }
    for (let j = 0; j < N; j++) wsum[o + j] += win[j];
    prev = best;
    if (k % 3000 === 0) postMessage({ id, progress: k / frames });
  }
  const out = chs.map(() => new Float32Array(len));
  for (let c = 0; c < C; c++) {
    const t = st[c], d = out[c];
    for (let i = 0; i < stLen; i++) if (wsum[i] > 1e-3) t[i] /= wsum[i];
    for (let i = 0; i < len; i++) { const x = i * r, i0 = x | 0, f = x - i0; d[i] = i0 + 1 < stLen ? t[i0] * (1 - f) + t[i0 + 1] * f : 0; }
  }
  postMessage({ id, chs: out }, out.map(d => d.buffer));
};`;
let pitchWorker = null, pitchSeq = 0;
const pitchJobs = new Map();
function pitchShift(buf, semis, onProgress) {
  if (!pitchWorker) {
    pitchWorker = new Worker(URL.createObjectURL(new Blob([PITCH_WORKER], { type: 'application/javascript' })));
    pitchWorker.onmessage = e => {
      const j = pitchJobs.get(e.data.id); if (!j) return;
      if (e.data.progress != null) return j.onProgress?.(e.data.progress);
      pitchJobs.delete(e.data.id);
      const out = new AudioBuffer({ numberOfChannels: e.data.chs.length, length: e.data.chs[0].length, sampleRate: j.sr });
      e.data.chs.forEach((d, c) => out.copyToChannel(d, c));
      j.res(out);
    };
    pitchWorker.onerror = e => { for (const j of pitchJobs.values()) j.rej(e); pitchJobs.clear(); pitchWorker = null; };
  }
  return new Promise((res, rej) => {
    const id = ++pitchSeq, chs = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c).slice());
    pitchJobs.set(id, { res, rej, sr: buf.sampleRate, onProgress });
    pitchWorker.postMessage({ id, semis, sr: buf.sampleRate, chs }, chs.map(c => c.buffer));
  });
}
const keyOf = s => (me().keys || {})[s.id] || 0;
const keyLabel = k => k === 0 ? '원래 키' : k > 0 ? `+${k}` : `${k}`;
// 곡마다 최근 두 개 키만 메모리에 둔다
function keyBuffer(s, semis, onProgress) {
  if (!semis) return Promise.resolve({ mr: s.buffer, guide: s.guide });
  s.keyCache ||= new Map();
  if (!s.keyCache.has(semis)) {
    const job = (async () => {
      if (s.demo) { const r = await renderDemo(semis); return { mr: r.mr, guide: r.guide }; }
      return { mr: await pitchShift(s.buffer, semis, onProgress), guide: null };
    })();
    job.catch(() => s.keyCache.delete(semis));
    s.keyCache.set(semis, job);
    if (s.keyCache.size > 2) s.keyCache.delete(s.keyCache.keys().next().value);
  }
  return s.keyCache.get(semis);
}
let keyJob = 0;
async function setKey(semis, { save = true } = {}) {
  const s = state.song; if (!s?.buffer || state.sync) return;
  semis = clamp(Math.round(semis), -6, 6);
  if (save) { const p = me(); p.keys ||= {}; if (semis) p.keys[s.id] = semis; else delete p.keys[s.id]; saveProfiles(p); }
  state.key = semis;
  const job = ++keyJob;
  if (!semis) { state.keyBufs = null; updateKeyUI(); if (state.playing) seekTo(curTime()); flash('원래 키'); return; }
  updateKeyUI('바꾸는 중…');
  try {
    const kb = await keyBuffer(s, semis, p => { if (job === keyJob) updateKeyUI(`바꾸는 중 ${Math.round(p * 100)}%`); });
    if (job !== keyJob || state.song !== s) return;
    state.keyBufs = kb; updateKeyUI();
    if (state.playing) seekTo(curTime());
    flash(`키 ${keyLabel(semis)}`);
  } catch (e) {
    console.error(e);
    if (job === keyJob) { state.key = 0; state.keyBufs = null; updateKeyUI(); toast('키를 바꾸지 못했어요'); }
  }
}
function updateKeyUI(busy) {
  $('#keyOut').textContent = busy ? `${keyLabel(state.key)} · ${busy}` : keyLabel(state.key);
  $('#keyBadge').hidden = !state.key; $('#keyBadge').textContent = `키 ${keyLabel(state.key)}`;
}
for (const b of document.querySelectorAll('[data-key-step]')) b.onclick = () => setKey((state.key || 0) + +b.dataset.keyStep);
$('#keyReset').onclick = () => setKey(0);
