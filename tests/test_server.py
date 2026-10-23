# YT 노래방 로컬 서버 테스트: python -m unittest discover -s tests
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import server  # noqa: E402


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = server.make_server('127.0.0.1', 0)   # 0: 비어 있는 포트를 아무거나
        cls.base = f'http://127.0.0.1:{cls.srv.server_address[1]}'
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        server.fails.clear()
        server.cmds.clear()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def post(self, path, obj):
        req = urllib.request.Request(self.base + path, data=json.dumps(obj).encode(), headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b'{}')

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


if __name__ == '__main__':
    unittest.main()
