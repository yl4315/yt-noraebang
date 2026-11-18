// 가짜 허브 (CR-227): Supabase 로그인(auth/v1)과 곡 설정 보내기·받기(rest/v1/rpc/hub_push·hub_pull)를 메모리에서 흉내 낸다.
// 진짜 허브에는 요청을 보내지 않는다: 주소는 만든 이름(qafakehub000….supabase.co), 키·토큰·계정 id는 점검할 때마다 새로 만든 가짜 값.
// 규칙은 키트 supabase/migrations/0001_hub.sql의 hub_push·hub_pull과 같게 (나중 updatedAt만 바꿈, 거절 이유, seq 순서, 500줄씩).
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
    secrets: new Map(),    // 열쇠 칸 (계정 id|앱|이름 → 값). 키트 0008 hub_secret 흉내
  };
  H.reset = () => { H.users.clear(); H.tokens.clear(); H.refresh.clear(); H.rows.clear(); H.seq = 0; H.mode = null; H.log.length = 0; H.badKey = 0; H.bodies.length = 0; H.secrets.clear(); };
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
    const entry = { m, path: u.pathname, grant: u.searchParams.get('grant_type') || undefined, size: (req.postData || '').length };
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
        if (fn === 'hub_push') { H.bodies.push(req.postData || ''); return push(usr, body || {}); }
        if (fn === 'hub_pull') return pull(usr, body || {});
        if (fn === 'hub_secret') {
          if (!APP_RE.test(body?.p_app || '') || !COLL_RE.test(body?.p_name || '')) return json(400, { code: '22023', message: 'hub: bad app or name' });
          const v = H.secrets.get([usr.id, body.p_app, body.p_name].join('|'));
          return json(200, JSON.stringify(v === undefined ? null : v));     // PostgREST: text 함수는 JSON 글자 하나 (없으면 null)
        }
        return json(404, { code: 'PGRST202', message: 'no such function' });
      }
      return json(404, { message: 'QA 가짜 허브: 없는 길' });
    })();
    entry.status = res.fulfill ? res.fulfill.status : 'fail';
    return res;
  };
  return H;
}
