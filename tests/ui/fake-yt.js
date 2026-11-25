// 가짜 유튜브 IFrame API (CR-030 화면 점검 전용). 점검이 https://www.youtube.com/iframe_api 요청을 가로채 이 파일을 준다 → 진짜 유튜브에 닿지 않는다.
// 진짜 API처럼: new YT.Player(el, { events: { onReady, onStateChange, onError } }), cueVideoById·playVideo·pauseVideo·seekTo·getCurrentTime·
// getDuration·getVideoData·setPlaybackRate. 상태 -1 시작 전 · 0 끝 · 1 재생 · 2 일시정지 · 3 버퍼링 · 5 올려 둠. 올려 둔 영상에 seekTo를 하면 재생이 시작된다 (진짜와 같음).
// 점검이 정하는 것: window.__ytVideos[id] = { title, author, dur(초), err(오류 번호) } · window.__ytBlockAutoplay = true면 사람이 누르지 않은 재생은 무시
// (폰 크롬 흉내: 1초 안에 진짜 누름·키(isTrusted)가 없었던 playVideo는 막힘. 점검의 eval은 누름으로 치지 않는다).
// 부른 것은 window.__ytFake.calls에 적는다.
(() => {
  const V = id => (window.__ytVideos || {})[id] || {};
  const log = window.__ytFake = { calls: [], players: [], host: null, vars: null };
  let lastTap = -1e9;
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, e => { if (e.isTrusted) lastTap = performance.now(); }, true);
  const NAMES = { '-1': '시작 전', 0: '끝', 1: '재생 중', 2: '일시정지', 3: '버퍼링', 5: '올려 둠' };
  class Player {
    constructor(el, o = {}) {
      const host = typeof el === 'string' ? document.getElementById(el) : el;
      const f = document.createElement('div');
      f.className = 'fake-yt'; f.id = host.id;
      f.style.cssText = 'width:100%;height:100%;background:#3A3A3A;color:#D0D0D0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font:700 22px "Noto Sans KR",sans-serif;text-align:center';
      f.innerHTML = '<b>가짜 유튜브 플레이어</b><span class="fy-s" style="font:400 13px sans-serif;color:#A8A8A8"></span>';
      host.replaceWith(f);
      Object.assign(this, { el: f, o, st: -1, t: 0, at: 0, rate: 1, id: null });
      log.players.push(this); log.host = o.host || null; log.vars = o.playerVars || null;
      setTimeout(() => o.events?.onReady?.({ target: this }), 30);
    }
    _emit(st) { this.st = st; this._paint(); this.o.events?.onStateChange?.({ data: st, target: this }); }
    _paint() { this.el.querySelector('.fy-s').textContent = this.id ? `${this.id} · ${NAMES[this.st] || this.st}` : ''; }
    _now() { return this.st === 1 ? this.t + (performance.now() - this.at) / 1000 * this.rate : this.t; }
    _err() { const e = V(this.id).err; if (e) { setTimeout(() => this.o.events?.onError?.({ data: e, target: this }), 20); return true; } return false; }
    cueVideoById(id) { log.calls.push(['cue', id]); this.id = id; this.t = 0; if (this._err()) return; setTimeout(() => this._emit(5), 10); }
    playVideo() {
      log.calls.push(['play']);
      if (this._err()) return;
      if (window.__ytBlockAutoplay && performance.now() - lastTap > 1000) { log.calls.push(['blocked']); return; }
      setTimeout(() => { this.at = performance.now(); this._emit(1); }, 20);
    }
    pauseVideo() { log.calls.push(['pause']); this.t = this._now(); this._emit(2); }
    seekTo(t) { log.calls.push(['seek', Math.round(t * 10) / 10]); this.t = t; this.at = performance.now(); if (this.st === 5 || this.st === -1) this._emit(1); }
    getCurrentTime() { return this._now(); }
    getDuration() { return this.id ? (V(this.id).dur ?? 30) : 0; }
    getVideoData() { const v = V(this.id); return { video_id: this.id, title: v.title || '', author: v.author || '' }; }
    setPlaybackRate(r) { log.calls.push(['rate', r]); this.t = this._now(); this.at = performance.now(); this.rate = r; }
    getPlayerState() { return this.st; }
    destroy() { log.calls.push(['destroy']); this.dead = true; }
  }
  // CR-244 재생목록 (열쇠 없이 목록 읽기, js/ytlist.js): cuePlaylist · getPlaylist · getPlaylistIndex · destroy.
  // 점검이 정하는 것: window.__ytLists[목록 번호] = { ids: [영상 번호…], err(첫 영상 오류 번호, 그래도 목록 번호는 줌), late(ms, 목록 번호가 늦게 옴) } ·
  // 없는 목록은 오류 100 (비공개·없는 목록 흉내). 200개까지만 준다 (진짜와 같음).
  // 진짜와 같이 (11-24 ⓪ 확인): 같은 플레이어에 둘째 목록을 객체 꼴({ list })로 올리면 첫 목록이 그대로 남는다 (글자 꼴은 바뀜) → ytlist.js는 목록마다 새 플레이어.
  // 목록을 올린 플레이어의 destroy는 플레이어 칸도 없앤다 (진짜도 iframe을 없앰). 원래 destroy(다른 곳에서 고칠 수 있음)는 그대로 부른다
  const LISTS = id => (window.__ytLists || {})[id];
  Object.assign(Player.prototype, {
    cuePlaylist(arg) {
      const obj = !!arg && typeof arg === 'object', id = String((obj ? arg.list : arg) ?? '');
      log.calls.push(['cueList', id, obj ? 'obj' : 'str']);
      if (this.gone) return;
      if (obj && this.list != null) { log.calls.push(['cueList-kept', this.list]); setTimeout(() => { if (!this.gone) this._emit(5); }, 10); return; }
      this.list = id; this.plist = null; this.pidx = -1;
      const d = LISTS(id);
      if (!d) { setTimeout(() => { if (!this.gone) this.o.events?.onError?.({ data: 100, target: this }); }, 20); return; }
      setTimeout(() => {
        if (this.gone) return;
        const ids = (d.ids || []).slice(0, 200);
        Object.assign(this, { plist: ids, pidx: ids.length ? 0 : -1, id: ids[0] || null, t: 0 });
        if (d.err) this.o.events?.onError?.({ data: d.err, target: this }); else this._emit(5);
      }, d.late || 10);
    },
    getPlaylist() { return this.plist ? [...this.plist] : null; },
    getPlaylistIndex() { return this.pidx ?? -1; },
  });
  const destroy0 = Player.prototype.destroy;
  Player.prototype.destroy = function () { if (this.list != null && !this.gone) { log.calls.push(['destroyList', this.list]); this.gone = true; this.el.remove(); } return destroy0.call(this); };
  setInterval(() => { for (const p of log.players) if (p.st === 1 && p._now() >= p.getDuration()) { p.t = p.getDuration(); p._emit(0); } }, 100);
  window.YT = { Player, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  setTimeout(() => { if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady(); }, 0);
})();
