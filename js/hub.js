// YT 노래방 · 허브 연결 (CR-227 1단계, W1~W5·W11·W12): 곡 설정(가사·싱크·가사 타이밍·곡 기본 키)을 회사 허브(Supabase)에 두고
// 내 기기끼리 맞춘다. MR 소리 파일은 허브에 올리지 않는다 (곡 열쇠만 MR 파일 내용의 SHA-256으로 만든다).
// - 연결 값은 이 기기 localStorage의 nb-hub* 에만 있다: nb-hub(주소·공개 키) · nb-hub-auth(로그인 세션, supabase-js가 씀)
//   · nb-hub-out(보낼 곡 목록) · nb-hub-owner(처음 로그인한 계정의 표시, 계정 id 그대로가 아니라 해시). 백업 파일·Drive에는 안 들어간다.
// - 허브 사본(받은 곡 설정)은 IndexedDB cache 저장소의 'hub-songs' 한 줄.
// - 허브 코드가 없으면(nb-hub 없음) 아무 요청도 하지 않고 지금과 똑같이 돈다 (W12).
// - 허브 주소·키·토큰·계정 id는 화면·콘솔에 찍지 않는다. 허브에서 온 글은 textContent로만 넣는다.
// 합치기 규칙(나중 것이 이김)·열쇠·검사는 core.js (hubPlan·hubMirrorAdd·songSettingsKey·hubCodeParse), 테스트는 tests/core.test.js.
'use strict';

const HUB_LS = 'nb-hub', HUB_AUTH = 'nb-hub-auth', HUB_OUT = 'nb-hub-out', HUB_OWNER = 'nb-hub-owner', HUB_MIRROR_ID = 'hub-songs';
const HUB_SCOPE = 'noraebang', HUB_COLL = 'song_settings', HUB_APP = 'noraebang';
const HUB_EDIT_MS = 3000, HUB_EVERY_MS = 60000, HUB_BACKOFF_MS = 5 * 60000;
const HUB_HASH_MAX = 300 * 1024 * 1024, HUB_HASH_MS = 20000;
const Hub = {
  conf: null, sb: null, state: 'off', busy: false, again: false, timer: 0, every: 0, failUntil: 0,
  lastAt: 0, out: [], mirror: null, fromHash: '', forgetArm: 0,
  needClear: false,      // 다른 허브로 바꿈: 곡의 "맞춘 표시"를 다음 맞추기 전에 지운다 (켤 때는 곡을 아직 안 불러왔을 수 있어서)
  ytKey: undefined,      // YouTube 검색 열쇠 (허브 열쇠 칸, 메모리에만). undefined = 아직 안 읽음, null = 없음
};

/* ---------------- 연결 값 (nb-hub) ---------------- */
Hub.conf = (() => { try { const o = JSON.parse(lsGet(HUB_LS) || 'null'); return o && hubPairOk(o.u, o.k) ? { u: o.u, k: o.k } : null; } catch { return null; } })();
Hub.out = (() => { try { const q = JSON.parse(lsGet(HUB_OUT) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; } })();
const hubOn = () => !!Hub.conf;
const hubSaveOut = () => lsSet(HUB_OUT, Hub.out.length ? JSON.stringify(Hub.out) : null);

// 이 기기의 nb-hub* 를 모두 지운다 (세션·보낼 줄·계정 표시·연결 코드). 곡·녹음·nb- 다른 설정은 그대로
function hubWipeLocal() {
  const keys = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(HUB_LS)) keys.push(k); } } catch {}
  for (const k of keys) lsSet(k, null);
}
// 곡에 남은 "허브와 맞춘 표시"를 지운다 (다른 허브에 다시 이으면 처음처럼 맞추게). 설정 고친 시각·MR 해시·기본 키는 그대로
async function hubClearMarks() {
  for (const s of state.songs) {
    if (s.demo || !(s.hubK || s.hubSig || s.hubAt || s.hubRej)) continue;
    delete s.hubK; delete s.hubSig; delete s.hubAt; delete s.hubRej;
    await persistSong(s, false, true);
  }
}
function hubDropClient() {
  if (Hub.sb) { try { Hub.sb.auth.stopAutoRefresh(); } catch {} }
  Hub.sb = null;
}
// 연결 코드 저장. 다른 허브(주소가 다름)면 이 기기의 세션·받기 위치·보낼 줄을 먼저 비운다
async function hubSaveConf(u, k) {
  const cur = Hub.conf;
  if (cur && cur.u !== u) {
    hubDropClient(); hubWipeLocal(); Hub.out = []; Hub.mirror = null; hubForgetYtKey();
    Hub.needClear = true;
    try { await DB.del('cache', HUB_MIRROR_ID); } catch {}
  } else hubDropClient();
  lsSet(HUB_LS, JSON.stringify({ u, k }));
  Hub.conf = { u, k }; Hub.state = 'login'; Hub.failUntil = 0;
  hubStartTimers();
}
// 주소 #hub=nbhub1.… 로 열렸으면 코드를 저장하고 주소에서 지운다 (다른 스크립트보다 먼저, 화면 그리기 전에)
if (/^#hub=/.test(location.hash)) {
  const r = hubCodeParse(location.hash);
  try { history.replaceState(null, '', location.pathname + location.search); } catch {}
  Hub.fromHash = r.ok ? 'ok' : 'bad';
  if (r.ok) hubSaveConf(r.u, r.k);
}

/* ---------------- 허브 연결 (supabase-js, 필요할 때만 만든다) ---------------- */
function hubClient() {
  if (!Hub.conf || typeof supabase === 'undefined' || !supabase || typeof supabase.createClient !== 'function') return null;
  if (!Hub.sb) {
    Hub.sb = supabase.createClient(Hub.conf.u, Hub.conf.k, {
      auth: { storageKey: HUB_AUTH, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return Hub.sb;
}
async function hubSession() {
  const sb = hubClient(); if (!sb) return null;
  try { const { data } = await sb.auth.getSession(); return (data && data.session) || null; } catch { return null; }
}
// 계정 표시: 계정 id를 그대로 두지 않고 해시 앞 16자리만 (같은 계정인지만 알면 된다)
async function hubTag(id) {
  const text = 'nb-owner:' + String(id || '');
  try {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    return [...h.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let x = 0x811c9dc5; for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return 'f' + x.toString(16);
  }
}

/* ---------------- 곡 열쇠 (MR 파일 해시는 한 번 계산해 곡에 둔다) ---------------- */
const hexOf = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
// 해시가 없거나 파일 크기가 달라진 곡만, 한 번에 한 곡씩. 재생 중이면 멈춘다 (소리가 끊기지 않게). 300MB 넘는 파일은 건너뜀
async function hubHashSongs() {
  if (!(self.crypto && crypto.subtle)) return;
  const t0 = Date.now();
  for (const s of state.songs.slice()) {
    if (state.playing || Date.now() - t0 > HUB_HASH_MS) break;
    if (s.demo || s.source === 'yt' || !s.blob || !s.blob.size || s.blob.size > HUB_HASH_MAX) continue;
    if (s.mrHash && s.mrHashSize === s.blob.size) continue;
    try {
      const blob = s.blob, key = mrHashKey(hexOf(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())));
      if (!key || s.blob !== blob) continue;
      s.mrHash = key; s.mrHashSize = blob.size;
      await persistSong(s, false, true);
    } catch {}
  }
}

/* ---------------- 허브 사본 (IndexedDB cache 'hub-songs') ---------------- */
async function hubLoadMirror() {
  if (Hub.mirror) return Hub.mirror;
  let m = null;
  try { m = await DB.get('cache', HUB_MIRROR_ID); } catch {}
  Hub.mirror = m && m.songs ? { cursor: +m.cursor || 0, songs: m.songs } : { cursor: 0, songs: {} };
  return Hub.mirror;
}
async function hubSaveMirror() {
  if (!Hub.mirror) return;
  try { await DB.put('cache', { id: HUB_MIRROR_ID, cursor: Hub.mirror.cursor, songs: Hub.mirror.songs }); } catch {}
}

/* ---------------- 곡 설정을 고쳤을 때 (songs.js·syncedit.js·key.js·bulk.js·autosync.js가 부름) ---------------- */
// 설정 고친 시각을 남기고 3초 뒤 맞추기. 허브를 안 쓰면 아무것도 안 함. 저장(persistSong)은 부른 쪽이 한다
function hubTouch(s) {
  if (!hubOn() || !s || s.demo) return;
  // 내용이 없는 곡은 맞춘 적이 있을 때만 (지운 것도 고친 것). 처음 넣은 빈 곡이 허브 값을 덮지 않게
  if (!settingsHas(settingsOf(s)) && !s.hubK) return;
  s.settingsAt = Date.now();
  const k = songSettingsKey(s);
  if (k) { Hub.out = hubQueueAdd(Hub.out, k, s.settingsAt); hubSaveOut(); }
  hubSoon(HUB_EDIT_MS);
  if ($('#cloudDialog')?.open) hubRender();
}
// 곡을 지웠을 때: 허브와 맞춘 곡이면 "지움 표시"를 보낼 줄에 (이 기기에 같은 MR 곡이 남아 있으면 안 보냄)
function hubForget(s) {
  if (!hubOn() || !s || s.demo || !s.hubK) return;
  Hub.out = hubQueueAdd(Hub.out, s.hubK, Date.now(), true); hubSaveOut();
  hubSoon(HUB_EDIT_MS);
}
// MR 파일을 바꿨을 때: 해시를 다시 계산하게. 옛 설정은 새 열쇠로 한 번 보낸다 (hubPlan: 다른 열쇠로 맞춘 곡 + 고친 시각)
function hubFileChanged(s) {
  if (!s) return;
  delete s.mrHash; delete s.mrHashSize;
}

/* ---------------- 맞추기 ---------------- */
function hubSoon(ms = HUB_EDIT_MS) {
  if (!hubOn()) return;
  clearTimeout(Hub.timer); Hub.timer = setTimeout(() => hubSync(), ms);
}
function hubStartTimers() {
  if (Hub.every || !hubOn()) return;
  Hub.every = setInterval(() => { if (document.visibilityState === 'visible') hubSync(); }, HUB_EVERY_MS);
}
// 이 곡을 지금 바꾸면 안 되나: 부르는 중·싱크 편집 중·곡 수정 창에서 고치는 중 (다음에 열 때 넣는다)
function hubBusy(s) {
  if (state.song === s && (state.playing || state.sync)) return true;
  return typeof editing !== 'undefined' && editing === s && !!$('#songDialog')?.open;
}
const hubLocal = (s, k) => {
  const x = settingsOf(s);
  return { k, sig: settingsSig(x), has: settingsHas(x), syncK: s.hubK, syncSig: s.hubSig, settingsAt: s.settingsAt, updatedAt: s.updatedAt, createdAt: s.createdAt, rej: s.hubRej };
};
// 열쇠 → 그 열쇠의 이 기기 곡들 (같은 MR을 두 번 넣었으면 둘 다)
function hubGroups() {
  const g = new Map();
  for (const s of state.songs) { const k = songSettingsKey(s); if (k) { if (!g.has(k)) g.set(k, []); g.get(k).push(s); } }
  return g;
}
// 한 열쇠의 대표 곡: 설정을 가장 늦게 고친 곡
const hubPick = list => list.reduce((a, b) => ((b.settingsAt || 0) > (a.settingsAt || 0) ? b : a));
async function hubMark(s, k, r) {
  if (s.hubK === k && s.hubSig === r.sig && s.hubAt === r.at) return;
  s.hubK = k; s.hubSig = r.sig; s.hubAt = r.at;
  await persistSong(s, false, true);
}
// 허브 값을 곡에 넣는다. 가사·가사 타이밍이 바뀌면 Drive에도 (곡 고친 시각을 남김)
async function hubApply(s, k, r) {
  const x = r.x, textChanged = (s.lyrics || '') !== x.lrc || (+s.lyricOffset || 0) !== x.offset;
  const keyChanged = (s.baseKey | 0) !== x.key;
  s.lyrics = x.lrc; s.lyricOffset = x.offset; s.baseKey = x.key;
  if (x.chk) s.syncChk = 1; else delete s.syncChk;
  s.hubK = k; s.hubSig = r.sig; s.hubAt = r.at; s.settingsAt = r.at; delete s.hubRej;
  await persistSong(s, textChanged, true);
  if (state.song === s) {
    computeLines(); updateLyrOffUI();
    if (keyChanged && s.buffer && !state.sync) setKey(keyOf(s), { save: false });
    if (typeof syncLineShow === 'function') syncLineShow('loaded', s);
  }
}
const hubErr = e => Object.assign(new Error('hub'), { code: e && e.code, status: e && e.status });

async function hubSync({ force = false } = {}) {
  if (!hubOn()) return;
  if (Hub.busy) { Hub.again = true; return; }
  if (!force && Date.now() < Hub.failUntil) return;
  if (!navigator.onLine) { hubSetState('offline'); return; }
  const sb = hubClient(); if (!sb) { hubSetState('err'); return; }
  Hub.busy = true; Hub.again = false;
  try {
    if (Hub.needClear) { Hub.needClear = false; await hubClearMarks(); }
    const session = await hubSession();
    if (!session) { hubSetState('login'); return; }
    if (Hub.state !== 'ok') hubSetState('syncing');
    await hubHashSongs();
    await hubLoadMirror();
    const snap = new Map(Hub.out.map(x => [x.k, x.at]));
    // 1) 보내기: 이 기기에서 나중에 고친 곡 (허브 사본과 견줌), 그리고 지움 표시
    let groups = hubGroups();
    const recs = [], sent = new Map();
    for (const [k, list] of groups) {
      const s = hubPick(list), plan = hubPlan(hubLocal(s, k), hubRemote(Hub.mirror.songs[k]));
      if (plan.act !== 'push') continue;
      const d = songSettingsData(s);
      if (d.big) { for (const x of list) { if (x.hubRej !== d.sig) { x.hubRej = d.sig; await persistSong(x, false, true); } } continue; }
      recs.push(hubRecord(s, plan.at)); sent.set(k, { list, sig: d.sig });
    }
    for (const q of Hub.out) {
      if (!q.del || groups.has(q.k) || !(q.at > 0)) continue;
      recs.push({ id: q.k, createdAt: q.at, updatedAt: q.at, deletedAt: q.at, data: {} });
    }
    for (let i = 0; i < recs.length; i += HUB_PUSH_MAX) {
      const { data, error } = await sb.rpc('hub_push', { p_scope: HUB_SCOPE, p_collection: HUB_COLL, p_app: HUB_APP, p_records: recs.slice(i, i + HUB_PUSH_MAX) });
      if (error) throw hubErr(error);
      for (const rj of (data && Array.isArray(data.rejected) ? data.rejected : [])) {
        const it = sent.get(rj && rj.id); if (!it) continue;
        for (const x of it.list) { x.hubRej = it.sig; await persistSong(x, false, true); }
      }
    }
    // 2) 받기: 받기 위치(seq) 뒤로 500줄씩
    for (let n = 0; n < 200; n++) {
      const { data, error } = await sb.rpc('hub_pull', { p_scope: HUB_SCOPE, p_collection: HUB_COLL, p_after: Hub.mirror.cursor || 0, p_limit: HUB_PULL_MAX });
      if (error) throw hubErr(error);
      const rows = Array.isArray(data) ? data : [];
      Hub.mirror = hubMirrorAdd(Hub.mirror, rows);
      if (rows.length < HUB_PULL_MAX) break;
    }
    await hubSaveMirror();
    // 3) 넣기: 허브 것이 나중이거나 이 기기가 처음 맞추는 곡. 같은 열쇠의 곡 모두. 부르는 중인 곡은 다음에
    groups = hubGroups();
    for (const [k, list] of groups) {
      const r = hubRemote(Hub.mirror.songs[k]); if (!r || r.del) continue;
      const plan = hubPlan(hubLocal(hubPick(list), k), r);
      if (plan.act !== 'same' && plan.act !== 'pull') continue;
      for (const s of list) {
        if (!state.songs.includes(s)) continue;
        if (settingsSig(settingsOf(s)) === r.sig) await hubMark(s, k, r);
        else if (!hubBusy(s)) await hubApply(s, k, r);
      }
    }
    Hub.out = Hub.out.filter(x => snap.get(x.k) !== x.at); hubSaveOut();
    Hub.lastAt = Date.now(); Hub.failUntil = 0;
    hubSetState('ok');
    if (Hub.ytKey === undefined) hubYoutubeKey();     // 로그인한 뒤 한 번 (기다리지 않음)
  } catch (e) {
    const auth = e && (e.code === '28000' || e.status === 401 || e.code === 'PGRST301');
    Hub.failUntil = Date.now() + HUB_BACKOFF_MS;
    hubSetState(!navigator.onLine ? 'offline' : auth ? 'login' : 'err');
  } finally {
    Hub.busy = false;
    if (Hub.again && Hub.state === 'ok') hubSoon(500);
  }
}

/* ---------------- YouTube 검색 열쇠 읽기 (쓰는 법 4장, 허브 0008의 열쇠 칸) ----------------
   열쇠는 메모리(Hub.ytKey)에만 둔다: localStorage·IndexedDB·Drive·백업 파일·화면·콘솔에 0. 넣기(hub_secret_set)는 이번에 안 만든다.
   유튜브 모드(yt.js, CR-030)가 있으면 ytSetKey로 "열쇠를 돌려주는 함수"를 넘긴다 → 로그아웃·끊기 뒤에는 저절로 없음. */
async function hubYoutubeKey() {
  if (!hubOn()) return null;
  if (Hub.ytKey !== undefined) return Hub.ytKey;
  const sb = hubClient(); if (!sb) return null;
  let res = null;
  try { res = await sb.rpc('hub_secret', { p_app: HUB_APP, p_name: 'youtube_key' }); } catch { return null; }   // 못 닿음: 다음 맞추기 때 다시
  const { data, error } = res || {};
  if (error) {
    // 0008 전(함수 없음)이면 "없음"으로 두고, 로그인·인터넷 문제면 다음에 다시
    if (error.code === '42883' || error.code === 'PGRST202') Hub.ytKey = null;
    return null;
  }
  const v = typeof data === 'string' ? data.trim() : '';
  Hub.ytKey = v && v.length <= 512 && !/\s/.test(v) ? v : null;     // 한 줄짜리 열쇠만
  if (typeof ytSetKey === 'function') { try { ytSetKey(Hub.ytKey ? () => Hub.ytKey : null); } catch {} }
  return Hub.ytKey;
}
function hubForgetYtKey() {
  const had = Hub.ytKey !== undefined && Hub.ytKey !== null;
  Hub.ytKey = undefined;
  if (had && typeof ytSetKey === 'function') { try { ytSetKey(null); } catch {} }
}

/* ---------------- 로그인·로그아웃·연결 끊기 (W1) ---------------- */
async function hubLogin(email, password) {
  const sb = hubClient(); if (!sb) { hubMsg('허브에 못 닿았어요 · 새로고침한 뒤 다시 해 주세요', true); return false; }
  if (!email || !password) { hubMsg('메일과 비밀번호를 넣어 주세요', true); return false; }
  if (!navigator.onLine) { hubMsg('인터넷이 없어요. 연결되면 다시 해 주세요', true); return false; }
  hubMsg('로그인 중…');
  let res = null;
  try { res = await sb.auth.signInWithPassword({ email, password }); } catch { res = null; }
  const session = res && !res.error && res.data && res.data.session;
  if (!session) { hubMsg('로그인 못 했어요. 메일과 비밀번호를 봐 주세요', true); hubSetState('login'); return false; }
  const tag = await hubTag(session.user && session.user.id), owner = lsGet(HUB_OWNER);
  if (owner && owner !== tag) {
    try { await sb.auth.signOut({ scope: 'local' }); } catch {}
    hubMsg('처음 연결한 계정과 달라요 · [연결 끊기] 뒤 다시 해 주세요', true); hubSetState('login');
    return false;
  }
  if (!owner) lsSet(HUB_OWNER, tag);
  hubMsg('로그인했어요. 곡 설정을 맞추는 중…');
  Hub.failUntil = 0; hubStartTimers();
  await hubSync({ force: true });
  hubMsg(Hub.state === 'ok' ? '로그인했어요' : '로그인했어요 · 허브에 아직 못 닿았어요', Hub.state !== 'ok');
  return true;
}
async function hubLogout() {
  const sb = hubClient();
  if (sb) { try { await sb.auth.signOut({ scope: 'local' }); } catch {} }
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(HUB_AUTH)) lsSet(k, null); } catch {}   // 서버에 못 닿아도 이 기기 세션은 지움
  hubForgetYtKey();
  hubSetState('login'); hubMsg('로그아웃했어요 · 곡과 가사는 이 기기에 그대로예요');
}
async function hubDisconnect() {
  const sb = Hub.sb;
  if (sb) { try { await sb.auth.signOut({ scope: 'local' }); } catch {} }
  hubDropClient(); clearTimeout(Hub.timer); clearInterval(Hub.every); Hub.every = 0;
  hubWipeLocal(); hubForgetYtKey(); Hub.needClear = false;
  Hub.conf = null; Hub.out = []; Hub.mirror = null; Hub.lastAt = 0; Hub.failUntil = 0;
  try { await DB.del('cache', HUB_MIRROR_ID); } catch {}
  await hubClearMarks();
  hubSetState('off'); hubMsg('연결을 끊었어요 · 곡과 가사는 이 기기에 그대로예요');
}

/* ---------------- 설정 창 › 허브 연결 ---------------- */
function hubSetState(st) { Hub.state = st; if ($('#cloudDialog')?.open) hubRender(); }
function hubMsg(text, err = false) {
  const m = $('#hubMsg'); if (!m) return;
  m.textContent = text || ''; m.hidden = !text; m.classList.toggle('err', !!err);
}
// 이 기기 곡 중 허브와 맞춘 곡 · 못 보낸 곡 수
function hubCounts() {
  let synced = 0, rejected = 0;
  for (const [k, list] of hubGroups()) {
    const s = hubPick(list), sig = settingsSig(settingsOf(s));
    if (s.hubK === k && s.hubSig === sig) synced++;
    else if (s.hubRej && s.hubRej === sig) rejected++;
  }
  return { synced, rejected };
}
async function hubRender() {
  const st = $('#hubState'); if (!st) return;
  const on = hubOn(), session = on ? await hubSession() : null;
  const out = Hub.out.length, { synced, rejected } = on ? hubCounts() : { synced: 0, rejected: 0 };
  const hm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const parts = [];
  if (!on) parts.push('연결 안 됨 · 허브 없이도 지금처럼 다 돼요');
  else if (!session) parts.push('허브 코드 저장됨 · 로그인해 주세요');
  else if (Hub.state === 'offline' || !navigator.onLine) parts.push('인터넷이 없어요 · 연결되면 보내요');
  else if (Hub.state === 'err') parts.push('허브에 못 닿았어요 · 5분 뒤 다시 해 볼게요');
  else if (Hub.state === 'syncing') parts.push('로그인됨 · 맞추는 중…');
  else parts.push(`로그인됨 · 곡 설정 ${synced}곡 맞춤` + (Hub.lastAt ? ` · 마지막 ${hm(Hub.lastAt)}` : ''));
  if (on && out) parts.push(`보낼 곡 ${out}개`);
  if (on && rejected) parts.push(`못 보낸 곡 ${rejected}개 (가사가 너무 길어요)`);
  st.textContent = parts.join(' · ');
  $('#hubCodeRow').hidden = on;
  $('#hubLogin').hidden = !on || !!session;
  $('#hubBtns').hidden = !on;
  $('#hubSyncNow').hidden = !session; $('#hubLogout').hidden = !session;
  if (!Hub.forgetArm) $('#hubForget').textContent = '연결 끊기';
}
function hubCodeSave() {
  const i = $('#hubCode'), r = hubCodeParse(i.value);
  i.value = '';      // 넣은 값은 칸에 남기지 않는다 (맞든 틀리든)
  if (!r.ok) { hubMsg('이 값은 못 써요', true); return; }
  hubSaveConf(r.u, r.k).then(() => { hubMsg('허브 코드를 저장했어요 · 로그인해 주세요'); hubRender(); });
}
{
  const on = (sel, ev, fn) => $(sel)?.addEventListener(ev, fn);
  on('#hubCodeSave', 'click', hubCodeSave);
  on('#hubCode', 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); hubCodeSave(); } });
  on('#hubLogin', 'submit', async e => {
    e.preventDefault();
    const em = $('#hubEmail'), pw = $('#hubPw'), btn = $('#hubLoginBtn');
    const email = em.value.trim(), password = pw.value;
    pw.value = '';     // 비밀번호는 칸에도 남기지 않는다 (저장도 안 함)
    btn.disabled = true;
    try { if (await hubLogin(email, password)) em.value = ''; } finally { btn.disabled = false; hubRender(); }
  });
  on('#hubSyncNow', 'click', async () => { hubMsg(''); await hubSync({ force: true }); hubRender(); });
  on('#hubLogout', 'click', async () => { await hubLogout(); hubRender(); });
  on('#hubForget', 'click', async () => {
    const b = $('#hubForget');
    if (!Hub.forgetArm) {     // 두 번 눌러야 끊긴다
      b.textContent = '한 번 더 누르면 끊어요';
      Hub.forgetArm = setTimeout(() => { Hub.forgetArm = 0; b.textContent = '연결 끊기'; }, 4000);
      return;
    }
    clearTimeout(Hub.forgetArm); Hub.forgetArm = 0;
    await hubDisconnect(); hubRender();
  });
  on('#cloudDialog', 'close', () => { hubMsg(''); const p = $('#hubPw'); if (p) p.value = ''; const c = $('#hubCode'); if (c) c.value = ''; });
  // 설정 창을 열 때마다 상태를 다시 그린다 (openCloudDialog는 cloud.js. 그 창의 [설정] 단추 둘을 고치지 않고 열림을 지켜본다)
  const dlg = $('#cloudDialog');
  if (dlg) new MutationObserver(() => { if (dlg.open) hubRender(); }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
}

/* ---------------- 켤 때 (main.js가 부름) ---------------- */
function hubInit() {
  if (Hub.fromHash === 'ok') toast('허브 코드를 저장했어요 · 설정 › 허브 연결에서 로그인해 주세요', 5000);
  else if (Hub.fromHash === 'bad') toast('이 값은 못 써요', 4000);
  Hub.fromHash = '';
  if (!hubOn()) return;      // 허브를 안 쓰면 여기서 끝 (요청·타이머 0)
  hubStartTimers();
  hubSoon(1500);
}
// 앞으로 올 때·인터넷이 돌아올 때 (허브를 안 쓰면 아무것도 안 함)
document.addEventListener('visibilitychange', () => { if (hubOn() && document.visibilityState === 'visible') hubSoon(500); });
addEventListener('online', () => { if (hubOn()) { Hub.failUntil = 0; hubSoon(500); } });
addEventListener('offline', () => { if (hubOn()) hubSetState('offline'); });
