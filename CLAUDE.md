# YT 노래방

집에서 쓰는 노래방 웹앱. 빌드 도구 없이 정적 파일(HTML/CSS/JS)과 작은 파이썬 서버로 돈다. 사용자는 한국어를 쓰고, 화면 문구와 코드 주석도 한국어로 쓴다.

## 실행과 테스트

```bash
python server.py 5173            # 이 PC에서만 (마이크는 https 주소나 localhost에서만 된다)
python server.py 5173 --lan      # 같은 와이파이 휴대폰 리모컨 허용
python server.py 5173 --lan --tv # 켠 뒤 크롬 앱 창·전체 화면으로 /?tv=1 (이미 켜져 있으면 TV 화면만)
npm test                         # Node 핵심 로직 테스트 + 파이썬 서버 테스트
```

- 사용자는 `YT 노래방 켜기.bat`(= `server.py 5173 --lan --open`) 또는 `YT 노래방 TV로 켜기.bat`(= `--lan --tv`)으로 켠다.
- `--tv`는 크롬을 `--user-data-dir` 없이 연다. 곡·녹음이 평소 크롬 프로필의 IndexedDB(`http://localhost:5173`)에 있어서, 다른 프로필로 열면 곡이 안 보인다. 크롬을 실제로 띄우는 확인은 사용자 화면에 창이 뜨니 하지 않는다 (테스트는 가짜 `popen`).
- 주소에 `?tv=1`이 있으면 앱 시작 뒤 바로 TV 화면(`startInTV`). 전체 화면이 아니면 첫 키·클릭에 전체 화면을 시도한다.
- 휴대폰 리모컨 코드는 저장소 폴더의 `.remote.json`(`{"pin","fixed"}`, git에 안 올림, `hidden()`이 안 내줌)에 저장해서 다시 켜도 같다. 불러오기는 `main()`에서만 하고, 테스트는 `server.PIN_FILE`을 임시 폴더로 바꾼다. 새 코드·고정 설정은 `POST /api/remote/pin`(이 PC에서만).
- 휴대폰 `remote.html`은 맞은 코드를 `localStorage['yt-remote-pin']`에 기억한다 (이 키 이름은 바꾸지 않는다). 홈 화면 아이콘용 `remote.webmanifest`가 따로 있다.
- 배포는 GitHub Pages(정적 파일 그대로). Pages에서는 `server.py`가 없으니 휴대폰 리모컨은 꺼지고, 나머지는 다 된다.

## 구조

`index.html`은 화면 뼈대만 있고, 기능은 `js/`의 **일반 스크립트(모듈 아님)** 들이 전역 이름을 같이 쓰는 방식이다.

| 파일 | 내용 |
|---|---|
| `js/util.js` | 공용 도구 (`$`, `el`, `fmt`, `pick`, `lsGet`, `norm`, `chosung` …) |
| `js/core.js` | **화면과 상관없는 순수 로직**: 가사(LRC) 읽기, 검색, Drive 동기화 합치기 규칙, 백업 파일 형식. Node 테스트가 직접 불러 쓴다 |
| `js/store.js` | IndexedDB, 설정 |
| `js/demo.js` | 데모곡 반주 합성 + 기기 저장(캐시) |
| `js/audio.js` | 오디오 엔진, 목소리 효과, 마이크, 녹음 캡처 워클릿, 지연 측정 |
| `js/songs.js` | 앱 상태(`state`), 곡 목록, 곡 추가/수정, LRCLIB 가사 찾기 |
| `js/playback.js` | 재생, 노래방식 두 줄 가사, 음정·점수 |
| `js/recording.js` | 녹음 저장, 녹음 믹스, 내 녹음, 싱크·믹스 조절 |
| `js/syncedit.js` | 가사 싱크 편집기 |
| `js/karaoke.js` | 예약, 번호 입력, 검색, TV 화면, 단축키, 간주점프, 인기차트, 동영상 곡 |
| `js/profiles.js` | 사용자, 좋아요, 재생목록 |
| `js/cloud.js` | 기기 저장(오프라인), Google Drive 동기화 |
| `js/key.js` | 키 바꾸기 (WSOLA, 워커에서 처리) |
| `js/remote.js` | 휴대폰 리모컨 중계 (`server.py`의 `/api/remote/*`) |
| `js/backup.js` | 녹음 Drive 백업, 백업 파일 |
| `js/main.js` | 메인 루프, 앱 시작 (항상 마지막) |
| `remote.html` | 휴대폰 리모컨 화면 (따로 동작, `remote.webmanifest`로 홈 화면 아이콘) |
| `sw.js` | 서비스 워커: 앱 파일·글꼴을 저장해 오프라인에서도 열리게 |

## 꼭 지킬 것

- **IndexedDB 이름 `hanbam-noraebang`은 바꾸지 않는다.** 앱 예전 이름이지만, 바꾸면 사용자가 넣은 곡·녹음이 안 보인다. 저장소를 추가할 땐 버전을 올리고 `onupgradeneeded`에서 없는 것만 만든다.
- localStorage 키도 예전 `nb-` 접두어를 그대로 쓴다.
- **스크립트 순서가 중요하다.** 파일 맨 위에서 바로 실행되는 코드는 앞 파일(또는 같은 파일)의 이름만 쓸 수 있다. 함수 안에서는 어느 파일 이름이든 쓸 수 있다.
- **JS 파일을 더하거나 빼면** `index.html`의 `<script>` 목록, `sw.js`의 `SHELL_FILES`를 같이 고치고 `SHELL` 버전을 올린다.
- `js/core.js`에는 DOM 코드를 넣지 않는다 (테스트가 브라우저 없이 돈다). 새 순수 로직은 여기에 두고 `tests/core.test.js`에 테스트를 더한다.
- 데모곡(반주·멜로디)을 바꾸면 `js/demo.js`의 `DEMO_CACHE_KEY` 숫자를 올린다. 안 올리면 예전 반주가 계속 나온다.
- 곡·녹음 내용이 바뀌면 `persistSong(s)` / `recTouch(r)`로 `updatedAt`을 남긴다. Drive 동기화는 `updatedAt`이 더 나중인 쪽이 이기고, 지운 것은 지움 기록(tombstone)으로 남긴다.
- 사용자에게 보이는 글은 쉬운 한국어로, 이유와 해결 방법을 같이 쓴다.

## 녹음 구조

목소리만 따로(16비트 PCM) 저장하고, 반주는 "녹음 몇 초 지점에 반주 몇 초(어떤 키)"인지(`parts`)만 기록한다. 그래서 녹음 뒤에도 타이밍·볼륨·효과를 바꿔 다시 섞을 수 있다(`buildMix`, `renderMix`).

## Claude의 내장 브라우저로 확인할 때

- 내장 브라우저에서는 서비스 워커가 보내는 요청이 localhost에 닿지 않아, 예전 화면이 캐시에서 열릴 수 있다. 확인 전에 서비스 워커 등록과 캐시를 지운다.
- 사용자의 실제 데이터는 사용자의 크롬에 있다. 내장 브라우저에서 만든 테스트 데이터는 끝나면 지운다.
