// YT 노래방 · 녹음 Drive 백업, 백업 파일 만들기/불러오기
'use strict';

/* ================= 녹음 백업 · 백업 파일 ================= */
const recMedia = r => r.v === 2 ? r.vocal : r.blob;
async function ensureRecMedia(r) {
  if (recMedia(r)) return;
  if (!r.fileId) throw Object.assign(new Error('nomedia'), { nomedia: true });
  if (!navigator.onLine) throw Object.assign(new Error('offline'), { offline: true });
  const b = await Cloud.api.download(r.fileId);
  if (r.v === 2) r.vocal = b; else r.blob = b;
  await DB.put('recs', r); requestPersist();
}
function recTouch(r) { r.updatedAt = Date.now(); Cloud.schedule(); }
$('#recBackup').checked = lsGet('nb-recbackup') === '1';
$('#recBackup').onchange = e => { lsSet('nb-recbackup', e.target.checked ? '1' : null); if (e.target.checked) Cloud.schedule(500); };

async function exportBackup() {
  const withRecs = $('#bkRecs').checked, withVideo = $('#bkVideo').checked, blobs = [];
  const add = b => { if (!b) return null; blobs.push(b); return blobs.length - 1; };
  const songs = state.songs.filter(x => !x.demo && (withVideo || !x.video)).map(x => ({ ...pick(x, SONG_FIELDS), mediaDirty: !!x.mediaDirty, blob: add(x.blob) }));
  const recs = withRecs ? state.recs.map(r => ({ ...pick(r, REC_FIELDS), media: add(recMedia(r)) })) : [];
  const file = packBackup({ version: 1, app: 'YT 노래방', createdAt: Date.now(), songs, recs, profiles: Profiles.list, scores, plays }, blobs);
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  download(file, `YT노래방_백업_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}.ytbackup`);
  return { songs: songs.length, recs: recs.length, size: file.size };
}
async function importBackup(file) {
  const { head, blobAt } = await unpackBackup(file);
  let addS = 0, addR = 0;
  for (const x of head.songs || []) {
    const local = state.songs.find(y => y.id === x.id);
    if (local && (local.updatedAt || 0) >= (x.updatedAt || 0)) continue;
    const blob = x.blob != null ? blobAt[x.blob] : (local?.blob || null);
    const ns = { ...x, blob, mediaDirty: !!x.mediaDirty || (!x.fileId && !!blob) };
    if (local) { Object.assign(local, ns); local.buffer = null; local.keyCache = null; await DB.put('songs', songRecord(local)); }
    else { state.songs.push(ns); state.tombs = state.tombs.filter(t => t.id !== x.id); await DB.put('songs', songRecord(ns)); addS++; }
  }
  for (const r of head.recs || []) {
    if (state.recs.some(y => y.id === r.id)) continue;
    const { media, ...meta } = r, b = media != null ? blobAt[media] : null;
    if (b) { if (meta.v === 2) meta.vocal = b; else meta.blob = b; }
    state.recs.push(meta); await DB.put('recs', meta); addR++;
  }
  mergeProfiles(head.profiles || []); saveProfiles();
  for (const x of head.scores || []) if (!scores.some(y => y.at === x.at && y.title === x.title)) scores.push(x);
  scores.sort((a, b) => b.at - a.at); scores.splice(30);
  for (const [id, pl] of Object.entries(head.plays || {})) if (!plays[id] || pl.n > plays[id].n) plays[id] = pl;
  try { localStorage.setItem('nb-scores', JSON.stringify(scores)); localStorage.setItem('nb-plays', JSON.stringify(plays)); } catch {}
  state.recs.sort((a, b) => b.createdAt - a.createdAt);
  afterSync(new Set()); renderBest(); renderIdleChart(); renderStorage();
  Cloud.schedule();
  return { addS, addR };
}
$('#bkExport').onclick = async () => {
  const b = $('#bkExport'), st = $('#bkStatus');
  b.disabled = true; st.textContent = '백업 파일을 만드는 중…';
  try { const r = await exportBackup(); st.textContent = `곡 ${r.songs}개, 녹음 ${r.recs}개를 담았어요 (${fmtBytes(r.size)}). 다운로드 폴더를 확인하세요`; }
  catch (e) { console.error(e); st.textContent = '백업 파일을 만들지 못했어요'; }
  b.disabled = false;
};
$('#bkFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const st = $('#bkStatus'); st.textContent = '불러오는 중…';
  try { const r = await importBackup(f); st.textContent = `불러왔어요 · 새 곡 ${r.addS}개, 새 녹음 ${r.addR}개 (이미 있던 건 더 최신 쪽으로 맞췄어요)`; }
  catch (err) { console.error(err); st.textContent = err.message?.includes('백업 파일') ? err.message : '불러오지 못했어요. 파일이 손상됐을 수 있어요'; }
};
