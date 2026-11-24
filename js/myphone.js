// YT 노래방 · 예나 폰 리모컨 (폰 쪽, CR-228 ③): remote.html이 server.py 없이(GitHub Pages) 열렸을 때 허브 길로 잇는다
// - 같은 주소의 노래방 앱이 이 폰에 저장한 허브 연결(nb-hub)·로그인 세션(nb-hub-auth)을 그대로 쓴다. 로그인은 노래방 앱에서만.
// - 방 이름은 허브 열쇠 칸 remote_room(0008 hub_secret)에서 읽는다 = 예나 계정만. 주소·QR·화면·콘솔에 쓰지 않는다.
// - 폰 → PC 이벤트 'p' {hello·cmd·bye}, PC → 폰 이벤트 'm' {welcome·songs·state·ok·no·full·closed}. 모양 확인은 core.js (myInOk·myClean*).
// - 화면(remote.html)은 옛 길과 같은 S 모양 { now, queue, songs, profiles, me, favorites, playlists, tv, rec, mrVol }을 받는다.
// remote.html이 core.js · js/vendor/supabase-2.117.1.js 다음에 불러온다. util.js는 안 쓴다.
'use strict';
const MyPhone = (() => {
  const HELLO_MS = 20000;      // 20초마다 "있어요" (PC는 60초 소식이 없으면 나간 것으로 셈)
  const LOST_MS = 30000;       // PC는 10초마다 상태를 보냄. 30초 소식이 없으면 끊긴 것
  const WAIT_MS = 6000;        // 붙은 뒤 이 안에 PC 답(welcome)이 없으면 "꺼져 있어요"
  const RECHECK_MS = 15000;    // 꺼져 있으면 15초마다 열쇠 칸을 다시 본다 (화면이 보일 때만)
  const ASK_MS = 3000;         // 곡 목록이 안 맞으면 3초에 한 번 다시 달라고
  const ACK_MS = 5000;         // 명령 답이 5초 안에 없으면 알림
  const HUB_KEY = 'nb-hub', AUTH_KEY = 'nb-hub-auth';

  let ui = null, sb = null, ch = null, room = '', ready = false, welcomed = false, dead = '', view = '', busy = false;
  const me = { pid: guestId(), seq: 0, rate: [] };
  let songs = [], songSig = '', parts = null, st = null, stSig = '', lastAt = 0, aliveAt = 0, askAt = 0, waitT = 0, checkAt = 0;
  const pending = new Map();   // seq → { msg, at }

  const conf = () => { try { const o = JSON.parse(localStorage.getItem(HUB_KEY) || 'null'); return o && hubPairOk(o.u, o.k) ? { u: o.u, k: o.k } : null; } catch { return null; } };
  function client(c) {
    if (sb) return sb;
    if (typeof supabase === 'undefined' || !supabase || typeof supabase.createClient !== 'function') return null;
    sb = supabase.createClient(c.u, c.k, {
      auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    return sb;
  }
  function show(kind) { view = kind; if (kind !== 'app') ui.conn(false); ui.view(kind); }

  /* ---------------- 방에 붙기 · 떼기 ---------------- */
  async function drop() {
    const c = ch; ch = null; room = ''; ready = false; welcomed = false; parts = null;
    clearTimeout(waitT);
    if (c) { try { await sb.removeChannel(c); } catch {} }
  }
  // 열쇠 칸 읽기 → 방에 붙기. force = [다시 해 보기] (끝난 방 이름이어도 한 번 더 붙어 본다)
  async function connect(force) {
    if (busy) return; busy = true; checkAt = Date.now();
    try {
      const c = conf(); if (!c) { await drop(); return show('login'); }
      const s = client(c); if (!s) return show('err');
      if (!welcomed && (force || !view || view === 'login')) show('wait');   // 꺼짐 화면에서 15초마다 다시 볼 때는 화면을 안 바꾼다
      let session = null;
      try { session = (await s.auth.getSession()).data.session; } catch {}
      if (!session) { await drop(); return show('login'); }
      let res = null;
      try { res = await s.rpc('hub_secret', { p_app: 'noraebang', p_name: MY_HUB_NAME }); } catch { return welcomed ? undefined : show('err'); }
      if (!res || res.error) {
        const e = res && res.error, auth = e && (e.code === 'PGRST301' || e.code === '28000' || e.status === 401);
        if (auth) { await drop(); return show('login'); }
        return welcomed ? undefined : show('err');
      }
      const name = typeof res.data === 'string' && MY_ROOM_RE.test(res.data) ? res.data : '';
      if (!name) { await drop(); return show('off'); }                 // 노래방에서 안 켬 (칸이 비었음)
      if (name === room && ch && welcomed) return;                       // 지금 이 방
      if (name === dead && !force) { await drop(); return show('off'); }  // 끝난 방 이름 그대로 = 아직 다시 안 켬
      await join(s, name);
    } finally { busy = false; }
  }
  async function join(s, name) {
    await drop();
    const c = s.channel(name, { config: { broadcast: { self: false, ack: false } } });
    ch = c; room = name;
    c.on('broadcast', { event: 'm' }, m => { if (ch === c) try { onPc(m && m.payload); } catch (e) { console.warn('리모컨 메시지 처리 실패', e && e.message); } });
    waitT = setTimeout(() => { if (ch === c && !welcomed) gone(); }, WAIT_MS + 9000);
    c.subscribe(status => {
      if (ch !== c) return;
      if (status === 'SUBSCRIBED') {
        ready = true; hello();
        clearTimeout(waitT); waitT = setTimeout(() => { if (ch === c && !welcomed) gone(); }, WAIT_MS);
      } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !welcomed) { drop(); show('err'); }
    });
  }
  // PC가 답이 없거나 껐음: 그 방 이름은 끝 (PC는 켤 때마다 새 이름을 쓴다)
  function gone() { dead = room || dead; drop(); st = null; pending.clear(); show('off'); }

  /* ---------------- 보내기 ---------------- */
  function put(o) {
    if (!ch || !ready) return 0;
    const msg = { v: MY_V, pid: me.pid, ...o };
    ch.send({ type: 'broadcast', event: 'p', payload: msg }).catch(() => {});
    return 1;
  }
  function hello() { aliveAt = Date.now(); put({ t: 'hello', ...(songSig ? { have: songSig } : {}) }); }
  // 화면 단추 → 명령 (remote.html send가 부름). "전체 예약" 곡이 많으면 4KB 안 조각으로 나눠 보낸다
  function send(cmd, args, msg) {
    if (!ch || !ready || !welcomed) { ui.toast('노래방에 연결하지 못했어요'); return; }
    if (!guestRateOk(me.rate, Date.now(), MY_PER_SEC)) { ui.toast('잠깐만요 · 너무 빨리 눌렀어요'); return; }
    const list = cmd === 'reserveMany' ? myChunkIds(args.ids).map(ids => ({ ...args, ids })) : [args && Object.keys(args).length ? args : undefined];
    list.forEach((a, i) => setTimeout(() => {
      const seq = ++me.seq;
      put({ t: 'cmd', seq, cmd, ...(a ? { args: a } : {}) });
      pending.set(seq, { msg: i === list.length - 1 ? msg : '', at: Date.now() });
    }, i * 200));
  }
  // 잡기 단계(true): supabase가 pagehide에서 소켓을 끊기 전에 "나가요". 못 닿아도 PC는 60초 소식이 없으면 나간 것으로 센다
  addEventListener('pagehide', () => { if (ch && ready) try { ch.send({ type: 'broadcast', event: 'p', payload: { v: MY_V, pid: me.pid, t: 'bye' } }); } catch {} }, true);

  /* ---------------- PC 메시지 ---------------- */
  const NO_TEXT = { nosong: '노래방에 없는 곡이에요', gone: '이미 예약 목록에 없어요', noprofile: '노래방에 없는 사용자예요', fail: '노래방에서 하지 못했어요' };
  function onPc(m) {
    if (!myInOk(m, me.pid)) return;
    lastAt = Date.now();
    switch (m.t) {
      case 'welcome': welcomed = true; dead = ''; clearTimeout(waitT); if (!st) show('wait'); return;
      case 'full': drop(); return show('full');
      case 'closed': return gone();
      case 'ok': case 'no': {
        const p = pending.get(m.seq); pending.delete(m.seq);
        if (m.t === 'ok') { if (p && p.msg) ui.toast(p.msg); return; }
        ui.buzz('warning'); return ui.toast(NO_TEXT[m.why] || NO_TEXT.fail);
      }
      case 'songs': {
        if (!parts || parts.sig !== m.sig || parts.n !== m.n) parts = { sig: m.sig, n: m.n, got: new Array(m.n), left: m.n };
        if (parts.got[m.i] === undefined) { parts.got[m.i] = myCleanSongs(m.songs); parts.left--; }
        if (parts.left > 0) return;
        songs = parts.got.flat(); songSig = parts.sig; parts = null;
        return paint();
      }
      case 'state': {
        const clean = myCleanState(m.st); if (!clean) return;
        st = clean; stSig = m.sig;
        if (!welcomed) { welcomed = true; dead = ''; clearTimeout(waitT); }
        return paint();
      }
    }
  }
  // 곡 목록이 상태와 맞지 않으면(아직 다 안 옴·바뀜) 다시 달라고 하고, 그동안은 가진 목록으로 그린다
  function paint() {
    if (!st) return;
    if (stSig !== songSig && !parts && Date.now() - askAt > ASK_MS) { askAt = Date.now(); hello(); }
    if (view !== 'app') show('app');
    ui.conn(true);
    ui.state({ ...st, songs });
  }

  /* ---------------- 1초마다: 20초마다 "있어요" · 30초 소식 없으면 끊김 · 꺼져 있으면 15초마다 다시 보기 ---------------- */
  function tick() {
    const now = Date.now();
    for (const [seq, p] of pending) if (now - p.at > ACK_MS) { pending.delete(seq); ui.toast('노래방이 답하지 않아요. 잠시 뒤 다시 눌러 주세요'); }
    if (welcomed && ready) {
      if (now - lastAt > LOST_MS) return gone();
      if (now - aliveAt > HELLO_MS) hello();
      if (stSig && stSig !== songSig && !parts && now - askAt > ASK_MS) { askAt = now; hello(); }
      return;
    }
    if ((view === 'off' || view === 'err') && document.visibilityState === 'visible' && now - checkAt > RECHECK_MS) connect(false);
  }
  function start(hooks) {
    ui = hooks;
    connect(false);
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (welcomed && ready) { if (Date.now() - lastAt > LOST_MS) gone(); else hello(); }
      else if (view !== 'wait') connect(false);
    });
  }
  return { start, send, retry: () => connect(true) };
})();
