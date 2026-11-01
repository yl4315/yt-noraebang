// YT 노래방 · 기기 맞추기 (CR-039): 켤 때 "Drive와 맞추기" 띠, 점수·부른 횟수를 기기마다 Drive에, 설정 창 "여행 준비"
'use strict';
// 계산(합치기·받을 순서·준비 끝 판정)은 core.js. 여기는 Drive 입출력과 화면만 얇게.
// 띠·여행 준비 칸이 없는 옛 index.html과 섞여도 멈추지 않게, 요소가 없으면 건너뛴다.

/* ================= 이 기기 id와 다른 기기 기록 사본 ================= */
// 기기 id: 처음 필요할 때(Drive에 올리거나 백업 파일을 만들 때) 만든다 → nb-device
function deviceId() {
  if (!Dev.id) Dev.id = lsGet('nb-device');
  if (!Dev.id) { Dev.id = uid(); lsSet('nb-device', Dev.id); statsChanged(); }
  return Dev.id;
}
function saveDevStats(o) {
  Dev.others = o; statsChanged();
  try { localStorage.setItem('nb-devstats', JSON.stringify(o)); } catch {}
}
// Drive의 내 파일과 합친 결과를 이 기기 기록에도 넣는다 (큰 쪽·합집합이라 줄지 않음)
function applyMyStats(p, s) {
  for (const k of Object.keys(plays)) delete plays[k];
  Object.assign(plays, p); scores.splice(0, scores.length, ...s);
  try { localStorage.setItem('nb-plays', JSON.stringify(plays)); localStorage.setItem('nb-scores', JSON.stringify(scores)); } catch {}
  statsChanged();
}
const gstats = () => { try { return JSON.parse(lsGet('nb-gstats') || '{}') || {}; } catch { return {}; } };
const tokenAlive = () => Cloud.api !== DriveApi || (!!Cloud.token && Date.now() < Cloud.exp - 60000);

/* syncNow의 마지막 단계: 이 기기 파일을 올리고(바뀌었을 때만) 다른 기기 파일을 받는다 (바뀐 것만).
   자기 파일만 쓰고 남의 파일은 읽기만 해서 두 기기가 동시에 맞춰도 충돌이 없다. 깨진 파일은 건너뛰고 그 기기 사본은 지난번 값 그대로. */
async function syncDeviceStats(api) {
  if (!api.listFolderJson) return null;             // 목록 함수가 없는 가짜 Drive면 건너뜀
  const me = deviceId(), g = gstats();
  const { mine, others } = pickStatsFiles(await api.listFolderJson(Cloud.folderId), me);
  let fileId = mine?.id || null;
  if (statsSig({ plays, scores }) !== g.sig || !fileId) {
    if (fileId) {
      try { const r = parseStatsFile(await api.readJson(fileId)); if (r) applyMyStats(mergePlays(plays, r.plays), mergeScores(scores, r.scores)); }
      catch (e) { if (e.needLogin) throw e; if (e.status === 404) fileId = null; else console.warn('stats mine', e); }
    }
    setCloud('syncing', '점수 기록 맞추는 중…');
    const body = buildStatsFile(me, plays, scores);
    if (fileId) await api.updateJson(fileId, body); else fileId = await api.createJson(Cloud.folderId, statsFileName(me), body);
    lsSet('nb-gstats', JSON.stringify({ fileId, sig: statsSig({ plays, scores }) }));
  }
  const next = { ...Dev.others }; let changed = 0;
  for (const f of others) {
    const cur = next[f.device];
    if (cur && f.mt && cur.mt >= f.mt) continue;     // 지난번 뒤로 안 바뀐 파일은 다시 읽지 않는다
    try {
      const r = parseStatsFile(await api.readJson(f.id));
      if (!r) { console.warn('stats shape', f.device); continue; }
      next[f.device] = { mt: f.mt, plays: mergePlays(cur?.plays, r.plays), scores: mergeScores(cur?.scores, r.scores) };
      changed++;
    } catch (e) { if (e.needLogin) throw e; console.warn('stats read', f.device, e); }
  }
  if (changed) saveDevStats(next);
  statsChanged(); renderBest(); renderIdleChart(); if (!$('#chartOv').hidden) renderChart();
  return { devices: Object.keys(Dev.others).filter(d => d !== me).length, changed };
}
// 노래가 끝나 점수·횟수가 쌓이면 몇 초 뒤 올린다. 로그인이 살아 있을 때만 (없으면 칩이 괜히 "다시 연결"로 바뀌니까), 노래 중에는 기다린다.
let statsTimer = null;
function scheduleStatsUpload() {
  if (!Cloud.connected || !tokenAlive()) return;
  clearTimeout(statsTimer);
  statsTimer = setTimeout(function go() { if (state.playing) { statsTimer = setTimeout(go, 5000); return; } Cloud.schedule(10); }, 5000);
}

/* ================= 켤 때 "Drive와 맞추기" 띠 ================= */
// 켤 때 로그인 창을 저절로 띄울 수는 없어서(브라우저가 막음) 한 번 누르게 한다. 로그인 토큰은 저장하지 않는다.
// ✕는 이번에만 숨긴다 (저장 안 함 → 다음에 켜면 또 보임). 오프라인·TV 화면·노래 중에는 안 보인다.
const Band = { t0: Date.now(), hide: false, tried: false, gisFailed: false };
function renderBand() {
  const box = $('#syncBand'); if (!box || !state.songs) return;
  const synced = Cloud.lastSync >= Band.t0, real = state.songs.some(s => !s.demo);
  let mode = null;
  if (!Band.hide && !state.tv && !state.playing && navigator.onLine) {
    if (Cloud.connected && Cloud.clientId && !synced) mode = 'sync';
    else if (!Cloud.connected && !real && state.songs.length) mode = 'connect';
  }
  box.hidden = !mode; if (!mode) return;
  const txt = $('#syncBandTxt'), go = $('#syncBandGo');
  let t, b = null, dis = false, err = false;
  if (mode === 'connect') { t = '다른 기기에서 쓰던 곡이 있나요? Drive에 연결하면 와요'; b = '연결'; }
  else if (Cloud.state === 'syncing') t = Cloud.msg || '맞추는 중…';
  else if (Band.tried && (Cloud.state === 'login' || Cloud.state === 'error')) { t = Cloud.msg; b = '다시 눌러 맞추기'; err = true; }
  else {
    const ready = Cloud.api !== DriveApi || !!window.google?.accounts?.oauth2 || Band.gisFailed;
    t = 'Drive와 맞추기' + (Cloud.lastSync ? ` · 마지막 ${ago(Cloud.lastSync)}` : '') + ' · 다른 기기의 곡·점수를 가져와요';
    b = ready ? '맞추기' : '준비 중…'; dis = !ready;
  }
  txt.textContent = t; go.hidden = !b; go.textContent = b || ''; go.disabled = dis;
  box.classList.toggle('err', err);
}
if ($('#syncBand')) {
  $('#syncBandGo').onclick = () => {
    if (!Cloud.connected) { openCloudDialog(); return; }
    Band.tried = true; haptic();
    const p = syncNow({ interactive: true });      // 로그인 창은 누른 줄에서 바로 연다 (await 앞)
    renderBand();
    p.then(r => {
      if (r?.ok) { toast('맞췄어요' + (r.newSongs ? ` · 새 곡 ${r.newSongs}개` : '') + (r.devices ? ` · 다른 기기 ${r.devices}대 기록이 더해졌어요` : ''), 5000); haptic('success'); }
      renderBand();
    });
  };
  $('#syncBandX').onclick = () => { Band.hide = true; renderBand(); };
  // 로그인 도구(GIS)를 다 불러오면 버튼을 켠다. 못 불러오면(막힘) 눌렀을 때 이유가 나오게 그냥 켠다
  if (Cloud.clientId && !window.google?.accounts?.oauth2) loadGis().then(renderBand, () => { Band.gisFailed = true; renderBand(); });
}

/* ================= 설정 창 "여행 준비" ================= */
// ① 로그인 + 맞추기 → ② 남은 공간 확인 → ③ Drive에만 있는 곡 받기(많이 부른 곡부터) → ④ 영구 저장 요청 → ⑤ 앱 화면 저장 확인.
// "준비 끝"은 저장해 둔 표시가 아니라 열 때마다 지금 상태로 판단한다 (새 곡이 생기면 저절로 "다시 준비").
const Travel = { running: false, stop: false, msg: '', cls: '', choice: null, resume: null, last: +(lsGet('nb-travel') || 0) };
const whenText = t => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}시 ${pad2(d.getMinutes())}분`; };
// 서비스 워커가 앱 화면(index.html)을 저장해 뒀는지
async function shellCached() {
  try {
    if (!('caches' in window)) return false;
    const url = new URL('index.html', location.href).href;
    for (const k of await caches.keys()) if (k.startsWith('yt-shell-') && await (await caches.open(k)).match(url)) return true;
  } catch {}
  return false;
}
function travelSay(msg, cls = '') {
  Travel.msg = msg; Travel.cls = cls;
  const m = $('#travelMsg'); if (!m) return;
  m.textContent = msg; m.hidden = !msg; m.className = 'travel-msg ' + cls;
}
async function renderTravel() {
  if (!$('#travelSec')) return;
  let persisted = false; try { persisted = await navigator.storage.persisted(); } catch {}
  const st = travelStatus({ songs: state.songs, connected: Cloud.connected, persisted, shellCached: await shellCached() });
  let t, cls = '';
  if (st.done) {
    cls = st.warnPersist ? 'warn' : 'ok';
    t = `여행 준비 끝 · 곡 ${st.local}곡이 이 기기에 있어요 · 인터넷 없이 부를 수 있어요 · `
      + (st.warnPersist ? '영구 저장이 꺼져 있어요: 공간이 부족하면 브라우저가 곡을 지울 수 있어요' : '영구 저장 켜짐')
      + (Travel.last ? ` · 마지막 준비 ${whenText(Travel.last)}` : '');
  } else if (st.why === 'connect') t = '아직 Drive에 연결하지 않았어요. "여행 준비"를 누르면 연결부터 해요';
  else if (st.why === 'songs') t = Travel.last ? `새 곡 ${st.cloudOnly}곡이 이 기기에 없어요 · 다시 준비해 주세요` : `Drive에만 있는 곡 ${st.cloudOnly}곡 · "여행 준비"를 누르면 이 기기에 받아요`;
  else t = '앱 화면이 아직 이 기기에 저장되지 않았어요. 한 번 새로고침한 뒤 다시 눌러 주세요';
  const line = $('#travelState'); line.textContent = t; line.className = 'travel-state ' + cls;
  $('#travelTip').hidden = !st.done;
  $('#travelUp').hidden = !st.pendingUpload;
  $('#travelUpTxt').textContent = st.pendingUpload ? `Drive에 아직 안 올라간 곡 ${st.pendingUpload}곡 (이 기기에서 넣은 곡은 Drive에 있어야 다른 기기가 받아요)` : '';
  const go = $('#travelGo');
  go.disabled = Travel.running || !navigator.onLine;
  if (!Travel.running) go.textContent = !navigator.onLine ? '인터넷이 필요해요' : Travel.resume || (st.done ? '다시 확인하기' : '여행 준비');
  $('#travelStop').hidden = !Travel.running;
  $('#travelNoVideo').hidden = Travel.running || !Travel.choice?.video;
  $('#travelAnyway').hidden = Travel.running || !Travel.choice;
  $('#travelBarBox').hidden = !Travel.running;
  travelSay(Travel.msg, Travel.cls);
}
// 누른 줄에서 바로 로그인 창을 열고(await 앞) 나머지를 이어서 한다
function travelStart(opts = {}) {
  if (Travel.running) return;
  if (!navigator.onLine) { travelSay('인터넷이 필요해요. 연결되면 다시 눌러 주세요', 'err'); return; }
  haptic();
  const p = opts.skipSync ? Promise.resolve({ ok: true }) : syncNow({ interactive: true, connect: !Cloud.connected });
  travelRun(p, opts);
}
async function travelRun(syncP, { skipVideo = false, anyway = false } = {}) {
  Object.assign(Travel, { running: true, stop: false, choice: null, resume: null });
  Wake.travel = true; updateWakeLock();
  travelSay('① 로그인하고 곡 목록·점수를 맞추는 중…'); renderTravel();
  try {
    let r = await syncP;
    if (r?.busy) { while (Cloud.syncing) await sleep(300); r = Cloud.state === 'ok' ? { ok: true } : { ok: false, msg: Cloud.msg }; }
    if (!r?.ok) { travelSay(r?.msg || cloudErrText(r?.error || {}), 'err'); return; }
    // ② 남은 공간 (모자라면 받기 전에 알린다)
    let free = null; try { const { usage, quota } = await navigator.storage.estimate(); if (quota) free = quota - usage; } catch {}
    const plan = downloadPlan({ free, skipVideo });
    const sizeNote = plan.unknown ? ` · ${plan.unknown}곡은 크기를 몰라요` : '';
    if (plan.list.length && !plan.fits && !anyway) {
      Travel.choice = { video: plan.video > 0 };
      travelSay(`공간이 모자라요: 받을 곡 약 ${fmtBytes(plan.need)} · 남은 공간 약 ${fmtBytes(free)}${sizeNote}. `
        + (plan.video ? `동영상 곡 ${plan.video}곡을 빼고 받거나, ` : '') + '많이 부른 곡부터 받다가 공간이 차면 멈출 수 있어요', 'warn');
      return;
    }
    // ③ 받기 (많이 부른 곡 → 좋아요한 곡 → 번호 순)
    const list = plan.list, bar = $('#travelBar');
    const res = await downloadSongs(list, {
      stopped: () => Travel.stop,
      onStep: (i, s) => { travelSay(`③ 받는 중 ${i + 1} / ${list.length} · ${s.title}${i === 0 ? sizeNote : ''}`); if (bar) bar.style.width = Math.round(i / list.length * 100) + '%'; },
    });
    const miss = res.missing ? ` · ${res.missing}곡은 Drive에 파일이 없어요` : '';
    if (res.stop === 'user') { Travel.resume = '이어서 받기'; travelSay(`멈췄어요. 받은 ${res.got}곡은 그대로예요 · ${res.left}곡 남았어요${miss}`); return; }
    if (res.stop === 'login') { Travel.resume = '다시 연결하고 이어서 받기'; travelSay(`로그인이 끝났어요 · ${res.left}곡 남았어요. 받은 곡은 그대로예요`, 'warn'); return; }
    if (res.stop === 'offline') { Travel.resume = '이어서 받기'; travelSay(`인터넷이 끊겼어요. 받은 곡은 그대로예요 · ${res.left}곡 남았어요. 연결되면 다시 눌러 주세요`, 'err'); return; }
    if (res.stop === 'space') {
      let left = null; try { const { usage, quota } = await navigator.storage.estimate(); if (quota) left = quota - usage; } catch {}
      Travel.resume = '이어서 받기'; Travel.choice = { video: list.some(s => s.video && needsDownload(s)) };
      travelSay(`공간이 모자라 ${res.got}곡에서 멈췄어요${left != null ? ` (남은 공간 약 ${fmtBytes(left)})` : ''} · ${res.left}곡 남았어요`, 'err');
      return;
    }
    // ④ 영구 저장 요청 · ⑤ 앱 화면 저장 확인
    travelSay('④ 영구 저장을 요청하는 중…');
    await requestPersist();
    if (!(await shellCached())) { travelSay('곡은 받았어요. 앱 화면이 아직 이 기기에 저장되지 않았어요: 한 번 새로고침한 뒤 다시 눌러 주세요' + miss, 'warn'); return; }
    let persisted = false; try { persisted = await navigator.storage.persisted(); } catch {}
    Travel.last = Date.now(); lsSet('nb-travel', String(Travel.last));
    travelSay(`여행 준비 끝 · 이번에 ${res.got}곡을 받았어요${res.failed ? ` · ${res.failed}곡은 받지 못했어요` : ''}${miss}`
      + (persisted ? '' : ' · 영구 저장이 꺼져 있어요: 홈 화면에 앱을 설치하면 켜지는 경우가 많아요'), res.failed || res.missing ? 'warn' : 'ok');
    haptic('success');
  } catch (e) {
    console.warn('travel', e); travelSay('여행 준비 중 문제가 생겼어요: ' + (e.message || e), 'err');
  } finally {
    Travel.running = false; Wake.travel = false; updateWakeLock();
    renderTravel(); renderStorage();
  }
}
if ($('#travelSec')) {
  $('#travelGo').onclick = () => travelStart();
  $('#travelStop').onclick = () => { Travel.stop = true; $('#travelStop').disabled = true; setTimeout(() => { $('#travelStop').disabled = false; }, 800); };
  $('#travelNoVideo').onclick = () => travelStart({ skipVideo: true, skipSync: true });
  $('#travelAnyway').onclick = () => travelStart({ anyway: true, skipSync: true });
  $('#travelUpBtn').onclick = () => { haptic(); syncNow({ interactive: true }); };
}
window.addEventListener('online', () => { if ($('#cloudDialog').open) renderTravel(); });
window.addEventListener('offline', () => { if ($('#cloudDialog').open) renderTravel(); });
