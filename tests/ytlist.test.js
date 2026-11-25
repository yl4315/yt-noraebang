// YT 노래방 재생목록 넣기 (CR-244, js/ytlist.js) 테스트: node --test tests/
// js/util.js + js/core.js + js/ytlist.js를 같은 vm 컨텍스트에서 차례로 실행한다 (tests/load-core.js와 같은 방식, 그 파일은 그대로).
// 브라우저 부분은 작은 가짜 DOM·가짜 fetch·가짜 유튜브 플레이어(tests/ui/fake-yt.js, 화면 점검과 같은 파일)로 시험한다. 진짜 유튜브·구글에 닿지 않는다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const plain = x => JSON.parse(JSON.stringify(x));
const same = (actual, expected) => assert.deepEqual(plain(actual), plain(expected));
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('기다려도 안 됨'); await wait(20); } };

/* ---------- 작은 가짜 DOM ---------- */
function fakeDom() {
  let n = 0;
  const match = (e, sel) => sel.split(',').map(x => x.trim()).some(s => {
    const m = s.match(/^([a-z]*)((?:\.[\w-]+)*)(?:\[([\w-]+)="([^"]*)"\])?$/i);
    if (!m) return false;
    const [, tag, cls, attr, val] = m;
    if (tag && e.localName !== tag.toLowerCase()) return false;
    for (const c of cls.split('.').filter(Boolean)) if (!String(e.className).split(/\s+/).includes(c)) return false;
    if (attr) { const v = attr.startsWith('data-') ? e.dataset[attr.slice(5)] : e.getAttribute(attr); if (v !== val) return false; }
    return true;
  });
  class El {
    constructor(tag) {
      Object.assign(this, { localName: String(tag).toLowerCase(), children: [], parentNode: null, style: {}, dataset: {}, attrs: {}, className: '', textContent: '',
        id: '', ls: {}, disabled: false, checked: false, type: '', hidden: false, _n: ++n, _html: '' });
    }
    get isConnected() { let x = this; while (x.parentNode) x = x.parentNode; return x === doc.documentElement; }
    get innerHTML() { return this._html; }
    set innerHTML(h) { this._html = h; this.children = []; for (const m of String(h).matchAll(/class="([^"]+)"/g)) { const c = new El('span'); c.className = m[1]; this.append(c); } }
    append(...xs) { for (const x of xs) { if (x.parentNode) x.remove(); x.parentNode = this; this.children.push(x); } }
    after(x) { const p = this.parentNode; if (!p) return; if (x.parentNode) x.remove(); p.children.splice(p.children.indexOf(this) + 1, 0, x); x.parentNode = p; }
    remove() { const p = this.parentNode; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentNode = null; } }
    replaceWith(x) { const p = this.parentNode; if (!p) return; if (x.parentNode) x.remove(); p.children.splice(p.children.indexOf(this), 1, x); x.parentNode = p; this.parentNode = null; }
    all() { return this.children.flatMap(c => [c, ...c.all()]); }
    querySelectorAll(sel) { return this.all().filter(e => match(e, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    addEventListener(t, f) { (this.ls[t] ||= []).push(f); }
    dispatchEvent(ev) {
      if (!ev.target) ev.target = this;
      for (let x = this; x && !ev.sp; x = x.parentNode) { for (const f of x.ls[ev.type] || []) f(ev); if (x === this && typeof x['on' + ev.type] === 'function') x['on' + ev.type](ev); }
      return !ev.dp;
    }
    focus() { doc.activeElement = this; }
    getBoundingClientRect() { return { left: 0, top: this._n * 50, width: 100, height: 40 }; }   // 만든 차례대로 위에서 아래로
  }
  const doc = { createElement: t => new El(t), activeElement: null };
  doc.documentElement = new El('html'); doc.body = new El('body'); doc.documentElement.append(doc.body);
  doc.getElementById = id => doc.documentElement.all().find(e => e.id === id) || null;
  doc.querySelector = s => doc.documentElement.querySelector(s);
  doc.querySelectorAll = s => doc.documentElement.querySelectorAll(s);
  class Ev { constructor(type, o = {}) { Object.assign(this, { type, bubbles: !!o.bubbles, target: null, sp: false, dp: false }); } stopPropagation() { this.sp = true; } preventDefault() { this.dp = true; } }
  const key = (key, code = key === ' ' ? 'Space' : key) => Object.assign(new Ev('keydown'), { key, code });
  return { doc, El, Ev, key };
}

/* ---------- 불러오기 ---------- */
const NAMES = ['YT_LIST_MAX', 'YT_KY_CHANNEL', 'YT_LIST_HOST', 'YT_LIST_WHY', 'YT_LIST_ERR', 'parseYouTubeListId', 'ytRankOfficial', 'ytWithChannelIds', 'ytListPlan',
  'ytListItemsPage', 'ytVideosRead', 'ytListJoin', 'ytApiErrorKind', 'ytListView', 'ytListDoneText',
  'YtList', 'ytListBox', 'ytListFetchKey', 'ytListFetchPlayer', 'ytListRead', 'ytListOpen', 'ytListClose', 'ytListPlanOf', 'ytListAdd', 'ytListCommit', 'ytListCard', 'ytListFocus', 'ytListPick',
  'parseYtSearch', 'ytTitleParts', 'nextSongNumbers'];
// dom: 가짜 DOM을 줄지 · fakeYt: tests/ui/fake-yt.js를 같이 불러올지 · extra: 컨텍스트에 더할 이름 (state·persistSong 등)
function load({ dom = true, fakeYt = false, extra = {} } = {}) {
  const D = dom ? fakeDom() : null;
  const timers = [];
  const base = { console, Blob, TextEncoder, TextDecoder, DataView, Uint8Array, URLSearchParams, URL, AbortController, crypto: globalThis.crypto, atob, btoa,
    setTimeout, clearTimeout, clearInterval, performance,
    setInterval: (f, ms) => { const t = setInterval(f, ms); t.unref?.(); timers.push(t); return t; } };
  if (D) Object.assign(base, { document: D.doc, Event: D.Ev, addEventListener() {}, removeEventListener() {} });
  const ctx = vm.createContext(Object.assign(base, extra));
  ctx.window = ctx;
  const run = f => { const file = path.join(ROOT, f); vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file }); };
  for (const f of ['js/util.js', 'js/core.js', 'js/ytlist.js']) run(f);
  if (fakeYt) run('tests/ui/fake-yt.js');
  // 알림·진동은 적어 두기만
  ctx.__toasts = []; ctx.__haptic = [];
  vm.runInContext('toast = (m, ms) => __toasts.push([m, ms]); haptic = k => __haptic.push(k);', ctx);
  const L = vm.runInContext(`({ ${NAMES.join(', ')} })`, ctx);
  return { L, ctx, D, stop: () => timers.forEach(clearInterval) };
}

const { L } = load({ dom: false });
const ID = n => ('vid' + String(n).padStart(8, '0')).slice(-11);   // 11글자 가짜 영상 번호
const KY = 'UCDqaUIUSJP5EVMEI178Zfag', TJ = 'UCZUhx8ClCv6paFW7qi3qljg';

/* ---------------- 링크 읽기 ---------------- */
test('재생목록 링크: watch?v=&list= · playlist?list= · youtu.be?list= · music · nocookie 퍼가기 · 주소만', () => {
  same(L.parseYouTubeListId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLt1UQ3o9-dDAfBGBvxv_37M2n-AUVkFUD&index=2'),
    { ok: true, id: 'PLt1UQ3o9-dDAfBGBvxv_37M2n-AUVkFUD', video: 'dQw4w9WgXcQ' });
  same(L.parseYouTubeListId('https://youtube.com/playlist?list=PLabc_DEF-123&si=xyz'), { ok: true, id: 'PLabc_DEF-123', video: null });
  same(L.parseYouTubeListId('https://youtu.be/dQw4w9WgXcQ?list=PLq123&si=abc'), { ok: true, id: 'PLq123', video: 'dQw4w9WgXcQ' });
  same(L.parseYouTubeListId('https://music.youtube.com/playlist?list=OLAK5uy_kq1-9Abc'), { ok: true, id: 'OLAK5uy_kq1-9Abc', video: null });
  same(L.parseYouTubeListId('https://www.youtube-nocookie.com/embed/videoseries?list=PLembed1'), { ok: true, id: 'PLembed1', video: null });
  same(L.parseYouTubeListId('친구가 보낸 거 m.youtube.com/watch?v=dQw4w9WgXcQ&list=UU_x5XG1OV2P6uZZ5FSM9Ttw 이거 다 넣자'),
    { ok: true, id: 'UU_x5XG1OV2P6uZZ5FSM9Ttw', video: 'dQw4w9WgXcQ' });
  // 영상 링크 뒤의 목록 링크도 찾는다
  same(L.parseYouTubeListId('https://youtu.be/dQw4w9WgXcQ 그리고 https://www.youtube.com/playlist?list=PLsecond'), { ok: true, id: 'PLsecond', video: null });
});

test('재생목록 링크: 내 목록(WL·LL·LM)·자동 믹스(RD·TL)는 이유와 함께 못 넣음, 이상한 번호도', () => {
  for (const id of ['WL', 'LL', 'LM']) {
    const r = L.parseYouTubeListId('https://www.youtube.com/playlist?list=' + id);
    assert.equal(r.ok, false); assert.equal(r.kind, 'mine'); assert.equal(r.why, L.YT_LIST_WHY.mine); assert.equal(r.id, id);
  }
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ', 'https://youtube.com/watch?v=dQw4w9WgXcQ&list=RDMM', 'https://www.youtube.com/watch_videos?video_ids=a,b&list=TLGGabc']) {
    const r = L.parseYouTubeListId(u);
    assert.equal(r.ok, false, u); assert.equal(r.kind, 'mix', u); assert.match(r.why, /믹스/);
  }
  const mix = L.parseYouTubeListId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ');
  assert.equal(mix.video, 'dQw4w9WgXcQ');   // 영상 하나 줄은 그대로 쓸 수 있게
  const bad = L.parseYouTubeListId('https://www.youtube.com/playlist?list=PL%3Cscript%3E');
  assert.equal(bad.ok, false); assert.equal(bad.kind, 'bad');
  assert.equal(L.parseYouTubeListId('https://www.youtube.com/playlist?list=' + 'P'.repeat(81)).kind, 'bad');
});

test('재생목록 링크: 목록이 없거나 유튜브가 아니면 null', () => {
  for (const s of [null, undefined, '', '좋은 날 아이유', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=',
    'https://example.com/playlist?list=PLabc', 'https://notyoutube.com/playlist?list=PLabc', 'https://youtube.com.evil.example/playlist?list=PLabc',
    'https://evil.example/youtube.com/playlist?list=PLabc', 'https://www.youtube.com/@KARAOKEKY/playlists'])
    assert.equal(L.parseYouTubeListId(s), null, String(s));
});

/* ---------------- 검색 순서 ---------------- */
test('검색 순서: 금영 공식 채널만 앞으로, TJ·그 밖은 받은 순서 그대로 (안정)', () => {
  const list = [{ id: 'a', channelId: TJ }, { id: 'b', channelId: KY }, { id: 'c', channelId: 'UCother' }, { id: 'd', channelId: KY }, { id: 'e', channelId: TJ }, { id: 'f' }];
  const copy = plain(list);
  same(L.ytRankOfficial(list).map(x => x.id), ['b', 'd', 'a', 'c', 'e', 'f']);
  same(list, copy);   // 받은 배열은 그대로
  same(L.ytRankOfficial([{ id: 'a', channelId: TJ }, { id: 'e', channelId: TJ }]).map(x => x.id), ['a', 'e']);
  same(L.ytRankOfficial(list, 'UCother').map(x => x.id), ['c', 'a', 'b', 'd', 'e', 'f']);
  same(L.ytRankOfficial(null), []);
  assert.equal(L.YT_KY_CHANNEL, KY);
});

test('검색 순서: search.list 답의 채널 번호를 붙여서 순서를 정한다', () => {
  const json = { items: [
    { id: { videoId: 'aaaaaaaaaaa' }, snippet: { title: '좋은 날 노래방 / TJ Karaoke', channelTitle: 'TJ Karaoke', channelId: TJ } },
    { id: { videoId: 'bbbbbbbbbbb' }, snippet: { title: '[KY 금영노래방] 좋은 날 - 아이유', channelTitle: 'KY Karaoke', channelId: KY } },
  ] };
  const list = L.ytWithChannelIds(L.parseYtSearch(json), json);
  same(list.map(x => x.channelId), [TJ, KY]);
  same(L.ytRankOfficial(list).map(x => x.id), ['bbbbbbbbbbb', 'aaaaaaaaaaa']);
});

/* ---------------- 넣을 계획 ---------------- */
const SONGS = [{ id: 's1', no: 1, source: 'yt', ytId: ID(2), title: '있는 곡' }, { id: 's2', no: 2, title: 'MR 곡' }];
const item = (n, o = {}) => ({ id: ID(n), title: '곡 ' + n, channel: 'KY', channelId: KY, embeddable: true, ...o });

test('계획: 곡 목록에 있는 곡은 건너뛰고, 못 트는 곡은 기본으로 빼고, 겹침·이상한 번호는 하나로', () => {
  const items = [item(1), item(2), item(3, { embeddable: false }), item(4, { embeddable: null }), item(1), { id: 'short' }, item(5)];
  const p = L.ytListPlan(items, SONGS);
  same(p.add.map(x => x.id), [ID(1), ID(4), ID(5)]);   // 모름(null)은 넣는다 (틀 때 안내)
  same(p.have.map(x => [x.item.id, x.song.id]), [[ID(2), 's1']]);
  same(p.blocked.map(x => x.id), [ID(3)]);
  assert.equal(p.n, 5); assert.equal(p.dup, 1); assert.equal(p.over, 0); assert.equal(p.cut, false); assert.equal(p.includeBlocked, false);
});

test('계획: [그 곡도 넣기]를 켜면 못 트는 곡도 넣는다 (목록 순서대로)', () => {
  const p = L.ytListPlan([item(1), item(3, { embeddable: false }), item(5)], SONGS, { includeBlocked: true });
  same(p.add.map(x => x.id), [ID(1), ID(3), ID(5)]);
  same(p.blocked.map(x => x.id), [ID(3)]);
  assert.equal(p.includeBlocked, true);
});

test('계획: 한 번에 200곡까지 · 넘으면 앞 200곡만 (있는 곡은 한도에 안 셈) · 안 읽은 뒷부분·꽉 찬 200개도 안내', () => {
  const many = Array.from({ length: 260 }, (_, i) => item(i + 1));
  const p = L.ytListPlan(many, SONGS);
  assert.equal(p.add.length, 200); assert.equal(p.add[0].id, ID(1)); assert.equal(p.add[199].id, ID(201));   // ID(2)는 있는 곡
  assert.equal(p.have.length, 1); assert.equal(p.over, 59); assert.equal(p.cut, true); assert.equal(p.n, 260);
  assert.equal(L.YT_LIST_MAX, 200);
  const q = L.ytListPlan([item(1), item(3)], [], { more: 40 });
  assert.equal(q.n, 42); assert.equal(q.over, 40); assert.equal(q.cut, true);
  const r = L.ytListPlan([item(1)], [], { maybeMore: true });
  assert.equal(r.over, 0); assert.equal(r.cut, true);
  assert.equal(L.ytListPlan([item(1), item(3)], [], { limit: 1 }).over, 1);
  same(plain(L.ytListPlan(null, null)).add, []);
});

/* ---------------- 열쇠 답 읽기 ---------------- */
test('열쇠 답: playlistItems 한 쪽 → 영상 번호·다음 쪽·전체 수 (지운·비공개 영상은 뺌)', () => {
  const p = L.ytListItemsPage({ nextPageToken: 'NEXT', pageInfo: { totalResults: 120 }, items: [
    { contentDetails: { videoId: ID(1) }, status: { privacyStatus: 'public' } },
    { contentDetails: { videoId: ID(2) }, status: { privacyStatus: 'private' } },
    { contentDetails: { videoId: ID(3) }, status: { privacyStatus: 'privacyStatusUnspecified' } },   // 지운 영상
    { contentDetails: { videoId: ID(4) }, status: { privacyStatus: 'unlisted' } },
    { contentDetails: {} },
  ] });
  same(p, { ids: [ID(1), ID(4)], next: 'NEXT', total: 120, gone: 3, raw: 5 });
  same(L.ytListItemsPage({ items: [] }), { ids: [], next: null, total: null, gone: 0, raw: 0 });
  same(L.ytListItemsPage(null), { ids: [], next: null, total: null, gone: 0, raw: 0 });
});

test('열쇠 답: videos(status,snippet) → 제목·채널·퍼가기 됨, 비공개·지움·거절은 뺌', () => {
  const m = L.ytVideosRead({ items: [
    { id: ID(1), snippet: { title: '좋은 날 &amp; 너랑 나', channelTitle: 'KY Karaoke', channelId: KY }, status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' } },
    { id: ID(2), snippet: { title: '막힌 곡', channelTitle: 'KY Karaoke', channelId: KY }, status: { embeddable: false, privacyStatus: 'public', uploadStatus: 'processed' } },
    { id: ID(3), snippet: { title: '비공개' }, status: { embeddable: true, privacyStatus: 'private' } },
    { id: ID(4), snippet: { title: '지움' }, status: { uploadStatus: 'deleted' } },
    { id: ID(5), snippet: { title: '거절' }, status: { uploadStatus: 'rejected' } },
    { id: ID(6), snippet: { title: '모름' }, status: {} },
    { id: 'bad' },
  ] });
  same([...m.keys()], [ID(1), ID(2), ID(6)]);
  same(m.get(ID(1)), { id: ID(1), title: '좋은 날 & 너랑 나', channel: 'KY Karaoke', channelId: KY, embeddable: true });
  assert.equal(m.get(ID(2)).embeddable, false); assert.equal(m.get(ID(6)).embeddable, null);
  const j = L.ytListJoin([ID(2), ID(3), ID(1)], m);
  same(j.items.map(x => x.id), [ID(2), ID(1)]); assert.equal(j.gone, 1);
});

test('열쇠 오류: 한도·열쇠 문제는 열쇠 없는 길로, 비공개·없는 목록은 그대로 알림', () => {
  const E = (reason, code) => ({ error: { code, errors: [{ reason }] } });
  assert.equal(L.ytApiErrorKind(403, E('quotaExceeded', 403)), 'blocked');
  assert.equal(L.ytApiErrorKind(400, E('keyInvalid', 400)), 'blocked');
  assert.equal(L.ytApiErrorKind(429, null), 'blocked');
  assert.equal(L.ytApiErrorKind(403, null), 'blocked');
  assert.equal(L.ytApiErrorKind(404, E('playlistNotFound', 404)), 'notfound');
  assert.equal(L.ytApiErrorKind(403, E('playlistItemsNotAccessible', 403)), 'private');
  assert.equal(L.ytApiErrorKind(500, null), 'other');
});

// 가짜 fetch: playlistItems는 total개를 50개씩, videos는 받은 번호대로 (blocked·gone 번호는 막힘·지움)
function fakeApi({ total = 120, blocked = [], gone = [], fail = null } = {}) {
  const calls = [];
  const all = Array.from({ length: total }, (_, i) => ID(i + 1));
  const fn = async (url, opt) => {
    const u = new URL(url), q = Object.fromEntries(u.searchParams), what = u.pathname.split('/').pop();
    calls.push({ what, q, opt });
    if (fail && fail.what === what) return { ok: false, status: fail.status, json: async () => fail.json || {} };
    if (what === 'playlistItems') {
      const start = q.pageToken ? +q.pageToken : 0, part = all.slice(start, start + +q.maxResults);
      return { ok: true, status: 200, json: async () => ({ nextPageToken: start + part.length < total ? String(start + part.length) : undefined, pageInfo: { totalResults: total },
        items: part.map(id => ({ contentDetails: { videoId: id }, status: { privacyStatus: 'public' } })) }) };
    }
    const ids = q.id.split(',');
    return { ok: true, status: 200, json: async () => ({ items: ids.filter(id => !gone.includes(id)).map(id => ({ id, snippet: { title: '노래 ' + id + ' / KY Karaoke', channelTitle: 'KY Karaoke', channelId: KY },
      status: { embeddable: !blocked.includes(id), privacyStatus: 'public', uploadStatus: 'processed' } })) }) };
  };
  return { fn, calls };
}

test('열쇠 길: 50개씩 넘겨 읽고 videos로 퍼가기 됨을 본다 (쿠키 없이, 열쇠는 결과에 안 남음)', async () => {
  const api = fakeApi({ total: 120, blocked: [ID(7)], gone: [ID(9)] });
  const r = await L.ytListFetchKey('PLtest', 'TESTKEY-not-real', { fetchFn: api.fn });
  assert.equal(r.ok, true); assert.equal(r.keyUsed, true);
  assert.equal(r.items.length, 119); assert.equal(r.gone, 1); assert.equal(r.more, 0);
  same(r.items.slice(0, 2).map(x => x.id), [ID(1), ID(2)]);
  assert.equal(r.items.find(x => x.id === ID(7)).embeddable, false);
  same(api.calls.map(c => c.what), ['playlistItems', 'playlistItems', 'playlistItems', 'videos', 'videos', 'videos']);
  for (const c of api.calls) {
    assert.equal(c.opt.credentials, 'omit'); assert.ok(c.opt.signal); assert.equal(c.q.key, 'TESTKEY-not-real');
    assert.ok(+c.q.maxResults <= 50);
  }
  assert.equal(api.calls[0].q.playlistId, 'PLtest'); assert.equal(api.calls[0].q.part, 'contentDetails,status');
  assert.equal(api.calls[3].q.part, 'status,snippet'); assert.equal(api.calls[3].q.id.split(',').length, 50);
  assert.ok(!JSON.stringify(r).includes('TESTKEY'));
  const p = L.ytListPlan(r.items, []);
  assert.equal(p.add.length, 118); assert.equal(p.blocked.length, 1);
});

test('열쇠 길: 200개까지만 읽고 나머지는 more로 센다 (부르는 수 8번)', async () => {
  const api = fakeApi({ total: 260 });
  const r = await L.ytListFetchKey('PLbig', 'k', { fetchFn: api.fn });
  assert.equal(r.items.length, 200); assert.equal(r.more, 60);
  assert.equal(api.calls.length, 8);
  const p = L.ytListPlan(r.items, [], { more: r.more });
  assert.equal(p.n, 260); assert.equal(p.add.length, 200); assert.equal(p.over, 60); assert.equal(p.cut, true);
});

test('열쇠 길: 403(한도)·404·비공개·인터넷 끊김·10초 넘음', async () => {
  const q = await L.ytListFetchKey('PL1', 'k', { fetchFn: fakeApi({ fail: { what: 'playlistItems', status: 403, json: { error: { errors: [{ reason: 'quotaExceeded' }] } } } }).fn });
  same(q, { ok: false, kind: 'blocked', status: 403 });
  const v = await L.ytListFetchKey('PL1', 'k', { fetchFn: fakeApi({ fail: { what: 'videos', status: 403 } }).fn });
  assert.equal(v.kind, 'blocked');
  assert.equal((await L.ytListFetchKey('PL1', 'k', { fetchFn: fakeApi({ fail: { what: 'playlistItems', status: 404, json: { error: { errors: [{ reason: 'playlistNotFound' }] } } } }).fn })).kind, 'notfound');
  assert.equal((await L.ytListFetchKey('PL1', 'k', { fetchFn: fakeApi({ fail: { what: 'playlistItems', status: 403, json: { error: { errors: [{ reason: 'playlistItemsNotAccessible' }] } } } }).fn })).kind, 'private');
  assert.equal((await L.ytListFetchKey('PL1', 'k', { fetchFn: async () => { throw new TypeError('Failed to fetch'); } })).kind, 'net');
  const slow = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('AbortError'))));
  assert.equal((await L.ytListFetchKey('PL1', 'k', { fetchFn: slow, timeoutMs: 30 })).kind, 'net');
  assert.equal((await L.ytListFetchKey('PL1', '', { fetchFn: fakeApi().fn })).kind, 'blocked');
});

/* ---------------- 열쇠 없는 길 (가짜 유튜브 플레이어) ---------------- */
test('가짜 플레이어도 진짜처럼: 같은 플레이어에 둘째 목록(객체 꼴)을 올리면 첫 목록이 남는다', async () => {
  const { ctx, D, stop } = load({ fakeYt: true });
  ctx.__ytLists = { A: { ids: [ID(1), ID(2)] }, B: { ids: [ID(3)] } };
  const spot = D.doc.createElement('div'); D.doc.body.append(spot);
  const p = await new Promise(res => { const pl = new ctx.YT.Player(spot, { events: { onReady: () => res(pl) } }); });
  p.cuePlaylist({ listType: 'playlist', list: 'A', index: 0 }); await wait(40);
  same(p.getPlaylist(), [ID(1), ID(2)]); assert.equal(p.getPlaylistIndex(), 0);
  p.cuePlaylist({ listType: 'playlist', list: 'B', index: 0 }); await wait(40);
  same(p.getPlaylist(), [ID(1), ID(2)]);   // 남음 (11-24 ⓪와 같음)
  p.cuePlaylist('B'); await wait(40);
  same(p.getPlaylist(), [ID(3)]);
  p.destroy();
  assert.equal(p.el.isConnected, false);
  assert.ok(ctx.__ytFake.calls.some(c => c[0] === 'destroyList'));
  stop();
});

test('열쇠 없는 길: 목록마다 새 플레이어 → 영상 번호, 첫 곡 제목, 읽고 나면 플레이어·칸을 없앤다', async () => {
  const { L: M, ctx, D, stop } = load({ fakeYt: true });
  ctx.__ytLists = { A: { ids: [ID(1), ID(2), ID(3)] }, B: { ids: [ID(4), ID(5)] } };
  ctx.__ytVideos = { [ID(1)]: { title: '[KY 금영노래방] 좋은 날 - 아이유', author: 'KY Karaoke' } };
  const a = await M.ytListFetchPlayer('A', { YTns: ctx.YT });
  assert.equal(a.ok, true); assert.equal(a.keyUsed, false); assert.equal(a.maybeMore, false);
  same(a.items.map(x => x.id), [ID(1), ID(2), ID(3)]);
  same(a.items[0], { id: ID(1), title: '[KY 금영노래방] 좋은 날 - 아이유', channel: 'KY Karaoke', channelId: '', embeddable: null });
  assert.equal(a.items[1].title, '');
  const b = await M.ytListFetchPlayer('B', { YTns: ctx.YT });
  same(b.items.map(x => x.id), [ID(4), ID(5)]);   // 둘째 목록도 제대로 (새 플레이어)
  const F = ctx.__ytFake;
  assert.equal(F.players.length, 2);
  same(F.calls.filter(c => c[0] === 'cueList').map(c => [c[1], c[2]]), [['A', 'obj'], ['B', 'obj']]);
  assert.equal(F.calls.filter(c => c[0] === 'destroyList').length, 2);
  assert.ok(!F.calls.some(c => c[0] === 'play' || c[0] === 'cue'));   // 틀지 않는다
  assert.equal(F.host, 'https://www.youtube-nocookie.com');
  assert.equal(D.doc.querySelectorAll('.yt-list-box').length, 0);   // 칸도 없앰
  assert.equal(M.YtList.player, null);
  stop();
});

test('열쇠 없는 길: 받은 칸(box)에 플레이어를 두고 칸은 남긴다 · host를 받는다 · 200개 꽉 차면 뒤가 더 있을 수 있음', async () => {
  const { L: M, ctx, D, stop } = load({ fakeYt: true });
  ctx.__ytLists = { BIG: { ids: Array.from({ length: 230 }, (_, i) => ID(i + 1)) } };
  const box = D.doc.createElement('div'); box.className = 'yt-list-box'; D.doc.body.append(box);
  const r = await M.ytListFetchPlayer('BIG', { YTns: ctx.YT, box, host: 'https://www.youtube.com' });
  assert.equal(r.items.length, 200); assert.equal(r.maybeMore, true);
  assert.equal(ctx.__ytFake.host, 'https://www.youtube.com');
  assert.equal(box.isConnected, true); assert.equal(box.children.length, 0);
  assert.equal(M.ytListPlan(r.items, [], { maybeMore: r.maybeMore }).cut, true);
  stop();
});

test('열쇠 없는 길: 칸을 만드는 함수(box: () => …)를 주면 앞 플레이어를 없앤 뒤 anchor 뒤에 칸을 만들고, 다 읽으면 칸도 없앤다 (2단계)', async () => {
  const { L: M, ctx, D, stop } = load({ fakeYt: true });
  ctx.__ytLists = { A: { ids: [ID(1)], late: 80 }, B: { ids: [ID(2), ID(3)] } };
  const wrap = D.doc.createElement('div'), anchor = D.doc.createElement('ul'); wrap.append(anchor); D.doc.body.append(wrap);
  const mk = () => M.ytListBox(anchor);
  const pa = M.ytListFetchPlayer('A', { YTns: ctx.YT, box: mk });
  await wait(40);
  const boxA = D.doc.querySelector('.yt-list-box');
  assert.ok(boxA); assert.equal(boxA.parentNode, wrap); assert.equal(wrap.children[1], boxA);   // anchor 바로 뒤 · 읽는 동안 보임
  assert.equal(M.YtList.boxMine, true);
  same((await pa).items.map(x => x.id), [ID(1)]);
  assert.equal(D.doc.querySelectorAll('.yt-list-box').length, 0); assert.equal(M.YtList.box, null);
  // 읽는 중에 다른 목록: 앞 플레이어·칸을 없애고 새 칸에서 (칸이 떨어져 나가 플레이어가 안 보이는 일 없음)
  ctx.__ytLists.A.late = 300;
  const p1 = M.ytListFetchPlayer('A', { YTns: ctx.YT, box: mk, timeoutMs: 400 });
  await wait(40);
  const first = D.doc.querySelector('.yt-list-box');
  const p2 = M.ytListFetchPlayer('B', { YTns: ctx.YT, box: mk });
  await wait(5);
  assert.equal(first.isConnected, false);
  const r2 = await p2;
  same(r2.items.map(x => x.id), [ID(2), ID(3)]);
  assert.equal((await p1).ok, false);   // 앞 목록은 버림
  assert.equal(D.doc.querySelectorAll('.yt-list-box').length, 0);
  same(ctx.__ytFake.players.map(p => p.o.host), ['https://www.youtube-nocookie.com', 'https://www.youtube-nocookie.com', 'https://www.youtube-nocookie.com']);
  stop();
});

test('열쇠 없는 길: 없는·비공개 목록, 빈 목록, 첫 곡이 막혀도 목록은 읽음, 플레이어를 못 불러옴', async () => {
  const { L: M, ctx, stop } = load({ fakeYt: true });
  ctx.__ytLists = { EMPTY: { ids: [] }, ERR: { ids: [ID(1), ID(2)], err: 150 } };
  const nf = await M.ytListFetchPlayer('NOPE', { YTns: ctx.YT, errMs: 50 });
  assert.equal(nf.ok, false); assert.equal(nf.kind, 'player'); assert.equal(nf.code, 100);
  const em = await M.ytListFetchPlayer('EMPTY', { YTns: ctx.YT, settleMs: 50 });
  assert.equal(em.kind, 'empty');
  const er = await M.ytListFetchPlayer('ERR', { YTns: ctx.YT, errMs: 50 });
  assert.equal(er.ok, true); same(er.items.map(x => x.id), [ID(1), ID(2)]);
  const to = await M.ytListFetchPlayer('SLOW', { YTns: { Player: class { constructor() {} } }, timeoutMs: 60 });
  assert.equal(to.kind, 'timeout');
  assert.equal((await M.ytListFetchPlayer('A')).kind, 'api');   // ytLoadApi(yt.js)가 없으면
  same(Object.keys(M.YT_LIST_ERR).sort(), ['api', 'empty', 'net', 'notfound', 'offline', 'other', 'player', 'private', 'timeout']);
  stop();
});

test('목록 읽기: 열쇠가 막히면(403) Yt.keyBlocked를 켜고 열쇠 없는 길로 · 읽은 목록은 이 화면 동안 다시 안 부름', async () => {
  const { L: M, ctx, stop } = load({ fakeYt: true });
  vm.runInContext('var Yt = { keyBlocked: false, meta: new Map() };', ctx);
  ctx.__ytLists = { PLx: { ids: [ID(1), ID(2)] } };
  const api = fakeApi({ fail: { what: 'playlistItems', status: 403, json: { error: { errors: [{ reason: 'quotaExceeded' }] } } } });
  const r = await M.ytListRead('PLx', { key: 'k', fetchFn: api.fn, YTns: ctx.YT });
  assert.equal(r.ok, true); assert.equal(r.keyUsed, false); assert.equal(ctx.Yt.keyBlocked, true);
  const again = await M.ytListRead('PLx', { key: null, YTns: ctx.YT });
  assert.equal(again, r);
  assert.equal(ctx.__ytFake.calls.filter(c => c[0] === 'cueList').length, 1);
  // 비공개 목록은 열쇠 없는 길로 가지 않고 그대로 알린다
  const pv = await M.ytListRead('PLpriv', { key: 'k', fetchFn: fakeApi({ fail: { what: 'playlistItems', status: 403, json: { error: { errors: [{ reason: 'playlistItemsNotAccessible' }] } } } }).fn, YTns: ctx.YT });
  assert.equal(pv.kind, 'private');
  stop();
});

/* ---------------- 카드 글 ---------------- */
test('카드 글: 재생목록 N곡 · 있는 곡 건너뜀 · 못 트는 곡 + [그 곡도 넣기] · [곡 목록에 다 넣기] · 예약은 안 해요', () => {
  const plan = L.ytListPlan([item(1), item(2), item(3, { embeddable: false }), item(4)], SONGS);
  const v = L.ytListView({ phase: 'ready', plan, keyUsed: true });
  same(v, { cls: 'yt-c-list-ready', head: '재생목록 4곡', lines: [
    { text: '곡 목록에 있는 1곡은 건너뛰어요' },
    { text: '1곡은 노래방 안에서 못 틀어요 (유튜브 앱에서는 돼요)', toggle: { text: '그 곡도 넣기', on: false } },
  ], btn: { text: '곡 목록에 다 넣기', act: 'add', primary: true, disabled: false }, small: '예약은 안 해요' });
  const on = L.ytListView({ phase: 'ready', plan: L.ytListPlan([item(3, { embeddable: false })], [], { includeBlocked: true }), keyUsed: true });
  assert.equal(on.lines[0].toggle.on, true); assert.equal(on.btn.disabled, false);
});

test('카드 글: 열쇠 없음 · 200곡 넘음 · 넣을 곡 없음 · 넣는 중 · 읽는 중 · 못 넣는 목록 · 오류', () => {
  const nokey = L.ytListView({ phase: 'ready', plan: L.ytListPlan([item(1)], [], { maybeMore: true }), keyUsed: false });
  same(nokey.lines.map(x => x.text), ['앞 200곡만 넣어요', '제목은 틀 때 보여요']);
  const none = L.ytListView({ phase: 'ready', plan: L.ytListPlan([item(2)], SONGS), keyUsed: true });
  assert.equal(none.btn.disabled, true); assert.ok(none.lines.some(x => x.text === '새로 넣을 곡이 없어요'));
  const gone = L.ytListView({ phase: 'ready', plan: L.ytListPlan([item(1)], [], { gone: 2 }), keyUsed: true });
  assert.ok(gone.lines.some(x => x.text === '지웠거나 비공개인 2곡은 빼요'));
  const adding = L.ytListView({ phase: 'adding', plan: L.ytListPlan([item(1)], []), keyUsed: true });
  same(adding.btn, { text: '넣는 중…', act: 'add', primary: true, disabled: true });
  same(L.ytListView({ phase: 'loading' }), { cls: 'yt-c-list-busy', head: '재생목록을 읽는 중…', lines: [], btn: null, small: '' });
  const bad = L.ytListView({ phase: 'bad', why: L.YT_LIST_WHY.mine });
  assert.equal(bad.head, '이 재생목록은 넣을 수 없어요'); same(bad.lines, [{ text: L.YT_LIST_WHY.mine }]); assert.equal(bad.btn, null);
  const err = L.ytListView({ phase: 'error', kind: 'private' });
  assert.equal(err.head, '재생목록을 읽지 못했어요'); assert.equal(err.lines[0].text, L.YT_LIST_ERR.private); assert.equal(err.btn.act, 'retry');
  assert.equal(L.ytListView({ phase: 'error', kind: 'offline' }).btn, null);
  assert.equal(L.ytListView({ phase: 'error', kind: '???' }).lines[0].text, L.YT_LIST_ERR.other);
});

test('끝 알림: N곡 넣었어요 · 있던 K곡 건너뜀 · 못 트는 M곡 뺌', () => {
  assert.equal(L.ytListDoneText({ added: 12, have: 3, blocked: 2 }), '12곡 넣었어요 · 있던 3곡 건너뜀 · 못 트는 2곡 뺌');
  assert.equal(L.ytListDoneText({ added: 5 }), '5곡 넣었어요');
  assert.equal(L.ytListDoneText({ added: 200, over: 40 }), '200곡 넣었어요 · 뒤 40곡은 안 넣음 (한 번에 200곡까지)');
  assert.match(L.ytListDoneText({ added: 3, fail: 1 }), /1곡은 이 기기에 저장하지 못했어요/);
});

/* ---------------- 곡 목록에 넣기 ---------------- */
function addCtx({ failIds = [] } = {}) {
  const saved = [], render = { n: 0 }, persist = { n: 0 };
  const songs = [{ id: 's1', no: 10002, source: 'yt', ytId: ID(2), title: '있는 곡' }, { id: 's2', no: 10007, title: 'MR 곡' }];
  const env = load({ extra: {
    state: { songs },
    persistSong: async (s, meta, quiet) => { saved.push({ id: s.ytId, meta, quiet }); return !failIds.includes(s.ytId); },
    renderSongs: () => { render.n++; }, requestPersist: () => { persist.n++; },
    ytPlaceholder: id => '유튜브 영상 ' + id,
  } });
  vm.runInContext('var Yt = { keyBlocked: false, meta: new Map() };', env.ctx);
  return { ...env, saved, render, persist, songs };
}

test('넣기: ytAdd와 같은 곡 모양 · 번호는 뒤로 차례대로 · 저장은 한꺼번에(실패 알림 없이) · 그리기·알림은 한 번', async () => {
  const { L: M, ctx, saved, render, persist, songs } = addCtx();
  const plan = M.ytListPlan([item(1, { title: '[KY 금영노래방] 좋은 날 - 아이유', channel: 'KY Karaoke' }), item(2), item(3, { embeddable: false }), item(4, { title: '', channel: '' })], songs);
  const r = await M.ytListAdd(plan);
  assert.equal(r.songs.length, 2); assert.equal(songs.length, 4);
  const [a, b] = r.songs;
  same(Object.keys(a).sort(), ['artist', 'createdAt', 'id', 'lyricOffset', 'lyrics', 'no', 'source', 'title', 'ytId']);
  const tp = M.ytTitleParts('[KY 금영노래방] 좋은 날 - 아이유', 'KY Karaoke');
  same({ no: a.no, source: a.source, ytId: a.ytId, title: a.title, artist: a.artist, lyrics: a.lyrics, lyricOffset: a.lyricOffset },
    { no: 10008, source: 'yt', ytId: ID(1), title: tp.title, artist: tp.artist, lyrics: '', lyricOffset: 0 });
  same([b.no, b.title, b.artist], [10009, '유튜브 영상 ' + ID(4), '']);
  same(saved, [{ id: ID(1), meta: true, quiet: true }, { id: ID(4), meta: true, quiet: true }]);
  assert.equal(render.n, 1); assert.equal(persist.n, 1);
  same(ctx.__toasts, [['2곡 넣었어요 · 있던 1곡 건너뜀 · 못 트는 1곡 뺌', 5000]]);
  same(ctx.__haptic, ['success']);
  same(ctx.Yt.meta.get(ID(1)), { title: '[KY 금영노래방] 좋은 날 - 아이유', channel: 'KY Karaoke' });
  // 같은 계획을 또 누르면 (그 사이 들어간 곡) 다 건너뛴다
  const again = await M.ytListAdd(plan);
  assert.equal(again.songs.length, 0); assert.equal(render.n, 1);
  assert.equal(ctx.__toasts[1][0], '0곡 넣었어요 · 있던 3곡 건너뜀 · 못 트는 1곡 뺌');
});

test('넣기: 저장 실패한 곡 수를 알림에 · [그 곡도 넣기]를 켜면 "뺌"이 없다', async () => {
  const { L: M, ctx, songs } = addCtx({ failIds: [ID(5)] });
  const plan = M.ytListPlan([item(3, { embeddable: false }), item(5)], songs, { includeBlocked: true });
  const r = await M.ytListAdd(plan);
  assert.equal(r.fail, 1); assert.equal(r.songs.length, 2);
  assert.equal(ctx.__toasts[0][0], '2곡 넣었어요 · 1곡은 이 기기에 저장하지 못했어요 · 저장 공간을 확인해 주세요');
  assert.equal(ctx.__toasts[0][1], 8000);
});

test('카드 상태: 열기 → 읽기(열쇠) → 계획 → [곡 목록에 다 넣기] (넣는 동안 adding) · 인터넷 끊김', async () => {
  const api = fakeApi({ total: 3, blocked: [ID(3)] });
  const { L: M, ctx, songs } = addCtx();
  vm.runInContext('var __key = "k"; function ytHasKey() { return !Yt.keyBlocked; } function ytKeyValue() { return __key; }', ctx);
  ctx.fetch = api.fn;
  const changes = [];
  const st = M.ytListOpen('PLopen', { onChange: s => changes.push(s.phase) });
  assert.equal(st.phase, 'loading'); assert.equal(M.ytListOpen('PLopen'), st);   // 같은 목록은 그대로
  await wait(20);
  same(changes, ['ready']);
  const plan = M.ytListPlanOf(st);
  same([plan.n, plan.add.length, plan.have.length, plan.blocked.length], [3, 1, 1, 1]);
  const done = M.ytListCommit(s => changes.push(s.phase));
  assert.equal(st.phase, 'adding');
  await done;
  same(changes, ['ready', 'adding', 'ready']);
  assert.equal(songs.length, 3);
  assert.equal(await M.ytListCommit(), null);   // 이제 넣을 곡 없음
  st.includeBlocked = true;
  assert.equal(M.ytListPlanOf(st).add.length, 1);
  M.ytListClose(); assert.equal(M.YtList.st, null);
  ctx.navigator = { onLine: false };
  const off = M.ytListOpen('PLother');
  assert.equal(off.phase, 'error'); assert.equal(off.kind, 'offline');
});

test('카드 상태: 못 읽은 목록은 다시 그려도 또 읽지 않고, [다시 해 보기](retry)·인터넷이 다시 되면 새로 읽는다', async () => {
  const { L: M, ctx, stop } = load({ fakeYt: true });
  vm.runInContext('var Yt = { keyBlocked: false, meta: new Map() }; function ytLoadApi() { return Promise.resolve(YT); }', ctx);
  const opts = { box: null, onChange: () => {} };
  ctx.__ytLists = {};
  const st = M.ytListOpen('PLgone', opts);
  await until(() => st.phase !== 'loading');
  assert.equal(st.phase, 'error'); assert.equal(st.kind, 'player');
  const cues = () => ctx.__ytFake.calls.filter(c => c[0] === 'cueList').length;
  assert.equal(cues(), 1);
  assert.equal(M.ytListOpen('PLgone', opts), st); assert.equal(M.ytListOpen('PLgone', opts), st);   // 다시 그리기: 그대로
  assert.equal(cues(), 1);
  ctx.__ytLists.PLgone = { ids: [ID(1)] };
  const again = M.ytListOpen('PLgone', { ...opts, retry: true });
  assert.notEqual(again, st); assert.equal(again.phase, 'loading');
  await until(() => again.phase !== 'loading');
  assert.equal(again.phase, 'ready'); assert.equal(cues(), 2);
  M.ytListClose();
  // 인터넷 끊김 → 다시 되면 같은 목록도 새로
  ctx.navigator = { onLine: false };
  const off = M.ytListOpen('PLnet');
  assert.equal(off.kind, 'offline'); assert.equal(M.ytListOpen('PLnet'), off);
  ctx.navigator = { onLine: true };
  ctx.__ytLists.PLnet = { ids: [ID(2)] };
  const on = M.ytListOpen('PLnet');
  assert.notEqual(on, off); assert.equal(on.phase, 'loading');
  await until(() => on.phase !== 'loading');
  assert.equal(on.phase, 'ready');
  M.ytListClose();
  stop();
});

test('카드 상태: 다 넣은 뒤 알림 글을 카드에 남긴다 (done) → [다 넣었어요](막힘) · 못 트는 곡이 남았으면 스위치 · 켜면 다시 [곡 목록에 다 넣기]', async () => {
  const api = fakeApi({ total: 3, blocked: [ID(3)] });
  const { L: M, ctx } = addCtx();
  vm.runInContext('var __key = "k"; function ytHasKey() { return !Yt.keyBlocked; } function ytKeyValue() { return __key; }', ctx);
  ctx.fetch = api.fn;
  const st = M.ytListOpen('PLdone');
  await wait(20);
  assert.equal(st.done, '');
  await M.ytListCommit();
  assert.equal(st.done, '1곡 넣었어요 · 있던 1곡 건너뜀 · 못 트는 1곡 뺌');
  const v = M.ytListView({ ...st, plan: M.ytListPlanOf(st) });
  same(v, { cls: 'yt-c-list-ready yt-c-list-done', head: '재생목록 3곡', lines: [
    { text: '1곡 넣었어요 · 있던 1곡 건너뜀 · 못 트는 1곡 뺌' },
    { text: '1곡은 노래방 안에서 못 틀어요 (유튜브 앱에서는 돼요)', toggle: { text: '그 곡도 넣기', on: false } },
  ], btn: { text: '다 넣었어요', act: 'add', primary: false, disabled: true }, small: '곡 목록에서 골라 예약해요' });
  st.includeBlocked = true;
  const v2 = M.ytListView({ ...st, plan: M.ytListPlanOf(st) });
  same(v2.btn, { text: '곡 목록에 다 넣기', act: 'add', primary: true, disabled: false }); assert.equal(v2.head, '재생목록 3곡');
  await M.ytListCommit();
  const v3 = M.ytListView({ ...st, plan: M.ytListPlanOf(st) });
  same(v3.lines, [{ text: '1곡 넣었어요 · 있던 2곡 건너뜀' }]); assert.equal(v3.btn.text, '다 넣었어요');
  // 넣는 중(adding)에는 done이 있어도 넣는 중 카드
  assert.equal(M.ytListView({ ...st, phase: 'adding', plan: M.ytListPlan([item(9)], []) }).btn.text, '넣는 중…');
  M.ytListClose();
});

/* ---------------- 카드 화면 (가짜 DOM) ---------------- */
test('카드: ytCard 모양 · 스위치 · 큰 단추 · TV 리모컨 화살표·Enter·Space가 카드 안에서 끝남', () => {
  const { L: M, D } = load();
  const ul = D.doc.createElement('ul'); D.doc.body.append(ul);
  const got = { toggle: [], act: [], exit: 0 };
  const v = M.ytListView({ phase: 'ready', plan: M.ytListPlan([item(1), item(3, { embeddable: false })], []), keyUsed: true });
  const li = M.ytListCard(ul, v, { onToggle: x => got.toggle.push(x), onAct: a => got.act.push(a), onExit: () => got.exit++ });
  assert.equal(li.className, 'yt-card yt-c-list yt-c-list-ready'); assert.equal(li.getAttribute('role'), 'group');
  assert.equal(li.querySelector('.yt-card-h').textContent, '재생목록 2곡');
  same(li.querySelectorAll('.yt-card-l').map(x => x.textContent), ['1곡은 노래방 안에서 못 틀어요 (유튜브 앱에서는 돼요)']);
  const sw = li.querySelector('input'), btn = li.querySelector('button');
  assert.equal(sw.parentNode.className, 'guest-sw yt-list-sw'); assert.equal(sw.type, 'checkbox'); assert.equal(sw.getAttribute('role'), 'switch'); assert.equal(sw.checked, false);
  assert.equal(sw.parentNode.querySelector('b').textContent, '그 곡도 넣기');
  assert.equal(li.querySelector('small').textContent, '예약은 안 해요');
  assert.equal(btn.className, 'btn primary'); assert.equal(btn.textContent, '곡 목록에 다 넣기'); assert.equal(btn.type, 'button');
  // ↓: 스위치 → 단추 · ↑ 맨 위: 카드 밖(검색 칸)으로
  sw.focus();
  let e = D.key('ArrowDown'); sw.dispatchEvent(e);
  assert.equal(D.doc.activeElement, btn); assert.equal(e.sp, true); assert.equal(e.dp, true);
  e = D.key('ArrowUp'); btn.dispatchEvent(e); assert.equal(D.doc.activeElement, sw);
  e = D.key('ArrowUp'); sw.dispatchEvent(e); assert.equal(got.exit, 1);
  // Enter로 스위치 켜기 · Space는 브라우저 기본(스위치·단추)으로 두고 노래방 단축키(재생)로 새지 않게
  e = D.key('Enter'); sw.dispatchEvent(e);
  assert.equal(sw.checked, true); same(got.toggle, [true]); assert.equal(e.sp, true);
  e = D.key(' '); btn.dispatchEvent(e); assert.equal(e.sp, true); assert.equal(e.dp, false);
  e = D.key('Enter'); btn.dispatchEvent(e); assert.equal(e.sp, true); assert.equal(e.dp, false);
  const c = new D.Ev('click'); btn.dispatchEvent(c); same(got.act, ['add']);
  assert.equal(M.ytListFocus(li), true); assert.equal(D.doc.activeElement, sw);
});

test('카드 화살표: 스위치(줄 오른쪽)와 단추(왼쪽 아래)처럼 45도 밖이어도 ↑↓는 차례대로 앞·뒤 칸 · 끝이면 그대로', () => {
  const { L: M } = load({ dom: false });
  const pts = [{ x: 300, y: 100 }, { x: 60, y: 160 }];   // 0 스위치 · 1 [곡 목록에 다 넣기] (화면 점검 폰 390·PC 1280 자리와 같은 모양)
  assert.equal(M.ytListPick(pts, 0, 'ArrowDown'), 1);
  assert.equal(M.ytListPick(pts, 1, 'ArrowUp'), 0);
  assert.equal(M.ytListPick(pts, 0, 'ArrowUp'), 0);     // 맨 위 ↑ → 그대로 (카드가 검색 칸으로 보냄)
  assert.equal(M.ytListPick(pts, 1, 'ArrowDown'), 1);   // 맨 아래 ↓ → 그대로
  assert.equal(M.ytListPick(pts, 0, 'ArrowLeft'), 1);   // ←→는 화면 자리 그대로 (pickByArrow)
  assert.equal(M.ytListPick([{ x: 60, y: 100 }, { x: 60, y: 160 }, { x: 60, y: 220 }], 0, 'ArrowDown'), 1);   // 세로로 줄 서면 pickByArrow 그대로
  assert.equal(M.ytListPick([{ x: 0, y: 0 }], -1, 'ArrowDown'), 0);
});

test('카드: 다시 그린 뒤 둘 곳(focus) · 넣는 중 단추는 막힘(화살표에서 빠짐) · 못 넣는 목록은 단추 없음', () => {
  const { L: M, D } = load();
  const ul = D.doc.createElement('ul'); D.doc.body.append(ul);
  const v = M.ytListView({ phase: 'ready', plan: M.ytListPlan([item(3, { embeddable: false })], [], { includeBlocked: true }), keyUsed: true });
  const li = M.ytListCard(ul, v, { focus: 'add' });
  assert.equal(D.doc.activeElement, li.querySelector('button'));
  assert.equal(li.querySelector('input').checked, true);
  const busy = M.ytListCard(ul, M.ytListView({ phase: 'adding', plan: M.ytListPlan([item(1)], []), keyUsed: true }), { focus: 'add' });
  assert.equal(busy.querySelector('button').disabled, true); assert.equal(busy.querySelector('button').textContent, '넣는 중…');
  assert.notEqual(D.doc.activeElement, busy.querySelector('button'));
  assert.equal(M.ytListFocus(busy), false);
  const bad = M.ytListCard(ul, M.ytListView({ phase: 'bad', why: M.YT_LIST_WHY.mix }));
  assert.equal(bad.querySelector('button'), null); assert.match(bad.className, /yt-c-list-bad/);
  assert.equal(ul.children.length, 3);
});

/* ---------------- 파일 모양 ---------------- */
test('ytlist.js: 맨 위에서 DOM을 건드리지 않고, 다른 스크립트와 이름이 겹치지 않으며, index.html에서 yt.js 바로 앞', () => {
  load({ dom: false });   // document 없이 불러도 오류 없음 (위에서 이미 한 번)
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="(js\/[^"]+\.js)"><\/script>/g)].map(m => m[1]);
  const i = srcs.indexOf('js/ytlist.js');
  assert.ok(i > 0); assert.equal(srcs[i + 1], 'js/yt.js');
  assert.ok(srcs.indexOf('js/core.js') < i && srcs.indexOf('js/util.js') < i);
  const top = f => [...fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/^(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  const mine = top('js/ytlist.js');
  assert.ok(mine.length > 20);
  const others = new Set(srcs.filter(s => s !== 'js/ytlist.js' && !s.includes('/vendor/')).flatMap(top));
  same(mine.filter(n => others.has(n)), []);
  assert.equal(new Set(mine).size, mine.length);
  // 바깥 접속은 구글 Data API(CSP에 있음)와 유튜브 플레이어뿐 (oEmbed 없음), 열쇠를 로그에 쓰지 않음
  const src = fs.readFileSync(path.join(ROOT, 'js/ytlist.js'), 'utf8');
  assert.ok(!/oembed/i.test(src.replace(/\/\/.*$/gm, '')));
  assert.ok(!/console\.(log|info|warn|error)/.test(src));
  assert.ok(!/localStorage|indexedDB/.test(src));
});
