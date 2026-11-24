// 가짜 허브 (CR-227): Supabase 로그인(auth/v1)과 곡 설정 보내기·받기(rest/v1/rpc/hub_push·hub_pull)를 메모리에서 흉내 낸다.
// 진짜 허브에는 요청을 보내지 않는다: 주소는 만든 이름(qafakehub000….supabase.co), 키·토큰·계정 id는 점검할 때마다 새로 만든 가짜 값.
// 규칙은 키트 supabase/migrations/0001_hub.sql의 hub_push·hub_pull과 같게 (나중 updatedAt만 바꿈, 거절 이유, seq 순서, 500줄씩).
// 손님 방(CR-228)용 가짜 Realtime 공개 broadcast는 아래 makeFakeRealtime.
import crypto from 'node:crypto';

export const FAKE_HUB_HOST = 'qafakehub' + '0'.repeat(11) + '.supabase.co';     // 앞 20자 = 진짜 허브 주소 모양
export const FAKE_HUB_URL = 'https://' + FAKE_HUB_HOST;
export const FAKE_HUB_KEY = 'sb_publishable_' + 'qa'.repeat(12);                // 공개 키 모양의 가짜
export const hubCode = (u = FAKE_HUB_URL, k = FAKE_HUB_KEY) => 'nbhub1.' + Buffer.from(JSON.stringify({ u, k })).toString('base64url');
export const fakeMail = name => [name, 'example.test'].join(String.fromCharCode(64));   // 가짜 메일 (실제로 없는 이름)

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
// 가짜 JWT (서명은 가짜). 앞 두 조각에 -·_ 가 없게 (atob로도 읽히게)
function fakeJwt(sub) {
  for (let n = 0; ; n++) {
    const h = b64({ alg: 'HS256', typ: 'JWT' }), now = Math.floor(Date.now() / 1000);
    const p = b64({ sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, qa: n });
    if (!/[-_]/.test(h + p)) return `${h}.${p}.${crypto.randomBytes(16).toString('hex')}`;
  }
}
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const SCOPE_RE = /^([a-z][a-z0-9]{1,19}|shared\.[a-z][a-z0-9_]{1,29})$/, COLL_RE = /^[a-z][a-z0-9_]{0,39}$/, APP_RE = /^[a-z][a-z0-9]{1,19}$/;

export function makeFakeHub() {
  const H = {
    users: new Map(), tokens: new Map(), refresh: new Map(), rows: new Map(), seq: 0,
    mode: null,            // null | 'down'(503) | 'neterr'(연결 끊김)
    log: [],               // [{ m, path, grant, status, size }] (요청 몸은 크기만)
    badKey: 0,             // apikey가 가짜 공개 키가 아닌 요청 수
    bodies: [],            // hub_push 몸 (점검이 "소리 파일 안 감"을 본다)
    secrets: new Map(),    // 열쇠 칸 (계정 id|앱|이름 → 값). 키트 0008 hub_secret·hub_secret_set 흉내
    secretSets: [],        // hub_secret_set 부른 기록 [{ app, name, size }] (값은 크기만)
    failRpc: new Set(),    // 이 이름의 rpc만 503 (CR-231: 허브에 넣기만 실패. 다른 요청은 그대로라 맞추기·뒤로 미루기는 안 바뀜)
    rt: null,              // 가짜 Realtime (makeFakeRealtime, 손님 방 점검이 붙임)
  };
  H.reset = () => { H.users.clear(); H.tokens.clear(); H.refresh.clear(); H.rows.clear(); H.seq = 0; H.mode = null; H.log.length = 0; H.badKey = 0; H.bodies.length = 0; H.secrets.clear(); H.secretSets.length = 0; H.failRpc.clear(); };
  H.addUser = (email, password) => { const id = crypto.randomUUID(); H.users.set(email, { id, email, password }); return id; };
  H.rowsOf = (owner, scope = 'noraebang', coll = 'song_settings') => [...H.rows.values()].filter(r => r.owner === owner && r.scope === scope && r.coll === coll);
  const userObj = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: '', email_confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', is_anonymous: false });
  const session = u => {
    const access = fakeJwt(u.id), refresh = crypto.randomBytes(12).toString('hex');
    H.tokens.set(access, u); H.refresh.set(refresh, u);
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user: userObj(u) };
  };
  const json = (status, body, extra = {}) => ({ fulfill: { status, body: status === 204 ? '' : body, headers: { ...CORS, ...extra } } });
  const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' };

  function push(owner, a) {
    if (!SCOPE_RE.test(a.p_scope || '') || !COLL_RE.test(a.p_collection || '') || !APP_RE.test(a.p_app || '')) return json(400, { code: '22023', message: 'hub: bad scope, collection or app' });
    if (!Array.isArray(a.p_records) || a.p_records.length > 200) return json(400, { code: '22023', message: 'hub: records must be a list of at most 200' });
    const late = Date.now() + 86400000, rejected = []; let stored = 0, older = 0;
    for (const r of a.p_records) {
      let d = r && r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? { ...r.data } : null;
      if (d) for (const k of ['id', 'createdAt', 'updatedAt', 'deletedAt', 'dirty']) delete d[k];
      const num = v => typeof v === 'number';
      const why = typeof r?.id !== 'string' || !ID_RE.test(r.id) ? 'id'
        : !d ? 'data'
        : Buffer.byteLength(JSON.stringify(d)) > 65536 ? 'too big'
        : !num(r.createdAt) || !num(r.updatedAt) || !(r.deletedAt === null || r.deletedAt === undefined || num(r.deletedAt)) ? 'times'
        : r.createdAt <= 0 || r.updatedAt <= 0 || (num(r.deletedAt) && r.deletedAt <= 0) ? 'times'
        : r.updatedAt > late || r.createdAt > late || (num(r.deletedAt) && r.deletedAt > late) ? 'clock' : null;
      if (why) { rejected.push({ id: r?.id ?? null, reason: why }); continue; }
      const key = [owner.id, a.p_scope, a.p_collection, r.id].join('|'), cur = H.rows.get(key);
      if (cur && !(cur.updated_at < r.updatedAt)) { older++; continue; }
      H.rows.set(key, { owner: owner.id, scope: a.p_scope, coll: a.p_collection, id: r.id, data: d,
        created_at: cur ? cur.created_at : Math.trunc(r.createdAt), updated_at: Math.trunc(r.updatedAt), deleted_at: num(r.deletedAt) ? Math.trunc(r.deletedAt) : null, seq: ++H.seq, app: a.p_app });
      stored++;
    }
    return json(200, { stored, older, rejected });
  }
  function pull(owner, a) {
    const after = +a.p_after || 0, limit = Math.min(Math.max(+a.p_limit || 500, 1), 500);
    const rows = H.rowsOf(owner.id, a.p_scope, a.p_collection).filter(r => r.seq > after).sort((x, y) => x.seq - y.seq).slice(0, limit)
      .map(({ id, data, created_at, updated_at, deleted_at, seq }) => ({ id, data, created_at, updated_at, deleted_at, seq }));
    return json(200, rows);
  }

  /** run.mjs 가로채기가 부른다: req = Fetch.requestPaused의 request */
  H.handle = req => {
    const u = new URL(req.url), m = req.method || 'GET';
    const hdr = Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    // CORS 미리 묻기: 보낸 머리글을 그대로 허락 (Authorization·apikey 등)
    if (m === 'OPTIONS') return json(204, '', { 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': hdr['access-control-request-headers'] || 'authorization,apikey,content-type,x-client-info', 'access-control-max-age': '600' });
    const entry = { m, path: u.pathname, grant: u.searchParams.get('grant_type') || undefined, size: (req.postData || '').length, origin: hdr.origin || '' };
    H.log.push(entry);
    if (H.mode === 'neterr') { entry.status = 'neterr'; return { fail: 'ConnectionRefused' }; }
    if (H.mode === 'down') { entry.status = 503; return json(503, { message: 'QA 가짜 허브: 일부러 바쁨' }); }
    if (hdr.apikey !== FAKE_HUB_KEY) H.badKey++;
    let body = null; try { body = JSON.parse(req.postData || 'null'); } catch {}
    const bearer = String(hdr.authorization || '').replace(/^Bearer\s+/i, '');
    const res = (() => {
      if (u.pathname === '/auth/v1/token' && m === 'POST') {
        if (entry.grant === 'password') {
          const usr = body && H.users.get(String(body.email || ''));
          if (!usr || usr.password !== body.password) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
          return json(200, session(usr));
        }
        if (entry.grant === 'refresh_token') {
          const usr = body && H.refresh.get(String(body.refresh_token || ''));
          if (!usr) return json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
          H.refresh.delete(body.refresh_token);
          return json(200, session(usr));
        }
        return json(400, { code: 400, error_code: 'validation_failed', msg: 'bad grant' });
      }
      if (u.pathname === '/auth/v1/logout' && m === 'POST') { H.tokens.delete(bearer); return json(204, ''); }
      if (u.pathname === '/auth/v1/user' && m === 'GET') { const usr = H.tokens.get(bearer); return usr ? json(200, userObj(usr)) : json(401, { code: 401, msg: 'no user' }); }
      if (u.pathname.startsWith('/rest/v1/rpc/') && m === 'POST') {
        const usr = H.tokens.get(bearer);
        if (!usr) return bearer.split('.').length === 3 ? json(401, { code: 'PGRST301', message: 'JWT invalid' }) : json(403, { code: '28000', message: 'hub: sign in first' });
        const fn = u.pathname.slice('/rest/v1/rpc/'.length);
        if (H.failRpc.has(fn)) return json(503, { message: 'QA 가짜 허브: 이 함수만 일부러 바쁨' });
        if (fn === 'hub_push') { H.bodies.push(req.postData || ''); return push(usr, body || {}); }
        if (fn === 'hub_pull') return pull(usr, body || {});
        if (fn === 'hub_secret') {
          if (!APP_RE.test(body?.p_app || '') || !COLL_RE.test(body?.p_name || '')) return json(400, { code: '22023', message: 'hub: bad app or name' });
          const v = H.secrets.get([usr.id, body.p_app, body.p_name].join('|'));
          return json(200, JSON.stringify(v === undefined ? null : v));     // PostgREST: text 함수는 JSON 글자 하나 (없으면 null)
        }
        // 0008 hub_secret_set: 앞뒤 빈칸을 떼고 넣는다 (512자·제어 문자 = 22023). 빈 값·null = 지움 → false, 넣으면 true
        if (fn === 'hub_secret_set') {
          if (!APP_RE.test(body?.p_app || '') || !COLL_RE.test(body?.p_name || '')) return json(400, { code: '22023', message: 'hub: bad app or name' });
          const key = [usr.id, body.p_app, body.p_name].join('|'), raw = body.p_value;
          H.secretSets.push({ app: body.p_app, name: body.p_name, size: typeof raw === 'string' ? raw.length : 0 });
          const v = typeof raw === 'string' ? raw.trim() : '';
          if (!v) { H.secrets.delete(key); return json(200, 'false'); }
          if (v.length > 512 || /[\u0000-\u001f\u007f]/.test(v)) return json(400, { code: '22023', message: 'hub: bad value' });
          H.secrets.set(key, v);
          return json(200, 'true');
        }
        return json(404, { code: 'PGRST202', message: 'no such function' });
      }
      // Realtime REST 보내기 (CR-228): 가짜 Realtime(H.rt)이 있으면 그 방에 퍼뜨린다
      if (u.pathname === '/realtime/v1/api/broadcast' && m === 'POST') { if (H.rt) H.rt.rest(body); return json(202, ''); }
      return json(404, { message: 'QA 가짜 허브: 없는 길' });
    })();
    entry.status = res.fulfill ? res.fulfill.status : 'fail';
    return res;
  };
  return H;
}

/* ---------------- 가짜 Realtime (CR-228 손님 방): 공개 broadcast만 메모리에서 ---------------- */
// 진짜 허브 Realtime(Phoenix vsn 2.0.0, supabase-js 2.117.1)의 "공개 채널 broadcast"만 흉내 낸다. Postgres 변경·presence·비공개 채널은 없음.
// CDP Fetch는 WebSocket을 못 가로채서: 페이지의 WebSocket을 가짜로 바꾸고(가짜 허브 주소만. 다른 주소는 진짜 WebSocket 그대로)
// Runtime 바인딩(__nbRt)으로 Node와 주고받는다. 가짜 WebSocket은 문서마다 새로 넣는다 (Page.addScriptToEvaluateOnNewDocument).
// 기록(R.log)에는 방 이름을 그대로 두지 않는다: 방마다 짧은 해시(room)만. 메시지 몸은 종류(t)·크기·받는 표만.
const RT_BIND = '__nbRt';
const rtSource = host => `(() => {
  if (window.__nbRtIn) return;
  const HOST = ${JSON.stringify(host)}, Real = window.WebSocket, socks = new Map(); let next = 0;
  const out = o => { try { window.${RT_BIND}(JSON.stringify(o)); } catch {} };
  const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
  class FakeWS extends EventTarget {
    constructor(url, protocols) {
      super();
      let u = null; try { u = new URL(url, location.href); } catch {}
      if (!u || u.hostname !== HOST) { out({ op: 'real', url: u ? u.origin + u.pathname : '' }); return protocols === undefined ? new Real(url) : new Real(url, protocols); }
      this.url = String(url); this.readyState = 0; this.binaryType = 'blob'; this.protocol = ''; this.extensions = ''; this.bufferedAmount = 0;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      for (const t of ['open', 'message', 'close', 'error']) this.addEventListener(t, e => { const f = this['on' + t]; if (typeof f === 'function') f.call(this, e); });
      this._id = ++next; socks.set(this._id, this);
      out({ op: 'open', id: this._id, proto: u.protocol, path: u.pathname, key: u.searchParams.get('apikey') || '', vsn: u.searchParams.get('vsn') || '' });
    }
    send(data) {
      if (this.readyState === 0) throw new DOMException('still connecting', 'InvalidStateError');
      if (this.readyState !== 1) return;
      if (typeof data === 'string') out({ op: 'send', id: this._id, text: data });
      else if (data instanceof ArrayBuffer) out({ op: 'send', id: this._id, bin: b64(data) });
      else if (ArrayBuffer.isView(data)) out({ op: 'send', id: this._id, bin: b64(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) });
      else out({ op: 'send', id: this._id, odd: String(data && data.constructor && data.constructor.name) });
    }
    close(code, reason) {
      if (this.readyState >= 2) return;
      this.readyState = 2; out({ op: 'close', id: this._id });
      setTimeout(() => this._closed(code || 1000, reason || '', true), 0);
    }
    _closed(code, reason, clean) {
      if (this.readyState === 3) return;
      this.readyState = 3; socks.delete(this._id);
      this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: clean }));
    }
  }
  for (const [k, v] of Object.entries({ CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })) { Object.defineProperty(FakeWS, k, { value: v }); Object.defineProperty(FakeWS.prototype, k, { value: v }); }
  window.WebSocket = FakeWS;
  window.__nbRtIn = m => {
    const s = socks.get(m.id); if (!s) return false;
    if (m.op === 'open') { if (s.readyState !== 0) return false; s.readyState = 1; s.dispatchEvent(new Event('open')); }
    else if (m.op === 'msg') {
      if (s.readyState !== 1) return false;
      const data = m.bin !== undefined ? (s.binaryType === 'arraybuffer' ? unb64(m.bin) : new Blob([unb64(m.bin)])) : m.text;
      s.dispatchEvent(new MessageEvent('message', { data }));
    } else if (m.op === 'close') { s.dispatchEvent(new Event('error')); s._closed(m.code || 1006, '', false); }
    return true;
  };
})()`;

/** 가짜 Realtime. onNet(기록 한 줄)은 run.mjs ctx.netLog에 넣는다 (연결 = "가짜 답", 가짜 허브가 아닌 WebSocket = "막음") */
export function makeFakeRealtime({ onNet } = {}) {
  const R = {
    topics: new Map(),   // 'realtime:<방 이름>' → Set(연결)
    conns: new Map(),    // 탭:문맥:번호 → { page, ctxId, id, topics, self }
    log: [],             // [{ op, room, event, t, to, size, keys }] (방 이름은 해시만, 몸 내용은 안 둠)
    joins: [],           // [{ room, private, self, ack, presence, pg }]
    opens: 0, badKey: 0, badUrl: 0, real: [],
    mode: null,          // null | 'joinerr' (방 붙기 거절)
    offs: [],
  };
  const tag = topic => 'r' + crypto.createHash('sha256').update(String(topic)).digest('hex').slice(0, 10);
  R.tag = tag;
  const deliver = (c, m) => {
    c.page.s('Runtime.evaluate', { expression: `window.__nbRtIn && window.__nbRtIn(${JSON.stringify({ id: c.id, ...m })})`, contextId: c.ctxId, returnByValue: true })
      .catch(() => drop(c));
  };
  const textOut = (c, arr) => deliver(c, { op: 'msg', text: JSON.stringify(arr) });
  // 서버 → 손님 broadcast: 바이너리 kind 4 (userBroadcast): [4, 방 길이, 이벤트 길이, meta 길이, 1=JSON] + 방 + 이벤트 + meta + 몸
  const binBroadcast = (topic, event, payload) => {
    const t = Buffer.from(topic), e = Buffer.from(event), body = Buffer.from(JSON.stringify(payload ?? null));
    return Buffer.concat([Buffer.from([4, t.length, e.length, 0, 1]), t, e, body]).toString('base64');
  };
  // 손님 → 서버 broadcast: 바이너리 kind 3 (userBroadcastPush): [3, joinRef, ref, 방, 이벤트, meta 길이, 인코딩] + 글자들 + 몸
  function parsePush(buf) {
    if (buf.length < 7 || buf[0] !== 3) return null;
    let o = 7; const take = n => { const s = buf.subarray(o, o + n); o += n; return s.toString('utf8'); };
    const joinRef = take(buf[1]), ref = take(buf[2]), topic = take(buf[3]), event = take(buf[4]); take(buf[5]);
    const body = buf.subarray(o); let payload;
    if (buf[6] === 1) { try { payload = JSON.parse(body.toString('utf8')); } catch { return null; } } else payload = { binary: body.length };
    return { joinRef, ref, topic, event, payload, size: body.length };
  }
  function drop(c) {
    if (!R.conns.has(c.key)) return;
    R.conns.delete(c.key);
    for (const t of c.topics) { const s = R.topics.get(t); if (s) { s.delete(c); if (!s.size) R.topics.delete(t); } }
    c.topics.clear();
  }
  function leave(c, topic) { c.topics.delete(topic); const s = R.topics.get(topic); if (s) { s.delete(c); if (!s.size) R.topics.delete(topic); } }
  function fanout(from, topic, event, payload, size) {
    const subs = R.topics.get(topic), entry = { op: 'broadcast', room: tag(topic), event, size, to: 0, from: from ? 'page' : 'node' };
    if (payload && typeof payload === 'object') {
      entry.t = typeof payload.t === 'string' ? payload.t.slice(0, 20) : undefined;
      if (typeof payload.to === 'string') entry.toGid = payload.to;
      if (typeof payload.gid === 'string') entry.gid = payload.gid;
      if (typeof payload.pid === 'string') entry.pid = payload.pid;                       // 예나 폰 표 (CR-228 ③)
      if (typeof payload.cmd === 'string') entry.cmd = payload.cmd.slice(0, 20);
      if (typeof payload.seq === 'number') entry.seq = payload.seq;
      if (typeof payload.why === 'string') entry.why = payload.why.slice(0, 20);
      if (typeof payload.pos === 'number') entry.pos = payload.pos;
      if (payload.gone === true) entry.gone = true;
      if (Array.isArray(payload.items)) entry.keys = [...new Set(payload.items.flatMap(x => x && typeof x === 'object' ? Object.keys(x) : []))].sort();
      if (Array.isArray(payload.q)) entry.qKeys = [...new Set(payload.q.flatMap(x => x && typeof x === 'object' ? Object.keys(x) : []))].sort();
      entry.top = Object.keys(payload).sort();
    }
    R.log.push(entry);
    if (subs) for (const c of subs) { if (c === from && !c.self.get(topic)) continue; deliver(c, { op: 'msg', bin: binBroadcast(topic, event, payload) }); entry.to++; }
  }
  function onBinding(page, ctxId, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.op === 'real') { R.real.push(m.url); if (onNet) onNet({ kind: '막음', url: m.url, note: 'WebSocket (가짜 허브가 아님)' }); return; }
    const key = page.sessionId + ':' + ctxId + ':' + m.id;
    if (m.op === 'open') {
      R.opens++;
      if (m.key !== FAKE_HUB_KEY) R.badKey++;
      const urlOk = m.proto === 'wss:' && m.path === '/realtime/v1/websocket' && m.vsn === '2.0.0';
      if (!urlOk) R.badUrl++;
      const c = { key, page, ctxId, id: m.id, topics: new Set(), self: new Map() };
      R.conns.set(key, c);
      R.log.push({ op: 'open', ok: urlOk });
      if (onNet) onNet({ kind: '가짜 답', url: FAKE_HUB_URL + m.path, note: '가짜 허브 Realtime' });
      if (!urlOk) { deliver(c, { op: 'close', code: 1006 }); drop(c); return; }
      setTimeout(() => deliver(c, { op: 'open' }), 5);
      return;
    }
    const c = R.conns.get(key); if (!c) return;
    if (m.op === 'close') { R.log.push({ op: 'close' }); drop(c); return; }
    if (m.op !== 'send') return;
    if (m.bin !== undefined) {
      const p = parsePush(Buffer.from(m.bin, 'base64'));
      if (!p) { R.log.push({ op: 'badframe' }); return; }
      if (!c.topics.has(p.topic)) { R.log.push({ op: 'notjoined', room: tag(p.topic) }); return; }
      return fanout(c, p.topic, p.event, p.payload, p.size);
    }
    if (m.odd) { R.log.push({ op: 'odd', what: m.odd }); return; }
    let arr; try { arr = JSON.parse(m.text); } catch { R.log.push({ op: 'badframe' }); return; }
    if (!Array.isArray(arr)) return;
    const [joinRef, ref, topic, event, payload] = arr;
    if (topic === 'phoenix' && event === 'heartbeat') return textOut(c, [null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]);
    if (event === 'phx_join') {
      const cfg = (payload && payload.config) || {}, bc = cfg.broadcast || {};
      const j = { room: tag(topic), private: cfg.private === true, self: bc.self === true, ack: bc.ack === true,
        presence: !!(cfg.presence && cfg.presence.enabled), pg: Array.isArray(cfg.postgres_changes) ? cfg.postgres_changes.length : 0 };
      R.joins.push(j); R.log.push({ op: 'join', room: j.room });
      if (R.mode === 'joinerr' || j.private) return textOut(c, [joinRef, ref, topic, 'phx_reply', { status: 'error', response: { reason: 'QA 가짜 허브: 공개 방만' } }]);
      if (!R.topics.has(topic)) R.topics.set(topic, new Set());
      R.topics.get(topic).add(c); c.topics.add(topic); c.self.set(topic, j.self);
      return textOut(c, [joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: [] } }]);
    }
    if (event === 'phx_leave') { R.log.push({ op: 'leave', room: tag(topic) }); leave(c, topic); return textOut(c, [joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]); }
    if (event === 'access_token') return;
    if (event === 'broadcast' && payload && typeof payload.event === 'string') {
      if (!c.topics.has(topic)) { R.log.push({ op: 'notjoined', room: tag(topic) }); return; }
      return fanout(c, topic, payload.event, payload.payload, Buffer.byteLength(JSON.stringify(payload.payload ?? null)));
    }
    R.log.push({ op: 'other', event: String(event).slice(0, 40) });
  }
  /** 탭에 가짜 WebSocket을 넣는다 (goto 전에) */
  R.attach = async (page, browser) => {
    await page.s('Runtime.addBinding', { name: RT_BIND });
    await page.s('Page.addScriptToEvaluateOnNewDocument', { source: rtSource(FAKE_HUB_HOST) });
    R.offs.push(browser.onEvent(m => {
      if (m.sessionId !== page.sessionId) return;
      if (m.method === 'Runtime.bindingCalled' && m.params.name === RT_BIND) onBinding(page, m.params.executionContextId, m.params.payload);
      else if (m.method === 'Runtime.executionContextDestroyed') { for (const c of [...R.conns.values()]) if (c.page === page && c.ctxId === m.params.executionContextId) drop(c); }
      else if (m.method === 'Runtime.executionContextsCleared') { for (const c of [...R.conns.values()]) if (c.page === page) drop(c); }
    }));
  };
  /** Node가 보내는 broadcast (점검이 만든 가짜 손님): page가 붙어 있는 방마다 */
  R.inject = (page, event, payload) => {
    const topics = new Set([...R.conns.values()].filter(c => c.page === page).flatMap(c => [...c.topics]));
    for (const t of topics) fanout(null, t, event, payload, Buffer.byteLength(JSON.stringify(payload ?? null)));
    return topics.size;
  };
  /** 방 하나에만 (CR-228 ③ 예나 방 점검: 같은 탭이 붙은 손님 방과 섞지 않으려고). 그 방에 붙은 연결 수를 돌려준다 */
  R.injectRoom = (room, event, payload) => {
    const t = 'realtime:' + room, n = (R.topics.get(t) || new Set()).size;
    fanout(null, t, event, payload, Buffer.byteLength(JSON.stringify(payload ?? null)));
    return n;
  };
  /** REST 보내기 (/realtime/v1/api/broadcast, 채널에 아직 안 붙었을 때 supabase-js가 씀) */
  R.rest = body => {
    const msgs = body && Array.isArray(body.messages) ? body.messages : [];
    for (const x of msgs) {
      R.log.push({ op: 'rest', room: tag('realtime:' + x.topic), private: x.private === true });
      if (x && typeof x.topic === 'string' && typeof x.event === 'string' && x.private !== true) fanout(null, 'realtime:' + x.topic, x.event, x.payload, Buffer.byteLength(JSON.stringify(x.payload ?? null)));
    }
  };
  R.subs = page => [...R.conns.values()].filter(c => c.page === page).reduce((n, c) => n + c.topics.size, 0);
  R.off = () => { for (const f of R.offs.splice(0)) try { f(); } catch {} };
  return R;
}
