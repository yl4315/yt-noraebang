// YT 노래방 · 손님 리모컨 (guest.html, CR-228): 방장 TV의 QR을 찍은 손님 폰 화면
'use strict';
// 로그인 없음 · 저장 0 (localStorage·sessionStorage·IndexedDB·쿠키를 쓰지 않음) · 회사 허브 Realtime 공개 broadcast만 (표·RPC 0).
// QR 주소의 # 뒤(방 이름·연결 코드)는 읽자마자 주소창에서 지우고 이 파일 안 메모리에만 둔다. 콘솔·화면 글에 찍지 않는다.
// 손님은 결과만 받는다: 곡 찾기는 방장이 대신 하고(번호·제목·가수·종류, 30개까지), 예약 목록은 제목 10개만.
// 글은 모두 textContent로만 넣는다.
(() => {
  // 1) 주소의 # 읽기 → 바로 지움 (supabase-js가 실리기 전에)
  const first = guestUrlParse(location.hash);
  try { history.replaceState(null, '', location.pathname); } catch {}
  let link = first.ok ? { room: first.room, u: first.u, k: first.k } : null;

  const NICK_MAX = 8;            // 화면 안내 "8자까지" (방장은 10자까지 받음)
  const JOIN_WAIT_MS = 10000;    // 이 안에 방장 답이 없으면 "방에 붙지 못했어요"
  const LOST_MS = 60000;         // 방장은 20초마다 상태를 보냄. 60초 소식이 없으면 끊긴 것
  const ALIVE_MS = 20000;        // 나도 20초마다 "있어요"
  const me = { gid: guestId(), nick: '', seq: 0, rate: [], mine: new Map() };   // mine: 내 예약 표 → 받을 때까지 온 상태 수
  let sb = null, ch = null, ready = false, welcomed = false, entered = false, phase = 'wait';
  let st = null, stN = 0, stAt = 0, lastH = 0, aliveAt = 0, joinTimer = 0, findTimer = 0, findSeq = 0, kind = 'mr';
  const pending = new Map();     // 보낸 표(seq) → { what, title, rid }

  const KIND = { mr: 'MR', video: '동영상', yt: '유튜브' };
  const kindLabel = k => KIND[k] || 'MR';
  const fmt = s => { s = Math.max(0, Math.floor(Number(s) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtKey = k => k > 0 ? `+${k}` : k < 0 ? `−${-k}` : '원래 키';
  const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  const isRid = v => typeof v === 'string' && /^[A-Za-z0-9_-]{16,32}$/.test(v);

  /* ---------------- 화면 바꾸기 ---------------- */
  const ICON = {
    wait: '<svg viewBox="0 0 24 24" width="32" height="32"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4"/></svg>',
    closed: '<svg viewBox="0 0 24 24" width="32" height="32"><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    lost: '<svg viewBox="0 0 24 24" width="32" height="32"><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    full: '<svg viewBox="0 0 24 24" width="32" height="32"><circle cx="9" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 4 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    qr: '<svg viewBox="0 0 24 24" width="32" height="32"><rect x="3" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 14h3v3h-3zM20 20h1M14 20h2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  };
  const MSG = {
    wait: { big: '방에 붙는 중…', body: '잠깐만 기다려 주세요', conn: '붙는 중' },
    noqr: { icon: 'qr', big: 'QR을 다시 찍어 주세요', body: '이 주소로는 방에 들어갈 수 없어요.', meta: 'TV나 방장 화면에 나온 QR을 폰 카메라로 찍어 주세요', conn: '연결 안 됨' },
    closed: { big: '방이 닫혔어요', body: '방장이 노래방을 끝냈어요.\n다시 하려면 TV에 나온 새 QR을 찍어 주세요.', meta: '이 폰에 남은 기록은 없어요', conn: '연결 끊김' },
    lost: { big: '방에 붙지 못했어요', body: '인터넷이 끊겼거나 QR이 오래됐어요.', retry: true, conn: '연결 안 됨' },
    full: { big: '방이 꽉 찼어요', body: '손님은 6명까지 들어올 수 있어요.\n누가 나가면 다시 해 보세요.', retry: true, retryMeta: '자리가 나면 다시 찍어 주세요', conn: '연결 안 됨' },   // retryMeta: CR-228 L7
  };
  function setConn(on, text) {
    $('#conn').classList.toggle('off', !on);
    $('#connTxt').textContent = text || (on ? '방에 연결됨' : '연결 안 됨');
  }
  const RETRY_META = $('#retryMeta').textContent;   // guest.html 기본 "그래도 안 되면 TV의 QR을 다시 찍어 주세요"
  function show(p, busy) {
    phase = p;
    const m = MSG[p];
    $('#scrMsg').hidden = !m; $('#msgFoot').hidden = !(m && m.retry);
    $('#retryMeta').textContent = (m && m.retryMeta) || RETRY_META;   // 다시 하기 밑 한 줄: 방이 꽉 참만 다른 말
    $('#scrJoin').hidden = p !== 'join'; $('#scrMain').hidden = p !== 'main';
    if (p !== 'main') $('#toast').hidden = true;
    if (m) {
      $('#msgIco').innerHTML = ICON[m.icon || p] || ICON.wait;   // 고정된 그림만 (손님·방장 글은 안 들어감)
      $('#msgBig').textContent = m.big; $('#msgBody').textContent = m.body;
      $('#msgMeta').textContent = m.meta || ''; $('#msgMeta').hidden = !m.meta;
      setConn(false, m.conn);
    } else setConn(true);
    // G1: 붙는 중에는 단추 자리에 "방에 붙는 중…"
    if (p === 'join') { const b = $('#joinBtn'); b.disabled = !!busy; b.textContent = busy ? '방에 붙는 중…' : '들어가기'; if (busy) setConn(false, '붙는 중'); }
  }
  let toastT = 0;
  function gToast(text, ok) {
    const t = $('#toast'); t.textContent = text; t.classList.toggle('ok', !!ok); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }

  /* ---------------- 방에 붙기 · 떼기 ---------------- */
  async function drop() {
    const c = ch, s = sb; ch = null; sb = null; ready = false; welcomed = false;
    clearTimeout(joinTimer);
    if (c) { try { await (s ? s.removeChannel(c) : c.unsubscribe()); } catch {} }
    if (s) { try { s.realtime.disconnect(); } catch {} }
  }
  async function connect() {
    if (!link) return show('noqr');
    entered ? show('wait') : show('join', true);
    await drop();
    if (typeof supabase === 'undefined' || !supabase || typeof supabase.createClient !== 'function') return show('lost');
    const s = supabase.createClient(link.u, link.k, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
    const c = s.channel(link.room, { config: { broadcast: { self: false, ack: false } } });
    sb = s; ch = c;
    c.on('broadcast', { event: 'h' }, m => { if (ch === c) try { onHost(m && m.payload); } catch {} });
    joinTimer = setTimeout(() => { if (ch === c && !welcomed) lost(); }, JOIN_WAIT_MS);
    c.subscribe(status => {
      if (ch !== c) return;
      if (status === 'SUBSCRIBED') { ready = true; hello(); }
      else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !welcomed) lost();
    });
  }
  function lost() { if (phase === 'closed') return; drop(); show('lost'); }
  // 방장이 닫음: 메모리의 방 이름·연결 코드·내 이름·내 예약을 모두 지운다 (다시 붙기 없음)
  function closed() {
    link = null; me.nick = ''; me.mine.clear(); pending.clear(); st = null;
    $('#nick').value = ''; $('#q').value = ''; $('#findList').textContent = ''; $('#queueList').textContent = ''; $('#nextBox').textContent = '';
    drop(); show('closed');
  }

  /* ---------------- 보내기 ---------------- */
  function send(o, quiet) {
    if (!ch || !ready) { if (!quiet) gToast('방에 다시 붙는 중이에요'); return 0; }
    if (!guestRateOk(me.rate, Date.now())) { if (!quiet) gToast('잠깐만요 · 너무 빨리 눌렀어요'); return 0; }   // 방장은 1초 4개 넘으면 버림
    const msg = { v: GUEST_V, gid: me.gid, seq: ++me.seq, ...o };
    ch.send({ type: 'broadcast', event: 'g', payload: msg }).catch(() => {});
    return msg.seq;
  }
  function hello() { aliveAt = Date.now(); return send({ t: 'hello', ...(me.nick ? { nick: me.nick } : {}) }, true); }
  addEventListener('pagehide', () => { if (ch && ready) try { ch.send({ type: 'broadcast', event: 'g', payload: { v: GUEST_V, gid: me.gid, seq: ++me.seq, t: 'bye' } }); } catch {} });

  /* ---------------- 방장 메시지 ---------------- */
  function onHost(m) {
    if (!m || typeof m !== 'object' || m.v !== GUEST_V || typeof m.t !== 'string') return;
    if (m.to !== undefined && m.to !== me.gid) return;          // 다른 손님에게 가는 답
    if (phase === 'closed' || phase === 'noqr') return;
    lastH = Date.now();
    switch (m.t) {
      case 'closed': return closed();
      case 'full': if (!welcomed) { drop(); show('full'); } return;
      case 'welcome':
        if (!welcomed) { welcomed = true; clearTimeout(joinTimer); show(entered ? 'main' : 'join'); if (entered) find(); }
        return;
      case 'state': st = m; stN++; stAt = Date.now(); renderState(); return;
      case 'found': return onFound(m);
      case 'ok': return onOk(m);
      case 'no': return onNo(m);
    }
  }
  function onOk(m) {
    const p = pending.get(m.seq); pending.delete(m.seq);
    if (!isRid(m.rid)) return;
    if (m.gone) { me.mine.delete(m.rid); gToast('예약에서 뺐어요', true); return renderState(); }
    me.mine.set(m.rid, stN);
    const pos = Number(m.pos) || 0;
    gToast(pos > 0 ? `예약했어요 · ${pos}번째` : '예약했어요 · 바로 시작해요', true);
    if (p && p.btn) p.btn.disabled = false;
    renderState();
  }
  const WHY = {
    nosong: '그 곡이 노래방에 없어요', many: '예약은 한 사람 20곡까지예요', gone: '이미 빠졌거나 부른 곡이에요',
    keyoff: '방장이 손님 키 바꾸기를 꺼 두었어요', nokey: '지금 곡은 키를 바꿀 수 없어요', yt: '유튜브 곡을 예약하지 못했어요',
  };
  function onNo(m) {
    const p = pending.get(m.seq); pending.delete(m.seq);
    if (p && p.rid && m.why === 'gone') { me.mine.delete(p.rid); renderState(); }
    if (p && p.btn) p.btn.disabled = false;
    gToast(WHY[m.why] || '방장이 받지 못했어요');
  }

  /* ---------------- 곡 찾기 (G2 내 MR · G3 유튜브) ---------------- */
  const ytIdOf = text => {
    if (typeof parseYouTubeId === 'function') { try { return parseYouTubeId(text) || null; } catch { return null; } }
    const m = String(text || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  };
  function setKind(k) {
    kind = k === 'yt' && st && st.yt === true ? 'yt' : 'mr';
    $('#segMr').classList.toggle('on', kind === 'mr'); $('#segMr').setAttribute('aria-selected', String(kind === 'mr'));
    $('#segYt').classList.toggle('on', kind === 'yt'); $('#segYt').setAttribute('aria-selected', String(kind === 'yt'));
    $('#q').placeholder = kind === 'yt' ? '곡 이름 또는 유튜브 링크' : '곡 이름 · 가수 · 번호';
    find();
  }
  function find() {
    clearTimeout(findTimer);
    const raw = $('#q').value, q = raw.trim().slice(0, 60);
    $('#qClear').hidden = !raw;
    if (kind === 'yt') {
      $('#findMeta').textContent = '방장 노래방이 대신 찾아요 · 링크 붙여넣기도 돼요';
      const id = ytIdOf(q);
      if (id) return renderFound({ kind: 'yt', link: true, items: [{ ytId: id, title: '붙여넣은 유튜브 영상', artist: '예약하면 방장 노래방이 틀어요', kind: 'yt' }] });
      if (!q) { findSeq = 0; return renderFound({ kind: 'yt', items: [] }); }
    }
    const seq = send({ t: 'search', q, kind }, true);
    if (seq) findSeq = seq;
  }
  function onFound(m) {
    if (m.seq !== findSeq || m.kind !== kind) return;           // 늦게 온 옛 답은 버림
    renderFound(m);
  }
  function renderFound(m) {
    const list = $('#findList'); list.textContent = '';
    const items = Array.isArray(m.items) ? m.items.slice(0, GUEST_RESULTS) : [];
    if (m.kind === 'mr') {
      const total = Number(m.total) || 0, n = Number(m.n) || 0;
      $('#findMeta').textContent = !total ? '노래방 곡 창고가 비어 있어요' : !n ? '맞는 곡이 없어요' : `곡 ${total}개 중 ${n}개` + (n > items.length ? ` · 앞 ${items.length}개만 보여요` : '');
    } else if (!m.link) $('#findMeta').textContent = items.length || !$('#q').value.trim() ? '방장 노래방이 대신 찾아요 · 링크 붙여넣기도 돼요' : '맞는 영상이 없어요 · 링크를 붙여넣어 보세요';
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const yt = typeof it.ytId === 'string';
      if (!yt && !Number.isInteger(it.no)) continue;
      const li = el('div', 'li');
      li.append(el('span', 'no', yt ? '' : String(it.no)));
      const tx = el('div', 'tx'); tx.append(el('div', 't1', str(it.title, 80) || '제목 없음'));
      const artist = str(it.artist, 60), k = kindLabel(it.kind);
      tx.append(el('div', 't2', artist ? `${artist} · ${k}` : k)); li.append(tx);
      const b = el('button', 'pill sec', '예약'); b.type = 'button';
      b.onclick = () => reserve(yt ? { ytId: it.ytId } : { no: it.no }, b);
      li.append(b); list.append(li);
    }
  }
  function reserve(what, btn) {
    const seq = send({ t: 'reserve', ...what, ...(me.nick ? { nick: me.nick } : {}) });
    if (!seq) return;
    btn.disabled = true; setTimeout(() => { btn.disabled = false; }, 1500);
    pending.set(seq, { btn });
  }

  /* ---------------- 지금 곡 (G4) · 예약 목록 (G5) ---------------- */
  const stQ = () => (st && Array.isArray(st.q) ? st.q.slice(0, GUEST_QUEUE_SHOW) : []);
  function mineLive() {
    // 이미 부른 곡의 내 예약 표는 잊는다 (예약 목록에서 사라짐). 방장은 "예약했어요" 답 다음에 새 상태를 보내므로
    // 답보다 먼저 온 옛 상태로는 지우지 않는다 (답을 받은 뒤 상태가 한 번 더 와야 잊음)
    const live = new Set([...stQ().map(x => x && x.r), ...(st && Array.isArray(st.rest) ? st.rest : [])].filter(isRid));
    for (const [r, n] of me.mine) if (!live.has(r) && stN > n) me.mine.delete(r);
    return me.mine.size;
  }
  function chip(text, cls) { return el('span', 'chip' + (cls ? ' ' + cls : ''), text); }
  function renderState() {
    if (!st) return;
    $('#segBox').hidden = st.yt !== true;
    if (st.yt !== true && kind === 'yt') setKind('mr');
    const now = st.now && typeof st.now === 'object' ? st.now : null;
    $('#nowTitle').textContent = now ? (str(now.title, 80) || '제목 없음') : '지금 부르는 곡이 없어요';
    $('#nowSub').textContent = now ? (str(now.artist, 60) ? `${str(now.artist, 60)} · ${kindLabel(now.kind)}` : kindLabel(now.kind)) : '예약하면 TV에서 차례로 시작해요';
    $('#nowProgBox').hidden = !(now && Number(now.d) > 0);
    tickNow();
    const key = now ? Math.round(Number(now.key) || 0) : 0, can = !!(now && st.keyOn === true && now.keyOk === true);
    $('#keyHead').textContent = now ? `키 · 지금 ${fmtKey(key)}` : '키';
    $('#keyDown').disabled = !can || key - 1 < -2; $('#keyUp').disabled = !can || key + 1 > 2; $('#keyZero').disabled = !can || key === 0;
    $('#keyInfo').textContent = st.keyOn !== true ? '방장이 손님 키 바꾸기를 꺼 두었어요.'
      : now && now.kind === 'yt' ? '유튜브 곡은 키를 못 바꿔요. 내 MR 곡에서만 돼요.'
      : '키는 지금 부르는 곡에만 바뀌어요. 유튜브 곡은 키를 못 바꿔요.';
    const q = stQ(), n = Number(st.n) || 0, mine = mineLive();
    // 다음 곡
    const next = $('#nextBox'); next.textContent = '';
    const row = el('div', 'row'), tx = el('div', 'tx'); row.append(tx);
    if (q[0]) {
      tx.append(el('div', 't1', str(q[0].title, 80) || '제목 없음'), el('div', 't2', `${kindLabel(q[0].kind)} · 1번째`));
      if (me.mine.has(q[0].r)) row.append(chip('내 예약', 'me'));
    } else tx.append(el('div', 't1', '예약된 곡이 없어요'), el('div', 't2', '곡 찾기에서 예약해 보세요'));
    next.append(row);
    // 예약 목록
    $('#qN').textContent = `예약 ${n}곡`; $('#qMine').textContent = `내 예약 ${mine}곡`;
    const list = $('#queueList'); list.textContent = '';
    if (!q.length) list.append(el('div', 'empty meta', '예약된 곡이 없어요. 곡 찾기에서 예약해 보세요'));
    q.forEach((it, i) => {
      if (!it || typeof it !== 'object') return;
      const li = el('div', 'li'); li.append(el('span', 'no idx', String(i + 1)));
      const t = el('div', 'tx'); t.append(el('div', 't1', str(it.title, 80) || '제목 없음'));
      const chips = el('div', 't2 chips'); chips.append(chip(kindLabel(it.kind)));
      const isMine = isRid(it.r) && me.mine.has(it.r);
      if (isMine) chips.append(chip('내 예약', 'me'));
      t.append(chips); li.append(t);
      if (isMine) { const b = el('button', 'pill ghost', '빼기'); b.type = 'button'; b.onclick = () => unreserve(it.r, b); li.append(b); }
      list.append(li);
    });
    if (n > q.length) list.append(el('div', 'more meta', `외 ${n - q.length}곡`));
  }
  function unreserve(rid, btn) {
    const seq = send({ t: 'unreserve', rid });
    if (!seq) return;
    btn.disabled = true; pending.set(seq, { rid, btn });
  }
  function tickNow() {
    const now = st && st.now;
    if (!now || !(Number(now.d) > 0)) return;
    const d = Number(now.d), t = Math.min(d, (Number(now.t) || 0) + (now.playing ? (Date.now() - stAt) / 1000 : 0));
    $('#nowProg').style.width = `${Math.max(0, Math.min(100, t / d * 100)).toFixed(1)}%`;
    $('#nowAt').textContent = fmt(t); $('#nowDur').textContent = fmt(d);
  }
  function sendKey(k) { if (send({ t: 'key', k })) gToast(`키 ${fmtKey(k)}로 바꿔 달라고 했어요`); }

  /* ---------------- 단추 ---------------- */
  $('#joinBtn').onclick = () => {
    if (!welcomed) return;
    const v = $('#nick').value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    me.nick = [...v].slice(0, NICK_MAX).join('');
    if (me.nick) hello();
    entered = true; show('main'); find();
  };
  $('#nick').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinBtn').click(); });
  $('#retryBtn').onclick = () => { connect(); };
  $('#q').addEventListener('input', () => { clearTimeout(findTimer); $('#qClear').hidden = !$('#q').value; findTimer = setTimeout(find, 300); });
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
  $('#qClear').onclick = () => { $('#q').value = ''; find(); $('#q').focus(); };
  $('#segMr').onclick = () => setKind('mr');
  $('#segYt').onclick = () => setKind('yt');
  $('#keyDown').onclick = () => { const k = Math.round(Number(st?.now?.key) || 0) - 1; if (k >= -2) sendKey(k); };
  $('#keyUp').onclick = () => { const k = Math.round(Number(st?.now?.key) || 0) + 1; if (k <= 2) sendKey(k); };
  $('#keyZero').onclick = () => sendKey(0);
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.onclick = () => {
    for (const x of document.querySelectorAll('.tabs [data-tab]')) { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); $('#' + x.dataset.tab).hidden = !on; }
  };

  /* ---------------- 1초마다: 진행 막대 · 20초마다 "있어요" · 60초 소식 없으면 끊김 ---------------- */
  setInterval(() => {
    if (phase === 'main') tickNow();
    if (!welcomed || !ready) return;
    const now = Date.now();
    if (now - lastH > LOST_MS) return lost();
    if (now - aliveAt > ALIVE_MS) hello();
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !welcomed) return;
    if (Date.now() - lastH > LOST_MS) lost(); else if (ready) hello();
  });

  // 2) 시작: supabase-js(뒤 스크립트)가 실린 다음
  document.addEventListener('DOMContentLoaded', () => { link ? connect() : show('noqr'); });
})();
