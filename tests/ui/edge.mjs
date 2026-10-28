// 화면 자동 점검(CR-019) · 헤드리스 Edge를 DevTools 프로토콜(CDP)로 움직이는 작은 도구.
// npm 패키지 없이 Node 22+ 기본 WebSocket만 쓴다 (디자인실 icons/lib/edge.mjs, 새 앱 공장 shot.mjs와 같은 방식).
// - 매번 새 빈 프로필(임시 폴더)로 켠다 → CEO 크롬·Edge의 곡·녹음과 섞이지 않는다.
// - 소리는 끈다(--mute-audio): 반주 시계는 흐르지만 스피커로는 안 나온다.
// - 화면 크기는 창 크기가 아니라 화면 흉내(Emulation)로 정한다 (창 크기 412로 켜면 화면 폭이 492가 되는 문제).
// - 끌 때: Browser.close → 프로필 폴더를 쓰는 msedge.exe가 남았으면 그것만 끈다 → 프로필 폴더 지우기.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const PROFILE_PREFIX = 'yt-ui-check-edge-';

const EDGE_PATHS = [
  process.env.YENA_EDGE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
export const findEdge = () => EDGE_PATHS.find(p => fs.existsSync(p)) || null;

// 점검이 켠 Edge(프로필 폴더 이름에 PROFILE_PREFIX)만 찾는다. CEO가 쓰는 Edge는 건드리지 않는다
export function ourEdgeProcesses(profile = PROFILE_PREFIX) {
  if (process.platform !== 'win32') return [];
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${profile.replace(/'/g, "''")}*' } | ForEach-Object { $_.ProcessId }`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch { return []; }
}
export function killPids(pids) {
  for (const pid of pids) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
}

/**
 * Edge 켜기. opts.downloadDir: 내려받은 파일 둘 곳 (없으면 내려받기 막음)
 * 돌려주는 것: { send, newPage, close, profile, onEvent }
 */
export async function launchEdge({ downloadDir = null, args = [] } = {}) {
  const exe = findEdge();
  if (!exe) throw new Error('Edge(msedge.exe)를 찾지 못했어요. Edge가 설치돼 있는지 확인해 주세요 (다른 곳이면 YENA_EDGE 환경 변수로 알려 주세요)');
  if (typeof WebSocket !== 'function') throw new Error('이 Node에는 WebSocket이 없어요 (Node 22 이상 필요)');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  const proc = spawn(exe, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-features=msEdgeSidebarV2,msUndersideButton,Translate,EdgeCollections,msShoppingTrigger',
    '--hide-scrollbars', '--force-color-profile=srgb', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',   // 가짜 마이크 (권한 창 없이 허용)
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-background-networking', '--no-pings', '--metrics-recording-only',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', ...args, 'about:blank',
  ], { stdio: 'ignore' });
  proc.on('error', () => {});
  // msedge.exe는 브라우저를 따로 띄우고 바로 끝날 수 있어서, 프로필 폴더의 DevToolsActivePort 파일로 주소를 찾는다
  const portFile = path.join(profile, 'DevToolsActivePort');
  let wsUrl = null;
  for (let i = 0; i < 150 && !wsUrl; i++) {
    await sleep(100);
    try { const [port, p] = fs.readFileSync(portFile, 'utf8').split(/\r?\n/); if (port && p) wsUrl = `ws://127.0.0.1:${port}${p}`; } catch {}
  }
  if (!wsUrl) { killPids(ourEdgeProcesses(profile)); throw new Error('Edge가 15초 안에 켜지지 않았어요'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Edge DevTools에 연결하지 못했어요')); });
  let id = 0, closed = false;
  const pending = new Map(), listeners = new Set();
  ws.onmessage = ev => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.id && pending.has(m.id)) {
      const { res, rej, method } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(`${method}: ${m.error.message}${m.error.data ? ' ' + m.error.data : ''}`)) : res(m.result);
    } else if (m.method) for (const l of [...listeners]) { try { l(m); } catch (e) { console.error('CDP 알림 처리 오류', e); } }
  };
  ws.onclose = () => { closed = true; for (const { rej, method } of pending.values()) rej(new Error(`${method}: Edge 연결이 끊겼어요`)); pending.clear(); };
  const send = (method, params = {}, sessionId, ms = 30000) => new Promise((res, rej) => {
    if (closed) return rej(new Error(`${method}: Edge 연결이 끊겼어요`));
    const i = ++id; pending.set(i, { res, rej, method });
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(`${method}: ${ms / 1000}초 안에 답이 없어요`)); } }, ms);
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const onEvent = fn => { listeners.add(fn); return () => listeners.delete(fn); };

  if (downloadDir) {
    fs.mkdirSync(downloadDir, { recursive: true });
    await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloadDir, eventsEnabled: true });
  } else await send('Browser.setDownloadBehavior', { behavior: 'deny' });
  // 내려받기 기록: guid → { name, state }
  const downloads = new Map();
  onEvent(m => {
    if (m.method === 'Browser.downloadWillBegin') downloads.set(m.params.guid, { name: m.params.suggestedFilename, state: 'begin', file: downloadDir && path.join(downloadDir, m.params.guid) });
    else if (m.method === 'Browser.downloadProgress' && downloads.has(m.params.guid)) downloads.get(m.params.guid).state = m.params.state;
  });

  const pages = new Set();
  const browser = {
    send, onEvent, profile, downloads, pages,
    /** 새 탭. 탭마다 따로 창을 만들어 둘 다 "보이는" 상태로 둔다 (리모컨 시험에서 PC 탭과 폰 탭을 같이 돌리려고) */
    async newPage() {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const page = makePage(browser, targetId, sessionId);
      await page.init();
      pages.add(page);
      return page;
    },
    async close() {
      if (!closed) { try { await Promise.race([send('Browser.close', {}, undefined, 5000), sleep(5000)]); } catch {} }
      try { ws.close(); } catch {}
      // 남은 프로세스(이 프로필을 쓰는 것만) 끄기
      for (let i = 0; i < 10; i++) {
        const left = ourEdgeProcesses(profile);
        if (!left.length) break;
        if (i >= 2) killPids(left);
        await sleep(500);
      }
      for (let i = 0; i < 20; i++) {
        try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(300); }
      }
    },
  };
  return browser;
}

function makePage(browser, targetId, sessionId) {
  const s = (method, params, ms) => browser.send(method, params, sessionId, ms);
  const events = [];                 // 페이지 오류·콘솔 오류
  let routeFn = null;
  const off = browser.onEvent(m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      events.push({ kind: 'pageerror', text: (d.exception?.description || d.text || '').split('\n')[0], url: d.url || '' });
    } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) {
      events.push({ kind: 'console', text: m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      events.push({ kind: 'log', text: (m.params.entry.text || '').slice(0, 300), url: m.params.entry.url || '' });
    } else if (m.method === 'Fetch.requestPaused' && routeFn) {
      routeFn(m.params).catch(e => console.error('요청 가로채기 오류', e.message));
    } else if (m.method === 'Page.javascriptDialogOpening') {
      s('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
  });
  const page = {
    targetId, sessionId, s, events, size: null,
    async init() {
      await s('Page.enable'); await s('Runtime.enable'); await s('Log.enable'); await s('Network.enable');
      await s('Emulation.setFocusEmulationEnabled', { enabled: true });
    },
    /** 페이지 안에서 식을 돌리고 값(JSON으로 바꿀 수 있는 것)을 돌려준다 */
    async eval(expr, ms) {
      const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, ms);
      if (r.exceptionDetails) throw new Error('페이지 안 오류: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0] + ' ← ' + expr.slice(0, 120));
      return r.result.value;
    },
    /** 식이 참이 될 때까지 기다린다. 됐으면 true */
    async until(expr, ms = 10000, step = 100) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { try { if (await page.eval(expr)) return true; } catch {} await sleep(step); }
      return false;
    },
    async goto(url, ready, ms = 60000) {
      await s('Page.navigate', { url });
      const ok = await page.until(`document.readyState==="complete"${ready ? ` && (${ready})` : ''}`, ms, 150);
      if (!ok) throw new Error(`${url} 이(가) ${ms / 1000}초 안에 준비되지 않았어요`);
    },
    /** 화면 흉내: { width, height, dsf, mobile, touch, landscape } */
    async emulate(v) {
      page.size = v;
      await s('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.dsf || 1, mobile: !!v.mobile,
        ...(v.screen ? { screenWidth: v.screen[0], screenHeight: v.screen[1] } : {}),
        ...(v.mobile ? { screenOrientation: v.width > v.height ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } } : {}) });
      await s('Emulation.setTouchEmulationEnabled', v.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await s('Emulation.setEmitTouchEventsForMouse', { enabled: false });
    },
    async media(features) { await s('Emulation.setEmulatedMedia', { features }); },
    async shot(file) {
      const r = await s('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const buf = Buffer.from(r.data, 'base64');
      if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); }
      return buf;
    },
    /** 요소 위치 (보이는지 포함). 없으면 null */
    async rect(sel) {
      return page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect(),cs=getComputedStyle(e);
        return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2,visible:r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'&&+cs.opacity>0}})()`);
    },
    async scrollTo(sel) {
      await page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(e) e.scrollIntoView({block:'center',inline:'center'})})()`);
      await sleep(80);
    },
    async mouse(type, x, y, extra = {}) { await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra }); },
    async move(x, y) { await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(30); },
    async clickXY(x, y) {
      await page.move(x, y);
      await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y);
      await sleep(80);
    },
    /** 진짜 마우스 클릭 (요소 가운데). 화면 밖이면 먼저 굴린다 */
    async click(sel, opts = {}) {
      // opts.hover: 먼저 마우스를 올릴 줄 (곡 목록 줄의 수정·삭제처럼 마우스를 올려야 보이는 버튼)
      if (opts.hover) { await page.scrollTo(opts.hover); const h = await page.rect(opts.hover); if (h) { await page.move(h.x + 8, h.cy); await sleep(60); } }
      await page.scrollTo(sel);
      // 마우스를 올리면 버튼이 더 나타나 자리가 바뀌는 줄(곡 목록)이 있어서, 올린 뒤 자리가 멈출 때까지 다시 잰다 (사람처럼)
      let r = await page.rect(sel);
      for (let i = 0; i < 4; i++) {
        if (!r) throw new Error(`누를 요소가 없어요: ${sel}`);
        if (!r.visible) throw new Error(`누를 요소가 안 보여요: ${sel}`);
        await page.move(r.cx, r.cy); await sleep(40);
        const r2 = await page.rect(sel);
        if (r2 && Math.abs(r2.cx - r.cx) < 1 && Math.abs(r2.cy - r.cy) < 1) break;
        r = r2;
      }
      await page.mouse('mousePressed', r.cx, r.cy); await page.mouse('mouseReleased', r.cx, r.cy);
      await sleep(80);
    },
    async tapXY(x, y) {
      await s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await sleep(50);
      await s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(120);
    },
    /** 손가락 톡 (요소 가운데) */
    async tap(sel) {
      await page.scrollTo(sel);
      const r = await page.rect(sel);
      if (!r) throw new Error(`누를 요소가 없어요: ${sel}`);
      if (!r.visible) throw new Error(`누를 요소가 안 보여요: ${sel}`);
      await page.tapXY(r.cx, r.cy);
    },
    /** 키 누르기. key: 'a' 'Enter' 'ㄴ' … opts: { shift, ctrl, code, wait } */
    async key(key, opts = {}) {
      const named = { Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'], Tab: [9, 'Tab'],
        ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'], ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'], ' ': [32, 'Space', ' '] }[key];
      let vk, code, text;
      if (named) [vk, code, text] = named;
      else {
        text = key;
        if (/^[a-z]$/i.test(key)) { vk = key.toUpperCase().charCodeAt(0); code = 'Key' + key.toUpperCase(); }
        else if (/^[0-9]$/.test(key)) { vk = key.charCodeAt(0); code = 'Digit' + key; }
        else {
          const sym = { '[': [219, 'BracketLeft'], ']': [221, 'BracketRight'], '{': [219, 'BracketLeft'], '}': [221, 'BracketRight'], ',': [188, 'Comma'], '.': [190, 'Period'],
            '<': [188, 'Comma'], '>': [190, 'Period'], '-': [189, 'Minus'], '=': [187, 'Equal'], '+': [187, 'Equal'], '/': [191, 'Slash'] }[key];
          [vk, code] = sym || [0, ''];
        }
      }
      code = opts.code || code;
      const mods = (opts.alt ? 1 : 0) | (opts.ctrl ? 2 : 0) | (opts.meta ? 4 : 0) | (opts.shift ? 8 : 0);
      const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods };
      await s('Input.dispatchKeyEvent', { type: text && !opts.ctrl ? 'keyDown' : 'rawKeyDown', ...base, ...(text && !opts.ctrl ? { text, unmodifiedText: text } : {}) });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(opts.wait ?? 60);
    },
    /** 글자 넣기 (지금 포커스된 칸에) */
    async type(text) { await s('Input.insertText', { text }); await sleep(60); },
    async setFiles(sel, files) {
      const { root } = await s('DOM.getDocument', { depth: 0 });
      const { nodeId } = await s('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
      if (!nodeId) throw new Error(`파일 칸이 없어요: ${sel}`);
      await s('DOM.setFileInputFiles', { files, nodeId });
    },
    async drag(type, x, y, files) {
      await s('Input.dispatchDragEvent', { type, x, y, data: { items: [], files, dragOperationsMask: 1 } });
    },
    /** 파일 끌어다 놓기: 들어가기 → (진짜 브라우저처럼) 위에서 몇 번 머무르기 → 놓기. 머무는 사이 줄 모양이 바뀌어도 놓을 곳이 정해지게 */
    async dropFiles(x, y, files) {
      await page.drag('dragEnter', x, y, files);
      for (let i = 0; i < 4; i++) { await page.drag('dragOver', x, y, files); await sleep(60); }
      await page.drag('drop', x, y, files);
    },
    /** 인터넷 끊김 흉내 (navigator.onLine=false, offline 이벤트) */
    async offline(on) {
      page.isOffline = !!on;     // 요청 가로채기가 흉내보다 먼저 받으므로, 가로채기도 이 값을 보고 끊는다
      await s('Network.emulateNetworkConditions', { offline: !!on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    },
    /** 요청 가로채기: fn(params) → { continue: true } | { fulfill: { status, body, headers } } | { fail: 'BlockedByClient' } */
    async route(fn) {
      routeFn = async p => {
        let r;
        try { r = await fn(p); } catch (e) { r = { fail: 'Failed' }; }
        if (r?.fulfill) {
          const f = r.fulfill, body = (Buffer.isBuffer(f.body) ? f.body : Buffer.from(typeof f.body === 'string' ? f.body : JSON.stringify(f.body ?? ''))).toString('base64');
          if (f.delay) await sleep(f.delay);
          await s('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: f.status || 200,
            responseHeaders: Object.entries({ 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...(f.headers || {}) }).map(([name, value]) => ({ name, value })), body }).catch(() => {});
        } else if (r?.fail) await s('Fetch.failRequest', { requestId: p.requestId, errorReason: r.fail }).catch(() => {});
        else await s('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
      };
      await s('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    },
    async bringToFront() { await s('Page.bringToFront'); },
    async close() {
      off(); browser.pages.delete(page);
      try { await browser.send('Target.closeTarget', { targetId }); } catch {}
    },
  };
  return page;
}
