// YT 노래방 · 재생, 노래방식 가사 표시, 음정·점수
'use strict';

/* ---------------- 재생 ---------------- */
function startSources() {
  const s = state.song, when = E.ctx.currentTime + 0.03;
  const kb = state.keyBufs || { mr: s.buffer, guide: s.guide };
  E.src = E.ctx.createBufferSource(); E.src.buffer = kb.mr; E.src.playbackRate.value = state.rate;
  E.src.connect(E.mrGain); E.src.start(when, state.offset);
  if (kb.guide) { E.gsrc = E.ctx.createBufferSource(); E.gsrc.buffer = kb.guide; E.gsrc.playbackRate.value = state.rate; E.gsrc.connect(E.guideGain); E.gsrc.start(when, state.offset); }
  state.when = when; state.playing = true;
  if (take) take.segs.push({ ctxStart: when, songOffset: state.offset, ctxEnd: Infinity, key: state.key || 0 });
}
function killSources() {
  for (const k of ['src', 'gsrc']) if (E[k]) { try { E[k].stop(); } catch {} E[k].disconnect(); E[k] = null; }
  if (take) { const sg = take.segs[take.segs.length - 1]; if (sg && sg.ctxEnd === Infinity) sg.ctxEnd = E.ctx.currentTime; }
}
async function play() {
  if (!state.song) return;
  if (!state.song.buffer && state.song._loading) { flash('반주 준비 중…'); await state.song._loading.catch(() => {}); }
  if (!state.song.buffer) { toast('이 곡의 반주를 불러오지 못했어요. 곡을 다시 골라 주세요'); return; }
  ensureCtx(); await E.ctx.resume(); await E.ready;
  if (state.playing) return;
  cancelNext();
  pStop(true);
  if (state.offset >= dur() - 0.1) state.offset = 0;
  const fresh = state.offset < 0.5;
  hideScore();
  if (fresh && !state.sync) { state.score = { frames: 0, voiced: 0, pitched: 0 }; countPlay(state.song); }
  if (state.armed && !state.sync) startRecording();
  startSources();
  if (!state.micOn && fresh && !state.sync) toast('마이크를 켜면 녹음하고 점수도 받을 수 있어요');
  updateTransportUI();
  if (state.tv) pokeUI();
}
function pause() {
  if (!state.playing) return;
  const t = curTime(); killSources(); state.playing = false; state.offset = t;
  pauseRecording(); updateTransportUI();
}
function stopPlayback() {
  killSources(); state.playing = false; state.offset = 0;
  finishRecording(null); updateTransportUI(); if (state.song) updateTimeUI(0);
}
function seekTo(t) {
  const was = state.playing;
  if (was) killSources();
  state.offset = clamp(t, 0, dur());
  if (was) startSources();
  resetLineCache();
}
function onFinish() {
  killSources(); state.playing = false; state.offset = 0;
  const score = computeScore(), recorded = !!take;
  finishRecording(score);
  updateTransportUI(); updateTimeUI(0);
  if (state.sync) return;
  if (score != null) { addScore(state.song, score); renderBest(); showScore(score, recorded); }
  scheduleNext(score != null ? 7000 : 3000);
}
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
function updateTransportUI() {
  $('#playBtn').innerHTML = state.playing ? ICON_PAUSE : ICON_PLAY;
  $('#playBtn').setAttribute('aria-label', state.playing ? '일시정지' : '시작');
  $('#syPlay').textContent = state.playing ? '일시정지' : '재생';
  $('#stage').classList.toggle('playing', state.playing);
  updateScreens(state.playing ? curTime() : state.offset);
  $('#recBtn').setAttribute('aria-pressed', state.armed);
  $('#recBadge').hidden = !(take && !take.paused);
  $('#tvRecBtn').textContent = state.armed ? '● 녹음 켜짐' : '● 녹음';
  $('#recLbl').textContent = take ? (take.paused ? '녹음 일시정지' : '녹음 중') : state.armed ? '녹음 대기 (시작하면 녹음)' : '녹음 꺼짐';
  updateWakeLock();   // 노래가 나오는 동안 화면이 꺼지지 않게 (karaoke.js)
}
$('#playBtn').onclick = () => togglePlay();
$('#stopBtn').onclick = () => { cancelNext(); stopPlayback(); };

const seek = $('#seek');
seek.addEventListener('input', () => { state.seeking = true; $('#tCur').textContent = fmt(+seek.value); });
seek.addEventListener('change', () => { seekTo(+seek.value); state.seeking = false; if (!state.playing) updateTimeUI(+seek.value); });

function updateTimeUI(t) {
  seek.max = dur() || 1;
  if (!state.seeking) { seek.value = t; $('#tCur').textContent = fmt(t); }
  $('#tDur').textContent = fmt(dur());
  renderLyrics(t);
  updateScreens(state.playing ? curTime() : state.offset);
}

/* ---------------- 가사 표시 (노래방식 두 줄) ---------------- */
function setLine(el, idx, p, dots) {
  const line = state.lines[idx], text = line ? line.text : '';
  const key = idx + '|' + text;
  if (el._key !== key) {
    el._key = key;
    el.querySelector('.base').textContent = text || ' ';
    el.querySelector('.fill').textContent = text || ' ';
  }
  el.style.setProperty('--p', (p * 100).toFixed(2) + '%');
  el.classList.toggle('dim', p >= 1);
  el.querySelector('.dots').textContent = dots;
}
const heardTime = t => state.playing ? t - (E.ctx.outputLatency || 0) * state.rate : t;
function activeIndex(lt) {
  const L = state.lines; let a = -1;
  for (let i = 0; i < L.length; i++) { if (L[i].t <= lt) a = i; else break; }
  return a;
}
function renderLyrics(t) {
  const L = state.lines, top = $('#lineTop'), bot = $('#lineBottom');
  if (!L.length) {
    top._key = bot._key = null;
    top.querySelector('.base').textContent = top.querySelector('.fill').textContent = state.song ? '가사 없이 반주만 나와요' : '';
    bot.querySelector('.base').textContent = bot.querySelector('.fill').textContent = ' ';
    top.style.setProperty('--p', '0%'); top.querySelector('.dots').textContent = bot.querySelector('.dots').textContent = '';
    state.active = -1;
    return;
  }
  const lt = heardTime(t) + lyricOffset();
  const a = state.active = activeIndex(lt);
  const activeIsReal = a >= 0 && L[a].text;
  const base = activeIsReal ? a : a + 1;
  const slots = [null, null];
  slots[base % 2] = base; slots[(base + 1) % 2] = base + 1;
  let p = 0;
  if (activeIsReal) {
    const start = L[a].t, next = L[a + 1]?.t, end = isFinite(next) ? next : start + 5, span = Math.min((end - start) * 0.92, 7);
    p = clamp((lt - start) / span, 0, 1);
  }
  let dots = '';
  if (!activeIsReal && L[base] && isFinite(L[base].t)) {
    const remain = L[base].t - lt;
    if (remain > 0 && remain <= 4 && (state.playing || t > 0)) dots = '●'.repeat(Math.ceil(remain));
  }
  setLine(top, slots[0], slots[0] === a && activeIsReal ? p : 0, slots[0] === base ? dots : '');
  setLine(bot, slots[1], slots[1] === a && activeIsReal ? p : 0, slots[1] === base ? dots : '');
}

/* ---------------- 마이크 분석: 음정·볼륨·점수 ---------------- */
const NOTE_EN = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTE_KO = ['도','도#','레','레#','미','파','파#','솔','솔#','라','라#','시'];
let tdBuf = null, lastPitch = { rms: 0, f: 0 };
function detectPitch(buf, sr) {
  const N = buf.length; let e = 0;
  for (let i = 0; i < N; i++) e += buf[i] * buf[i];
  const rms = Math.sqrt(e / N);
  if (rms < 0.012) return { rms, f: 0 };
  const W = 1024, minLag = Math.floor(sr / 1100), maxLag = Math.min(N - W - 2, Math.floor(sr / 70));
  const corr = new Float32Array(maxLag + 2);
  let e1 = 0; for (let i = 0; i < W; i++) e1 += buf[i] * buf[i];
  let max = 0;
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let c = 0, e2 = 0;
    for (let i = 0; i < W; i++) { const b = buf[i + lag]; c += buf[i] * b; e2 += b * b; }
    const v = c / (Math.sqrt(e1 * e2) || 1); corr[lag] = v; if (v > max) max = v;
  }
  if (max < 0.75) return { rms, f: 0 };
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (corr[lag] >= 0.9 * max && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
      const x1 = corr[lag - 1], x2 = corr[lag], x3 = corr[lag + 1], a = (x1 + x3 - 2 * x2) / 2, b = (x3 - x1) / 2;
      return { rms, f: sr / (a ? lag - b / a : lag) };
    }
  }
  return { rms, f: 0 };
}
function analyseMic() {
  if (!state.micOn) return null;
  if (!tdBuf) tdBuf = new Float32Array(E.analyser.fftSize);
  E.analyser.getFloatTimeDomainData(tdBuf);
  if (state.frame % 3 === 0) lastPitch = detectPitch(tdBuf, E.ctx.sampleRate);
  else { let e = 0; for (let i = 0; i < tdBuf.length; i++) e += tdBuf[i] * tdBuf[i]; lastPitch = { rms: Math.sqrt(e / tdBuf.length), f: lastPitch.f }; }
  const { rms, f } = lastPitch;
  $('#levelBar').style.width = clamp(Math.sqrt(rms) * 220, 0, 100) + '%';
  if (f > 0 && rms > 0.015) {
    const midi = Math.round(69 + 12 * Math.log2(f / 440)), n = ((midi % 12) + 12) % 12;
    $('#noteName').textContent = NOTE_EN[n] + (Math.floor(midi / 12) - 1);
    $('#noteKo').textContent = `${NOTE_KO[n]} · ${Math.round(f)}Hz`;
  } else if (state.frame % 20 === 0) { $('#noteName').textContent = '–'; $('#noteKo').textContent = '소리를 내 보세요'; }
  return lastPitch;
}
function scoreFrame(mic) {
  if (!state.score || !mic || !state.playing) return;
  const a = state.active;
  const hasLyrics = state.lines.some(l => l.text);
  if (hasLyrics ? (a < 0 || !state.lines[a].text) : curTime() < 3) return;
  state.score.frames++;
  if (mic.rms > 0.02) { state.score.voiced++; if (mic.f > 0) state.score.pitched++; }
}
function computeScore() {
  const s = state.score; state.score = null;
  if (!s || s.frames < 60 || !state.micOn) return null;
  const sing = Math.min(1, (s.voiced / s.frames) / 0.65), tune = s.voiced ? s.pitched / s.voiced : 0;
  return clamp(Math.round(52 + sing * 36 + tune * 12), 0, 100);
}
const SCORE_MSG = [
  [100, '완벽해요! 오늘 밤 주인공은 당신'],
  [95, '가수 데뷔 각! 앵콜 한 곡 더?'],
  [88, '분위기 최고! 다들 박수 짝짝짝'],
  [78, '좋아요, 목이 이제 막 풀렸어요'],
  [65, '음… 이번엔 연습이었던 걸로'],
  [0, '마이크 가까이, 조금 더 크게!'],
];
function showScore(score, recorded) {
  $('#scoreOverlay').hidden = false; $('#scoreListen').hidden = !recorded;
  $('#scoreMsg').textContent = SCORE_MSG.find(([min]) => score >= min)[1];
  const el = $('#scoreNum'), t0 = performance.now(), D = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1400;
  (function step(now) {
    const k = D ? clamp((now - t0) / D, 0, 1) : 1;
    el.textContent = Math.round(score * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}
function hideScore() { $('#scoreOverlay').hidden = true; }
$('#scoreClose').onclick = hideScore;
$('#scoreAgain').onclick = () => { hideScore(); state.offset = 0; play(); };
$('#scoreListen').onclick = () => { hideScore(); showTab('recs'); };
