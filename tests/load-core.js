// 브라우저 없이 js/util.js + js/core.js를 불러온다. 두 파일은 브라우저용 일반 스크립트라서
// 같은 vm 컨텍스트에서 차례로 실행하고, 필요한 이름들을 꺼내 쓴다.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const NAMES = ['fmtMs', 'norm', 'chosung', 'pick', 'parseLyrics', 'toLRC', 'searchIn', 'SONG_FIELDS', 'REC_FIELDS',
  'mergeRemoteInto', 'mergeProfileLists', 'renumberDuplicates', 'buildLibrary', 'librarySig', 'packBackup', 'unpackBackup', 'BK_MAGIC', 'titleFromFilename', 'songsFromFolderFiles', 'tvParam', 'fillsScreen',
  'MEASURE', 'findClickDelays', 'summarizeDelays', 'pickByArrow',
  'isMediaFile', 'byFileName', 'nextSongNumbers', 'findSameSong', 'lacksLyrics', 'artistNames', 'artistMatches', 'titleRank', 'rankLyrics', 'chooseLyrics', 'AUTO_SEC',
  'STATS_CAP', 'statsFileName', 'cleanPlays', 'mergePlays', 'mergeScores', 'statsTotals', 'statsSig', 'buildStatsFile', 'parseStatsFile', 'pickStatsFiles', 'mergeBackupStats', 'planDownload', 'travelStatus',
  'MR_DEFAULT_SERVER', 'MR_MAX_FILES', 'MR_MAX_BYTES', 'normalizeMrServer', 'mrMessageOk',
  'MR_HUB_NAME', 'mrServerPick', 'mrHubValueOk', 'mrHubFill', 'MR_SAVE_TEXT', 'mrClearText', 'MR_NOSERVER_TEXT',
  'YT_ID_RE', 'isYtSong', 'parseYouTubeId', 'ytWatchUrl', 'ytSearchQuery', 'ytResultsUrl', 'htmlText', 'parseYtSearch', 'ytTitleParts', 'shareParams', 'stripShareParams', 'findYtSong',
  'ADV_KEY', 'DECK_KEY', 'advOn', 'deckOpenAtStart', 'storeSummary',
  'MR_LRC_MAX', 'MR_LYR_MAX', 'mrLrcOk', 'mrLyricsFor', 'mrLyricsFromLrclib', 'alignLyricsText', 'canAlignSong', 'alignAsk', 'alignErrText', 'ALIGN_ERR_TEXT',
  'HUB_LRC_MAX', 'HUB_PUSH_MAX', 'HUB_PULL_MAX', 'hubPairOk', 'hubCodeParse', 'hubCodeMake', 'mrHashKey', 'songSettingsKey', 'settingsOf', 'settingsSig', 'settingsHas', 'settingsFromData',
  'songSettingsData', 'hubPlan', 'hubMirrorAdd', 'hubRemote', 'hubQueueAdd', 'hubQueueDrop', 'hubRecord', 'lrclibGetParams', 'autoSyncPick', 'canAutoSync',
  'GUEST_MAX', 'GUEST_PER_SEC', 'GUEST_MAX_BYTES', 'GUEST_RESULTS', 'GUEST_QUEUE_SHOW', 'guestRoomName', 'guestId', 'guestUrl', 'guestUrlParse', 'guestMsgOk', 'guestRateOk', 'guestSearchResult', 'guestQueueMap', 'guestStateMsg'];

function loadCore() {
  const ctx = vm.createContext({ console, Blob, TextEncoder, TextDecoder, DataView, Uint8Array, URLSearchParams, URL, crypto: globalThis.crypto, atob, btoa });
  for (const f of ['util.js', 'core.js']) {
    const file = path.join(__dirname, '..', 'js', f);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }
  return vm.runInContext(`({ ${NAMES.join(', ')} })`, ctx);
}

// vm 안에서 만든 객체는 프로토타입이 달라서, 비교할 때는 평범한 JSON 값으로 바꾼다
const plain = x => JSON.parse(JSON.stringify(x));

module.exports = { loadCore, plain };
