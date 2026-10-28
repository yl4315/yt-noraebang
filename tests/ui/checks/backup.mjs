// 흐름 15: 백업 파일 만들기 → 다른 저장소(localhost 주소 = 빈 저장소)에서 불러오기 → 곡·녹음·사용자·점수가 돌아옴, 다른 파일이면 오류
import fs from 'node:fs';
import path from 'node:path';
import { PC, openPage, txt, sleep, q, stopAll } from './_lib.mjs';
import { waitDownload } from './record.mjs';
export const areas = ['Q'];

export default async function backup(ctx) {
  const { ok, step } = ctx, p = ctx.p;
  await stopAll(p);
  let file = null, want = null;

  await step('"백업 파일 만들기" → .ytbackup 받아짐 (녹음·동영상 곡 포함 선택)', ['Q1'], async () => {
    want = await p.eval(`({songs:state.songs.filter(s=>!s.demo).length, video:state.songs.filter(s=>!s.demo&&s.video).length, recs:state.recs.length, profiles:liveProfiles().map(x=>x.name), scores:scores.length})`);
    await p.click('#settingsBtn');
    await p.eval(`document.querySelector('#bkRecs').checked=true; document.querySelector('#bkVideo').checked=true`);
    let since = ctx.downloads().length;
    await p.click('#bkExport');
    const d1 = await waitDownload(ctx, /^YT노래방_백업_\d{8}\.ytbackup$/, since, 20000);
    const st1 = await txt(p, '#bkStatus');
    await p.click('#bkVideo'); await p.click('#bkRecs');
    since = ctx.downloads().length;
    await p.click('#bkExport');
    const d2 = await waitDownload(ctx, /^YT노래방_백업_\d{8}\.ytbackup$/, since, 20000);
    const st2 = await txt(p, '#bkStatus');
    await p.click('#bkVideo'); await p.click('#bkRecs');
    await p.click('#cloudClose');
    ok('Q1', !!d1 && d1.head.toString('latin1', 0, 6) === 'YTNB1\n' && st1.startsWith(`곡 ${want.songs}개, 녹음 ${want.recs}개를 담았어요`) && !!d2 && st2.startsWith(`곡 ${want.songs - want.video}개, 녹음 0개를 담았어요`) && d2.size < d1.size,
      `"${st1}" (${d1?.name}) · 녹음·동영상 빼면 "${st2.split('(')[0].trim()}"`);
    if (d1) { file = path.join(ctx.tmp, 'QA 시험 백업.ytbackup'); fs.copyFileSync(d1.file, file); }
  });

  await step('빈 저장소에서 "백업 파일 불러오기" → 곡·녹음·사용자·점수, 다른 파일이면 오류 안내', ['Q2'], async () => {
    if (!file) throw new Error('백업 파일이 없어요 (Q1 실패)');
    const b = await openPage(ctx, PC, ctx.localBase + '/index.html');
    const empty = await b.eval(`state.songs.length===1 && state.recs.length===0`);
    await b.click('#settingsBtn');
    await b.setFiles('#bkFile', [file]);
    await b.until(`/^불러왔어요|불러오지 못했어요|백업 파일/.test(document.querySelector('#bkStatus').textContent)`, 20000);
    const st = await txt(b, '#bkStatus');
    const got = await b.eval(`({songs:state.songs.filter(s=>!s.demo).length, recs:state.recs.length, profiles:liveProfiles().map(x=>x.name), scores:scores.length, list:document.querySelectorAll('#songList li').length})`);
    await b.setFiles('#bkFile', [ctx.fx.notBackup]);
    await b.until(`!/^불러왔어요/.test(document.querySelector('#bkStatus').textContent) && document.querySelector('#bkStatus').textContent!=='불러오는 중…'`, 10000);
    const bad = await txt(b, '#bkStatus');
    await b.close();
    ok('Q2', empty && st === `불러왔어요 · 새 곡 ${want.songs}개, 새 녹음 ${want.recs}개 (이미 있던 건 더 최신 쪽으로 맞췄어요)` && got.songs === want.songs && got.recs === want.recs && got.list === want.songs + 1
      && want.profiles.every(n => got.profiles.includes(n)) && got.scores >= want.scores && /백업 파일|불러오지 못했어요/.test(bad),
      `"${st}" · 사용자 ${got.profiles.join(',')} · 점수 ${got.scores}개 · 다른 파일 → "${bad}"`);
  });
}
