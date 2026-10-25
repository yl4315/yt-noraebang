# YT 노래방 로컬 서버
#   python server.py            → 이 PC에서만 (http://localhost:5173)
#   python server.py --lan      → 같은 와이파이의 휴대폰 리모컨도 허용
#   python server.py --open     → 켜면서 브라우저도 연다
# 브라우저가 예전 파일을 캐시하지 않도록 no-store로 보낸다. 마이크는 localhost에서만 되므로
# 노래방 화면은 항상 이 PC에서 localhost로 연다.
# 휴대폰 리모컨 코드는 이 폴더의 .remote.json에 저장해서 다음에 켜도 같은 코드를 쓴다 (git에는 안 올림).
import functools
import http.server
import json
import os
import random
import re
import socket
import sys
import threading
import time
import webbrowser
from urllib.parse import parse_qs, unquote, urlparse

port = 5173
lan = False
root = os.path.dirname(os.path.abspath(__file__))

# 리모컨 코드 저장 파일. 점으로 시작해서 hidden()이 휴대폰에 내주지 않는다.
# 테스트는 이 값을 임시 폴더로 바꿔서 진짜 파일을 건드리지 않는다. 파일은 main()에서 불러온다.
PIN_FILE = os.path.join(root, '.remote.json')


def new_pin(old=None):
    # 4자리 숫자. "새 코드"가 옛 코드와 같으면 바뀐 줄 모르니 다른 숫자가 나올 때까지 뽑는다.
    rnd = random.SystemRandom()
    while True:
        pin = f'{rnd.randint(0, 9999):04d}'
        if pin != old:
            return pin


def pin_valid(pin):
    return isinstance(pin, str) and re.fullmatch(r'[0-9]{4}', pin) is not None


PIN = new_pin()
FIXED = True         # True = 코드 고정(기본), False = 켤 때마다 새 코드 (예전 방식)
lock = threading.Lock()
cmds = []            # (번호, 명령) — 휴대폰이 보낸 명령을 노래방 화면이 가져간다
seq = 0
tv_state = b'{}'     # 노래방 화면이 올려 둔 현재 상태 (곡 목록, 예약 등)
fails = {}           # IP별 틀린 코드 횟수


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))   # 실제로 보내지는 않고, 어느 네트워크 주소를 쓰는지만 알아낸다
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def read_pin_file(path=None):
    # 저장된 코드 설정을 읽는다. 없거나 깨졌으면 None
    try:
        with open(path or PIN_FILE, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def save_pin_file(path=None):
    # 지금 코드와 설정을 저장한다. 임시 파일에 쓴 뒤 바꿔치기해서, 쓰다 꺼져도 파일이 반쯤 깨지지 않게.
    # 저장하지 못해도(읽기 전용 폴더 등) 서버는 그대로 돈다. 그때는 다음에 켤 때 새 코드가 생긴다.
    path = path or PIN_FILE
    tmp = path + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump({'pin': PIN, 'fixed': FIXED}, f)
        os.replace(tmp, path)
        return True
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass
        return False


def load_pin(path=None):
    # 켤 때 코드 정하기: 고정이면 저장해 둔 코드를 다시 쓴다. 켤 때마다 새 코드로 해 두었거나,
    # 파일이 없거나 깨졌거나, 코드가 4자리 숫자가 아니면 새로 만들어 저장한다. 저장했으면 True.
    global PIN, FIXED
    data = read_pin_file(path) or {}
    FIXED = data.get('fixed') is not False          # 모르는 값이면 기본(고정)
    old = data.get('pin')
    PIN = old if FIXED and pin_valid(old) else new_pin(old)
    return save_pin_file(path)


def remote_info():
    # 노래방 화면(이 PC)에 보여 줄 리모컨 정보: 주소(QR에 넣음), 코드, 고정 여부
    ip = lan_ip() if lan else None
    url = f'http://{ip}:{port}/remote.html?pin={PIN}' if ip else None
    with lock:
        last = seq
    return {'pin': PIN, 'url': url, 'lan': lan, 'last': last, 'fixed': FIXED}


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *a):
        if '/api/' not in (self.path or ''):
            super().log_message(fmt, *a)

    def is_local(self):
        return self.client_address[0] in ('127.0.0.1', '::1')

    def pin_ok(self, pin):
        ip = self.client_address[0]
        n, until = fails.get(ip, (0, 0))
        if until > time.time():
            return False
        if str(pin) == PIN:
            fails.pop(ip, None)
            return True
        n += 1
        fails[ip] = (0, time.time() + 60) if n >= 10 else (n, 0)   # 10번 틀리면 1분 쉬기
        return False

    def send_json(self, obj=None, code=200, raw=None):
        body = raw if raw is not None else json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def hidden(self):
        # .git 같은 숨김 폴더와 파이썬 캐시는 내주지 않는다
        parts = unquote(urlparse(self.path).path).replace('\\', '/').split('/')
        return any(p.startswith('.') or p == '__pycache__' for p in parts if p)

    def do_HEAD(self):
        if self.hidden():
            return self.send_error(404)
        return super().do_HEAD()

    def do_GET(self):
        if self.hidden():
            return self.send_error(404)
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == '/api/remote/info':
            if not self.is_local():
                return self.send_json({'error': 'local only'}, 403)
            return self.send_json(remote_info())
        if u.path == '/api/remote/poll':
            if not self.is_local():
                return self.send_json({'error': 'local only'}, 403)
            since = int((q.get('since') or ['0'])[0] or 0)
            with lock:
                out = [c for n, c in cmds if n > since]
                last = seq
            return self.send_json({'cmds': out, 'last': last})
        if u.path == '/api/remote/state':
            if not self.is_local() and not self.pin_ok((q.get('pin') or [''])[0]):
                return self.send_json({'error': 'pin'}, 403)
            with lock:
                body = tv_state
            return self.send_json(raw=body)
        if u.path.startswith('/api/'):
            return self.send_json({'error': 'not found'}, 404)
        return super().do_GET()

    def do_POST(self):
        global seq, tv_state
        u = urlparse(self.path)
        n = int(self.headers.get('Content-Length') or 0)
        if n > 2_000_000:
            return self.send_json({'error': 'too big'}, 413)
        data = self.rfile.read(n)
        if u.path == '/api/remote/state':
            if not self.is_local():
                return self.send_json({'error': 'local only'}, 403)
            with lock:
                tv_state = data
            return self.send_json({'ok': True})
        if u.path == '/api/remote/cmd':
            try:
                msg = json.loads(data or b'{}')
            except ValueError:
                return self.send_json({'error': 'json'}, 400)
            if not self.pin_ok(msg.get('pin')):
                return self.send_json({'error': 'pin'}, 403)
            cmd_args = msg.get('args') if isinstance(msg.get('args'), dict) else {}
            with lock:
                seq += 1
                cmds.append((seq, {'cmd': str(msg.get('cmd'))[:20], 'args': cmd_args}))
                del cmds[:-200]
            return self.send_json({'ok': True})
        if u.path == '/api/remote/pin':
            return self.change_pin(data)
        return self.send_json({'error': 'not found'}, 404)

    def change_pin(self, data):
        # 노래방 설정 창에서: {"action": "new"} → 지금 바로 새 코드, {"fixed": true/false} → 코드 고정 설정.
        # 이 PC에서만 된다. 다른 사이트가 이 PC 브라우저를 시켜서 보내는 요청도 막는다 (Origin이 localhost가 아니면).
        global PIN, FIXED
        if not self.is_local() or not self.same_site():
            return self.send_json({'error': 'local only'}, 403)
        try:
            msg = json.loads(data or b'{}')
        except ValueError:
            return self.send_json({'error': 'json'}, 400)
        if not isinstance(msg, dict):
            return self.send_json({'error': 'json'}, 400)
        renew = msg.get('action') == 'new'
        fixed = msg.get('fixed')
        if fixed is not None and not isinstance(fixed, bool):
            return self.send_json({'error': 'fixed'}, 400)
        if not renew and fixed is None:
            return self.send_json({'error': 'nothing to do'}, 400)
        with lock:
            if fixed is not None:
                FIXED = fixed
            if renew:
                PIN = new_pin(PIN)
            saved = save_pin_file()
        if renew:
            print(f'휴대폰 리모컨 코드를 바꿨어요: {PIN}')
        if fixed is not None:
            print('휴대폰 리모컨 코드: ' + ('고정 (다음에 켜도 같은 코드)' if FIXED else '켤 때마다 새 코드'))
        return self.send_json({**remote_info(), 'saved': saved})

    def same_site(self):
        # 브라우저는 POST에 Origin을 붙인다. 없으면(curl 등) 이 PC의 프로그램이라 허용한다.
        origin = self.headers.get('Origin')
        if not origin:
            return True
        try:
            return urlparse(origin).hostname in ('localhost', '127.0.0.1', '::1')
        except ValueError:
            return False


class Server(http.server.ThreadingHTTPServer):
    # 윈도에서는 파이썬 기본값(SO_REUSEADDR)이 이미 쓰고 있는 포트에도 또 붙게 해서, 두 번 켜면 서버가 둘이 되고
    # "이미 켜져 있어요 → 브라우저만 열기"로 가지 않는다 (휴대폰 명령이 다른 서버로 가서 사라질 수 있다).
    # 그래서 윈도에서는 포트를 혼자 쓰게(SO_EXCLUSIVEADDRUSE) 한다. 껐다 바로 다시 켜는 것은 그대로 된다.
    allow_reuse_address = os.name != 'nt'

    def server_bind(self):
        if os.name == 'nt' and hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def make_server(host, listen_port):
    server = Server((host, listen_port), functools.partial(Handler, directory=root))
    server.daemon_threads = True
    return server


def main(argv):
    global port, lan
    port = int(next((a for a in argv if a.isdigit()), 5173))
    lan = '--lan' in argv
    try:
        server = make_server('0.0.0.0' if lan else '127.0.0.1', port)
    except OSError:
        print(f'YT 노래방이 이미 켜져 있어요. 브라우저만 열게요: http://localhost:{port}')
        if '--open' in argv:
            webbrowser.open(f'http://localhost:{port}/')
        return
    # 코드 파일은 서버가 새로 켜질 때만 읽는다 (이미 켜져 있을 때 읽으면 켜진 서버와 코드가 어긋난다)
    saved = load_pin()
    print(f'YT 노래방: http://localhost:{port}  (이 창을 닫으면 꺼져요)')
    if lan:
        ip = lan_ip()
        print(f'휴대폰 리모컨: http://{ip}:{port}/remote.html  · 코드 {PIN}{" (고정 코드)" if FIXED else ""}' if ip else '휴대폰 리모컨: 와이파이 주소를 찾지 못했어요')
        if not saved:
            print('리모컨 코드를 저장하지 못했어요. 다음에 켜면 코드가 바뀔 수 있어요 (폴더에 쓸 수 있는지 확인해 주세요)')
    if '--open' in argv:
        threading.Timer(0.8, lambda: webbrowser.open(f'http://localhost:{port}/')).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main(sys.argv[1:])
