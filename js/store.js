// YT 노래방 · 브라우저 저장소(IndexedDB)와 설정
'use strict';

/* ---------------- 저장소 (IndexedDB) ---------------- */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    // 저장소 이름은 예전 이름(hanbam) 그대로 둔다. 바꾸면 이미 넣은 곡과 녹음이 안 보인다.
    const r = indexedDB.open('hanbam-noraebang', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const name of ['songs', 'recs', 'cache']) if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const run = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), req = fn(t.objectStore(store));
      t.oncomplete = () => res(req.result); t.onerror = () => rej(t.error);
    });
  };
  return {
    all: s => run(s, 'readonly', st => st.getAll()).catch(() => []),
    get: (s, id) => run(s, 'readonly', st => st.get(id)),
    put: (s, v) => run(s, 'readwrite', st => st.put(v)),
    del: (s, id) => run(s, 'readwrite', st => st.delete(id)),
  };
})();
// meta: 내용이 바뀌었으면 수정 시각을 남기고 Drive 동기화를 예약한다
// quiet: 실패 알림을 띄우지 않는다 (여러 곡을 한꺼번에 저장할 때 알림을 한 번만 띄우려고). 저장했으면 true를 돌려준다
function persistSong(s, meta = true, quiet = false) {
  if (s.demo) return Promise.resolve(true);
  if (meta) { s.updatedAt = Date.now(); Cloud.schedule(); }
  return DB.put('songs', songRecord(s)).then(() => true, () => {
    if (!quiet) toast('브라우저 저장 공간에 저장하지 못했어요. 새로고침하면 사라질 수 있어요.', 4500);
    return false;
  });
}

/* ---------------- 설정 ---------------- */
const DEFAULTS = { mrVol: 80, micVol: 80, echo: 25, reverb: 35, guide: 45, recOffset: 120, recOffsetTouched: false, monitor: false, speakerMode: false };
const settings = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('nb-settings') || '{}') }; } catch { return { ...DEFAULTS }; } })();
const saveSettings = () => { try { localStorage.setItem('nb-settings', JSON.stringify(settings)); } catch {} };
