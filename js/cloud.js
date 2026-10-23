// YT 노래방 · 기기 저장(오프라인)과 Google Drive 동기화
'use strict';

/* ================= 기기 저장 (오프라인) ================= */
const onDevice = s => s.demo || !!s.blob;
// IndexedDB에 넣을 모양: 재생용으로만 쓰는 값(디코딩된 소리 등)은 빼고 저장
function songRecord(s) { const { buffer, guide, _loading, _dl, ...rest } = s; return { ...rest, blob: s.blob || null }; }
function songStatus(s) {
  if (s.demo) return null;
  if (s._dl != null) return { cls: 'cloud', text: `받는 중 ${Math.round(s._dl * 100)}%` };
  if (!s.blob && s.fileId) return { cls: 'cloud', text: '☁ Drive' };
  if (Cloud.connected && s.blob && (!s.fileId || s.mediaDirty)) return { cls: '', text: '올릴 예정' };
  return null;
}
async function ensureMedia(s) {
  if (s.demo || s.blob) return;
  if (!s.fileId) throw Object.assign(new Error('nomedia'), { nomedia: true });
  if (!navigator.onLine) throw Object.assign(new Error('offline'), { offline: true });
  s._dl = 0; renderSongs();
  try {
    s.blob = await Cloud.api.download(s.fileId, p => {
      s._dl = p; const tg = document.querySelector(`[data-dl="${s.id}"]`); if (tg) tg.textContent = `받는 중 ${Math.round(p * 100)}%`;
    });
    s.mime ||= s.blob.type;
    await DB.put('songs', songRecord(s));
    requestPersist();
  } finally { s._dl = null; renderSongs(); }
}
function mediaErrText(e) {
  if (e.offline) return '인터넷이 연결되면 받을 수 있어요. 지금은 기기에 저장된 곡만 부를 수 있어요';
  if (e.needLogin) return 'Drive에서 받으려면 위쪽 Drive 버튼을 눌러 다시 연결해 주세요';
  if (e.nomedia) return '이 곡의 MR 파일이 없어요. 곡 수정에서 파일을 다시 넣어 주세요';
  if (e.status) return `Drive에서 받지 못했어요 (${e.status})`;
  return 'MR 파일을 읽지 못했어요. mp3·m4a·wav 파일인지 확인해 주세요.';
}
async function requestPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}
async function renderStorage() {
  let usage = 0, quota = 0, persisted = false;
  try { ({ usage, quota } = await navigator.storage.estimate()); persisted = await navigator.storage.persisted(); } catch {}
  const local = state.songs.filter(s => !s.demo && s.blob).length, cloudOnly = state.songs.filter(s => !s.demo && !s.blob && s.fileId).length;
  $('#storeTxt').textContent = `${fmtBytes(usage)} 사용 중` + (quota ? ` · 남은 공간 약 ${fmtBytes(quota - usage)}` : '');
  $('#storeBar').style.width = quota ? Math.max(1, Math.min(100, usage / quota * 100)) + '%' : '0';
  $('#storeCounts').textContent = `기기에 저장된 곡 ${local}곡` + (cloudOnly ? ` · Drive에만 있는 곡 ${cloudOnly}곡` : '');
  $('#persistTxt').textContent = persisted ? '영구 저장 켜짐: 저장 공간이 부족해도 브라우저가 곡을 함부로 지우지 않아요'
    : '영구 저장 꺼짐: 저장 공간이 부족하면 브라우저가 곡을 지울 수도 있어요';
  $('#persistBtn').hidden = persisted;
  if (!dlAllRunning) { $('#dlAllBtn').disabled = !cloudOnly; $('#dlAllBtn').textContent = cloudOnly ? `Drive에만 있는 ${cloudOnly}곡 모두 받기` : '모든 곡이 기기에 있어요'; }
}
let dlAllRunning = false;
$('#dlAllBtn').onclick = async () => {
  const b = $('#dlAllBtn'), list = state.songs.filter(s => !s.demo && !s.blob && s.fileId);
  dlAllRunning = true; b.disabled = true;
  try {
    for (let i = 0; i < list.length; i++) {
      b.textContent = `받는 중 ${i + 1} / ${list.length}`;
      try { await ensureMedia(list[i]); } catch (e) { toast(mediaErrText(e), 5000); break; }
    }
  } finally { dlAllRunning = false; renderStorage(); }
};
$('#persistBtn').onclick = async () => { await requestPersist(); renderStorage(); };

/* ================= Google Drive 곡 창고 ================= */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

const Cloud = {
  clientId: lsGet('nb-gclient') || '',
  connected: lsGet('nb-gconnected') === '1',
  folderId: lsGet('nb-gfolder'), libId: lsGet('nb-glib'),
  lastSync: +(lsGet('nb-glast') || 0),
  token: null, exp: 0, state: 'off', msg: '', syncing: false, again: false, timer: null, gis: null,
  api: null,
  schedule(delay = 4000) {
    if (!this.connected) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => syncNow(), delay);
  },
};
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (Cloud.gis) return Cloud.gis;
  Cloud.gis = new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
    sc.onload = res; sc.onerror = () => { Cloud.gis = null; rej(new Error('gis')); };
    document.head.append(sc);
  });
  return Cloud.gis;
}
// 로그인 팝업은 클릭 직후에 열어야 막히지 않아서, 이 함수는 await 없이 바로 요청한다
function getToken(interactive) {
  if (Cloud.token && Date.now() < Cloud.exp - 60000) return Promise.resolve(Cloud.token);
  if (Cloud.api !== DriveApi) return Promise.resolve('test');
  if (!interactive) return Promise.reject(Object.assign(new Error('login'), { needLogin: true }));
  if (!Cloud.clientId) return Promise.reject(Object.assign(new Error('noclient'), { noClient: true }));
  if (!window.google?.accounts?.oauth2) { loadGis().catch(() => {}); return Promise.reject(Object.assign(new Error('gis'), { gisLoading: true })); }
  return new Promise((res, rej) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: Cloud.clientId, scope: DRIVE_SCOPE,
      callback: r => {
        if (r.error) return rej(Object.assign(new Error(r.error), { needLogin: true }));
        Cloud.token = r.access_token; Cloud.exp = Date.now() + (r.expires_in || 3600) * 1000; res(Cloud.token);
      },
      error_callback: e => rej(Object.assign(new Error(e?.type || 'popup'), { needLogin: true, popup: true })),
    });
    tc.requestAccessToken({ prompt: Cloud.connected ? '' : 'consent' });
  });
}
const DriveApi = {
  async req(method, url, { body, headers = {}, raw } = {}) {
    const t = await getToken(false);
    const res = await fetch(url, { method, body, headers: { Authorization: 'Bearer ' + t, ...headers } });
    if (res.status === 401) { Cloud.token = null; throw Object.assign(new Error('401'), { needLogin: true }); }
    if (!res.ok) throw Object.assign(new Error('drive ' + res.status), { status: res.status });
    if (raw) return res;
    return res.status === 204 ? null : res.json();
  },
  async findOrCreateFolder() {
    const q = encodeURIComponent("name='YT 노래방' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const r = await this.req('GET', `${DRIVE}/files?q=${q}&fields=files(id)&spaces=drive`);
    if (r.files.length) return r.files[0].id;
    return (await this.req('POST', `${DRIVE}/files?fields=id`, {
      body: JSON.stringify({ name: 'YT 노래방', mimeType: 'application/vnd.google-apps.folder' }), headers: { 'Content-Type': 'application/json' },
    })).id;
  },
  async findLibrary(folderId) {
    const q = encodeURIComponent(`name='library.json' and '${folderId}' in parents and trashed=false`);
    return (await this.req('GET', `${DRIVE}/files?q=${q}&fields=files(id)`)).files[0]?.id || null;
  },
  async readJson(id) { return (await this.req('GET', `${DRIVE}/files/${id}?alt=media`, { raw: true })).json(); },
  async createJson(folderId, name, obj) {
    const b = 'nb' + Math.random().toString(36).slice(2);
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId], mimeType: 'application/json' })}\r\n`
      + `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(obj)}\r\n--${b}--`;
    return (await this.req('POST', `${UPLOAD}/files?uploadType=multipart&fields=id`, { body, headers: { 'Content-Type': `multipart/related; boundary=${b}` } })).id;
  },
  async updateJson(id, obj) {
    await this.req('PATCH', `${UPLOAD}/files/${id}?uploadType=media&fields=id`, { body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json; charset=UTF-8' } });
  },
  async upload(folderId, name, blob, onProgress) {
    const type = blob.type || 'application/octet-stream';
    const init = await this.req('POST', `${UPLOAD}/files?uploadType=resumable&fields=id`, {
      body: JSON.stringify({ name, parents: [folderId], mimeType: type }),
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type }, raw: true,
    });
    const loc = init.headers.get('Location');
    if (!loc) throw new Error('업로드 주소를 받지 못했어요');
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest(); x.open('PUT', loc);
      x.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => x.status < 300 ? res(JSON.parse(x.responseText).id) : rej(Object.assign(new Error('upload ' + x.status), { status: x.status }));
      x.onerror = () => rej(new Error('업로드 중 연결이 끊겼어요'));
      x.send(blob);
    });
  },
  async download(id, onProgress) {
    const t = await getToken(false);
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest(); x.open('GET', `${DRIVE}/files/${id}?alt=media`); x.responseType = 'blob';
      x.setRequestHeader('Authorization', 'Bearer ' + t);
      x.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => {
        if (x.status === 401) { Cloud.token = null; return rej(Object.assign(new Error('401'), { needLogin: true })); }
        x.status < 300 ? res(x.response) : rej(Object.assign(new Error('download ' + x.status), { status: x.status }));
      };
      x.onerror = () => rej(Object.assign(new Error('offline'), { offline: !navigator.onLine }));
      x.send();
    });
  },
  async trash(id) {
    await this.req('PATCH', `${DRIVE}/files/${id}`, { body: JSON.stringify({ trashed: true }), headers: { 'Content-Type': 'application/json' } });
  },
};
Cloud.api = DriveApi;

const EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/webm': 'webm', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
function mediaName(s) {
  const ext = (s.blob?.name?.match(/\.([a-z0-9]{2,5})$/i)?.[1]) || EXT[s.blob?.type] || 'bin';
  return `${s.no} ${s.title}${s.artist ? ' - ' + s.artist : ''}.${ext}`.replace(/[\\/:*?"<>|]/g, '_');
}
function cloudErrText(e) {
  if (e.offline || !navigator.onLine) return '인터넷이 끊겨 있어요. 연결되면 다시 동기화해요';
  if (e.noClient) return '설정에서 Google 클라이언트 ID를 먼저 넣어 주세요';
  if (e.gisLoading) return 'Google 로그인 도구를 불러오는 중이에요. 잠시 후 다시 눌러 주세요';
  if (e.popup) return '로그인 창이 닫혔거나 막혔어요. 팝업을 허용하고 다시 눌러 주세요';
  if (e.needLogin) return 'Google 로그인이 필요해요. Drive 버튼을 눌러 다시 연결하세요';
  if (e.status === 403) return 'Drive 권한이 없어요 (403). 앱 등록에서 Drive API를 켰는지 확인하세요';
  return '동기화하지 못했어요: ' + (e.message || e);
}
function setCloud(st, msg = '') { Cloud.state = st; Cloud.msg = msg; renderCloudChip(); if ($('#cloudDialog').open) renderCloudPanel(); }
function renderCloudChip() {
  const b = $('#cloudBtn'), on = Cloud.connected;
  const cls = !on ? '' : !navigator.onLine ? 'off' : { ok: 'ok', syncing: 'syncing', login: 'warn', error: 'warn' }[Cloud.state] || '';
  b.className = 'btn cloud-chip ' + cls;
  $('#cloudTxt').textContent = !on ? 'Drive 연결'
    : !navigator.onLine ? '오프라인'
    : Cloud.state === 'syncing' ? (Cloud.msg || '동기화 중…')
    : Cloud.state === 'login' ? 'Drive 다시 연결'
    : Cloud.state === 'error' ? '동기화 실패'
    : Cloud.lastSync ? `동기화 ${ago(Cloud.lastSync)}` : 'Drive 동기화';
  b.title = Cloud.msg || 'Google Drive와 곡 목록 맞추기';
}
function renderCloudPanel() {
  $('#gClientId').value = $('#gClientId').value || Cloud.clientId;
  $('#gConnect').textContent = Cloud.connected ? '지금 동기화' : 'Google 계정 연결';
  $('#gDisconnect').hidden = !Cloud.connected;
  const st = $('#cloudStatus');
  st.textContent = !Cloud.clientId ? '아직 설정 전이에요. 아래 방법대로 클라이언트 ID를 만들어 넣어 주세요.'
    : !Cloud.connected ? '클라이언트 ID가 있어요. "Google 계정 연결"을 누르세요.'
    : Cloud.msg ? Cloud.msg
    : Cloud.lastSync ? `연결됨 · 마지막 동기화 ${ago(Cloud.lastSync)}` : '연결됨';
  st.classList.toggle('err', Cloud.state === 'error' || Cloud.state === 'login');
}
function openCloudDialog() { $('#gClientId').value = Cloud.clientId; renderCloudPanel(); renderStorage(); $('#cloudDialog').showModal(); }
$('#settingsBtn').onclick = openCloudDialog;
$('#cloudClose').onclick = () => $('#cloudDialog').close();
$('#cloudBtn').onclick = () => { if (!Cloud.connected || !Cloud.clientId) openCloudDialog(); else syncNow({ interactive: true }); };
$('#gClientSave').onclick = () => {
  const v = $('#gClientId').value.trim();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(v)) { setCloud(Cloud.state, '클라이언트 ID는 "….apps.googleusercontent.com"으로 끝나요. 다시 복사해 주세요'); return; }
  Cloud.clientId = v; lsSet('nb-gclient', v); loadGis().catch(() => {});
  setCloud(Cloud.state, '저장했어요. 이제 "Google 계정 연결"을 누르세요');
};
$('#gConnect').onclick = () => {
  if (!Cloud.clientId) { setCloud('error', '클라이언트 ID를 먼저 저장해 주세요'); return; }
  syncNow({ interactive: true, connect: true });
};
$('#gDisconnect').onclick = e => confirmButton(e.currentTarget, () => {
  try { if (Cloud.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(Cloud.token, () => {}); } catch {}
  Object.assign(Cloud, { connected: false, token: null, exp: 0, folderId: null, libId: null, lastSync: 0 });
  for (const k of ['nb-gconnected', 'nb-gfolder', 'nb-glib', 'nb-glast']) lsSet(k, null);
  setCloud('off'); renderSongs();
  toast('Drive 연결을 끊었어요. 기기에 있는 곡은 그대로 남아요');
});

/* 동기화: Drive의 library.json과 이 기기의 곡·사용자 목록을 합친다 (더 나중에 바뀐 쪽이 이김) */
async function syncNow({ interactive = false, connect = false } = {}) {
  if (!Cloud.connected && !connect) return;
  if (Cloud.syncing) { Cloud.again = true; return; }
  if (!navigator.onLine) { setCloud('offline'); return; }
  const tokenP = getToken(interactive);   // 팝업이 필요하면 지금 바로 열린다
  Cloud.syncing = true; setCloud('syncing', '동기화 중…');
  const api = Cloud.api, touched = new Set();
  try {
    await tokenP;
    if (connect && !Cloud.connected) { Cloud.connected = true; lsSet('nb-gconnected', '1'); }
    if (!Cloud.folderId) { Cloud.folderId = await api.findOrCreateFolder(); lsSet('nb-gfolder', Cloud.folderId); }
    if (!Cloud.libId) { Cloud.libId = await api.findLibrary(Cloud.folderId); lsSet('nb-glib', Cloud.libId); }
    let remote = null;
    if (Cloud.libId) { try { remote = await api.readJson(Cloud.libId); } catch (e) { if (e.status !== 404) throw e; Cloud.libId = null; } }
    if (!remote || !Array.isArray(remote.songs)) remote = { version: 1, songs: [], profiles: [] };
    const before = librarySig(remote);

    // 1) Drive → 기기 (합치기 규칙: core.js의 mergeRemoteInto)
    const demo = state.songs.filter(s => s.demo);
    const m = mergeRemoteInto(state.songs.filter(s => !s.demo), state.tombs, remote.songs, SONG_FIELDS, { mediaKey: 'blob' });
    state.songs = [...demo, ...m.live]; state.tombs = m.tombs;
    for (const id of m.touched) touched.add(id);
    // Drive에 새 MR이 올라온 곡: 예전 파일로 만든 소리·키·녹음 믹스를 버린다
    for (const id of m.mediaChanged) {
      const l = songById(id); if (l) { l.buffer = null; l.keyCache = null; }
      for (const r of state.recs) if (r.songId === id) recCache.delete(r.id);
    }
    // 2) 이 기기에서 넣거나 바꾼 MR 올리기
    for (const s of state.songs) {
      if (s.demo || !s.blob || (s.fileId && !s.mediaDirty)) continue;
      setCloud('syncing', `올리는 중 · ${s.title}`);
      const id = await api.upload(Cloud.folderId, mediaName(s), s.blob, p => setCloud('syncing', `올리는 중 · ${s.title} ${Math.round(p * 100)}%`));
      if (s.fileId && s.fileId !== id) api.trash(s.fileId).catch(() => {});
      Object.assign(s, { fileId: id, mime: s.blob.type, size: s.blob.size, mediaDirty: false, updatedAt: Date.now() });
      touched.add(s.id);
    }
    // 3) 지운 곡의 Drive 파일은 휴지통으로
    for (const t of state.tombs) if (t.fileId && !t.trashed) { await api.trash(t.fileId).catch(() => {}); t.trashed = true; touched.add(t.id); }
    // 4-0) 녹음: Drive에 있는 녹음 목록과 합치고, 백업을 켰으면 이 기기 녹음을 올린다
    const rm = mergeRemoteInto(state.recs, state.recTombs, remote.recs, REC_FIELDS, { createdAtFallback: true });
    state.recs = rm.live; state.recTombs = rm.tombs;
    const recTouched = new Set(rm.touched);
    for (const id of recTouched) recCache.delete(id);
    if (lsGet('nb-recbackup') === '1') for (const r of state.recs) {
      const m = recMedia(r); if (!m || r.fileId) continue;
      setCloud('syncing', `녹음 올리는 중 · ${r.title}`);
      const d = new Date(r.createdAt), p2 = n => String(n).padStart(2, '0');
      const name = `녹음 ${r.title} ${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.${r.v === 2 ? 'pcm' : 'webm'}`.replace(/[\\/:*?"<>|]/g, '_');
      r.fileId = await api.upload(Cloud.folderId, name, m, p => setCloud('syncing', `녹음 올리는 중 · ${r.title} ${Math.round(p * 100)}%`));
      r.updatedAt = Date.now(); recTouched.add(r.id);
    }
    for (const t of state.recTombs) if (t.fileId && !t.trashed) { await api.trash(t.fileId).catch(() => {}); t.trashed = true; recTouched.add(t.id); }
    // 4) 사용자 · 좋아요 · 재생목록
    mergeProfiles(remote.profiles || []);
    // 5) 두 기기에서 동시에 같은 번호를 쓴 경우 나중 곡 번호를 바꾼다
    for (const id of renumberDuplicates(state.songs)) touched.add(id);
    // 6) library.json 쓰기
    const cutoff = Date.now() - 90 * 864e5;
    state.tombs = state.tombs.filter(t => (t.updatedAt || 0) > cutoff);
    state.recTombs = state.recTombs.filter(t => (t.updatedAt || 0) > cutoff);
    const lib = buildLibrary({ songs: state.songs, tombs: state.tombs, profiles: Profiles.list, recs: state.recs, recTombs: state.recTombs });
    if (librarySig(lib) !== before) {
      setCloud('syncing', '목록 저장 중…');
      if (Cloud.libId) await api.updateJson(Cloud.libId, lib);
      else { Cloud.libId = await api.createJson(Cloud.folderId, 'library.json', lib); lsSet('nb-glib', Cloud.libId); }
    }
    // 7) 기기에 저장
    for (const id of touched) {
      const s = state.songs.find(x => x.id === id), t = state.tombs.find(x => x.id === id);
      if (s) await DB.put('songs', songRecord(s)); else if (t) await DB.put('songs', t); else await DB.del('songs', id);
    }
    for (const id of recTouched) {
      const r = state.recs.find(x => x.id === id), t = state.recTombs.find(x => x.id === id);
      if (r) await DB.put('recs', r); else if (t) await DB.put('recs', t); else await DB.del('recs', id);
    }
    state.recs.sort((a, b) => b.createdAt - a.createdAt);
    saveProfiles();
    Cloud.lastSync = Date.now(); lsSet('nb-glast', String(Cloud.lastSync));
    setCloud('ok');
    afterSync(touched);
  } catch (e) {
    console.warn('sync', e);
    setCloud(e.needLogin || e.popup ? 'login' : 'error', cloudErrText(e));
  } finally {
    Cloud.syncing = false;
    if (Cloud.again) { Cloud.again = false; Cloud.schedule(1000); }
  }
}
function mergeProfiles(remoteList) {
  if (!remoteList.length) return;
  Profiles.list = mergeProfileLists(Profiles.list, remoteList);
  if (!liveProfiles().length) Profiles.list.push(defaultProfile());
  Profiles.cur = liveProfiles().find(p => p.id === Profiles.cur?.id) || liveProfiles()[0];
}
function afterSync(touched) {
  state.songs.sort((a, b) => (a.demo ? -1 : b.demo ? 1 : a.no - b.no));
  renderSongs(); renderQueue(); renderMine(); renderProfileChip(); renderRecs(); refreshOverlays();
  if (!state.songs.includes(state.song)) selectSong(state.songs[0]);
  else if (touched.has(state.song?.id) && !state.playing && state.offset < 0.5 && nextAt == null) selectSong(state.song);
}
window.addEventListener('online', () => { renderCloudChip(); renderSongs(); Cloud.schedule(1500); });
window.addEventListener('offline', () => { renderCloudChip(); renderSongs(); });
setInterval(() => { if (Cloud.connected && Cloud.state === 'ok') renderCloudChip(); }, 60000);

/* 곡 수정 창: 기기 저장 / 지우기 */
function renderDeviceRow(s) {
  const row = $('#deviceRow'); row.hidden = !(s && s.fileId);
  if (row.hidden) return;
  $('#deviceTxt').textContent = s.blob ? '이 기기에 저장돼 있어요 (인터넷 없이 부를 수 있어요)' : 'Drive에만 있어요';
  $('#evictBtn').hidden = !s.blob; $('#fetchBtn').hidden = !!s.blob;
}
$('#evictBtn').onclick = async () => {
  const s = editing; if (!s?.fileId) return;
  s.blob = null; if (state.song !== s) s.buffer = null;
  await DB.put('songs', songRecord(s)); renderDeviceRow(s); renderSongs();
  toast('기기에서 지웠어요. Drive에는 그대로 있어요');
};
$('#fetchBtn').onclick = async () => {
  const s = editing; if (!s) return;
  try { await ensureMedia(s); toast('기기에 저장했어요'); } catch (e) { toast(mediaErrText(e), 5000); }
  renderDeviceRow(s);
};
