// YT 노래방 · 유튜브 재생목록 넣기 (CR-244)
// 재생목록 링크(list=…)를 붙이면 "재생목록 N곡" 미리 보기 → [곡 목록에 다 넣기]. 예약은 하지 않는다. 곡 목록에 있는 곡은 건너뛴다.
// - 열쇠(YouTube Data API)가 있으면 playlistItems·videos로 제목·채널·퍼가기 됨(status.embeddable)을 미리 안다 → 노래방 안에서 못 트는 곡은 기본으로 뺀다.
// - 열쇠가 없으면 공식 IFrame 플레이어의 cuePlaylist → getPlaylist()로 영상 번호만 (200개까지). 제목은 틀 때 플레이어가 알려 준다 (yt.js ytNoteMeta).
//   목록마다 새 플레이어를 만들고 읽으면 바로 없앤다. 올려 두기만 하고 틀지 않는다. 플레이어 칸은 보이는 곳에 둔다 (200px 넘게, css "CR-244").
// 내려받기·소리 빼기·녹화·광고 가리기는 하지 않는다. 열쇠는 저장·화면·로그에 쓰지 않는다.
// 위쪽은 순수 함수 (tests/ytlist.test.js가 브라우저 없이 부른다), 아래쪽은 브라우저 부분. yt.js 바로 앞에 불러오고, 맨 위에서 바로 도는 코드는 없다
// (yt.js·store.js·songs.js의 이름은 함수 안에서만 쓴다).
'use strict';

/* ---------------- 순수 함수 ---------------- */
const YT_LIST_MAX = 200;                              // 한 번에 넣는 곡 수 (열쇠 없는 길도 플레이어가 200개까지 준다)
const YT_KY_CHANNEL = 'UCDqaUIUSJP5EVMEI178Zfag';     // 금영 노래방 공식 유튜브 채널 (@KARAOKEKY)
const YT_LIST_HOST = 'https://www.youtube-nocookie.com';
const YT_LIST_ID_RE = /^[A-Za-z0-9_-]{2,80}$/;
const YT_LIST_WHY = {
  mine: '‘나중에 볼 동영상’·‘좋아요 표시한 동영상’은 내 계정에서만 보이는 목록이에요 · 공개 재생목록 링크를 붙여 주세요',
  mix: '유튜브가 자동으로 만든 믹스예요 · 공개 재생목록 링크를 붙여 주세요',
  bad: '재생목록 번호가 이상해요 · 링크를 다시 복사해 붙여 주세요',
};
// 글 속 유튜브 링크에서 재생목록 번호(list=)를 뽑는다. 허용 주소는 parseYouTubeId와 같다 (youtu.be · youtube.com · m.·music. · youtube-nocookie.com).
// list=가 있는 링크가 없으면 null (그때는 지금처럼 영상 하나 링크로 본다).
// 있으면 { ok:true, id, video } — video는 같은 링크의 영상 번호(v=·youtu.be/…, 없으면 null).
// 넣을 수 없는 목록은 { ok:false, id, video, kind, why }: 개인 목록(WL·LL·LM) = mine, 자동 믹스(RD…)·잠깐 만든 목록(TL…) = mix, 모양 틀림 = bad
function parseYouTubeListId(text) {
  const s = String(text ?? '');
  const re = /(?<![\w.\-\/@])(?:https?:\/\/)?(?:[\w-]+\.)*(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\/[^\s<>"'()]*/ig;
  for (const m of s.matchAll(re)) {
    let u;
    try { u = new URL(/^https?:/i.test(m[0]) ? m[0] : 'https://' + m[0]); } catch { continue; }
    const host = u.hostname.toLowerCase();
    if (host !== 'youtu.be' && !/(^|\.)youtube(-nocookie)?\.com$/.test(host)) continue;
    const id = (u.searchParams.get('list') || '').trim();
    if (!id) continue;
    const v = parseYouTubeId(m[0]), video = v === 'videoseries' ? null : v;   // 퍼가기 주소 /embed/videoseries?list=…는 영상이 아니다
    const no = kind => ({ ok: false, id, video, kind, why: YT_LIST_WHY[kind] });
    if (!YT_LIST_ID_RE.test(id)) return no('bad');
    if (/^(WL|LL|LM)$/.test(id)) return no('mine');
    if (/^(RD|TL)/.test(id)) return no('mix');
    return { ok: true, id, video };
  }
  return null;
}
// 검색 결과 순서: 금영 공식 채널 영상만 앞으로, 나머지(TJ 포함)는 받은 순서 그대로 (안정 정렬). 항목은 channelId를 가진다
function ytRankOfficial(list, channelId = YT_KY_CHANNEL) {
  const a = Array.isArray(list) ? list : [];
  const off = x => !!x && x.channelId === channelId;
  return [...a.filter(off), ...a.filter(x => !off(x))];
}
// search.list 답(json)의 채널 번호(snippet.channelId)를 parseYtSearch 결과에 붙인다 (core.js parseYtSearch는 채널 번호를 안 줘서)
function ytWithChannelIds(list, json) {
  const m = new Map((Array.isArray(json?.items) ? json.items : []).map(it => [String(it?.id?.videoId || ''), String(it?.snippet?.channelId || '')]));
  return (Array.isArray(list) ? list : []).map(x => ({ ...x, channelId: x.channelId || m.get(x.id) || '' }));
}
// 넣을 계획. items = [{ id, title, channel, channelId, embeddable(true·false·null=모름) }] (목록 순서), songs = 지금 곡 목록.
// → { n, add, have, blocked, over, cut, dup, gone, includeBlocked }
//   n = 목록 곡 수(겹침 빼고 + 아직 안 읽은 뒷부분) · add = 넣을 곡(앞에서 limit개까지) · have = [{ item, song }] 곡 목록에 있음(건너뜀)
//   blocked = 퍼가기 안 됨(embeddable false, includeBlocked면 add에도 들어감) · over = 한도·안 읽은 뒷부분 때문에 안 넣는 곡 수
//   cut = "앞 N곡만" 안내 (over가 있거나, 열쇠 없이 200개를 꽉 채워 받아 뒤가 더 있을 수 있음)
function ytListPlan(items, songs, { limit = YT_LIST_MAX, includeBlocked = false, more = 0, gone = 0, maybeMore = false } = {}) {
  const seen = new Set(), uniq = [];
  let dup = 0;
  for (const it of Array.isArray(items) ? items : []) {
    const id = String(it?.id || '');
    if (!YT_ID_RE.test(id)) continue;
    if (seen.has(id)) { dup++; continue; }
    seen.add(id); uniq.push(it);
  }
  const have = [], blocked = [], ok = [];
  for (const it of uniq) {
    const s = findYtSong(songs, it.id);
    if (s) { have.push({ item: it, song: s }); continue; }
    if (it.embeddable === false) { blocked.push(it); if (!includeBlocked) continue; }
    ok.push(it);
  }
  const lim = Math.max(0, Math.floor(+limit || 0));
  const add = ok.slice(0, lim), rest = Math.max(0, Math.floor(+more || 0));
  const over = ok.length - add.length + rest;
  return { n: uniq.length + rest, add, have, blocked, over, cut: over > 0 || !!maybeMore, dup, gone: Math.max(0, +gone || 0), includeBlocked: !!includeBlocked };
}
// playlistItems.list (part=contentDetails,status) 한 쪽 → { ids, next, total, gone, raw }. 지운 영상·비공개 영상은 ids에서 빠지고 gone에 센다
function ytListItemsPage(json) {
  const items = Array.isArray(json?.items) ? json.items : [];
  const ids = [];
  let gone = 0;
  for (const it of items) {
    const id = String(it?.contentDetails?.videoId || it?.snippet?.resourceId?.videoId || '');
    const ps = it?.status?.privacyStatus;
    if (!YT_ID_RE.test(id) || ps === 'private' || ps === 'privacyStatusUnspecified') { gone++; continue; }
    ids.push(id);
  }
  const next = typeof json?.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : null;
  const t = json?.pageInfo?.totalResults, total = Number.isFinite(+t) && t !== null && t !== '' ? +t : null;
  return { ids, next, total, gone, raw: items.length };
}
// videos.list (part=status,snippet) → Map 영상 번호 → { id, title, channel, channelId, embeddable }. 비공개·올리는 중·지운 영상은 없다 (유튜브가 안 주거나 여기서 뺀다)
function ytVideosRead(json) {
  const m = new Map();
  for (const it of Array.isArray(json?.items) ? json.items : []) {
    const id = String(it?.id || '');
    if (!YT_ID_RE.test(id)) continue;
    const st = it?.status || {}, sn = it?.snippet || {};
    if (st.privacyStatus === 'private') continue;
    if (st.uploadStatus && !/^(processed|uploaded)$/.test(st.uploadStatus)) continue;   // 지움·실패·거절
    m.set(id, { id, title: htmlText(sn.title), channel: htmlText(sn.channelTitle), channelId: String(sn.channelId || ''),
      embeddable: st.embeddable === false ? false : st.embeddable === true ? true : null });
  }
  return m;
}
// 목록 순서(ids)대로 영상 정보를 붙인다. 정보가 없는 영상(지움·비공개)은 빠지고 gone에 센다
function ytListJoin(ids, vids) {
  const items = [];
  let gone = 0;
  for (const id of Array.isArray(ids) ? ids : []) { const v = vids && vids.get(id); if (v) items.push(v); else gone++; }
  return { items, gone };
}
// 유튜브 Data API 오류 → 'blocked'(한도·열쇠 문제: 이 화면 동안 열쇠 없는 길) · 'private'(비공개 목록) · 'notfound' · 'other'
function ytApiErrorKind(status, json) {
  if (status === 429) return 'blocked';
  const e = json?.error || {};
  const reason = String(e?.errors?.[0]?.reason || e?.details?.[0]?.reason || '');
  if (status === 404 || /notFound$/i.test(reason)) return 'notfound';
  if (/^(playlistItemsNotAccessible|playlistForbidden)$/.test(reason)) return 'private';
  if (status === 403 || status === 400) return 'blocked';   // ytKeySearch와 같이 (한도 초과·열쇠 틀림·막힘)
  return 'other';
}
const YT_LIST_ERR = {
  notfound: '재생목록을 찾지 못했어요 · 지워졌거나 비공개 목록일 수 있어요',
  private: '비공개 재생목록이라 읽을 수 없어요 · 공개나 일부 공개 목록 링크를 붙여 주세요',
  empty: '비공개 목록이거나, 노래방에서 못 트는 영상만 있는 목록일 수 있어요',
  timeout: '비공개 목록이거나, 노래방에서 못 트는 영상만 있는 목록일 수 있어요',
  player: '비공개 목록이거나, 노래방에서 못 트는 영상만 있는 목록일 수 있어요',
  api: '유튜브 플레이어를 불러오지 못했어요 · 인터넷 연결을 확인해 주세요',
  net: '유튜브에 닿지 않았어요 · 인터넷 연결을 확인하고 다시 해 봐요',
  offline: '인터넷이 끊겨 있어요 · 인터넷이 되면 다시 해 봐요',
  other: '유튜브가 답하지 않아요 · 잠시 후 다시 해 봐요',
};
// 미리 보기 카드에 쓸 글 (화면과 상관없음). st = { phase: 'loading'|'ready'|'adding'|'bad'|'error', why, kind, plan, keyUsed }
// → { cls, head, lines: [{ text, toggle? }], btn: { text, act, primary, disabled } | null, small }
function ytListView(st, { limit = YT_LIST_MAX } = {}) {
  const ph = st?.phase;
  if (ph === 'bad') return { cls: 'yt-c-list-bad', head: '이 재생목록은 넣을 수 없어요', lines: [{ text: st.why || YT_LIST_WHY.bad }], btn: null, small: '' };
  if (ph === 'error') return { cls: 'yt-c-list-err', head: '재생목록을 읽지 못했어요', lines: [{ text: YT_LIST_ERR[st.kind] || YT_LIST_ERR.other }],
    btn: st.kind === 'offline' ? null : { text: '다시 해 보기', act: 'retry', primary: false, disabled: false }, small: '' };
  if (ph !== 'ready' && ph !== 'adding') return { cls: 'yt-c-list-busy', head: '재생목록을 읽는 중…', lines: [], btn: null, small: '' };
  const p = st.plan || ytListPlan([], []), lines = [];
  if (p.have.length) lines.push({ text: `곡 목록에 있는 ${p.have.length}곡은 건너뛰어요` });
  if (p.blocked.length) lines.push({ text: `${p.blocked.length}곡은 노래방 안에서 못 틀어요 (유튜브 앱에서는 돼요)`, toggle: { text: '그 곡도 넣기', on: !!p.includeBlocked } });
  if (p.cut) lines.push({ text: `앞 ${limit}곡만 넣어요` });
  if (p.gone) lines.push({ text: `지웠거나 비공개인 ${p.gone}곡은 빼요` });
  if (!p.add.length) lines.push({ text: '새로 넣을 곡이 없어요' });
  else if (!st.keyUsed) lines.push({ text: '제목은 틀 때 보여요' });
  const adding = ph === 'adding';
  return { cls: 'yt-c-list-ready', head: `재생목록 ${p.n}곡`, lines,
    btn: { text: adding ? '넣는 중…' : '곡 목록에 다 넣기', act: 'add', primary: true, disabled: adding || !p.add.length }, small: '예약은 안 해요' };
}
// 넣은 뒤 알림 한 줄
function ytListDoneText({ added = 0, have = 0, blocked = 0, over = 0, fail = 0, limit = YT_LIST_MAX } = {}) {
  const parts = [`${added}곡 넣었어요`];
  if (have) parts.push(`있던 ${have}곡 건너뜀`);
  if (blocked) parts.push(`못 트는 ${blocked}곡 뺌`);
  if (over) parts.push(`뒤 ${over}곡은 안 넣음 (한 번에 ${limit}곡까지)`);
  if (fail) parts.push(`${fail}곡은 이 기기에 저장하지 못했어요 · 저장 공간을 확인해 주세요`);
  return parts.join(' · ');
}

/* ---------------- 브라우저 부분 ---------------- */
const YtList = {
  st: null,           // 지금 카드 상태 { id, phase, kind, items, gone, more, maybeMore, keyUsed, includeBlocked }
  cache: new Map(),   // 이 화면 동안 읽은 목록 ('k:'·'p:' + 목록 번호 → 결과). 저장하지 않는다
  player: null, box: null, boxMine: false, gen: 0,
};
// 열쇠 길: playlistItems.list 50개씩 200개까지 → videos.list 50개씩 (제목·채널·퍼가기 됨). 1회에 많아야 8번 부른다 (할당량 8)
// → { ok:true, items, gone, more, keyUsed:true } | { ok:false, kind: 'blocked'|'private'|'notfound'|'other'|'net', status }
async function ytListFetchKey(listId, key, { fetchFn = typeof fetch === 'function' ? fetch : null, timeoutMs = 10000, max = YT_LIST_MAX } = {}) {
  if (!key || !fetchFn) return { ok: false, kind: 'blocked' };
  const get = async (path, params) => {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const url = 'https://www.googleapis.com/youtube/v3/' + path + '?' + new URLSearchParams({ ...params, key });
      const res = await fetchFn(url, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer-when-downgrade' });
      let j = null; try { j = await res.json(); } catch {}
      return { status: res.status, ok: !!res.ok, j };
    } finally { clearTimeout(timer); }
  };
  try {
    const ids = [];
    let page = null, total = null, gone = 0, raw = 0;
    do {
      const r = await get('playlistItems', { part: 'contentDetails,status', playlistId: listId, maxResults: '50',
        fields: 'nextPageToken,pageInfo/totalResults,items(contentDetails/videoId,status/privacyStatus)', ...(page ? { pageToken: page } : {}) });
      if (!r.ok) return { ok: false, kind: ytApiErrorKind(r.status, r.j), status: r.status };
      const items = Array.isArray(r.j?.items) ? r.j.items.slice(0, max - raw) : [];
      const p = ytListItemsPage({ ...r.j, items });
      raw += p.raw; gone += p.gone; ids.push(...p.ids);
      if (total == null) total = p.total;
      page = p.next;
    } while (page && raw < max);
    const want = [...new Set(ids)], vids = new Map();
    for (let i = 0; i < want.length; i += 50) {
      const r = await get('videos', { part: 'status,snippet', id: want.slice(i, i + 50).join(','), maxResults: '50',
        fields: 'items(id,snippet(title,channelTitle,channelId),status(embeddable,privacyStatus,uploadStatus))' });
      if (!r.ok) return { ok: false, kind: ytApiErrorKind(r.status, r.j), status: r.status };
      for (const [k, v] of ytVideosRead(r.j)) vids.set(k, v);
    }
    const j = ytListJoin(ids, vids);
    return { ok: true, items: j.items, gone: gone + j.gone, more: Math.max(0, (total ?? raw) - raw), maybeMore: false, keyUsed: true };
  } catch { return { ok: false, kind: 'net' }; }
}
// 목록 플레이어 칸: anchor 바로 뒤(2단계: 검색 창 #searchList 뒤 — 목록을 다시 그려도 iframe이 지워지지 않게)에 보이는 칸을 만든다
function ytListBox(anchor) {
  if (YtList.box && YtList.box.isConnected) return YtList.box;
  const b = el('div', 'yt-list-box', '');
  if (anchor && anchor.parentNode) anchor.after(b); else document.body.append(b);
  YtList.box = b; YtList.boxMine = true;
  return b;
}
// 목록 플레이어를 없앤다 (읽고 나면 바로 · 카드를 닫을 때)
function ytListDropPlayer() {
  const p = YtList.player; YtList.player = null;
  if (p) { try { p.destroy(); } catch {} }
  if (YtList.box && YtList.boxMine) { YtList.box.remove(); YtList.box = null; YtList.boxMine = false; }
}
// 열쇠 없는 길: 목록마다 새 플레이어를 만들어 cuePlaylist → getPlaylist() (11-24 ⓪: 같은 플레이어에 둘째 목록을 올리면 첫 목록이 남았다).
// 틀지 않는다 (올려 두기만). 다 읽으면 destroy. host는 2단계에서 CR-251 설정 값과 잇는다 (지금 기본 youtube-nocookie).
// → { ok:true, items:[{ id, title:'', channel:'', embeddable:null }], gone:0, more:0, maybeMore, keyUsed:false } | { ok:false, kind: 'api'|'timeout'|'empty'|'player', code }
async function ytListFetchPlayer(listId, { box = null, host = YT_LIST_HOST, YTns = null, timeoutMs = 12000, settleMs = 3000, errMs = 1500 } = {}) {
  ytListDropPlayer();
  let YT = YTns;
  if (!YT) {
    if (typeof ytLoadApi !== 'function') return { ok: false, kind: 'api' };
    try { YT = await ytLoadApi(); } catch { return { ok: false, kind: 'api' }; }
  }
  const my = ++YtList.gen;
  const holder = box || ytListBox(null);
  if (box) { YtList.box = box; YtList.boxMine = false; }
  const spot = document.createElement('div'); holder.append(spot);
  return new Promise(res => {
    let p = null, done = false, poll = 0, cuedAt = 0, errCode = null;
    const vars = { playsinline: 1, controls: 1, rel: 0 };
    if (typeof location === 'object' && /^https?:$/.test(location.protocol)) vars.origin = location.origin;
    const finish = r => {
      if (done) return; done = true;
      clearTimeout(timer); clearInterval(poll);
      if (YtList.gen === my) ytListDropPlayer(); else { try { p && p.destroy(); } catch {} }
      try { spot.remove(); } catch {}
      res(r);
    };
    const timer = setTimeout(() => finish({ ok: false, kind: errCode != null ? 'player' : cuedAt ? 'empty' : 'timeout', code: errCode?.code }), timeoutMs);
    const read = () => {
      if (done || !p) return;
      let ids = null; try { ids = p.getPlaylist(); } catch {}
      if (Array.isArray(ids) && ids.length) {
        let vd = {}; try { vd = p.getVideoData() || {}; } catch {}
        const items = ids.map(String).filter(x => YT_ID_RE.test(x)).slice(0, YT_LIST_MAX).map(id => ({ id, title: '', channel: '', channelId: '', embeddable: null }));
        if (items[0] && vd.video_id === items[0].id && vd.title) { items[0].title = String(vd.title); items[0].channel = String(vd.author || ''); }
        finish({ ok: true, items, gone: 0, more: 0, maybeMore: ids.length >= YT_LIST_MAX, keyUsed: false });
      } else if ((cuedAt && performance.now() - cuedAt > settleMs) || (errCode != null && performance.now() - errCode.at > errMs)) {
        finish({ ok: false, kind: errCode != null ? 'player' : 'empty', code: errCode?.code });
      }
    };
    try {
      p = new YT.Player(spot, {
        host, width: '100%', height: '100%', playerVars: vars,
        events: {
          onReady: () => {
            try { p.cuePlaylist({ listType: 'playlist', list: listId, index: 0 }); } catch { finish({ ok: false, kind: 'api' }); return; }
            poll = setInterval(read, 150);
          },
          onStateChange: e => { if (e && e.data === 5) { if (!cuedAt) cuedAt = performance.now(); read(); } },
          // 첫 영상이 막혀 있어도 목록 번호는 올 수 있다 → errMs(1.5초) 더 기다려 본다
          onError: e => { if (errCode == null) errCode = { code: e && e.data, at: performance.now() }; read(); },
        },
      });
      if (YtList.gen === my) YtList.player = p;
    } catch { finish({ ok: false, kind: 'api' }); }
  });
}
// 목록 읽기: 열쇠가 있으면 열쇠 길. 한도·열쇠 문제(403·400·429)면 이 화면 동안 열쇠 없는 길 (ytKeySearch와 같이 Yt.keyBlocked).
// 열쇠 길이 인터넷 오류·그 밖의 오류(5xx)면 플레이어 길로 한 번 더 해 본다. 비공개·없는 목록은 플레이어도 못 읽어서 그대로 알린다
async function ytListRead(listId, { key, box, host, fetchFn, YTns } = {}) {
  const k = key !== undefined ? key : (typeof ytHasKey === 'function' && ytHasKey() ? ytKeyValue() : null);
  const ck = (k ? 'k:' : 'p:') + listId;
  if (YtList.cache.has(ck)) return YtList.cache.get(ck);
  let r = null;
  if (k) {
    r = await ytListFetchKey(listId, k, { fetchFn });
    if (!r.ok && r.kind === 'blocked') { if (typeof Yt === 'object' && Yt) Yt.keyBlocked = true; r = null; }
    else if (!r.ok && (r.kind === 'net' || r.kind === 'other')) r = null;
  }
  if (!r) r = await ytListFetchPlayer(listId, { box, host, YTns });
  if (r.ok) YtList.cache.set((r.keyUsed ? 'k:' : 'p:') + listId, r);
  return r;
}
// 카드 상태 열기 (2단계: renderYtTab이 목록 링크를 보면 부름). 같은 목록이면 그대로 둔다. onChange = 다 읽으면 다시 그리기
function ytListOpen(listId, { box, host, onChange } = {}) {
  if (YtList.st && YtList.st.id === listId && YtList.st.phase !== 'error') return YtList.st;
  if (YtList.st) ytListClose();
  const st = YtList.st = { id: listId, phase: 'loading', kind: null, items: [], gone: 0, more: 0, maybeMore: false, keyUsed: false, includeBlocked: false };
  if (typeof navigator === 'object' && navigator.onLine === false) { st.phase = 'error'; st.kind = 'offline'; return st; }
  ytListRead(listId, { box, host }).then(r => {
    if (YtList.st !== st) return;
    if (r.ok) Object.assign(st, { phase: 'ready', items: r.items, gone: r.gone || 0, more: r.more || 0, maybeMore: !!r.maybeMore, keyUsed: !!r.keyUsed });
    else Object.assign(st, { phase: 'error', kind: r.kind || 'other' });
    if (typeof onChange === 'function') onChange(st);
  });
  return st;
}
function ytListClose() { YtList.st = null; ytListDropPlayer(); }
// 지금 곡 목록으로 계획 (곡을 넣으면 have가 바뀌어서 그릴 때마다 새로)
function ytListPlanOf(st) {
  return ytListPlan(st?.items || [], typeof state === 'object' && state ? state.songs : [], { includeBlocked: !!st?.includeBlocked, more: st?.more, gone: st?.gone, maybeMore: st?.maybeMore });
}
// 곡 목록에 넣기: 곡 줄은 ytAdd와 같은 모양 (source:'yt'·ytId·제목·가수). 저장은 여러 곡 넣기(bulk.js)처럼 실패 알림 없이(quiet) 한꺼번에 보내고,
// 목록 그리기·알림·Drive 동기화 예약은 끝에 한 번. 가사 자동 찾기(LRCLIB)는 곡마다 부르지 않는다 → 처음 틀 때 ytNoteMeta가 한다
async function ytListAdd(plan) {
  const want = Array.isArray(plan?.add) ? plan.add : [];
  const list = want.filter((it, i) => !findYtSong(state.songs, it.id) && want.findIndex(x => x.id === it.id) === i);
  const nos = nextSongNumbers(state.songs, list.length), now = Date.now();
  const songs = list.map((it, i) => {
    const p = ytTitleParts(it.title || '', it.channel || '');
    return { id: uid(), no: nos[i], source: 'yt', ytId: it.id, title: p.title || ytPlaceholder(it.id), artist: p.artist || '', lyrics: '', lyricOffset: 0, createdAt: now };
  });
  if (typeof Yt === 'object' && Yt && Yt.meta) for (const it of list) if (it.title) Yt.meta.set(it.id, { title: it.title, channel: it.channel || '' });
  const saved = await Promise.all(songs.map(s => persistSong(s, true, true)));
  const fail = saved.filter(x => !x).length;
  state.songs.push(...songs);
  if (songs.length) { renderSongs(); if (typeof requestPersist === 'function') requestPersist(); }
  const text = ytListDoneText({ added: songs.length, have: (plan?.have?.length || 0) + (want.length - list.length), blocked: plan?.includeBlocked ? 0 : (plan?.blocked?.length || 0), over: plan?.over || 0, fail });
  toast(text, fail ? 8000 : 5000);
  if (songs.length) haptic('success');
  return { songs, fail, text };
}
// [곡 목록에 다 넣기]
async function ytListCommit(onChange) {
  const st = YtList.st;
  if (!st || st.phase !== 'ready') return null;
  const plan = ytListPlanOf(st);
  if (!plan.add.length) return null;
  st.phase = 'adding'; if (typeof onChange === 'function') onChange(st);
  try { return await ytListAdd(plan); }
  finally { if (YtList.st === st) { st.phase = 'ready'; if (typeof onChange === 'function') onChange(st); } }
}
// 미리 보기 카드 (ytCard 모양: 굵은 제목 · 줄들 · 작은 글 · 단추). DOM만 만든다 — 2단계에서 renderYtTab이 부른다.
// v = ytListView(...) · on = { onToggle(켬), onAct('add'|'retry'), onExit() (맨 위에서 ↑: 검색 칸으로), focus('sw'|'add'|'retry': 다시 그린 뒤 둘 곳) }
// TV 리모컨: ↑↓←→로 스위치·단추 사이를 옮기고(core.js pickByArrow), Enter·Space로 누른다. 이 키들은 카드 안에서 끝낸다 (노래방 단축키 Space 재생으로 새지 않게)
function ytListCard(ul, v, on = {}) {
  const li = el('li', 'yt-card yt-c-list ' + (v.cls || ''), '');
  li.setAttribute('role', 'group'); li.setAttribute('aria-label', v.head);
  li.append(el('b', 'yt-card-h', v.head));
  for (const ln of v.lines || []) {
    li.append(el('span', 'yt-card-l', ln.text));
    if (!ln.toggle) continue;
    const lab = el('label', 'guest-sw yt-list-sw', '');
    const t = el('span', '', ''); t.append(el('b', '', ln.toggle.text));
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.setAttribute('role', 'switch'); cb.checked = !!ln.toggle.on; cb.dataset.k = 'sw';
    cb.onchange = () => { if (typeof on.onToggle === 'function') on.onToggle(cb.checked); };
    lab.append(t, cb); li.append(lab);
  }
  if (v.small) li.append(el('small', 'yt-card-s', v.small));
  if (v.btn) {
    const row = el('div', 'yt-guide-btns', '');
    const b = el('button', 'btn' + (v.btn.primary ? ' primary' : ''), v.btn.text);
    b.type = 'button'; b.disabled = !!v.btn.disabled; b.dataset.k = v.btn.act;
    b.onclick = e => { e.stopPropagation(); if (typeof on.onAct === 'function') on.onAct(v.btn.act); };
    row.append(b); li.append(row);
  }
  li.addEventListener('keydown', e => {
    const k = e.key, t = e.target;
    const items = [...li.querySelectorAll('input,button')].filter(x => !x.disabled);
    if (/^Arrow(Up|Down|Left|Right)$/.test(k)) {
      e.preventDefault(); e.stopPropagation();
      const i = items.indexOf(t);
      const pts = items.map(x => { const r = x.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const j = pickByArrow(pts, i, k);
      if ((j === i || j < 0) && k === 'ArrowUp' && typeof on.onExit === 'function') on.onExit();
      else if (items[j]) items[j].focus();
      return;
    }
    if (k === 'Enter' || k === ' ' || e.code === 'Space') {
      e.stopPropagation();   // Space는 브라우저 기본(스위치 켜고 끄기·단추 누르기)만
      if (k === 'Enter' && t && t.dataset && t.dataset.k === 'sw') { e.preventDefault(); t.checked = !t.checked; t.dispatchEvent(new Event('change')); }   // 스위치는 Enter로도
    }
  });
  ul.append(li);
  if (on.focus) { const f = li.querySelector(`[data-k="${on.focus}"]`); if (f && !f.disabled) f.focus(); }
  return li;
}
// 카드의 첫 스위치·단추로 (2단계: 검색 칸에서 ↓)
function ytListFocus(li) { const f = li && [...li.querySelectorAll('input,button')].find(x => !x.disabled); if (f) f.focus(); return !!f; }
