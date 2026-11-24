# YT 노래방

집에서 쓰는 노래방 웹앱. 빌드 도구 없이 정적 파일(HTML/CSS/JS)과 작은 파이썬 서버로 돈다. 사용자는 한국어를 쓰고, 화면 문구와 코드 주석도 한국어로 쓴다.

옛 판(CR 번호가 붙은 설명 그대로)은 `docs/archive/CLAUDE-2026-11-12.md`.

## 실행과 테스트

```bash
python server.py 5173            # 이 PC에서만 (마이크는 https 주소나 localhost에서만 된다)
python server.py 5173 --lan      # 같은 와이파이 휴대폰 리모컨 허용
python server.py 5173 --lan --tv # 켠 뒤 크롬 앱 창·전체 화면으로 /?tv=1 (이미 켜져 있으면 TV 화면만)
npm test                         # Node 핵심 로직 테스트 + 파이썬 서버 테스트
npm run test:ui                  # 화면 자동 점검: 헤드리스 Edge가 빈 시험 저장소에서 눌러 보고 결과표·스크린샷
```

### 화면 자동 점검 (`npm run test:ui`)

- **화면을 고친 CR은 끝내기 전에 `npm test`와 `npm run test:ui`를 둘 다 돌린다.**
- 결과·사진은 PC 임시 폴더 (`--out`으로 바꿈). 저장소 안은 git에서 빠지는 `tests/ui/out/`만. 옵션은 `tests/ui/run.mjs` 맨 위.
- **화면 점검은 "더 보기 (고급)"을 켠 화면에서 돈다** (CR-229, `openPage`가 `nb-advanced`='1'). 기본(숨긴) 화면은 `checks/hide.mjs`가 `{ ...ctx, adv: false }`로 따로 본다.
- **기능을 더하거나 바꾸면 `tests/ui/features.json`(기능 번호 → 분류 auto/test/partial/human/device, 조건 P·V·O·M·W·S·L·H)과 그 번호를 보는 `tests/ui/checks/*.mjs`를 같이 고친다.** 결과표에 259줄이 다 나오는지, 자동 줄에 확인 기록이 있는지 점검이 스스로 본다 (기록이 없으면 실패).
- Drive가 필요한 흐름은 `tests/ui/checks/devsync.mjs`처럼 페이지 안 `Cloud.api`를 가짜 Drive(메모리)로 바꿔 본다 (`getToken`은 가짜 API면 `'test'`).
  - 실제 Google에는 요청하지 않는다.
  - 이 점검은 같이 쓰는 탭에서 맨 마지막에 돌고 넣은 것을 지운다.
- 점검 도구는 npm 패키지 없이 CDP로 Edge를 움직인다 (`tests/ui/edge.mjs`).
- 끝 정리는 **이번 점검이 켠 Edge 프로필만** 끄고 지운다 (`run.mjs` `myProfiles`). 같은 PC에서 다른 가지(worktree)의 점검이 동시에 돌 수 있어서, 이름 앞부분(`yt-ui-edge-`, 옛 이름 `yt-ui-check-edge-`)으로 모두 끄지 않는다.
- 시험 서버 `tests/ui/serve.py`는 `server.PIN_FILE`을 임시 폴더로 바꾸고 127.0.0.1에만 켠다 (저장소 `.remote.json`을 안 건드림). 밖으로 나가는 요청은 글꼴·QR 라이브러리만 허용, `lrclib.net`(`/api/search`·`/api/get`)은 가짜 답, Google은 막음.
- 허브(CR-227)는 `tests/ui/fakehub.mjs`의 **메모리 가짜 허브**로만 본다: 만든 주소(`qafakehub…`)·가짜 공개 키·점검이 만든 가짜 계정. 로그인·`hub_push`·`hub_pull`·`hub_secret`을 키트 규칙대로 흉내 낸다. 진짜 허브에 요청하면 공통 점검이 실패한다. `checks/hub.mjs`는 새 Edge에 기기 둘(127.0.0.1·localhost = 다른 저장소)을 열고, 끝에서 두 번째로 돈다.
- 손님 방(CR-228)은 `fakehub.mjs`의 `makeFakeRealtime`(가짜 Realtime: 페이지의 `WebSocket`을 바꿔 끼우고 CDP 바인딩으로 Node의 메모리 broadcast에 잇는다, Phoenix vsn 2.0.0 글·이진 틀)으로만 본다. `checks/guest.mjs`가 맨 마지막: 새 Edge 셋(방장 PC · 손님 폰 A · 손님 폰 B, 저장소가 따로)에 방장 1 + 손님 2, 가짜 손님은 Node가 방에 직접 보낸다(`R.inject`). 방 이름·연결 코드는 점검 기록·결과표에도 쓰지 않는다(개수만 셈). 손님 주소로 갈 때 `p.goto` 대신 `Page.navigate`(실패 글에 주소가 남지 않게).
- 예나 폰 리모컨(CR-228 ③)은 `checks/myremote.mjs`(손님 점검 다음, 맨 마지막): 새 Edge 둘(노래방 PC · 예나 폰, 둘 다 정적 서버 = Pages처럼 `server.py` 없음)에 같은 가짜 허브·가짜 Realtime. 폰은 같은 주소의 노래방 앱에서 가짜 계정으로 로그인한 뒤 `remote.html`. 가짜 폰은 Node가 방에 직접 보낸다(`R.injectRoom`). 방 이름은 기록·결과표에 쓰지 않는다(개수만 셈). `server.py` 주소의 `remote.html`이 옛 코드 화면 그대로인지도 본다.
- 공통 점검 "보안 규칙(CSP)이 막은 것 0": `_lib.mjs` 기록 장치가 `securitypolicyviolation`을 콘솔 오류로 남긴다. 새 바깥 주소를 쓰면 `index.html` CSP에 더한다 (아래 "허브 연결").
- 점검이 찾은 앱 문제는 고치지 않고 결과표 "점검하다 본 것"에 적는다. 바로 못 고치는 실패는 `features.json`의 `known`(설명 + 맞는 실패 글)으로 "알려진 문제"로 따로 보이게 하고, 고치면 지운다.
- 점검이 고장을 잡는지: `node tests/ui/selftest.mjs` (사본에서 단축키 C 빼기·검색 ✕ 숨기기·데모곡 번호 바꾸기 → M4·M10·I9·I12·S1·S4가 실패로 나와야 함).
- `npm test`는 `tests/*.test.js`와 `tests/test_*.py`만 돈다. `tests/ui/` 파일은 이름 모양이 달라 섞이지 않는다.

### 켜기·TV 화면

- 사용자는 `YT 노래방 켜기.bat`(= `server.py 5173 --lan --open`) 또는 `YT 노래방 TV로 켜기.bat`(= `--lan --tv`)으로 켠다.
- `--tv`는 크롬을 `--user-data-dir` 없이 연다. 곡·녹음이 평소 크롬 프로필의 IndexedDB(`http://localhost:5173`)에 있어서, 다른 프로필로 열면 곡이 안 보인다.
- 크롬을 실제로 띄우는 확인은 사용자 화면에 창이 뜨니 하지 않는다 (테스트는 가짜 `popen`).
- 주소에 `?tv=1`이 있으면 앱 시작 뒤 바로 TV 화면(`startInTV`). 전체 화면이 아니면 첫 키·클릭에 전체 화면을 시도한다.
- 앱 아이콘 바로가기 "TV 화면으로"(`manifest.webmanifest` `shortcuts`)도 이 주소다. `start_url`·`scope`는 바꾸지 않는다.
- 배포는 GitHub Pages(정적 파일 그대로). Pages에서는 `server.py`가 없으니 휴대폰 리모컨은 꺼지고, 나머지는 다 된다.

### 폰을 TV에 이어 쓰기

- 폰·노트북이 노래방 본체, TV는 화면만. 터치 화면 판단은 곡 목록과 같은 `(hover:none)` (JS `isTouch()`).
- 터치 화면에서만 TV 조작 막대가 첫 줄 8칸 + `⋯ 더 보기`(`#tvMore`)로 바뀌고 키 표시를 숨긴다. 마우스 화면은 `#tvMore`가 `display:contents`라 예전 막대 그대로("번호"만 더함). 키보드용·터치용 안내 글은 `.for-keys`·`.for-touch`.
- 화면 숫자판(`#numPad`)은 번호 입력(`numKey`·`updateNumBox`·`reserveByNumber`)과 같은 길이다. Esc 순서(`stopKey`) 맨 앞에서 닫는다.
- 숨은 막대는 마우스 움직임·화면 누르기·키 누르기로 다시 보인다. 숨어 있을 때 누른 첫 톡은 버튼을 누르지 않는다(`tapWhileHidden`).
- 화면 켜 두기 `updateWakeLock()`(TV 화면이거나 노래 중)은 `updateTransportUI()`·TV 들어가기/나가기·`visibilitychange`에서 부른다. 가로 고정은 터치 + 전체 화면일 때만, 실패는 조용히.
- 자동 측정의 딸깍 간격·창(`MEASURE`)과 딸깍 찾기 계산은 `core.js`에 있다 (블루투스·무선 화면 복제처럼 지연이 길어도 맞게).

### 휴대폰 리모컨

- 코드는 저장소 폴더의 `.remote.json`(`{"pin","fixed"}`, git에 안 올림, `hidden()`이 안 내줌)에 저장해서 다시 켜도 같다.
  - 불러오기는 `main()`에서만 하고, 테스트는 `server.PIN_FILE`을 임시 폴더로 바꾼다.
  - 새 코드·고정 설정은 `POST /api/remote/pin`(이 PC에서만).
- 이 PC 전용 창구 `/api/remote/info`·`/api/remote/pin`·`/api/remote/poll`·`POST /api/remote/state`와 코드 없는 `GET /api/remote/state`는 보낸 곳이 이 PC이고 `Host`가 `localhost`·`127.0.0.1`·`[::1]`(포트는 아무거나)일 때만 답한다 (`local_host()`, DNS 리바인딩 막기). 휴대폰이 쓰는 길(`POST /api/remote/cmd`, 코드를 붙인 `GET /api/remote/state?pin=`)과 앱 파일은 `Host`를 보지 않는다.
- 휴대폰 `remote.html`은 맞은 코드를 `localStorage['yt-remote-pin']`에 기억한다 (이 키 이름은 바꾸지 않는다). 홈 화면 아이콘용 `remote.webmanifest`가 따로 있다.

## 구조

`index.html`은 화면 뼈대만 있고, 기능은 `js/`의 **일반 스크립트(모듈 아님)** 들이 전역 이름을 같이 쓰는 방식이다.

| 파일 | 내용 |
|---|---|
| `js/util.js` | 공용 도구 (`$`, `el`, `fmt`, `pick`, `lsGet`, `norm`, `chosung`, 터치 화면 진동 `haptic` …) |
| `js/haptics.js` | **디자인실 파일 복사본** (`departments/design/tokens/out/karaoke/`), 직접 고치지 않음. 회사 진동 `YenaHaptics.play('tap'·'success'·'warning')`. 앱(`util.js` 다음)과 `remote.html`이 같이 씀 |
| `css/tokens.css` | **디자인실 파일 복사본**, 직접 고치지 않음. 회사 CSS 변수(`--color-*`·`--radius-*`·`--font-*`). `app.css`·`remote.html`보다 먼저 불러온다 |
| `js/core.js` | **화면과 상관없는 순수 로직**: 가사(LRC) 읽기, 검색, Drive 동기화 합치기 규칙, 파일 이름 → 제목·가수, 가사 후보 정렬·자동 고르기, 백업 파일 형식, TV로 켜기 판단, 지연 자동 측정 계산, 숫자판 방향키 고르기. Node 테스트가 직접 불러 쓴다 |
| `js/store.js` | IndexedDB, 설정 |
| `js/demo.js` | 데모곡 반주 합성 + 기기 저장(캐시) |
| `js/audio.js` | 오디오 엔진, 목소리 효과, 마이크, 녹음 캡처 워클릿, 지연 측정 |
| `js/songs.js` | 앱 상태(`state`), 곡 목록, 곡 추가/수정, LRCLIB 가사 찾기 (`findLyrics`·`lyricItem`·`mediaDuration`은 `bulk.js`도 씀) |
| `js/bulk.js` | 여러 곡 한 번에 넣기(MR 여러 개 + 가사 자동 찾기), "가사 없음" 곡 모아 찾기, PC 곡 목록에 끌어다 놓기 |
| `js/mr.js` | MR 만들기: 집 AI 서버의 "MR 만들기 창"을 새 탭으로 열고, 다 만든 MR을 창끼리 받아 `openBulk`로. 설정 창 서버 주소 칸 |
| `js/playback.js` | 재생, 노래방식 두 줄 가사, 음정·점수 |
| `js/recording.js` | 녹음 저장, 녹음 믹스, 내 녹음, 싱크·믹스 조절 |
| `js/syncedit.js` | 가사 싱크 편집기 |
| `js/karaoke.js` | 예약, 번호 입력·화면 숫자판, 검색, TV 화면(터치 막대·화면 켜 두기·가로 고정), 단축키, 간주점프, 인기차트, 동영상 곡 |
| `js/profiles.js` | 사용자, 좋아요, 재생목록 |
| `js/cloud.js` | 기기 저장(오프라인), Google Drive 동기화 |
| `js/key.js` | 키 바꾸기 (WSOLA, 워커에서 처리) |
| `js/remote.js` | 휴대폰 리모컨 중계 (`server.py`의 `/api/remote/*`) |
| `js/backup.js` | 녹음 Drive 백업, 백업 파일 |
| `js/devsync.js` | 기기 맞추기: 켤 때 "Drive와 맞추기" 띠, 점수·부른 횟수 기기별 Drive 파일 올리기·받기, 설정 창 "여행 준비" |
| `js/vendor/supabase-2.117.1.js` | **남의 라이브러리 그대로** (supabase-js UMD, MIT, 맨 위 한 줄만 더함). 고치지 않는다. 판을 바꾸면 파일 이름·`index.html`·`sw.js`를 같이. 라이선스 글은 `js/vendor/LICENSES.txt` |
| `js/hub.js` | 허브 연결(CR-227): 설정 창 "허브 연결" 칸(코드·로그인·끊기), 곡 설정 보내기·받기(`hubSync`), 허브 열쇠 칸 읽기(`hubYoutubeKey`) |
| `js/guesthost.js` | 손님 방 방장 쪽(CR-228): 설정 "손님" 줄·손님 초대 QR 시트·TV 대기 카드, 허브 Realtime 공개 broadcast 방 열기·닫기, 손님 메시지 처리 (`hub.js` 다음) |
| `js/myremote.js` | 예나 폰 리모컨 PC 쪽(CR-228 ③): 설정 고급 "예나 폰 리모컨 (허브)" 칸, 켤 때마다 새 방 + 허브 열쇠 칸 `remote_room`, 폰 명령 → `remoteRun`, 상태 → 폰 (`guesthost.js` 다음) |
| `js/vendor/toqr-0.1.1.mjs` | **남의 라이브러리 그대로** (toqr, MIT, `block-calendar` node_modules 사본). 손님 QR 그림만 `import()`로 씀. 고치지 않는다 |
| `js/autosync.js` | 무대 [자동 맞추기](LRCLIB `/api/get` → 검색), 싱크 한 줄, [자동 맞춤 · 확인해 주세요] (코드 이름·id는 옛 `sync` 그대로) |
| `js/yt.js` | 유튜브 곡 (CR-030): 공식 IFrame 플레이어, 검색 창 [유튜브 노래방 검색] 탭(링크·열쇠 검색·열어 찾기), 폰 [공유] 받기, 재생 못 함·눌러서 시작 안내, TV 유튜브 띠. `main.js` 바로 앞 |
| `js/main.js` | 메인 루프, 앱 시작 (항상 마지막) |
| `remote.html` · `js/myphone.js` | 휴대폰 리모컨 화면 (따로 동작, `remote.webmanifest`로 홈 화면 아이콘). `server.py`가 답하면 옛 길(코드), 아니면(Pages) 허브 길 `js/myphone.js`(CR-228 ③). `haptics.js`·`core.js`·supabase-js·`myphone.js` 순서, `util.js`는 안 씀 |
| `guest.html` · `js/guest.js` · `css/guest.css` | 손님 폰 화면(CR-228). `util.js`·`core.js`·`guest.js`·supabase-js 순서. 앱 화면과 따로 돌고 저장 0 |
| `sw.js` | 서비스 워커: 앱 파일·글꼴을 저장해 오프라인에서도 열리게 |
| `tests/ui/` | 화면 자동 점검 (`npm run test:ui`): `run.mjs` 차례·결과표, `edge.mjs` 헤드리스 Edge(CDP), `serve.py` 시험 서버, `checks/*.mjs` 흐름별 점검, `features.json` 기능 번호 연결표, `fixtures.mjs` 시험 파일(그때그때 만듦), `compare.mjs` 사진 비교, `selftest.mjs` 고장 잡는지 시험. 앱 파일이 아니라 `sw.js` 목록에 넣지 않는다 |

## 디자인

- 관리 화면(위쪽 막대·곡 목록·창·조작부·싱크 편집기)과 휴대폰 리모컨은 **회사 다크** (캘린더 "예나의 하루"), **TV 무대는 노래방 색 그대로** (CEO 결정 C1).
- `app.css` 맨 위 `:root`가 꽂는 자리: 예전 변수 이름(`--room`·`--panel`·`--amber` …)이 회사 변수를 가리키고, `.stage,.tv`에서 예전 무대 값으로 되돌린다. 그래서 **무대 선택자는 고치지 않아도 예전 모양**이다.
  - 같이 쓰는 부품(`.btn`·`.round`·`kbd`)은 `--btn-bg`·`--btn-line`·`--r-btn`·`--on-amber` 같은 변수로 양쪽 값을 나눈다.
  - 관리 화면에 색을 새로 쓸 때는 `#색` 대신 회사 변수(`--color-danger`·`--color-info` …).
- `--amber`는 관리 화면에서 흰색(회사 강조)이다. 소리 막대처럼 "내용 색"은 직접 값으로 둔다.
- 다크 고정. `<html data-theme="light">`로 바꿔 보면 관리 화면에 남은 직접 색을 찾을 수 있다 (무대는 남색 그대로가 맞음).
- 디자인실이 토큰을 바꾸면 두 파일을 다시 복사한다 (`cmp`로 같은지 확인).
- 진동은 손가락 화면에서만(`haptic()`): 누르기 `tap`, 예약·저장 `success`, 취소 `warning` (한 번 누르면 하나만). 리모컨은 `remote.html` 안 `buzz()`.
- 조작 막대가 가리는 높이는 `updateBarSpace()`가 문서 `--bar-h`로 둔다 → 대기 화면 아래쪽, 막대가 보이는 동안 가사 두 줄, TV 화면 알림이 그만큼 올라간다.

## 꼭 지킬 것

- **IndexedDB 이름 `hanbam-noraebang`은 바꾸지 않는다.** 앱 예전 이름이지만, 바꾸면 사용자가 넣은 곡·녹음이 안 보인다. 저장소를 추가할 땐 버전을 올리고 `onupgradeneeded`에서 없는 것만 만든다.
- localStorage 키도 예전 `nb-` 접두어를 그대로 쓴다.
- **스크립트 순서가 중요하다.** 파일 맨 위에서 바로 실행되는 코드는 앞 파일(또는 같은 파일)의 이름만 쓸 수 있다. 함수 안에서는 어느 파일 이름이든 쓸 수 있다.
- **JS 파일을 더하거나 빼면** `index.html`의 `<script>` 목록, `sw.js`의 `SHELL_FILES`를 같이 고치고 `SHELL` 버전을 올린다.
  - 새 파일의 함수를 다른 파일에서 부를 때는 `typeof 이름 === 'function'`으로 감싼다 (배포 직후 캐시로 옛 `index.html` + 새 JS가 섞이면 그 파일이 없을 수 있다. 예: `backup.js`의 `deviceId`·`saveDevStats`).
- `js/core.js`에는 DOM 코드를 넣지 않는다 (테스트가 브라우저 없이 돈다). 새 순수 로직은 여기에 두고 `tests/core.test.js`에 테스트를 더한다.
- 데모곡(반주·멜로디)을 바꾸면 `js/demo.js`의 `DEMO_CACHE_KEY` 숫자를 올린다. 안 올리면 예전 반주가 계속 나온다.
- 곡·녹음 내용이 바뀌면 `persistSong(s)` / `recTouch(r)`로 `updatedAt`을 남긴다. Drive 동기화는 `updatedAt`이 더 나중인 쪽이 이기고, 지운 것은 지움 기록(tombstone)으로 남긴다.
- **기기 맞추기**:
  - 점수·부른 횟수는 `library.json`·`SONG_FIELDS`에 넣지 않는다 (예전 판이 지운다).
  - 기기마다 Drive `stats-<기기 id>.json`을 자기 것만 쓰고, 다른 기기 것은 `nb-devstats`에 사본으로 둔다.
  - `nb-plays`·`nb-scores`는 이 기기가 센 것만 (남의 기록을 섞지 않는다). 화면 합계는 `totals()`(core.js `statsTotals`)로 보여 줄 때만 더한다.
  - 새 키: `nb-device`(기기 id) · `nb-devstats` · `nb-gstats`(내 파일 id·비교값) · `nb-travel`(마지막 여행 준비). 연결 끊기는 `nb-devstats`·`nb-gstats`만 지운다.
- 로그인 창은 누른 줄에서 바로 열어야 막히지 않는다: 띠·여행 준비 버튼은 `await` 앞에서 `syncNow({ interactive: true })`를 부른다. `syncNow`는 `{ ok, newSongs, devices }` / `{ ok: false, error }` / `{ busy }`를 돌려준다. 로그인 토큰은 저장하지 않는다.
- 여러 곡 받기는 `downloadSongs(list)` 하나 ("모두 받기"·여행 준비): 404·403은 건너뛰고, 로그인 끝남·끊김·공간 부족·멈추기에서 멈춘다. `ensureMedia`는 기기에 저장한 뒤에만 `s.blob`을 넣는다.
- 사용자에게 보이는 글은 쉬운 한국어로, 이유와 해결 방법을 같이 쓴다.
- **숨김 정리 (CR-229)**: 복잡한 칸은 **지우지 않고 숨긴다** (코드·단축키·저장 값·동작은 그대로, 기능 줄은 `features.json` `hide`).
  - 설정 창 `더 보기 (고급)`(`#advBtn`) → `nb-advanced`='1'이면 `<html class="adv">` = 숨기기 전 화면. 끄면(기본) `.adv-only`·`.adv-full`이 숨고 `.adv-short`가 보인다 (`css/app.css` "숨김 정리").
  - 그 자리에서 펴는 칸: `.fold` 안 `.fold-btn`("더 보기 ›")을 누르면 `.unfold` → `.fold-more`가 보인다 (음향 설정 세부, "가사 맞추기 ›", 설정 창 "이 기기에 저장된 곡"). 고급이면 늘 펴져 있다.
  - 음향 설정(`#deckMore`): 고급 꺼짐이면 사람이 펴고 접은 상태를 `nb-deck`에 기억 (처음엔 접힘). 고급 켬이면 예전 규칙 (PC 펼침, ≤560 접힘) — core.js `deckOpenAtStart`.
  - 설정 창 차례: 손님(`#guestSec`, 맨 위 묶음 — 고급 밖, 디자인 확인 CR-228 2장) → 곡 창고(Drive · 이 기기에 저장된 곡 · 허브 연결 `#hubSec` — 고급 밖, 디자인 확인 CR-229 #2) → `더 보기 (고급)` 안에 여행 준비 · 백업 파일 · MR 만들기(주소는 `#mrAddr` 안) · 예나 폰 리모컨(`#myRemoteSec`, 허브에 로그인해 있을 때만 `myRender`가 보이게 함, `#advBtn` 작은 글 "예나 폰 리모컨"(`#advSubMy`)도 그때만, CR-228 ③) · 옛 휴대폰 리모컨(`#remoteSec`, 서버로 켰을 때만 `renderRemoteInfo`가 보이게 함 — Pages에서는 고급을 켜도 안 보임, `#advBtn` 작은 글 끝 "옛 휴대폰 리모컨"(`#advSubRemote`)도 그때만).
  - 새 칸을 숨길 때는 위 클래스만 쓰고, 그 칸을 보는 화면 점검은 고급 켠 화면에서 그대로 돌게 둔다 (`tests/ui/checks/_lib.mjs` `openPage`가 탭마다 `nb-advanced`='1'). 숨김 자체는 `checks/hide.mjs`(W13).

## 유튜브 곡 (`js/yt.js`, CR-030)

- 곡 하나 = `source:'yt'` + `ytId`(영상 번호 11자) (+ 플레이어가 알려 준 길이 `ytDur`). 판정은 `core.js isYtSong`, 찾기는 `findYtSong`. 파일(`blob`·`fileId`)이 없다.
- **재생 소스 층(R3)**: `playback.js`의 `play`·`pause`·`stopPlayback`·`seekTo`·`onFinish`·`curTime`·`dur`는 `ytSong()`이면 `ytPlay`·`ytPause`·`ytStop`·`ytSeek`·`ytTime`·`ytDur`로 보낸다. MR 곡 길은 그대로. "곡 준비됨"은 `songReady(s)` (`s.buffer`를 직접 보지 않는다).
- 약관: 공식 IFrame API(`https://www.youtube.com/iframe_api`, 플레이어 host는 youtube-nocookie)만. 영상은 보이는 채로, 노래방 요소가 위에 겹치지 않게(`ytFrame`이 무대 빈 곳에 16:9로 놓음), 200×200 아래로 줄이지 않는다. 화면이 숨으면 멈춘다. **영상 소리를 Web Audio에 잇거나 녹음·내려받기하는 코드를 넣지 않는다** (화면 점검 V6이 `yt.js`를 훑어 봄).
- 유튜브 곡은 키·녹음·반주 볼륨을 끈다 (`setKey`·`setArmed`·`bumpMr`가 안내만). 점수는 마이크 + `curTime()`(= `ytTime`)이라 그대로 켜 둔다.
- 검색 열쇠(YouTube Data API)는 **`ytSetKey(글자 또는 함수)`로 메모리에만** (허브 CR-227이 부름). localStorage·IndexedDB·Drive·화면·로그에 쓰지 않는다. 열쇠가 없으면 링크·[공유]·[유튜브에서 열어 찾기]만. 한도(400·403·429)면 이 화면 동안 열쇠 없는 길.
- 열쇠가 없을 때 곡 제목은 플레이어가 재생할 때 알려 주는 제목(`getVideoData`)으로 채운다. oEmbed 같은 바깥 접속을 더하지 않는다.
- 폰 [공유]: `manifest.webmanifest` `share_target`(GET `./`, title·text·url) → 켤 때 `ytHandleShare`가 주소 칸을 지우고 확인 창. `sw.js`는 공유 주소를 가로채거나 저장하지 않는다. `start_url`·`scope`는 바꾸지 않는다.
- TV에서 유튜브 곡이면 `#tv.yt-mode`: 무대는 위 칸, `#tvRemote`가 아래 68px 띠. 이때 `flash()`와 `toast()`는 무대 가운데·띠 왼쪽 대신 띠 안(`ytBandNote`)에 뜬다 (yt.js가 두 함수를 감쌈).
- 폰(무대 폭 640 아래, TV 아님)에서 창(`YT_SPLIT`)이 열리면: 멈춘 영상은 숨기고(창이 무대를 다 씀), 재생 중이면 무대에 `yt-grow`를 붙여 `--yt-cut` + 창 높이만큼 길게 한다 (위 영상 · 아래 창).
- 폰(폭 560 아래)에서 재생 전에 곡 검색 창을 열면 무대가 `min(600px,78vh)`로 길어지고 창이 무대 폭을 다 쓴다. 검색 줄 단추는 다음 줄 오른쪽(높이 36), 썸네일 96×54, ✕ 48×48 (`app.css` 맨 끝, 무대가 `.main` 안일 때만 → TV 화면은 그대로). 못 트는 영상 안내(`#ytErr`)가 보이면 곡 제목 카드·가사를 숨긴다.
- 화면 점검은 `tests/ui/fake-yt.js`(가짜 플레이어)·`checks/youtube.mjs`. 열쇠는 `run.mjs`의 가짜 글자만 쓴다.

## 곡 넣기 자동화 (`js/bulk.js`)

- 곡 추가 창에서 MR을 2개 이상 고르거나(파일 칸 `multiple`은 새로 넣을 때만) PC에서 곡 목록(`#songsPanel`)에 끌어다 놓으면 `openBulk(files)`, 곡 목록 위 `#missBtn`은 `openMissing()`. MR이 아닌 파일은 `isMediaFile`로 빼고, 줄 순서·번호는 파일 이름 순서(`byFileName`, `nextSongNumbers`).
- 제목·가수는 `titleFromFilename` 하나로 (곡 추가 창 파일 하나, 여러 곡 넣기, Drive 폴더 들여오기가 같이 씀).
- 가사는 LRCLIB에 **한 번에 한 곡씩**, 곡 사이 0.5초. 곡마다 많아야 3번 (`findLyrics`: 제목+가수 → 가수를 못 맞추면 괄호 안 이름 → 결과가 없으면 제목만). 두 곡 연달아 "바빠요"면 멈춘다. 시험할 때 요청을 많이 보내지 않는다 (곡 5개 안팎).
- 저절로 넣는 기준은 `chooseLyrics` (싱크 + 제목 같음 + 가수 같음 + MR 길이 `AUTO_SEC` 3초 안, 넷 다). 가수 비교는 `artistMatches` (괄호 앞·안 이름, Feat. 뒤는 뺌). 정렬은 `rankLyrics` (곡 추가 창도 같이 씀).
- **"가사 자동" 표시는 곡에 저장하지 않는다.** Drive `library.json` 칸(`SONG_FIELDS`)을 늘리면 예전 판 화면이 동기화할 때 그 칸을 지운다. 새 곡은 곡 추가 창과 같은 모양으로 `persistSong`(여러 곡이면 `quiet`로 실패 알림을 한 번만).
- 창을 닫으면(취소·✕·Esc·TV 화면) 아무것도 저장하지 않고 찾기도 멈춘다 (`Bulk.sess`). 저장해도 무대의 곡은 그대로 두고 목록만 첫 새 곡으로 옮긴다.

## MR 만들기 (`js/mr.js`)

- 서비스는 따로 저장소 `C:\dev\yena-mr` (집 AI 서버 DGX의 도커).
- 노래방은 **서버에 요청하지 않는다** (https 노래방 → http 서버는 막힘). 노래방이 DGX로 `fetch`하는 코드를 넣지 않는다 (2단계 HTTPS는 따로 CR).
  - 곡 목록 `#mrBtn`이 서버 주소 + `/`("MR 만들기 창")를 이름 있는 창 `yena-mr`로 연다 (클릭 안에서 바로, `noopener` 쓰지 않음). 창이 다 만든 MR 파일을 `postMessage`로 넘긴다.
- 메시지 약속은 yena-mr README와 같다: 모두 `{app:'yena-mr', v:1, type}`. 창 → `hello`·`files{files}`, 노래방 → `welcome`·`ack{n}`·`nack{reason:'busy'|'bad'}`.
  - 가사 정렬(CR-227 W7·W8)은 v:1에 **더하기만** 했다 (`docs/align-api.md` 5장, yena-mr 저장소): 창 → `hello{caps}`·`lyrics_req{items}`·`files{files, lrc}`·`aligned{songId, lrc, score, level}|{songId, error}`, 노래방 → `welcome{caps:['lyrics','align']}`·`lyrics{items}`·`align_req{songId,title,artist,lyrics}`·`align_stop{songId}`·`ack{n,songId}`·`nack{reason:'busy',songId}`. 예전 창(caps 없음)·예전 노래방은 모르는 칸·type을 지나쳐 예전 길(U1~U7) 그대로.
  - 받는 규칙은 `core.js mrMessageOk` (보낸 창이 `Mr.win`, 보낸 주소가 설정 주소의 origin, 파일 30개·한 파일 120MB·`isMediaFile`).
  - 다른 창이 열려 있거나 TV·싱크 편집 중이면 `nack busy` + 알림 (열린 창·입력은 그대로).
- 받은 파일은 `openBulk(files, note)` 그대로 (둘째 인자 = 안내 줄 "MR 만들기로 만든 곡 N개예요…", 없으면 예전과 같다). 곡 저장 구조·`SONG_FIELDS`는 안 바꾼다.
- 서버 주소 (CR-231): **코드·문서·테스트에 집 AI 주소를 적지 않는다** (짧은 기계 이름·tailnet 이름·IP 모두. 공개 저장소). `MR_DEFAULT_SERVER`는 `''`. 예시는 `http://(집 AI 이름):8765`, 테스트는 `*.example.test` 같은 가짜 이름만.
  - 쓰는 차례 (`core.js mrServerPick`): ① 이 기기 `nb-mrserver` ② 허브 열쇠 칸 `hub_secret('noraebang','mr_server')` (로그인한 뒤 한 번 읽어 메모리 `Hub.mrServer`, `hub.js hubMrServer`) ③ 없음 → [MR 만들기]·[원곡 파일로 자동 맞추기]가 창을 열지 않는다. 곡 목록 안내와 싱크 한 줄 모두 짧은 `MR_NOSERVER_SHORT` + [주소 넣기](곡 목록 `#mrGo`, 싱크 줄은 `info.go` → 곡 수정 창이 열려 있으면 닫고 `mrGoSettings`). 길이 든 `MR_NOSERVER_TEXT`(설정 › 더 보기 (고급) › …)는 기록·시험용으로 남김.
  - 허브 값이 왔는데 이 기기에 값이 없으면 `mrHubValueOk`(=`normalizeMrServer`)가 맞을 때만 이 기기에도 저장 (`mrHubFill`). 틀린 값은 버린다.
  - 설정 창 [저장]: 언제나 이 기기에 저장 + 허브에 로그인해 있으면 `hub_secret_set`도 (`hubMrServerSet` → ok·off·fail, 안내 `MR_SAVE_TEXT`). 허브만 실패하면 이 기기 값은 그대로 두고 허브만 못 넣었다고. 빈 칸 저장 = [이 기기에서 지우기] = 이 기기 값만 지움 (허브 값을 지우는 단추는 없다).
  - 로그아웃·연결 끊기·허브 바꾸기는 메모리 값만 지운다 (`hubForgetMrServer`, 이 기기 `nb-mrserver`는 그대로). 손님 화면(guest.html)은 hub.js·mr.js를 안 불러온다.
  - 주소는 설정 칸에만 보인다: 콘솔·Drive `library.json`·백업 파일·허브 곡 기록에 넣지 않는다.
  - Drive `library.json`·백업 파일에 넣지 않는다.
- 10초(`MR_HELLO_MS`) 안에 창이 `hello`를 안 하면 "못 닿았어요" + [다시 해 보기]. 이어진 창이 열려 있으면 다시 누를 때 새로 열지 않는다 (올리는 중인 곡이 끊기지 않게).
- 화면 점검은 `tests/ui/fake-mr/index.html`(가짜 창, 다른 포트)과 `checks/mr.mjs`. 진짜 창의 진행·실패 안내(U4·U5)는 yena-mr 저장소 시험이 본다.

## 허브 연결 (`js/hub.js`, CR-227)

- 허브 = 회사 Supabase (키트 `supabase/migrations/0001_hub.sql`의 `hub_push`·`hub_pull`, `0008`의 `hub_secret`). 범위 `noraebang`, 모음 `song_settings`. 표·권한은 데이터플랫폼실 것이라 노래방은 함수만 부른다.
- **연결 값은 이 기기 `nb-hub*`에만**: `nb-hub`(주소·공개 키) · `nb-hub-auth*`(로그인 세션, supabase-js가 씀) · `nb-hub-out`(보낼 곡) · `nb-hub-owner`(처음 계정의 해시 16자리). 백업 파일·`library.json`·`stats-*.json`·화면·콘솔에 넣지 않는다. 비밀번호는 저장하지 않는다.
  - 받는 값 검사(`hubCodeParse`·`hubPairOk`, core.js): 주소는 `https://<소문자·숫자 20자>.supabase.co`, 키는 공개 키(anon JWT·`sb_publishable_`)만. `sb_secret_`·service_role은 거절.
  - 주소 `#hub=nbhub1.…`로 열면 저장하고 `history.replaceState`로 `#`을 지운다 (hub.js 맨 위, 다른 화면 그리기 전에).
- 곡 열쇠 `songSettingsKey`: MR 곡 = 파일 내용 SHA-256 앞 40자 `mr-…`(곡에 `mrHash`·`mrHashSize`로 한 번만 계산), 유튜브 곡 = `yt-<영상번호>`. 제목·가수는 열쇠가 아니다. **MR 소리 파일은 허브에 올리지 않는다.**
- 곡에 더한 칸(IndexedDB에만, `SONG_FIELDS`·Drive에는 안 넣음): `mrHash`·`mrHashSize` · `baseKey`(곡 기본 키) · `syncChk`(자동 맞춤 확인 표시) · `settingsAt`(설정 고친 시각) · `hubK`·`hubSig`·`hubAt`(허브와 맞춘 표시) · `hubRej`(너무 커서 못 보냄).
- 합치기는 core.js `hubPlan`(나중 시각이 곡 통째로 이김, 지움은 표시만) · `hubMirrorAdd`(받은 줄 사본). 허브 사본은 IndexedDB `cache`의 `hub-songs` 한 줄.
- 설정을 고치는 곳은 `hubTouch(s)`를 부른다 (가사 타이밍·키·싱크 편집 저장·곡 수정·여러 곡 넣기·자동 맞추기). 3초 뒤 맞추기, 1분마다(앞에 있을 때)·앞으로 올 때·인터넷이 돌아올 때도. 실패하면 5분 쉼.
- 키 두 층: 사용자별 키(`me().keys`)가 이기고, 없으면 허브를 쓸 때만 곡 기본 키(`keyOf`).
- 허브 코드가 없으면(`nb-hub` 없음) 요청·타이머 0, 지금과 똑같이 돈다 (W12). 허브 함수를 다른 파일에서 부를 때는 `typeof … === 'function'`.
- 허브 열쇠 칸(YouTube 검색 열쇠)은 `hubYoutubeKey()` 읽기 하나: 로그인 뒤 한 번 읽어 **메모리에만**, `ytSetKey`(CR-030 `yt.js`)가 있으면 넘긴다. 로그아웃·끊기에서 지운다.
- **CSP** (`index.html` `<meta>`): `script-src`·`connect-src`만 정한다. 새 바깥 주소(스크립트·fetch)를 쓰면 여기에 더한다. 지금: Google 로그인·Drive, cdnjs(QR), YouTube, LRCLIB, `*.supabase.co`(허브·손님 방 Realtime `wss`). 손님 화면 `guest.html`은 따로 CSP (아래 "손님 방"). 허브·LRCLIB·사용자 글은 `textContent`로만 넣는다.

## 자동 맞추기 (`js/autosync.js`, CR-227 1단계 · 화면 말은 CR-236에서 "싱크" → "맞추기·시각")

- LRCLIB에는 **곡 제목·가수(첫 이름)·MR 길이만** 보낸다 (`lrclibGetParams`). 덧붙이는 머리글 없음 (CORS 미리 묻기가 생김).
- 길이: MR 파일 → 없으면 유튜브 곡은 영상 길이 `s.ytDur` (플레이어가 알려 준 값). 그래서 유튜브 곡도 MR 곡과 같은 길이 규칙(3초 안)이 돈다. 영상 길이를 아직 모르면 길이 없이 보낸다 (그때는 `/api/get` 답을 길이 비교 없이 받음).
- 정확히 한 곡 찾는 `/api/get` 먼저 → 없거나(404) 맞지 않으면 곡 추가 창과 같은 `findLyrics`(검색) + `chooseLyrics`. 고르는 규칙은 core.js `autoSyncPick`.
- 연주곡(`instrumental`)이면 가사를 넣지 않고 안내만. 찾으면 `syncChk`를 켜고 [자동 맞춤 · 확인해 주세요] 단추 → 가사 맞추기(싱크 편집기)에서 저장하거나 가사를 손으로 고치면 `clearSyncCheck`.
- [자동 맞추기](`#autoSyncBtn`)·[자동 맞춤 · 확인해 주세요](`#syncChkBtn`)·[원곡 파일로 자동 맞추기](`#alignBtn`, 끝)는 아래 조작부 `#syncTools` 한 줄: 접힌 "가사 맞추기 ›"(`#lyrFold`) 밖이라 고급을 꺼도 보인다. 세 단추가 다 숨으면 줄도 숨는다 (`css/app.css` `#syncTools`, 손가락 화면(`hover:none`)에서는 단추 모양은 그대로 두고 `::after`로 손가락 자리만 48, 줄 사이 18px이라 두 줄로 꺾여도 안 겹침).
- 화면에 남은 "싱크"는 녹음 쪽만 (녹음 싱크·`싱크·믹스 조절`·녹음 기본 싱크). 가사 쪽은 "맞추기"·"가사 시각"으로 쓴다 (토스트 "가사 시각을 저장했어요", 곡 추가 창 태그 "시각 있음").
- 싱크 한 줄(`#syncLine` 무대 아래, `#syncLine2` 곡 수정 창): 찾음 / 불러옴(다른 기기) / 못 찾음 [직접 맞추기] / 집 AI가 맞추는 중 [그만두기] / 집 AI 오류 글 (CR-236 W7 R2: 폰 412에서도 단추와 한 줄). 오류 단추는 `alignInfo`: 목소리 없음·소리 파일 아님 = [다른 파일로](`info.again`, 곡 수정 창이면 `#alignBtn2`, 무대면 `alignStart`) · 서버 주소 없음 = [주소 넣기](`info.go`) · 그 밖 = [직접 맞추기].

## 집 AI 가사 정렬 (CR-227 2단계 W7·W8, `js/mr.js`·`js/autosync.js`·`js/bulk.js`)

- 노래방은 여전히 서버에 요청하지 않는다. 정렬도 MR 만들기 창(yena-mr `web/index.html`)이 하고, 노래방은 `postMessage`로 가사를 주고 결과만 받는다. 받는 모양 검사는 `core.js mrMessageOk` (`files.lrc`·`lyrics_req`·`aligned`·`hello.caps`), 넣을 곡 가사는 `mrLyricsFor`·`alignLyricsText`, 오류 글은 `ALIGN_ERR_TEXT` (yena-mr `app/errors.py`와 같은 뜻).
- W7 (MR 만들 때 같이): 창의 `lyrics_req`에 곡마다 답한다 (`mrAnswerLyrics`) — 노래방에 같은 곡(제목·가수)이 있으면 그 가사, 없으면 LRCLIB `/api/get`(제목·가수·길이만, 8초). 시각이 이미 있으면 `synced:true`(글 안 보냄, 창이 맞추지 않음). `files.lrc`는 여러 곡 넣기 창에서 보통·높음 = `✔ 집 AI 시각 · 확인해 주세요`(W9 표시 `syncChk`) · 낮음 = 후보로만.
- W8 (원곡 파일로 자동 맞추기): 무대(`#syncTools`, 시각 없음·확인 표시 곡)·곡 수정 창(가사가 있는 곡) 단추 → `alignStart`가 클릭 안에서 같은 이름 창 `yena-mr`을 열고 `hello` 뒤 `align_req`. 기다리는 요청은 `Align.want` (창이 다시 인사하면 다시 보냄, 창은 같은 곡을 한 줄로). 10초 안에 인사가 없거나 인터넷이 없으면 "집 AI에 닿지 않아요 · 집에 가면 다시 해요".
- 결과 넣기는 `alignApply`: `level` low → "가사 시각이 많이 틀릴 수 있어요. 넣을까요?", 이미 시각 있는 가사 → "이미 시각이 있는 가사예요. 바꿀까요?" (둘 다 처음 초점·Esc = 넣지 않기). 낮음을 넣지 않으면 그 결과를 **이 화면 메모리에만** 둔다 (`AutoSync.dropped`, 곡 id → `{lrc, level, base}`; IndexedDB·허브·백업·Drive에 안 넣음, 새로 고치면 사라짐, CR-236 W7 R5). 그 곡의 수정 창을 열면 가사 후보에 "집 AI" 한 줄로 보이고, 고른 뒤 저장하면 `syncChk` (`alignDropTaken`). 가사가 그 사이 바뀌었으면(`base` 다름) 후보를 버린다. 넣으면 `syncChk` + `hubTouch` (허브 길 그대로). 맞추는 사이 가사를 고쳤으면 넣지 않고 `ack{n:0}`. 다른 창이 열려 있으면 `nack busy`.
- 화면 점검: `tests/ui/checks/align.mjs` + 가짜 창 `tests/ui/fake-mr/index.html` (caps·aligned 흉내). 진짜 창 쪽은 yena-mr `tools/w7_check.py`.

## 손님 방 (`js/guesthost.js` · `guest.html`, CR-228)

- 방 = 회사 허브 Realtime **공개 broadcast** 채널 하나 (`private`·presence·표 변경 0). 방 이름은 열 때마다 새 256비트 난수 `nbr-…`(core.js `guestRoomName`). 방장(노래방)이 먼저 붙고, 손님 메시지는 이벤트 `g`, 방장 답은 `h`.
- QR 주소 = `…/guest.html#r=<방 이름>&c=<허브 연결 코드 nbhub1.…>` (core.js `guestUrl`). **값은 `#` 뒤에만, `?` 없음.** 손님 화면은 열자마자 `history.replaceState`로 `#`을 지우고 값은 메모리에만 둔다 (`guestUrlParse`).
- **방 이름·연결 코드·허브 주소·키는 콘솔·기록·화면 글에 찍지 않는다** (QR 그림 안에만). 손님은 로그인·허브 표·RPC 0, 저장(localStorage·sessionStorage·IndexedDB·쿠키·서비스 워커) 0.
- 메시지 모양은 core.js `guestMsgOk`(종류 `hello`·`search`·`reserve`·`unreserve`·`key`·`bye`, 4KB까지, 키 −2~2, 손님 표 16~32자, 이름 10자). 모르는 종류·모양 틀림·안 들어온(hello 안 한) 손님 메시지는 답 없이 버린다. 손님 6명(`GUEST_MAX`), 한 사람 1초 4개(`guestRateOk`), 방 전체 1초 30개.
- 방장이 대신 처리하고 **결과만** 돌려준다: 찾기 = MR 창고에서 번호·제목·가수·종류만 30개(`guestSearchResult`), 예약 = 곡 번호가 진짜 있는지 다시 확인, 빼기 = 그 손님이 넣은 예약만(`guestQueueMap`), 상태 = 지금 곡·다음·예약 제목 10개(`guestStateMsg`, 바뀔 때와 20초마다).
- 답: `welcome`·`full`·`found`·`ok{rid,pos}`(pos 0 = 바로 시작)·`ok{gone}`·`no{why: many·nosong·gone·keyoff·nokey·yt}`·`state`·`closed`.
- 유튜브 곡(`reserve{ytId}`·`search{kind:'yt'}`)은 `typeof ytReserve === 'function'`(CR-030 `yt.js`)일 때만 처리. 없으면 `no{why:'yt'}`, 손님 화면 유튜브 칸은 숨김(`state.yt`).
- 방을 닫는 때: [방 닫기] · [새 QR 만들기](새 방) · 노래방 화면 닫기(`pagehide`) · 허브 연결 끊기·바꾸기(`guestTick`이 1초마다 `Hub.sb`를 봄). 닫으면 손님에게 `closed`를 보내고 방 이름·손님 이름·예약 표를 메모리에서도 지운다.
- 예약 목록의 손님 이름은 `guestNickAt(i)`(karaoke.js `renderQueue`·`renderQueueList`가 `typeof`로 부름). 방이 닫혀 있으면 ''.
- 이 기기 설정: `nb-guest-tv`(`'0'` = TV에 QR 안 보임) · `nb-guest-key`(`'0'` = 손님 키 바꾸기 끔). 기본은 둘 다 켬이라 키를 안 만든다.
- TV 대기 카드 `#guestCard`: 방이 열려 있으면 QR(`#tvIdle.guest-on`이면 옛 리모컨 안내 `#remoteInfo`는 숨김), 닫혀 있으면 허브가 있을 때만 [손님 QR 켜기]. 카드가 보이면 점수 칸은 시계 옆(`.idle-right>.best` 1행 2열)·팁은 고급이어도 한 줄, QR은 `max(96px,16cqw)` (디자인 확인 CR-228 #1~#3). QR 이미지는 1칸 = 1px로 그리고(`guestQrMake` → `Guest.qrPx`), 보이는 크기는 `guestQrFit`가 그 배수로 내린다 (core.js `qrFitPx`, 카드는 최소 96px라 모자라면 한 배 위로, 창 `#guestQrImg`는 220px 안). 낮은 화면(높이 480px 이하)에서는 카드가 한 줄 `#guestCardMini` "손님 QR: 설정 › 손님"만 (CR-228 L1). 카드 바탕은 `--panel` (L8). `server.py` 휴대폰 리모컨(N1~N21)은 그대로.
- 손님 화면 CSP는 `guest.html` `<meta>`에 따로: `default-src 'none'`, 스크립트·스타일은 `'self'`, 바깥은 `https://*.supabase.co`·`wss://*.supabase.co`만. `sw.js`는 손님 파일도 저장하지만(`SHELL` v14) 허브 요청은 저장하지 않는다.
- 알려진 한계: 공개 broadcast라 방 이름을 아는 손님은 방장 답(`h`)을 흉내 낼 수 있다 (다른 손님 화면에 가짜 `closed`·목록). 손님 화면은 `textContent`로만 넣어서 스크립트는 못 넣는다.

## 예나 폰 리모컨 (`js/myremote.js` · `js/myphone.js`, CR-228 ③)

- 옛 휴대폰 리모컨(`server.py` `/api/remote/*`, N1~N21)은 그대로 두고, `server.py` 없이(GitHub Pages) **예나 폰이 허브로** 같은 16가지 명령을 보내는 길을 더했다. TV QR·안내 글을 이 길로 바꾸는 것(기본 길 바꾸기)은 ④.
- 방 = 회사 허브 Realtime **공개 broadcast** 채널 하나 (`private`·presence·표 변경 0, 손님 방과 따로). 이름은 켤 때마다 새 256비트 난수 `nbm-…`(core.js `myRoomName`, 손님 방 `nbr-…`과 모양이 달라 섞이지 않음). 폰 → PC 이벤트 `p`(`hello`·`cmd`·`bye`), PC → 폰 `m`(`welcome`·`songs`·`state`·`ok`·`no`·`full`·`closed`).
- 방 이름 건네기 = 허브 열쇠 칸 `hub_secret_set`/`hub_secret('noraebang','remote_room')` (키트 0008, 새 SQL 없음) = 예나 계정만 읽는다. **방 이름은 주소(`?`·`#`)·QR·화면 글·콘솔·기록에 쓰지 않는다.**
- PC(`myOpen`): 채널에 먼저 붙고 → 열쇠 칸에 쓰고 → 듣기. 여는 사이 로그아웃·끄기가 오면(`My.gen`) 붙은 채널을 떼고 칸도 되돌린다.
- 방 끝: 끄기(`myClose`) · 이 화면 닫기·새로 고침(`pagehide` 잡기 단계 → `closed`, supabase가 소켓을 끊기 전. 가짜 점검 다리는 닫히는 페이지의 마지막 메시지를 못 받아 X9는 폰의 30초 끊김 길로 보고, 바로 뜨는지는 기기 확인 X10) · 로그아웃·허브 끊기(`myHubLeaving`, `hub.js`가 부름) · 허브 바뀜(`myTick`이 1초마다 `Hub.sb`). 폰에 `closed`를 보내고, 열쇠 칸이 아직 이 방이면 비운다. 다른 화면이 새로 켜서 칸이 다른 방이 되면 이 화면은 1분 안에 저절로 끈다 (안내 `myNote`).
- 켜 둔 것은 이 기기 `nb-myremote`='1' (처음엔 꺼짐) → 다음에 열 때 로그인해 있으면 새 이름으로 다시 켠다 (`myHubChanged`, `hubSetState`가 부름). 로그아웃해도 이 값은 그대로.
- PC가 지키는 것(`myOnMsg`): 모양 검사 core.js `myMsgOk`(종류 3가지·명령 `MY_CMDS` 16가지·명령마다 칸 모양 `myArgsOk`·4KB까지) · hello 안 한 폰의 명령 버림 · 폰 4대(`MY_MAX`, 5번째는 `full`) · 한 대 1초 8개 · 방 전체 1초 20개 · 곡·예약·사용자 다시 확인(`myCmdWhy` → `no{why: nosong·gone·noprofile}`). 버린 메시지에는 답하지 않는다.
- 실행은 옛 리모컨과 같은 `remoteRun`, 상태는 `remoteState` 그대로: 곡 목록은 32KB 조각 `songs`(`mySongParts`, 표시 `mySig`가 바뀌었을 때만), 나머지는 `state`(명령 뒤·바뀔 때·10초마다). 손님 방(`nbr-…`)은 이벤트 `g`·손님 모양(`guestMsgOk`)만 받으니, 거기로 보낸 예나 모양 메시지는 실행되지 않는다.
- 폰(`js/myphone.js`): `remote.html`이 `/api/remote/info`를 물어 `remoteModePick`이 server.py 답(200 · 휴대폰 403 `local only`)이면 옛 길(코드) 그대로, 아니면 허브 길. 같은 주소의 노래방 앱이 저장한 `nb-hub`·`nb-hub-auth`를 그대로 쓴다 (로그인은 노래방 앱에서만, 폰은 열쇠 칸을 읽기만). 받은 것은 `myInOk`·`myCleanSongs`·`myCleanState`로 다시 걸러서 옛 길과 같은 `S` 모양으로 그린다. "전체 예약"은 `myChunkIds`로 4KB 안 조각.
- 폰 안내 화면 `#hubView` (글은 `remote.html` `HUB_VIEW`): 붙는 중 · 로그인 필요 [노래방 열기] · 꺼짐 [다시 해 보기] · 못 닿음 · 폰 많음. 꺼짐·못 닿음이면 화면이 보이는 동안 15초마다 열쇠 칸을 다시 본다. 끝난 방 이름에는 [다시 해 보기]로만 다시 붙는다.
- `remote.html` CSP `<meta>`: `connect-src 'self' https://*.supabase.co wss://*.supabase.co` (옛 길은 같은 주소만 씀).
- 알려진 한계: 공개 broadcast라 방 이름을 아는 사람은 명령을 보낼 수 있다 (이름은 예나 계정 열쇠 칸에만, 켤 때마다 바뀜). PC 답(`m`)도 흉내 낼 수 있지만 폰은 `textContent`로만 넣는다.

## 녹음 구조

목소리만 따로(16비트 PCM) 저장하고, 반주는 "녹음 몇 초 지점에 반주 몇 초(어떤 키)"인지(`parts`)만 기록한다. 그래서 녹음 뒤에도 타이밍·볼륨·효과를 바꿔 다시 섞을 수 있다(`buildMix`, `renderMix`).

## Claude의 내장 브라우저로 확인할 때

- 내장 브라우저에서는 서비스 워커가 보내는 요청이 localhost에 닿지 않아, 예전 화면이 캐시에서 열릴 수 있다. 확인 전에 서비스 워커 등록과 캐시를 지운다.
- 사용자의 실제 데이터는 사용자의 크롬에 있다. 내장 브라우저에서 만든 테스트 데이터는 끝나면 지운다.
