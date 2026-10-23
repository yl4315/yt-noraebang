// YT 노래방 · 데모곡 반주 합성과 저장
'use strict';

/* ---------------- 데모 MR 합성 ---------------- */
const DEMO_LYRICS = [
  '창문 너머 불빛 하나', '오늘 밤도 너를 불러', '작은 방에 울린 노래', '두 손으로 마이크 꽉',
  '박자 놓쳐도 괜찮아', '음정 틀려도 웃어봐', '우리 목소리 겹치면', '이 밤이 전부 노래야'
];
// 96 BPM → 한 마디 2.5초. 전주 2마디 후 가사 한 줄 = 2마디(5초)
const DEMO_LRC = DEMO_LYRICS.map((t, i) => ({ t: 5 + i * 5, text: t })).concat([{ t: 45, text: '' }]);

function tone(c, out, { type = 'sine', f, t, d, v = 0.2, a = 0.01, r = 0.1, lp }) {
  d = Math.max(d, a + 0.02);
  const o = c.createOscillator(); o.type = type; o.frequency.value = f;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a);
  g.gain.setValueAtTime(v, t + Math.max(a, d - r)); g.gain.linearRampToValueAtTime(0, t + d);
  let node = o;
  if (lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); node = fl; }
  node.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
}

async function renderDemo(transpose = 0) {
  const sr = 44100, beat = 60 / 96, bar = beat * 4, BARS = 20, len = Math.ceil((BARS * bar + 3) * sr);
  const mc = new OfflineAudioContext(2, len, sr), gc = new OfflineAudioContext(2, len, sr);
  const comp = mc.createDynamicsCompressor(); comp.connect(mc.destination);
  const mOut = mc.createGain(); mOut.gain.value = 0.85; mOut.connect(comp);
  const gOut = gc.createGain(); gOut.connect(gc.destination);
  const noise = mc.createBuffer(1, sr, sr); const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const mtof = m => 440 * Math.pow(2, (m + transpose - 69) / 12);

  const kick = t => {
    const o = mc.createOscillator(), g = mc.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(g); g.connect(mOut); o.start(t); o.stop(t + 0.35);
  };
  const nz = (t, d, v, hp) => {
    const s = mc.createBufferSource(); s.buffer = noise;
    const f = mc.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = mc.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    s.connect(f); f.connect(g); g.connect(mOut); s.start(t, Math.random() * 0.5); s.stop(t + d + 0.02);
  };
  const snare = t => { nz(t, 0.18, 0.32, 1200); tone(mc, mOut, { type: 'triangle', f: 190, t, d: 0.1, v: 0.22, a: 0.002, r: 0.08 }); };
  const hat = (t, v) => nz(t, 0.045, v, 7000);

  const PROG = [{ root: 36, tri: [60, 64, 67] }, { root: 43, tri: [59, 62, 67] }, { root: 45, tri: [57, 60, 64] }, { root: 41, tri: [57, 60, 65] }];
  const chordAt = k => k >= 18 ? PROG[0] : PROG[((k - 2) % 4 + 4) % 4];

  for (let k = 0; k < BARS; k++) {
    const t0 = k * bar, ch = chordAt(k), last = k === BARS - 1;
    for (const m of ch.tri) {
      tone(mc, mOut, { type: 'sawtooth', f: mtof(m), t: t0, d: last ? bar * 1.5 : bar, v: 0.026, a: 0.25, r: 0.4, lp: 1500 });
      tone(mc, mOut, { type: 'triangle', f: mtof(m) * 1.004, t: t0, d: last ? bar * 1.5 : bar, v: 0.03, a: 0.25, r: 0.4 });
    }
    if (last) {
      tone(mc, mOut, { type: 'triangle', f: mtof(ch.root), t: t0, d: bar * 1.2, v: 0.32, a: 0.01, r: 0.8, lp: 700 });
      kick(t0); nz(t0, 1.6, 0.18, 4000);
      continue;
    }
    for (const [b, d] of [[0, 1.4], [1.5, 0.5], [2, 1], [3, 0.9]])
      tone(mc, mOut, { type: 'triangle', f: mtof(ch.root), t: t0 + b * beat, d: d * beat, v: 0.32, a: 0.008, r: 0.06, lp: 700 });
    if (k >= 2) [0, 1, 2, 1, 2, 1, 0, 1].forEach((n, i) =>
      tone(mc, mOut, { type: 'square', f: mtof(ch.tri[n] + 12), t: t0 + i * beat / 2, d: beat * 0.42, v: 0.03, a: 0.004, r: 0.12, lp: 2600 }));
    if (k >= 1) {
      kick(t0); kick(t0 + 2 * beat); if (k % 2) kick(t0 + 2.5 * beat);
      snare(t0 + beat); snare(t0 + 3 * beat);
      for (let i = 0; i < 8; i++) hat(t0 + i * beat / 2, i % 2 ? 0.05 : 0.09);
    } else {
      for (let i = 0; i < 4; i++) hat(t0 + i * beat, 0.05);
    }
  }

  // 멜로디 가이드: [박, 길이(박), MIDI]
  const A = [[0,1,64],[1,1,64],[2,1,67],[3,1,69],[4,1,67],[5,.5,65],[5.5,.5,64],[6,2,62]];
  const B = [[0,1,60],[1,1,64],[2,1,69],[3,1,67],[4,1,65],[5,1,64],[6,1,62],[7,1,64]];
  const C = [[0,1,67],[1,.5,69],[1.5,.5,67],[2,1,64],[3,1,60],[4,1,62],[5,1,64],[6,2,67]];
  const D = [[0,1,69],[1,1,67],[2,1,64],[3,1,60],[4,1,62],[5,.5,64],[5.5,.5,62],[6,2,60]];
  [A, B, C, D, A, B, C, D].forEach((ln, i) => {
    const t0 = (2 + 2 * i) * bar;
    for (const [b, d, m] of ln) {
      tone(gc, gOut, { type: 'sine', f: mtof(m + 12), t: t0 + b * beat, d: d * beat * 0.92, v: 0.2, a: 0.012, r: 0.12 });
      tone(gc, gOut, { type: 'triangle', f: mtof(m), t: t0 + b * beat, d: d * beat * 0.92, v: 0.1, a: 0.012, r: 0.12 });
    }
  });
  const [mr, guide] = await Promise.all([mc.startRendering(), gc.startRendering()]);
  return { mr, guide };
}

// 데모 반주는 합성하는 데 몇 초 걸려서, 한 번 만든 걸 기기에 저장해 두고 다음부터 바로 쓴다.
// 데모곡(반주나 멜로디)을 바꾸면 이 이름의 숫자를 올려야 새로 만든다.
const DEMO_CACHE_KEY = 'demo-v1';
async function loadDemo() {
  try { const c = await DB.get('cache', DEMO_CACHE_KEY); if (c) return await unpackDemo(c); } catch {}
  const r = await renderDemo();
  DB.put('cache', packDemo(r)).catch(() => {});
  return r;
}
// 반주 두 채널 + 멜로디 가이드 두 채널을 16비트로 이어 붙여 한 덩어리로 저장한다
function packDemo({ mr, guide }) {
  const len = mr.length, chs = [mr.getChannelData(0), mr.getChannelData(1), guide.getChannelData(0), guide.getChannelData(1)];
  const i16 = new Int16Array(len * 4);
  chs.forEach((d, c) => { for (let i = 0; i < len; i++) { const v = clamp(d[i], -1, 1); i16[c * len + i] = v < 0 ? v * 0x8000 : v * 0x7fff; } });
  return { id: DEMO_CACHE_KEY, sr: mr.sampleRate, len, pcm: new Blob([i16.buffer]) };
}
async function unpackDemo(c) {
  const i16 = new Int16Array(await c.pcm.arrayBuffer());
  if (i16.length !== c.len * 4) throw new Error('demo cache size');
  const mk = first => {
    const buf = new AudioBuffer({ numberOfChannels: 2, length: c.len, sampleRate: c.sr });
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch), o = (first + ch) * c.len; for (let i = 0; i < c.len; i++) d[i] = i16[o + i] / 32768; }
    return buf;
  };
  return { mr: mk(0), guide: mk(2) };
}
