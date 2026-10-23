# YT 노래방 로컬 서버
#   python server.py            → 이 PC에서만 (http://localhost:5173)
#   python server.py --lan      → 같은 와이파이의 휴대폰 리모컨도 허용
#   python server.py --open     → 켜면서 브라우저도 연다
# 브라우저가 예전 파일을 캐시하지 않도록 no-store로 보낸다. 마이크는 localhost에서만 되므로
# 노래방 화면은 항상 이 PC에서 localhost로 연다.
import functools
import http.server
import json
import os
import random
import socket
import sys
import threading
import time
import webbrowser
from urllib.parse import parse_qs, unquote, urlparse

port = 5173
lan = False
root = os.path.dirname(os.path.abspath(__file__))

PIN = f'{random.SystemRandom().randint(0, 9999):04d}'
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
            ip = lan_ip() if lan else None
            url = f'http://{ip}:{port}/remote.html?pin={PIN}' if ip else None
            with lock:
                last = seq
            return self.send_json({'pin': PIN, 'url': url, 'lan': lan, 'last': last})
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
        return self.send_json({'error': 'not found'}, 404)


def make_server(host, listen_port):
    server = http.server.ThreadingHTTPServer((host, listen_port), functools.partial(Handler, directory=root))
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
    print(f'YT 노래방: http://localhost:{port}  (이 창을 닫으면 꺼져요)')
    if lan:
        ip = lan_ip()
        print(f'휴대폰 리모컨: http://{ip}:{port}/remote.html  · 코드 {PIN}' if ip else '휴대폰 리모컨: 와이파이 주소를 찾지 못했어요')
    if '--open' in argv:
        threading.Timer(0.8, lambda: webbrowser.open(f'http://localhost:{port}/')).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main(sys.argv[1:])
