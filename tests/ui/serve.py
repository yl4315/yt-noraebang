# 화면 자동 점검(CR-019)용 시험 서버. run.mjs가 켜고 끈다 (사람이 직접 켤 일은 없다).
#   python tests/ui/serve.py <포트> --pin-dir <임시 폴더> [--root <폴더>]   ← 노래방 서버 (리모컨 있음)
#   python tests/ui/serve.py <포트> --static [--root <폴더>]                ← 정적 서버 (리모컨 없음)
# - server.py의 Handler를 그대로 쓰되, 휴대폰 리모컨 코드 파일(server.PIN_FILE)을 임시 폴더로 바꾼다.
#   (저장소 폴더의 .remote.json은 CEO 휴대폰 리모컨의 고정 코드라서 읽지도 쓰지도 않는다. 서버 테스트와 같은 방법)
# - 127.0.0.1에만 켠다 (와이파이에 열지 않음). 리모컨 칸이 보이도록 lan 표시만 켜고,
#   와이파이 주소는 문서용 가짜 주소(192.0.2.1)로 둔다 → 사진에 진짜 집 주소가 안 찍히고 매번 같다.
# - --static: /api/가 없는 정적 서버 (GitHub Pages와 같은 상태, 리모컨 없음). 오프라인 시험에서 이것만 끈다.
# - 점검(node)이 끝나거나 죽어서 표준 입력이 닫히면 같이 꺼진다 (서버가 남지 않게).
import functools
import http.server
import os
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, REPO)
import server  # noqa: E402

FAKE_LAN_IP = '192.0.2.1'


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        return sys.argv[i + 1]
    return default


class StaticHandler(http.server.SimpleHTTPRequestHandler):
    # Pages처럼 파일만 내준다. 숨김 파일은 server.py와 같이 막는다 (.remote.json이 있어도 안 나감)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass

    def do_GET(self):
        if server.Handler.hidden(self):
            return self.send_error(404)
        return super().do_GET()


class QuietHandler(server.Handler):
    def log_message(self, *a):
        pass


def wait_stdin_then_exit():
    # 점검이 끝나(또는 죽어) 표준 입력이 닫히면 끈다
    try:
        sys.stdin.read()
    except Exception:
        pass
    os._exit(0)


def main():
    port = int(sys.argv[1])
    root = os.path.abspath(arg('--root', REPO))
    if '--static' in sys.argv:
        st = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(StaticHandler, directory=root))
        st.daemon_threads = True
        threading.Thread(target=st.serve_forever, daemon=True).start()
        print(f'READY {port} static', flush=True)
        wait_stdin_then_exit()
    pin_dir = arg('--pin-dir')
    if not pin_dir:
        print('--pin-dir가 필요해요', flush=True)
        sys.exit(2)
    pin_file = os.path.abspath(os.path.join(pin_dir, '.remote.json'))
    # 안전장치: 코드 파일이 저장소 폴더(또는 시험 사본 폴더) 안이면 켜지 않는다
    for bad in (REPO, root):
        if os.path.commonpath([pin_file, bad]) == bad:
            print('코드 파일이 저장소 안이라 켜지 않아요: ' + pin_file, flush=True)
            sys.exit(2)
    server.PIN_FILE = pin_file
    server.root = root
    server.port = port
    server.lan = True
    server.lan_ip = lambda: FAKE_LAN_IP
    # --pin: 시작 코드를 정해 둔다 (스크린샷이 매번 같게). 임시 코드 파일에 고정 코드로 써 두고 main()과 같이 불러온다
    start_pin = arg('--pin')
    if start_pin and server.pin_valid(start_pin):
        server.PIN, server.FIXED = start_pin, True
        server.save_pin_file()
    server.load_pin()

    main_srv = server.Server(('127.0.0.1', port), functools.partial(QuietHandler, directory=root))
    main_srv.daemon_threads = True
    threading.Thread(target=main_srv.serve_forever, daemon=True).start()
    print(f'READY {port} pin={server.PIN}', flush=True)
    wait_stdin_then_exit()


if __name__ == '__main__':
    main()
