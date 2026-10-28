// YT 노래방 · 오디오 엔진: 효과, 마이크, 녹음 캡처, 지연 측정
'use strict';

/* ---------------- 오디오 엔진 ---------------- */
// 마이크 원음을 샘플 단위로 받아 두는 워클릿. 각 덩어리에 오디오 시계 기준 프레임 번호를 붙여서
// 나중에 반주와 정확히 다시 맞출 수 있게 한다.
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super(); this.on = false; this.buf = new Float32Array(8192); this.n = 0; this.start = 0;
    this.port.onmessage = e => {
      if (e.data === 'on') this.on = true;
      else if (e.data === 'off') { this.flush(); this.on = false; this.port.postMessage({ done: true }); }
    };
  }
  flush() {
    if (!this.n) return;
    const out = this.buf.slice(0, this.n);
    this.port.postMessage({ frame: this.start, data: out }, [out.buffer]);
    this.n = 0;
  }
  process(inputs) {
    if (!this.on) return true;
    const ch = inputs[0] && inputs[0][0], len = ch ? ch.length : 128;
    if (this.n + len > this.buf.length) this.flush();
    if (this.n === 0) this.start = currentFrame;
    if (ch) this.buf.set(ch, this.n); else this.buf.fill(0, this.n, this.n + len);
    this.n += len;
    if (this.n >= this.buf.length) this.flush();
    return true;
  }
}
registerProcessor('capture', Capture);`;

const E = {};
const impulses = new Map();
function getImpulse(sr) {
  if (!impulses.has(sr)) {
    const len = Math.floor(sr * 2.4), buf = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    impulses.set(sr, buf);
  }
  return impulses.get(sr);
}
// 목소리 효과 체인 (실시간 모니터와 녹음 믹스가 같은 소리를 내도록 공용)
function makeVocalChain(c) {
  const input = c.createGain(), dry = c.createGain(), bus = c.createGain();
  const delay = c.createDelay(1); delay.delayTime.value = 0.27;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
  const fb = c.createGain(), wet = c.createGain();
  const conv = c.createConvolver(); conv.buffer = getImpulse(c.sampleRate);
  const rev = c.createGain();
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 4;
  const vol = c.createGain();
  input.connect(dry); dry.connect(bus);
  input.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(wet); wet.connect(bus);
  input.connect(conv); conv.connect(rev); rev.connect(bus);
  bus.connect(comp); comp.connect(vol);
  const offline = c instanceof OfflineAudioContext;
  const sv = (p, v) => offline ? (p.value = v) : p.setTargetAtTime(v, c.currentTime, 0.03);
  return {
    input, output: vol,
    set({ vocal, echo, reverb }) {
      sv(vol.gain, vocal / 100 * 1.8); sv(wet.gain, echo / 100 * 0.55);
      sv(fb.gain, 0.12 + echo / 100 * 0.38); sv(rev.gain, reverb / 100 * 1.3);
    },
    disconnect() { [input, dry, bus, delay, lp, fb, wet, conv, rev, comp, vol].forEach(n => n.disconnect()); }
  };
}
const mrGainValue = v => Math.pow(v / 100, 2) * 1.1;

function ensureCtx() {
  if (E.ctx) return E.ctx;
  const c = E.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  E.master = c.createGain(); E.master.connect(c.destination);
  E.mrGain = c.createGain(); E.mrGain.connect(E.master);
  E.guideGain = c.createGain(); E.guideGain.connect(E.master);
  E.micIn = c.createGain();
  E.analyser = c.createAnalyser(); E.analyser.fftSize = 2048; E.micIn.connect(E.analyser);
  E.live = makeVocalChain(c); E.micIn.connect(E.live.input);
  E.monitor = c.createGain(); E.live.output.connect(E.monitor); E.monitor.connect(E.master);
  E.ready = (async () => {
    try {
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
      await c.audioWorklet.addModule(url);
      E.cap = new AudioWorkletNode(c, 'capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
      const sink = c.createGain(); sink.gain.value = 0;
      E.micIn.connect(E.cap); E.cap.connect(sink); sink.connect(c.destination);
      E.cap.port.onmessage = onCapMessage;
    } catch (e) { console.error(e); }
  })();
  applySettings();
  return c;
}
function applySettings() {
  for (const inp of document.querySelectorAll('.knob input[data-key]')) {
    const k = inp.dataset.key; inp.value = settings[k];
    $('#v-' + k).textContent = k === 'recOffset' ? settings[k] + 'ms' : settings[k];
  }
  $('#t-monitor').checked = settings.monitor; $('#t-speakerMode').checked = settings.speakerMode;
  if (!E.ctx) return;
  const now = E.ctx.currentTime, set = (p, v) => p.setTargetAtTime(v, now, 0.03);
  set(E.mrGain.gain, mrGainValue(settings.mrVol));
  set(E.guideGain.gain, settings.guide / 100);
  set(E.monitor.gain, settings.monitor ? 1 : 0);
  E.live.set({ vocal: settings.micVol, echo: settings.echo, reverb: settings.reverb });
}

/* 녹음 캡처 */
let capTarget = null, capWaiters = [];
function onCapMessage(e) {
  const d = e.data;
  if (d.data) capTarget?.chunks.push({ frame: d.frame, data: d.data });
  else if (d.done) capWaiters.splice(0).forEach(r => r());
}
function capOn(target) { capTarget = target; E.cap.port.postMessage('on'); }
function capOff() { return new Promise(r => { capWaiters.push(r); E.cap.port.postMessage('off'); }); }

async function enableMic() {
  ensureCtx(); E.ctx.resume();
  if (!navigator.mediaDevices?.getUserMedia) { toast('이 브라우저에서는 마이크를 쓸 수 없어요. localhost 주소로 열었는지 확인해 주세요.'); return false; }
  const ec = settings.speakerMode;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: ec, noiseSuppression: ec, autoGainControl: false, latency: 0 } });
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? '마이크 권한이 거부됐어요. 주소창 옆 자물쇠 아이콘에서 허용해 주세요.' : '마이크를 찾지 못했어요: ' + e.message, 4500);
    return false;
  }
  if (E.micSrc) { E.micSrc.disconnect(); E.micStream.getTracks().forEach(t => t.stop()); }
  E.micStream = stream; E.micSrc = E.ctx.createMediaStreamSource(stream); E.micSrc.connect(E.micIn);
  state.micOn = true;
  if (!settings.recOffsetTouched) {
    const inLat = stream.getAudioTracks()[0].getSettings().latency || 0.02;
    const outLat = (E.ctx.outputLatency || 0) + (E.ctx.baseLatency || 0.01);
    settings.recOffset = clamp(Math.round((inLat + outLat) * 1000 / 5) * 5, 0, 600);
    applySettings();
  }
  updateMicUI();
  return true;
}
function updateMicUI() {
  const on = state.micOn, label = on ? (E.micStream.getAudioTracks()[0].label || '마이크') : '마이크 꺼짐';
  $('#micStatus').classList.toggle('on', on);
  $('#micStatus span').textContent = label;
  $('#micBtn span').textContent = on ? '마이크 다시 연결' : '마이크 켜기';
  if (!on) { $('#noteName').textContent = '–'; $('#noteKo').textContent = '마이크를 켜면 음정이 보여요'; }
}

/* 지연 시간 자동 측정: 스피커로 딸깍 소리를 내고 마이크에 들어오기까지 걸린 시간을 잰다 */
async function measureLatency() {
  const btn = $('#measureBtn');
  ensureCtx(); await E.ctx.resume(); await E.ready;
  if (!E.cap) { toast('이 브라우저에서는 측정할 수 없어요'); return; }
  if (!state.micOn && !(await enableMic())) return;
  if (state.playing) pause();
  pStop(true);
  btn.disabled = true; btn.textContent = '측정 중…';
  const M = MEASURE;
  toast(`딸깍 소리가 ${M.clicks}번 나요. 조용히 기다려 주세요 (약 ${Math.round(M.lead + (M.clicks - 1) * M.gap + M.win + 0.3)}초)`, 4000);
  const c = E.ctx, sr = c.sampleRate, target = { chunks: [] };
  capOn(target);
  // 딸깍 간격·기다리는 창은 core.js의 MEASURE (블루투스·무선 화면 복제처럼 지연이 길어도 앞 딸깍을 잡지 않게)
  const t0 = c.currentTime + M.lead, clicks = [];
  for (let i = 0; i < M.clicks; i++) {
    const t = t0 + i * M.gap; clicks.push(t);
    const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 1500;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.8, t + 0.001); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.05);
  }
  await sleep((clicks[clicks.length - 1] - c.currentTime + M.win + 0.3) * 1000);
  await capOff(); if (capTarget === target) capTarget = null;

  let total = 0; for (const ch of target.chunks) total += ch.data.length;
  const pcm = new Float32Array(total); let o = 0;
  for (const ch of target.chunks) { pcm.set(ch.data, o); o += ch.data.length; }
  const r = summarizeDelays(findClickDelays(pcm, sr, target.chunks[0]?.frame ?? 0, clicks));
  btn.disabled = false; btn.textContent = '자동 측정';
  if (!r.ok) {
    toast('딸깍 소리를 못 들었어요. 스피커 볼륨을 올리거나 이어폰을 마이크 가까이 대고 다시 해 보세요. "스피커로 반주 듣는 중"이 켜져 있으면 끄고 해 보세요.', 6000);
    return;
  }
  settings.recOffset = r.ms;
  settings.recOffsetTouched = true; applySettings(); saveSettings();
  if (r.tooLong) toast(`지연이 너무 길어요 (약 ${r.raw}ms). ${M.maxMs}ms로 맞춰 뒀어요. 선으로 이어 보세요. 녹음 뒤 '싱크·믹스 조절'에서 더 고칠 수 있어요`, 7000);
  else if (r.uneven) toast(`측정 완료: ${r.ms}ms. 다만 값이 고르지 않아요. 조용한 곳에서 다시 해 보세요`, 6000);
  else toast(`측정 완료: ${r.ms}ms. 다음 녹음부터 이 값으로 맞춰요`, 4000);
}
$('#measureBtn').onclick = measureLatency;
