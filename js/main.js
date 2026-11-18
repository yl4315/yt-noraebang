// YT 노래방 · 메인 루프와 앱 시작
'use strict';

/* ---------------- 메인 루프 ---------------- */
function loop() {
  state.frame++;
  const mic = E.ctx ? analyseMic() : null;
  // 곡 화면: 내 MR은 오디오 엔진이 있을 때, 유튜브 곡은 플레이어가 위치를 준다 (R3). 유튜브 곡의 끝은 플레이어의 "끝남" 알림으로
  if (songReady() && (E.ctx || ytSong())) {
    const t = curTime();
    if (state.playing || state.frame % 10 === 0) updateTimeUI(t);
    if (state.playing) {
      scoreFrame(mic);
      if (!ytSong() && t >= dur() - 0.02) onFinish();
    }
    if (state.sync && state.sync.now !== state.active) renderSyncList();
  }
  if (E.ctx && P.playing) {
    if (pTime() >= P.rec.duration - 0.01) pStop(true);
    else if (state.frame % 6 === 0) renderPlayerUI();
  }
  if (typeof ytFrame === 'function') ytFrame();
  tickNext();
  videoFollow();
  if (state.tv && state.frame % 60 === 0 && !$('#tvIdle').hidden) renderClock();
  requestAnimationFrame(loop);
}

/* ---------------- 시작 ---------------- */
(async function init() {
  applySettings();
  const demo = { id: 'demo', no: 10001, title: '작은 방의 노래', artist: '예태 노래방 데모 MR', demo: true, lyricOffset: 0 };
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
  // 음향 설정 처음 상태 (CR-229): 고급이면 예전 규칙(PC 펼침·560px 이하 접힘), 아니면 접힘이 기본이고 사람이 편 상태를 기억
  $('#deckMore').open = deckOpenAtStart(advOn(lsGet(ADV_KEY)), lsGet(DECK_KEY), matchMedia('(max-width:560px)').matches);
  remoteInit();
  await selectSong(demo);
  // 폰 유튜브 앱 [공유] → 노래방 (manifest share_target, CR-030): 주소의 ?title=&text=&url=을 지우고 시트 한 장
  if (typeof ytHandleShare === 'function') ytHandleShare();
  // "YT 노래방 TV로 켜기"(주소 ?tv=1)로 열었으면 곡 목록·데모곡 준비가 끝난 뒤 바로 TV 화면으로
  if (tvParam(location.search)) startInTV();
  requestAnimationFrame(loop);
})();
