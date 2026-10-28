# YT 노래방

집에서 쓰는 노래방 웹앱. 빌드 도구 없이 정적 파일(HTML/CSS/JS)과 작은 파이썬 서버로 돈다. 사용자는 한국어를 쓰고, 화면 문구와 코드 주석도 한국어로 쓴다.

## 실행과 테스트

```bash
python server.py 5173            # 이 PC에서만 (마이크는 https 주소나 localhost에서만 된다)
python server.py 5173 --lan      # 같은 와이파이 휴대폰 리모컨 허용
python server.py 5173 --lan --tv # 켠 뒤 크롬 앱 창·전체 화면으로 /?tv=1 (이미 켜져 있으면 TV 화면만)
npm test                         # Node 핵심 로직 테스트 + 파이썬 서버 테스트
npm run test:ui                  # 화면 자동 점검: 헤드리스 Edge가 빈 시험 저장소에서 눌러 보고 결과표·스크린샷 (CR-019)
```

- **화면을 고친 CR은 끝내기 전에 `npm test`와 `npm run test:ui`를 둘 다 돌린다.** 결과·사진은 PC 임시 폴더(`--out`으로 바꿈, 저장소 안은 git에서 빠지는 `tests/ui/out/`만). 옵션은 `tests/ui/run.mjs` 맨 위.
- **기능을 더하거나 바꾸면 `tests/ui/features.json`(기능 번호 → 분류 auto/test/partial/human/device, 조건 P·V·O·M·W·S·L)과 그 번호를 보는 `tests/ui/checks/*.mjs`를 같이 고친다.** 결과표에 208줄이 다 나오는지, 자동 줄에 확인 기록이 있는지 점검이 스스로 본다 (기록이 없으면 실패).
- 점검 도구는 npm 패키지 없이 CDP로 Edge를 움직인다 (`tests/ui/edge.mjs`). 시험 서버 `tests/ui/serve.py`는 `server.PIN_FILE`을 임시 폴더로 바꾸고 127.0.0.1에만 켠다 (저장소 `.remote.json`을 안 건드림). 밖으로 나가는 요청은 글꼴·QR 라이브러리만 허용, `lrclib.net`은 가짜 답, Google은 막음.
- 점검이 찾은 앱 문제는 고치지 않고 결과표 "점검하다 본 것"에 적는다. 바로 못 고치는 실패는 `features.json`의 `known`(설명 + 맞는 실패 글)으로 "알려진 문제"로 따로 보이게 하고, 고치면 지운다.
- 점검이 고장을 잡는지: `node tests/ui/selftest.mjs` (사본에서 단축키 C 빼기·검색 ✕ 숨기기·데모곡 번호 바꾸기 → M4·M10·I9·I12·S1·S4가 실패로 나와야 함).
- `npm test`는 `tests/*.test.js`와 `tests/test_*.py`만 돈다. `tests/ui/` 파일은 이름 모양이 달라 섞이지 않는다.

- 사용자는 `YT 노래방 켜기.bat`(= `server.py 5173 --lan --open`) 또는 `YT 노래방 TV로 켜기.bat`(= `--lan --tv`)으로 켠다.
- `--tv`는 크롬을 `--user-data-dir` 없이 연다. 곡·녹음이 평소 크롬 프로필의 IndexedDB(`http://localhost:5173`)에 있어서, 다른 프로필로 열면 곡이 안 보인다. 크롬을 실제로 띄우는 확인은 사용자 화면에 창이 뜨니 하지 않는다 (테스트는 가짜 `popen`).
- 주소에 `?tv=1`이 있으면 앱 시작 뒤 바로 TV 화면(`startInTV`). 전체 화면이 아니면 첫 키·클릭에 전체 화면을 시도한다. 앱 아이콘 바로가기 "TV 화면으로"(`manifest.webmanifest` `shortcuts`)도 이 주소다. `start_url`·`scope`는 바꾸지 않는다.
- **폰을 TV에 이어 쓰기 (CR-003)**: 폰·노트북이 노래방 본체, TV는 화면만. 터치 화면 판단은 곡 목록과 같은 `(hover:none)` (JS `isTouch()`).
  - 터치 화면에서만 TV 조작 막대가 첫 줄 8칸 + `⋯ 더 보기`(`#tvMore`)로 바뀌고 키 표시를 숨긴다. 마우스 화면은 `#tvMore`가 `display:contents`라 예전 막대 그대로("번호"만 더함). 키보드용·터치용 안내 글은 `.for-keys`·`.for-touch`.
  - 화면 숫자판(`#numPad`)은 번호 입력(`numKey`·`updateNumBox`·`reserveByNumber`)과 같은 길이다. Esc 순서(`stopKey`) 맨 앞에서 닫는다.
  - 숨은 막대는 마우스 움직임·화면 누르기·키 누르기로 다시 보인다. 숨어 있을 때 누른 첫 톡은 버튼을 누르지 않는다(`tapWhileHidden`).
  - 화면 켜 두기 `updateWakeLock()`(TV 화면이거나 노래 중)은 `updateTransportUI()`·TV 들어가기/나가기·`visibilitychange`에서 부른다. 가로 고정은 터치 + 전체 화면일 때만, 실패는 조용히.
  - 자동 측정의 딸깍 간격·창(`MEASURE`)과 딸깍 찾기 계산은 `core.js`에 있다 (블루투스·무선 화면 복제처럼 지연이 길어도 맞게).
- 휴대폰 리모컨 코드는 저장소 폴더의 `.remote.json`(`{"pin","fixed"}`, git에 안 올림, `hidden()`이 안 내줌)에 저장해서 다시 켜도 같다. 불러오기는 `main()`에서만 하고, 테스트는 `server.PIN_FILE`을 임시 폴더로 바꾼다. 새 코드·고정 설정은 `POST /api/remote/pin`(이 PC에서만).
- 휴대폰 `remote.html`은 맞은 코드를 `localStorage['yt-remote-pin']`에 기억한다 (이 키 이름은 바꾸지 않는다). 홈 화면 아이콘용 `remote.webmanifest`가 따로 있다.
- 배포는 GitHub Pages(정적 파일 그대로). Pages에서는 `server.py`가 없으니 휴대폰 리모컨은 꺼지고, 나머지는 다 된다.

## 구조

`index.html`은 화면 뼈대만 있고, 기능은 `js/`의 **일반 스크립트(모듈 아님)** 들이 전역 이름을 같이 쓰는 방식이다.

| 파일 | 내용 |
|---|---|
| `js/util.js` | 공용 도구 (`$`, `el`, `fmt`, `pick`, `lsGet`, `norm`, `chosung` …) |
| `js/core.js` | **화면과 상관없는 순수 로직**: 가사(LRC) 읽기, 검색, Drive 동기화 합치기 규칙, 파일 이름 → 제목·가수, 가사 후보 정렬·자동 고르기, 백업 파일 형식, TV로 켜기 판단, 지연 자동 측정 계산, 숫자판 방향키 고르기. Node 테스트가 직접 불러 쓴다 |
| `js/store.js` | IndexedDB, 설정 |
| `js/demo.js` | 데모곡 반주 합성 + 기기 저장(캐시) |
| `js/audio.js` | 오디오 엔진, 목소리 효과, 마이크, 녹음 캡처 워클릿, 지연 측정 |
| `js/songs.js` | 앱 상태(`state`), 곡 목록, 곡 추가/수정, LRCLIB 가사 찾기 (`findLyrics`·`lyricItem`·`mediaDuration`은 `bulk.js`도 씀) |
| `js/bulk.js` | 여러 곡 한 번에 넣기(MR 여러 개 + 가사 자동 찾기), "가사 없음" 곡 모아 찾기, PC 곡 목록에 끌어다 놓기 |
| `js/playback.js` | 재생, 노래방식 두 줄 가사, 음정·점수 |
| `js/recording.js` | 녹음 저장, 녹음 믹스, 내 녹음, 싱크·믹스 조절 |
| `js/syncedit.js` | 가사 싱크 편집기 |
| `js/karaoke.js` | 예약, 번호 입력·화면 숫자판, 검색, TV 화면(터치 막대·화면 켜 두기·가로 고정), 단축키, 간주점프, 인기차트, 동영상 곡 |
| `js/profiles.js` | 사용자, 좋아요, 재생목록 |
| `js/cloud.js` | 기기 저장(오프라인), Google Drive 동기화 |
| `js/key.js` | 키 바꾸기 (WSOLA, 워커에서 처리) |
| `js/remote.js` | 휴대폰 리모컨 중계 (`server.py`의 `/api/remote/*`) |
| `js/backup.js` | 녹음 Drive 백업, 백업 파일 |
| `js/main.js` | 메인 루프, 앱 시작 (항상 마지막) |
| `remote.html` | 휴대폰 리모컨 화면 (따로 동작, `remote.webmanifest`로 홈 화면 아이콘) |
| `sw.js` | 서비스 워커: 앱 파일·글꼴을 저장해 오프라인에서도 열리게 |
| `tests/ui/` | 화면 자동 점검 (`npm run test:ui`): `run.mjs` 차례·결과표, `edge.mjs` 헤드리스 Edge(CDP), `serve.py` 시험 서버, `checks/*.mjs` 흐름별 점검, `features.json` 기능 번호 연결표, `fixtures.mjs` 시험 파일(그때그때 만듦), `compare.mjs` 사진 비교, `selftest.mjs` 고장 잡는지 시험. 앱 파일이 아니라 `sw.js` 목록에 넣지 않는다 |

## 꼭 지킬 것

- **IndexedDB 이름 `hanbam-noraebang`은 바꾸지 않는다.** 앱 예전 이름이지만, 바꾸면 사용자가 넣은 곡·녹음이 안 보인다. 저장소를 추가할 땐 버전을 올리고 `onupgradeneeded`에서 없는 것만 만든다.
- localStorage 키도 예전 `nb-` 접두어를 그대로 쓴다.
- **스크립트 순서가 중요하다.** 파일 맨 위에서 바로 실행되는 코드는 앞 파일(또는 같은 파일)의 이름만 쓸 수 있다. 함수 안에서는 어느 파일 이름이든 쓸 수 있다.
- **JS 파일을 더하거나 빼면** `index.html`의 `<script>` 목록, `sw.js`의 `SHELL_FILES`를 같이 고치고 `SHELL` 버전을 올린다.
- `js/core.js`에는 DOM 코드를 넣지 않는다 (테스트가 브라우저 없이 돈다). 새 순수 로직은 여기에 두고 `tests/core.test.js`에 테스트를 더한다.
- 데모곡(반주·멜로디)을 바꾸면 `js/demo.js`의 `DEMO_CACHE_KEY` 숫자를 올린다. 안 올리면 예전 반주가 계속 나온다.
- 곡·녹음 내용이 바뀌면 `persistSong(s)` / `recTouch(r)`로 `updatedAt`을 남긴다. Drive 동기화는 `updatedAt`이 더 나중인 쪽이 이기고, 지운 것은 지움 기록(tombstone)으로 남긴다.
- 사용자에게 보이는 글은 쉬운 한국어로, 이유와 해결 방법을 같이 쓴다.

## 곡 넣기 자동화 (CR-017, `js/bulk.js`)

- 곡 추가 창에서 MR을 2개 이상 고르거나(파일 칸 `multiple`은 새로 넣을 때만) PC에서 곡 목록(`#songsPanel`)에 끌어다 놓으면 `openBulk(files)`, 곡 목록 위 `#missBtn`은 `openMissing()`. MR이 아닌 파일은 `isMediaFile`로 빼고, 줄 순서·번호는 파일 이름 순서(`byFileName`, `nextSongNumbers`).
- 제목·가수는 `titleFromFilename` 하나로 (곡 추가 창 파일 하나, 여러 곡 넣기, Drive 폴더 들여오기가 같이 씀).
- 가사는 LRCLIB에 **한 번에 한 곡씩**, 곡 사이 0.5초. 곡마다 많아야 3번 (`findLyrics`: 제목+가수 → 가수를 못 맞추면 괄호 안 이름 → 결과가 없으면 제목만). 두 곡 연달아 "바빠요"면 멈춘다. 시험할 때 요청을 많이 보내지 않는다 (곡 5개 안팎).
- 저절로 넣는 기준은 `chooseLyrics` (싱크 + 제목 같음 + 가수 같음 + MR 길이 `AUTO_SEC` 3초 안, 넷 다). 가수 비교는 `artistMatches` (괄호 앞·안 이름, Feat. 뒤는 뺌). 정렬은 `rankLyrics` (곡 추가 창도 같이 씀).
- **"가사 자동" 표시는 곡에 저장하지 않는다.** Drive `library.json` 칸(`SONG_FIELDS`)을 늘리면 예전 판 화면이 동기화할 때 그 칸을 지운다. 새 곡은 곡 추가 창과 같은 모양으로 `persistSong`(여러 곡이면 `quiet`로 실패 알림을 한 번만).
- 창을 닫으면(취소·✕·Esc·TV 화면) 아무것도 저장하지 않고 찾기도 멈춘다 (`Bulk.sess`). 저장해도 무대의 곡은 그대로 두고 목록만 첫 새 곡으로 옮긴다.

## 녹음 구조

목소리만 따로(16비트 PCM) 저장하고, 반주는 "녹음 몇 초 지점에 반주 몇 초(어떤 키)"인지(`parts`)만 기록한다. 그래서 녹음 뒤에도 타이밍·볼륨·효과를 바꿔 다시 섞을 수 있다(`buildMix`, `renderMix`).

## Claude의 내장 브라우저로 확인할 때

- 내장 브라우저에서는 서비스 워커가 보내는 요청이 localhost에 닿지 않아, 예전 화면이 캐시에서 열릴 수 있다. 확인 전에 서비스 워커 등록과 캐시를 지운다.
- 사용자의 실제 데이터는 사용자의 크롬에 있다. 내장 브라우저에서 만든 테스트 데이터는 끝나면 지운다.
