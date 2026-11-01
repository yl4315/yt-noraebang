// 기기 맞추기 (CR-039): 켤 때 "Drive와 맞추기" 띠, 점수·부른 횟수 Drive 파일(가짜 Drive), "여행 준비", 연결 끊기.
// 실제 Google·Drive에는 요청을 보내지 않는다: 페이지 안의 Cloud.api를 가짜 Drive(메모리)로 바꾼다 (getToken은 가짜 API면 'test').
// 같이 쓰는 PC 탭에서 맨 마지막에 돌고, 끝나면 넣은 곡·키를 지우고 다시 연다. 폰 크기(412×915)로 보고 사진도 찍는다.
import path from 'node:path';
import fs from 'node:fs';
import { PC, PHONE, READY_DEMO, txt, isHidden, visible, marks, sawToast, sleep, enterTVNoFs, stopAll } from './_lib.mjs';
export const areas = ['O', 'P'];

const T = Date.now();
// 가짜 Drive: 파일은 메모리에, 부른 것은 __fd.log에
const FAKE = `(() => {
  const files = new Map(); let n = 0; const log = [];
  const add = (name, data, mimeType = 'application/json', extra = {}) => { const id = 'fd' + (++n); files.set(id, { id, name, mimeType, data, modifiedTime: new Date(Date.now() + n).toISOString(), ...extra }); return id; };
  const api = {
    delay: 0, fail: {}, missing: new Set(),
    async findOrCreateFolder() { return 'qa-folder'; },
    async findLibrary() { const f = [...files.values()].find(f => f.name === 'library.json'); return f ? f.id : null; },
    async readJson(id) { const f = files.get(id); log.push('read ' + (f ? f.name : id)); if (!f) throw Object.assign(new Error('404'), { status: 404 }); return JSON.parse(typeof f.data === 'string' ? f.data : JSON.stringify(f.data)); },
    async createJson(folder, name, obj) { log.push('create ' + name); return add(name, obj); },
    async updateJson(id, obj) { const f = files.get(id); log.push('update ' + f.name); f.data = obj; f.modifiedTime = new Date(Date.now() + 5000 + (++n)).toISOString(); },
    async upload(folder, name, blob) { log.push('upload ' + name); return add(name, null, blob.type || 'audio/wav', { size: blob.size }); },
    async download(id, onP) {
      log.push('download ' + id);
      if (api.delay) await new Promise(r => setTimeout(r, api.delay));
      if (api.fail[id]) throw api.fail[id];
      if (api.missing.has(id)) throw Object.assign(new Error('download 404'), { status: 404 });
      onP && onP(1); return new Blob([new Uint8Array(2000)], { type: 'audio/wav' });
    },
    async trash(id) { log.push('trash ' + id); },
    async listFolderMedia() { return [...files.values()].filter(f => /^(audio|video)\\//.test(f.mimeType)).map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })); },
    async listFolderJson() { log.push('listjson'); return [...files.values()].filter(f => f.mimeType === 'application/json').map(({ id, name, modifiedTime }) => ({ id, name, modifiedTime })); },
  };
  window.__fd = { files, add, api, log };
  Cloud.api = api; renderBand();
})()`;
const song = (id, no, title, extra = {}) => ({ id, no, title, artist: 'QA원격', lyrics: '', lyricOffset: 0, createdAt: T - 1e6, updatedAt: T - 1e6, fileId: 'm-' + id, mime: 'audio/wav', size: 3e6, ...extra });
const LIB = { version: 1, songs: [song('qa-r1', 20001, 'QA 원격 인기곡'), song('qa-r2', 20002, 'QA 원격 좋아요곡'), song('qa-r3', 20003, 'QA 원격 동영상곡', { video: true, mime: 'video/webm', size: 5e7 }), song('qa-r4', 20004, 'QA 원격 넷째곡')], profiles: [] };
const PCSTATS = { v: 1, app: 'YT 노래방', device: 'qa-pc', updatedAt: T, plays: { 'qa-r1': { n: 5, last: T - 5000 }, demo: { n: 2, last: T - 9000 } },
  scores: [{ id: 'qa-r1', no: 20001, title: 'QA 원격 인기곡', score: 91, at: T - 1000, who: 'QA아빠' }] };
const SEED = `__fd.add('library.json', ${JSON.stringify(JSON.stringify(LIB))}); __fd.add('stats-qa-pc.json', ${JSON.stringify(PCSTATS)}); __fd.add('stats-qa-bad.json', 'not json{')`;
const KEYS = ['nb-gconnected', 'nb-gfolder', 'nb-glib', 'nb-glast', 'nb-device', 'nb-devstats', 'nb-gstats', 'nb-travel'];

export default async function devsync(ctx) {
  const { ok, step } = ctx, p = ctx.p, ids = ctx.ids || {};
  const shotDir = ctx.shotsDir; fs.mkdirSync(shotDir, { recursive: true });
  const shot = async name => { try { await sleep(350); await p.shot(path.join(shotDir, name)); } catch (e) { ctx.log('  (사진 실패 ' + name + ': ' + e.message + ')'); } };
  const fd = expr => p.eval(`(()=>{const L=__fd.log; return ${expr}})()`);
  const reload = async () => { await p.goto(ctx.base + '/index.html', READY_DEMO, 150000); await p.eval(FAKE); };
  const synced = () => p.until('Cloud.state==="ok" && !Cloud.syncing', 8000);
  await stopAll(p);
  const keep = await p.eval(`({plays:localStorage.getItem('nb-plays'), scores:localStorage.getItem('nb-scores'), fav:JSON.stringify(me().favorites)})`);
  try {
    await p.emulate(PHONE);
    await step('새 폰: 연결 기록 없음 + 데모곡뿐 → "다른 기기에서 쓰던 곡이 있나요?" 띠 → 누르면 설정 창', ['O16'], async () => {
      await p.goto(ctx.base + '/index.html', READY_DEMO, 150000);
      const hasSongs = await visible(p, '#syncBand');      // 시험 곡이 있으면 안 뜸
      await p.eval(`window.__keepSongs=state.songs; state.songs=state.songs.filter(s=>s.demo); renderBand()`);
      const t = await txt(p, '#syncBandTxt'), shown = await visible(p, '#syncBand'), bt = await txt(p, '#syncBandGo');
      await p.click('#syncBandGo');
      const dlg = await p.until(`document.querySelector('#cloudDialog').open`, 3000);
      await p.click('#cloudClose');
      await p.eval(`state.songs=window.__keepSongs; renderBand()`);
      ok('O16', !hasSongs && shown && t === '다른 기기에서 쓰던 곡이 있나요? Drive에 연결하면 와요' && bt === '연결' && dlg, `곡이 있으면 안 뜸 · 데모곡뿐이면 "${t}" [${bt}] → 설정 창 ${dlg ? '열림' : '안 열림'}`);
    });

    await step('Drive 연결 기록이 있으면 켤 때 "Drive와 맞추기" 띠: 오프라인·TV 화면·노래 중·✕이면 안 보임', ['O15'], async () => {
      await p.eval(`localStorage.setItem('nb-gconnected','1'); localStorage.setItem('nb-gfolder','qa-folder')`);
      await reload(); await p.eval(SEED);
      const a = { t: await txt(p, '#syncBandTxt'), b: await txt(p, '#syncBandGo'), on: await visible(p, '#syncBand'), dis: await p.eval(`document.querySelector('#syncBandGo').disabled`) };
      await shot('cr039-01-band-phone.png');
      await p.offline(true); await sleep(300);
      const off = await isHidden(p, '#syncBand');
      await p.offline(false); await p.eval('clearTimeout(Cloud.timer)'); await sleep(300);   // 가짜 Drive라 다시 연결되면 저절로 맞춰져 버리니 예약만 지운다
      const back = await visible(p, '#syncBand');
      await enterTVNoFs(p);
      const tv = await isHidden(p, '#syncBand');
      await p.eval('exitTV()'); await sleep(200);
      const tvBack = await visible(p, '#syncBand');
      await p.eval('state.playing=true; updateTransportUI()');
      const sing = await isHidden(p, '#syncBand');
      await p.eval('state.playing=false; updateTransportUI()'); await sleep(100);
      const singBack = await visible(p, '#syncBand');
      await p.click('#syncBandX');
      const x = await isHidden(p, '#syncBand');
      await reload(); await p.eval(SEED);   // ✕는 이번에만: 다시 켜면 또 보임
      const again = await visible(p, '#syncBand');
      ok('O15', a.on && /^Drive와 맞추기/.test(a.t) && a.b === '맞추기' && !a.dis && off && back && tv && tvBack && sing && singBack && x && again,
        `"${a.t}" [${a.b}] · 오프라인 숨김 ${off} · TV 숨김 ${tv} · 노래 중 숨김 ${sing} · 끝나면 다시 ${singBack} · ✕ ${x} → 다시 켜면 ${again}`);
    });

    await step('[맞추기] 한 번: 곡 목록 + 다른 기기 점수·횟수가 인기차트·최고 점수·오늘 최고·대기 화면 TOP 5에 더해지고 내 파일이 올라감', ['O15', 'O17'], async () => {
      const myDemo = await p.eval('plays.demo?.n||0');
      const m = await marks(p);
      await p.click('#syncBandGo');
      const toastOk = await sawToast(p, /^맞췄어요 · 새 곡 4개 · 다른 기기 1대 기록이 더해졌어요$/, m, 8000);
      const hidden = await p.until(`document.querySelector('#syncBand').hidden`, 3000);
      const g = await p.eval(`({r1:playsOf(songById('qa-r1')), demo:playsOf(songById('demo')), stat:chartStat(songById('qa-r1')), best:document.querySelector('#bestBox').textContent,
        mixed:!!plays['qa-r1'] || scores.some(x=>x.who==='QA아빠'), dev:localStorage.getItem('nb-device'), copy:!!JSON.parse(localStorage.getItem('nb-devstats')||'{}')['qa-pc']})`);
      await p.eval('state.queue=[]; renderQueue()');
      await enterTVNoFs(p);
      const idle = await txt(p, '#idleChartList');
      await p.eval('exitTV()');
      const created = await fd(`L.filter(x=>x.startsWith('create stats-')).join(',')`);
      ok('O15', toastOk && hidden, `누름 → 띠 사라짐 · 알림 "맞췄어요 · 새 곡 4개 · 다른 기기 1대 기록이 더해졌어요"`);
      ok('O17', g.r1 === 5 && g.demo === myDemo + 2 && g.stat === '5회 부름 · 최고 91점' && /91점 QA 원격 인기곡 \(QA아빠\)/.test(g.best) && /QA 원격 인기곡5회/.test(idle)
        && !g.mixed && g.copy && created === `create stats-${g.dev}.json`,
        `인기차트 "${g.stat}" · 데모곡 ${g.demo}회 (이 기기 ${myDemo} + PC 2) · 오늘 점수에 "91점 … (QA아빠)" · TOP 5에 "QA 원격 인기곡 5회" · 이 기기 기록에는 안 섞임 · 깨진 파일은 건너뜀 · ${created}`);
    });

    await step('바뀐 게 없으면 다시 안 씀, 다른 기기 파일도 안 바뀌면 다시 안 읽음 / 한 곡 부르면 내 파일만 고침, 두 번 올려도 합계 그대로', ['O17'], async () => {
      const n0 = await fd('L.length');
      await p.eval('syncNow()'); await synced();
      const again = await fd(`L.slice(${n0}).filter(x=>/stats-/.test(x)).join(',')`);
      await p.eval(`countPlay(songById('qa-r1'))`);
      const n1 = await fd('L.length');
      await p.eval('syncNow()'); await synced();
      const up = await fd(`L.slice(${n1}).filter(x=>/^(update|create) stats-/.test(x)).join(',')`);
      await p.eval('syncNow()'); await synced();
      await p.eval('syncNow()'); await synced();
      const r1 = await p.eval(`playsOf(songById('qa-r1'))`);
      const file = await p.eval(`[...__fd.files.values()].find(f=>f.name==='stats-'+localStorage.getItem('nb-device')+'.json').data.plays['qa-r1'].n`);
      ok('O17', again === 'read stats-qa-bad.json' && /^update stats-/.test(up) && !up.includes(',') && r1 === 6 && file === 1,
        `다시 맞추면 "${again}"(깨진 파일만 다시 시도) · 한 곡 부르면 "${up}" · 두 번 더 맞춰도 합계 ${r1}회 (내 파일 1 + PC 5)`);
    });

    await step('받기 저장 실패를 흉내 내면 곡이 "기기에 있음"으로 남지 않음 (F1)', ['P8'], async () => {
      const r = await p.eval(`(async()=>{ const put=DB.put; DB.put=()=>Promise.reject(Object.assign(new Error('QA'),{name:'QuotaExceededError'}));
        let e=null; try { await ensureMedia(songById('qa-r4')); } catch(x){ e=x; } DB.put=put;
        return { blob: !!songById('qa-r4').blob, storage: !!e?.storage, text: e ? mediaErrText(e) : '' }; })()`);
      ok('P8', !r.blob && r.storage && /^기기 저장 공간이 모자라/.test(r.text), `저장 실패 → 곡은 Drive에만 그대로 · "${r.text}"`);
    });

    let plan1 = null;
    await step('여행 준비: 공간이 모자라면 받기 전에 알림 + "동영상 곡 빼고 받기"', ['P6', 'P7'], async () => {
      await p.eval(`Object.defineProperty(navigator.storage,'estimate',{configurable:true,value:async()=>({usage:1e6,quota:1e6+2e7})})`);
      await p.eval(`if(!me().favorites.includes('qa-r4')) me().favorites.push('qa-r4')`);
      const cloudOnly = await p.eval('state.songs.filter(needsDownload).length');
      await p.click('#settingsBtn');
      await p.until(`/Drive에만 있는 곡 ${cloudOnly}곡/.test(document.querySelector('#travelState').textContent)`, 5000);
      const st0 = await txt(p, '#travelState');
      const n0 = await fd('L.length');
      await p.click('#travelGo');
      const warned = await p.until(`/^공간이 모자라요/.test(document.querySelector('#travelMsg').textContent)`, 8000);
      const msg = await txt(p, '#travelMsg');
      const btns = { nv: await visible(p, '#travelNoVideo'), any: await visible(p, '#travelAnyway') };
      const dl0 = await fd(`L.slice(${n0}).filter(x=>x.startsWith('download')).length`);
      plan1 = await p.eval(`downloadPlan({skipVideo:true}).list.map(s=>s.fileId)`);
      await shot('cr039-02-travel-space-phone.png');
      ok('P7', warned && /^공간이 모자라요: 받을 곡 약 \d+MB · 남은 공간 약 20MB\. 동영상 곡 1곡을 빼고 받거나/.test(msg) && btns.nv && btns.any && dl0 === 0,
        `"${st0}" → "${msg}" · [동영상 곡 빼고 받기] [인기 곡부터 받다가 멈추기] · 받기 전이라 받은 곡 0`);
    });

    await step('동영상 빼고 받기 → 많이 부른 곡부터, [멈추기] → 이유, 다시 누르면 받은 곡 건너뛰고 이어서 / 로그인 끝남 → "다시 연결하고 이어서 받기"', ['P6', 'P8'], async () => {
      await p.eval('__fd.api.delay=3000');
      const n0 = await fd('L.length');
      await p.click('#travelNoVideo');
      await p.until(`__fd.log.slice(${n0}).some(x=>x.startsWith('download')) && !document.querySelector('#travelStop').hidden`, 5000);
      const prog = await txt(p, '#travelMsg');
      await shot('cr039-03-travel-progress-phone.png');
      await p.click('#travelStop');
      await p.until(`/^멈췄어요/.test(document.querySelector('#travelMsg').textContent)`, 8000);
      const stopMsg = await txt(p, '#travelMsg'), resume = await txt(p, '#travelGo');
      const first = await fd(`L.slice(${n0}).filter(x=>x.startsWith('download')).map(x=>x.slice(9)).join(',')`);
      // 이어서 받기: 공간은 넉넉하게, 'QA 원격 좋아요곡'에서 로그인이 끝남
      await p.eval(`__fd.api.delay=0; __fd.api.fail['m-qa-r2']=Object.assign(new Error('401'),{needLogin:true}); Object.defineProperty(navigator.storage,'estimate',{configurable:true,value:async()=>({usage:1e6,quota:1e10})})`);
      const plan2 = await p.eval(`downloadPlan().list.map(s=>s.fileId)`);
      const n1 = await fd('L.length');
      await p.click('#travelGo');
      await p.until(`/^로그인이 끝났어요/.test(document.querySelector('#travelMsg').textContent)`, 8000);
      const loginMsg = await txt(p, '#travelMsg'), loginBtn = await txt(p, '#travelGo');
      const second = await fd(`L.slice(${n1}).filter(x=>x.startsWith('download')).map(x=>x.slice(9)).join(',')`);
      await p.eval(`delete __fd.api.fail['m-qa-r2']`);
      const n2 = await fd('L.length');
      await p.click('#travelGo');
      await p.until(`!Travel.running && /여행 준비 끝|새로고침/.test(document.querySelector('#travelMsg').textContent)`, 10000);
      const third = await fd(`L.slice(${n2}).filter(x=>x.startsWith('download')).map(x=>x.slice(9)).join(',')`);
      const at = plan2.indexOf('m-qa-r2'), k = first.split(',').length;
      ok('P8', new RegExp(`^③ 받는 중 1 / ${plan1.length} · QA 원격 인기곡`).test(prog) && stopMsg === `멈췄어요. 받은 ${k}곡은 그대로예요 · ${plan1.length - k}곡 남았어요` && resume === '이어서 받기'
        && loginMsg.startsWith(`로그인이 끝났어요 · ${plan2.length - at}곡 남았어요`) && loginBtn === '다시 연결하고 이어서 받기',
        `"${prog}" → [멈추기] "${stopMsg}" [${resume}] → 로그인 끝남 "${loginMsg.split('.')[0]}" [${loginBtn}]`);
      ok('P6', plan1[0] === 'm-qa-r1' && plan1[1] === 'm-qa-r4' && first === plan1.slice(0, k).join(',') && second === plan2.slice(0, at + 1).join(',') && third === plan2.slice(at).join(',') && !plan1.includes('m-qa-r3') && plan2.includes('m-qa-r3'),
        `받는 순서 (많이 부른 곡 → 좋아요 → 번호): 동영상 빼고 ${plan1.join(' ').replace(/m-qa-/g, '')} → 1차 ${first} [멈추기] · 2차 ${second} (로그인 끝남) · 3차 ${third} (받은 곡은 건너뜀)`);
    });

    await step('"여행 준비 끝"은 지금 상태로: 곡 수·영구 저장·마지막 준비 시각, 새 곡이 Drive에 생기면 "다시 준비"', ['P9', 'P6'], async () => {
      const msg = await txt(p, '#travelMsg'), st = await txt(p, '#travelState'), cls = await p.eval(`document.querySelector('#travelState').className`);
      const local = await p.eval('state.songs.filter(s=>!s.demo&&s.blob).length'), shell = await p.eval('shellCached()'), tip = await visible(p, '#travelTip');
      await shot('cr039-04-travel-done-phone.png');
      // 새 곡이 Drive에 생김 (파일 없는 곡: "모두 받기"가 건너뛰고 끝에 알림)
      await p.eval(`(()=>{const f=[...__fd.files.values()].find(f=>f.name==='library.json'); const lib=typeof f.data==='string'?JSON.parse(f.data):f.data; lib.songs.push(${JSON.stringify(song('qa-r5', 20005, 'QA 원격 새곡', { updatedAt: T }))}); f.data=lib; f.modifiedTime=new Date(Date.now()+9e5).toISOString(); __fd.api.missing.add('m-qa-r5');})()`);
      await p.eval('syncNow()'); await synced();
      await p.until(`/새 곡 1곡이 이 기기에 없어요/.test(document.querySelector('#travelState').textContent)`, 5000);
      const st2 = await txt(p, '#travelState');
      const m = await marks(p);
      await p.click('#dlAllBtn');
      const miss = await sawToast(p, /^0곡을 받았어요 · 1곡은 Drive에 파일이 없어요$/, m, 5000);
      await p.click('#cloudClose');
      ok('P9', shell && new RegExp(`^여행 준비 끝 · 곡 ${local}곡이 이 기기에 있어요 · 인터넷 없이 부를 수 있어요 · (영구 저장 켜짐|영구 저장이 꺼져 있어요)`).test(st) && /마지막 준비 \d+월 \d+일 \d+시 \d\d분$/.test(st)
        && /\b(ok|warn)\b/.test(cls) && /^여행 준비 끝 · 이번에 \d+곡을 받았어요/.test(msg) && tip && st2 === '새 곡 1곡이 이 기기에 없어요 · 다시 준비해 주세요',
        `"${st}" · "${msg}" · 안내 "비행기 모드로…" ${tip ? '보임' : '안 보임'} → Drive에 새 곡 → "${st2}"`);
      ok('P6', miss, '"모두 받기"도 같은 순서·같은 받기: 파일 없는 곡은 건너뛰고 "1곡은 Drive에 파일이 없어요"');
    });

    await step('PC 1280: 설정 창 맨 위 "여행 준비" 구역', ['P9'], async () => {
      await p.emulate(PC); await sleep(300);
      await p.click('#settingsBtn');
      await shot('cr039-05-settings-pc.png');
      const top = await p.eval(`document.querySelector('#cloudDialog .set-sec').id`);
      ok('P9', top === 'travelSec', `설정 창 첫 구역 = ${top}`);
    });

    await step('"연결 끊기" → 다른 기기 기록 사본이 지워지고 이 기기 기록은 남는다', ['O18'], async () => {
      await p.click('#gDisconnect'); await p.click('#gDisconnect');
      await sleep(300);
      const r = await p.eval(`({copy:localStorage.getItem('nb-devstats'), g:localStorage.getItem('nb-gstats'), mine:JSON.parse(localStorage.getItem('nb-plays')||'{}')['qa-r1']?.n, r1:playsOf(songById('qa-r1')), dev:!!localStorage.getItem('nb-device'), best:document.querySelector('#bestBox').textContent})`);
      await p.click('#cloudClose');
      ok('O18', r.copy === null && r.g === null && r.mine === 1 && r.r1 === 1 && r.dev && !/QA아빠/.test(r.best), `사본 ${r.copy === null ? '지움' : '남음'} · 이 기기 기록 qa-r1 ${r.mine}회 그대로 · 인기차트 ${r.r1}회 · 오늘 점수에서 PC(QA아빠) 빠짐`);
    });
  } finally {
    // 정리: 넣은 곡·키를 지우고 점수·횟수·좋아요를 되돌린 뒤 다시 연다
    await p.emulate(PC).catch(() => {});
    await p.eval(`(async()=>{ try { Cloud.api=DriveApi; } catch {}
      for (const s of state.songs.filter(s=>/^qa-r\\d$/.test(s.id))) await DB.del('songs', s.id);
      ${ids.driveOnly ? `const d=songById(${JSON.stringify(ids.driveOnly)}); if (d && d.blob) { d.blob=null; await DB.put('songs', songRecord(d)); }` : ''}
      for (const k of ${JSON.stringify(KEYS)}) localStorage.removeItem(k);
      const keep=${JSON.stringify(keep)};
      keep.plays==null ? localStorage.removeItem('nb-plays') : localStorage.setItem('nb-plays', keep.plays);
      keep.scores==null ? localStorage.removeItem('nb-scores') : localStorage.setItem('nb-scores', keep.scores);
      me().favorites.splice(0, me().favorites.length, ...JSON.parse(keep.fav)); saveProfiles(); })()`).catch(e => ctx.log('  (정리 실패: ' + e.message + ')'));
    await p.goto(ctx.base + '/index.html', READY_DEMO, 150000).catch(() => {});
  }
}
