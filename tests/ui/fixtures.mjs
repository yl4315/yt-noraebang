// 화면 자동 점검(CR-019) · 시험 파일 만들기. 저작권 없는 소리(사인파)를 그때그때 만들어 임시 폴더에 둔다 (저장소에는 파일을 두지 않음).
// 시험 데이터 이름에는 "QA 시험"을 붙여 사진에서 시험 데이터인 게 보이게 한다.
import fs from 'node:fs';
import path from 'node:path';

// 8kHz 8비트 모노 WAV (몇십 KB). 두 음을 번갈아 내서 소리 막대가 움직이게
export function wav(sec, f1 = 220, f2 = 330) {
  const rate = 8000, n = Math.round(rate * sec), b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) { const f = Math.floor(i / rate) % 2 ? f2 : f1; b[44 + i] = 128 + Math.round(40 * Math.sin(2 * Math.PI * f * i / rate)); }
  return b;
}

// 시간 있는 가사: 간주(2~9초)가 있어서 간주점프(I11)를 볼 수 있다
export const LRC_LONG = ['[00:00.60]QA 시험 첫 줄', '[00:02.00]', '[00:09.00]QA 시험 간주 뒤 줄', '[00:10.50]QA 시험 마지막 줄', '[00:11.50]'].join('\n');
export const LRC_SHORT = ['[00:00.50]QA 시험 하나', '[00:01.50]QA 시험 둘', '[00:02.50]QA 시험 셋', '[00:03.50]'].join('\n');
export const PLAIN = 'QA 시험 시간 없는 첫 줄\nQA 시험 시간 없는 둘째 줄\nQA 시험 시간 없는 셋째 줄';
// 싱크 편집기용: 시간 없는 가사 4줄
export const PLAIN4 = 'QA 시험 편집 하나\nQA 시험 편집 둘\nQA 시험 편집 셋\nQA 시험 편집 넷';

// 가짜 LRCLIB 후보
export const cand = (id, trackName, artistName, duration, synced = true) => ({ id, trackName, artistName, albumName: 'QA 시험 앨범', duration,
  syncedLyrics: synced ? '[00:01.00]QA 시험 가사 첫 줄\n[00:03.00]QA 시험 가사 둘째 줄\n[00:05.00]QA 시험 가사 셋째 줄' : null,
  plainLyrics: 'QA 시험 가사 첫 줄\nQA 시험 가사 둘째 줄\nQA 시험 가사 셋째 줄' });

/** 임시 폴더에 시험 파일을 만들고 경로를 돌려준다 */
export function makeFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const put = (name, data) => { const p = path.join(dir, name); fs.writeFileSync(p, data); return p; };
  return {
    dir,
    // 곡 추가 창 (D2: 앞 꼬리표·MR이 빠지는지)
    tagged: put('[TJ노래방] QA 시험 노래 - QA가수 (MR) _ TJ Karaoke.wav', wav(12)),
    short: put('QA 시험 짧은 곡 - QA가수.wav', wav(4.2)),
    plain: put('QA 시험 시간없는가사.wav', wav(5)),
    nolyr: put('QA 시험 가사없음.wav', wav(3)),
    edit: put('QA 시험 편집.wav', wav(9)),
    broken: put('QA 시험 깨진 파일.wav', Buffer.from('RIFF0000WAVEnot really a wav file')),
    // 여러 곡 한 번에 넣기 (D11~D15): 파일 이름 순서 = 번호 순서, MR이 아닌 파일 2개는 빠져야 함
    // 일부러 고른 순서를 섞어 둔다. 파일 이름 순서(숫자는 크기대로)면 01 02 03 04 10. QA… 차례
    bulk: [
      put('02 QA 시험 둘째 - QA가수B.wav', wav(3)),
      put('10. QA 시험 열째 - QA가수J.wav', wav(3)),
      put('01 QA가수A - QA 시험 첫째.wav', wav(3)),     // 제목·가수가 뒤집힌 이름 (D12 뒤집어 맞춤)
      put('QA 시험 노래 - QA가수.wav', wav(3)),          // 이미 있는 곡과 같은 제목·가수 → 체크 꺼짐 (D15)
      put('03 QA 시험 셋째 - QA가수C.wav', wav(3)),
      put('04 QA 시험 넷째 - QA가수D.wav', wav(3)),
    ],
    drop: [put('QA 시험 끌어놓기 - QA가수E.wav', wav(3)), put('QA 시험 끌어놓기 둘 - QA가수F.wav', wav(3))],
    notMedia: [put('QA 시험 메모.txt', 'memo'), put('QA 시험 표지.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]))],
    notBackup: put('QA 시험 아닌 파일.ytbackup', 'this is not a backup'),
  };
}
