// YT 노래방 · 메인 루프와 앱 시작
'use strict';

/* ---------------- 메인 루프 ---------------- */
function loop() {
  state.frame++;
  if (E.ctx) {
    const mic = analyseMic();
    if (state.song?.buffer) {
      const t = curTime();
      if (state.playing || state.frame % 10 === 0) updateTimeUI(t);
      if (state.playing) {
        scoreFrame(mic);
        if (t >= dur() - 0.02) onFinish();
      }
      if (state.sync && state.sync.now !== state.active) renderSyncList();
    }
    if (P.playing) {
      if (pTime() >= P.rec.duration - 0.01) pStop(true);
      else if (state.frame % 6 === 0) renderPlayerUI();
    }
  }
  tickNext();
  videoFollow();
  if (state.tv && state.frame % 60 === 0 && !$('#tvIdle').hidden) renderClock();
  requestAnimationFrame(loop);
}

/* ---------------- 시작 ---------------- */
(async function init() {
  applySettings();
  const demo = { id: 'demo', no: 10001, title: '작은 방의 노래', artist: 'YT 노래방 데모 MR', demo: true, lyricOffset: 0 };
  loadProfiles();
  const saved = (await DB.all('songs')).sort((a, b) => a.no - b.no);
  state.songs = [demo, ...saved.filter(x => !x.deleted)];
  state.tombs = saved.filter(x => x.deleted);
  const allRecs = await DB.all('recs');
  state.recs = allRecs.filter(r => !r.deleted).sort((a, b) => b.createdAt - a.createdAt);
  state.recTombs = allRecs.filter(r => r.deleted);
  state.queue = loadQueue();
  renderSongs(); renderRecs(); renderQueue(); renderBest(); renderClock(); updateTransportUI();
  renderProfileChip(); renderMine(); renderCloudChip();
  if (Cloud.clientId) loadGis().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (matchMedia('(max-width:560px)').matches) $('#deckMore').open = false;
  remoteInit();
  await selectSong(demo);
  // "YT 노래방 TV로 켜기"(주소 ?tv=1)로 열었으면 곡 목록·데모곡 준비가 끝난 뒤 바로 TV 화면으로
  if (tvParam(location.search)) startInTV();
  requestAnimationFrame(loop);
})();
