# YT 노래방 로컬 서버 테스트: python -m unittest discover -s tests
import functools
import http.server
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import server  # noqa: E402

# 테스트가 저장소의 진짜 코드 파일(.remote.json)을 읽거나 쓰지 않게, 모든 테스트 동안 임시 폴더를 쓴다
_real_pin_file = server.PIN_FILE
_tmp_dir = None


def setUpModule():
    global _tmp_dir
    _tmp_dir = tempfile.mkdtemp(prefix='yt-remote-test-')
    server.PIN_FILE = os.path.join(_tmp_dir, '.remote.json')


def tearDownModule():
    server.PIN_FILE = _real_pin_file
    shutil.rmtree(_tmp_dir, ignore_errors=True)


class ServerBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = server.make_server('127.0.0.1', 0)   # 0: 비어 있는 포트를 아무거나
        cls.base = f'http://127.0.0.1:{cls.srv.server_address[1]}'
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def post(self, path, obj, headers=None, raw=None):
        body = raw if raw is not None else json.dumps(obj).encode()
        req = urllib.request.Request(self.base + path, data=body, headers={'Content-Type': 'application/json', **(headers or {})})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b'{}')


class ServerTest(ServerBase):
    def setUp(self):
        server.fails.clear()
        server.cmds.clear()

    def test_app_files_and_no_cache(self):
        with urllib.request.urlopen(self.base + '/index.html') as r:
            self.assertEqual(r.status, 200)
            self.assertEqual(r.headers['Cache-Control'], 'no-store')

    def test_hidden_files_are_blocked(self):
        for path in ['/.git/config', '/.gitignore', '/.claude/launch.json', '/js/../.git/HEAD', '/%2Egit/config', '/__pycache__/x']:
            self.assertEqual(self.get(path)[0], 404, path)

    def test_command_needs_right_code(self):
        self.assertEqual(self.post('/api/remote/cmd', {'pin': 'xxxx', 'cmd': 'start'})[0], 403)
        self.assertEqual(self.post('/api/remote/cmd', {'pin': server.PIN, 'cmd': 'reserve', 'args': {'id': 'demo'}})[0], 200)
        status, body = self.get('/api/remote/poll?since=0')
        data = json.loads(body)
        self.assertEqual([c['cmd'] for c in data['cmds']], ['reserve'])
        self.assertEqual(data['cmds'][0]['args'], {'id': 'demo'})
        # 이미 가져간 명령은 다시 오지 않는다
        self.assertEqual(json.loads(self.get(f"/api/remote/poll?since={data['last']}")[1])['cmds'], [])

    def test_too_many_wrong_codes_blocks_for_a_while(self):
        for _ in range(10):
            self.post('/api/remote/cmd', {'pin': 'nope', 'cmd': 'start'})
        # 10번 틀리면 맞는 코드도 잠시 막힌다
        self.assertEqual(self.post('/api/remote/cmd', {'pin': server.PIN, 'cmd': 'start'})[0], 403)

    def test_state_round_trip(self):
        req = urllib.request.Request(self.base + '/api/remote/state', data=b'{"queue":["a"]}', method='POST')
        with urllib.request.urlopen(req) as r:
            self.assertEqual(r.status, 200)
        status, body = self.get('/api/remote/state?pin=' + server.PIN)
        self.assertEqual(json.loads(body), {'queue': ['a']})

    def test_command_args_must_be_object(self):
        self.post('/api/remote/cmd', {'pin': server.PIN, 'cmd': 'reserve', 'args': 'oops'})
        data = json.loads(self.get('/api/remote/poll?since=0')[1])
        self.assertEqual(data['cmds'][0]['args'], {})


class SecondStartTest(unittest.TestCase):
    """이미 켜져 있을 때 다시 켜면 서버가 둘이 되지 않는다 (A2: 그때는 브라우저만 연다)"""

    def test_second_server_on_same_port_is_refused(self):
        first = server.make_server('127.0.0.1', 0)
        try:
            with self.assertRaises(OSError):
                server.make_server('127.0.0.1', first.server_address[1]).server_close()
        finally:
            first.server_close()
        again = server.make_server('127.0.0.1', first.server_address[1])   # 끈 뒤에는 바로 다시 켜진다
        again.server_close()


def read_file(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write_file(path, text):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


class PinFileTest(unittest.TestCase):
    """리모컨 코드 저장: 다시 켜도 같은 코드 (CR-009)"""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='yt-pin-')
        self.path = os.path.join(self.dir, '.remote.json')
        self.keep = (server.PIN, server.FIXED)

    def tearDown(self):
        server.PIN, server.FIXED = self.keep
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_saved_code_is_reused_next_time(self):
        self.assertTrue(server.load_pin(self.path))          # 파일이 없으면 새로 만들어 저장
        first = server.PIN
        self.assertTrue(server.pin_valid(first))
        self.assertEqual(read_file(self.path), {'pin': first, 'fixed': True})
        server.PIN = '0000' if first != '0000' else '1111'    # 서버를 껐다 켠 것처럼
        server.load_pin(self.path)
        self.assertEqual(server.PIN, first)
        self.assertTrue(server.FIXED)

    def test_new_code_each_time_when_not_fixed(self):
        write_file(self.path, '{"pin": "1234", "fixed": false}')
        self.assertTrue(server.load_pin(self.path))
        self.assertNotEqual(server.PIN, '1234')
        self.assertTrue(server.pin_valid(server.PIN))
        self.assertFalse(server.FIXED)
        # 새 코드와 설정이 저장되고, 다음에 켜면 또 바뀐다
        self.assertEqual(read_file(self.path), {'pin': server.PIN, 'fixed': False})
        before = server.PIN
        server.load_pin(self.path)
        self.assertNotEqual(server.PIN, before)

    def test_broken_file_makes_new_code(self):
        for text in ['{oops', '', '[1, 2]', '"1234"', '{"pin": "12a4"}', '{"pin": 1234}', '{"pin": "12345"}', '{"pin": "١٢٣٤"}']:
            write_file(self.path, text)
            self.assertTrue(server.load_pin(self.path), text)
            self.assertTrue(server.pin_valid(server.PIN), text)
            self.assertTrue(server.FIXED, text)
            self.assertEqual(read_file(self.path), {'pin': server.PIN, 'fixed': True}, text)   # 고친 파일로 다시 저장

    def test_save_failure_still_gives_a_code(self):
        bad = os.path.join(self.dir, 'no-such-folder', '.remote.json')
        self.assertFalse(server.load_pin(bad))
        self.assertTrue(server.pin_valid(server.PIN))
        self.assertFalse(os.path.exists(bad + '.tmp'))

    def test_new_pin_is_always_different(self):
        for _ in range(200):
            self.assertNotEqual(server.new_pin('0420'), '0420')


class PinApiTest(ServerBase):
    """설정 창의 "새 코드 만들기" · "켤 때마다 새 코드 만들기" (CR-009)"""

    def setUp(self):
        server.fails.clear()
        server.cmds.clear()
        self.keep = (server.PIN, server.FIXED)
        server.FIXED = True
        if os.path.exists(server.PIN_FILE):
            os.remove(server.PIN_FILE)

    def tearDown(self):
        server.PIN, server.FIXED = self.keep

    def test_info_tells_if_code_is_fixed(self):
        info = json.loads(self.get('/api/remote/info')[1])
        self.assertEqual(info['pin'], server.PIN)
        self.assertIs(info['fixed'], True)

    def test_new_code_replaces_old_code(self):
        old = server.PIN
        status, body = self.post('/api/remote/pin', {'action': 'new'})
        self.assertEqual(status, 200)
        self.assertNotEqual(body['pin'], old)
        self.assertEqual(body['pin'], server.PIN)
        self.assertIs(body['saved'], True)
        self.assertEqual(read_file(server.PIN_FILE), {'pin': server.PIN, 'fixed': True})
        # 옛 코드로 붙어 있던 휴대폰은 막히고(→ "코드가 바뀌었어요"), 새 코드는 된다
        self.assertEqual(self.post('/api/remote/cmd', {'pin': old, 'cmd': 'start'})[0], 403)
        with mock.patch.object(server.Handler, 'is_local', return_value=False):   # 휴대폰이 상태를 물을 때
            self.assertEqual(self.get('/api/remote/state?pin=' + old)[0], 403)
            server.fails.clear()
            self.assertEqual(self.get('/api/remote/state?pin=' + server.PIN)[0], 200)
        self.assertEqual(self.post('/api/remote/cmd', {'pin': server.PIN, 'cmd': 'start'})[0], 200)

    def test_fixed_setting_is_saved(self):
        pin = server.PIN
        status, body = self.post('/api/remote/pin', {'fixed': False})
        self.assertEqual(status, 200)
        self.assertIs(body['fixed'], False)
        self.assertEqual(body['pin'], pin)                     # 설정만 바꾸면 지금 코드는 그대로
        self.assertEqual(read_file(server.PIN_FILE), {'pin': pin, 'fixed': False})
        self.assertIs(json.loads(self.get('/api/remote/info')[1])['fixed'], False)
        self.assertIs(self.post('/api/remote/pin', {'fixed': True})[1]['fixed'], True)
        self.assertEqual(read_file(server.PIN_FILE), {'pin': pin, 'fixed': True})

    def test_wrong_requests_change_nothing(self):
        pin = server.PIN
        for obj in [{}, {'fixed': 'yes'}, {'fixed': 0}, {'action': 'old'}, [1]]:
            self.assertEqual(self.post('/api/remote/pin', obj)[0], 400, obj)
        self.assertEqual(self.post('/api/remote/pin', None, raw=b'{oops')[0], 400)
        self.assertEqual((server.PIN, server.FIXED), (pin, True))

    def test_phone_cannot_change_or_read_code(self):
        pin = server.PIN
        with mock.patch.object(server.Handler, 'is_local', return_value=False):   # 휴대폰(같은 와이파이)에서 온 요청처럼
            self.assertEqual(self.get('/api/remote/info')[0], 403)
            self.assertEqual(self.post('/api/remote/pin', {'action': 'new'})[0], 403)
            self.assertEqual(self.post('/api/remote/pin', {'fixed': False})[0], 403)
        self.assertEqual((server.PIN, server.FIXED), (pin, True))

    def test_other_sites_cannot_change_code(self):
        pin = server.PIN
        self.assertEqual(self.post('/api/remote/pin', {'action': 'new'}, headers={'Origin': 'https://example.com'})[0], 403)
        self.assertEqual(self.post('/api/remote/pin', {'action': 'new'}, headers={'Origin': 'null'})[0], 403)
        self.assertEqual(server.PIN, pin)
        self.assertEqual(self.post('/api/remote/pin', {'action': 'new'}, headers={'Origin': 'http://localhost:5173'})[0], 200)

    def test_code_file_is_not_served(self):
        # 코드 파일이 실제로 있는 폴더를 내주는 서버를 따로 띄워서, 있어도 안 열리는지 본다
        folder = tempfile.mkdtemp(prefix='yt-serve-')
        for name in ['.remote.json', '.remote.json.tmp', 'ok.txt']:
            write_file(os.path.join(folder, name), '{"pin": "1234"}')
        srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(server.Handler, directory=folder))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{srv.server_address[1]}'
        try:
            with urllib.request.urlopen(base + '/ok.txt') as r:
                self.assertEqual(r.status, 200)                 # 보통 파일은 열린다
            for path in ['/.remote.json', '/.remote.json.tmp', '/%2Eremote.json', '/js/../.remote.json']:
                with self.assertRaises(urllib.error.HTTPError, msg=path) as e:
                    urllib.request.urlopen(base + path)
                self.assertEqual(e.exception.code, 404, path)
        finally:
            srv.shutdown()
            srv.server_close()
            shutil.rmtree(folder, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
