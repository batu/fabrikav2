import json, sys, time, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
LOG = OUT / 'log.jsonl'; RES = OUT / 'results.jsonl'
queue = []; lock = threading.Lock(); seq = [0]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body=b'', ctype='application/json'):
        self.send_response(code); self.send_header('content-type', ctype); self.send_header('access-control-allow-origin', '*')
        self.send_header('content-length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self):
        self.send_response(204); self.send_header('access-control-allow-origin', '*'); self.send_header('access-control-allow-headers', 'content-type'); self.send_header('access-control-allow-methods', 'GET,POST,OPTIONS'); self.end_headers()
    def _body(self):
        n = int(self.headers.get('content-length') or 0); raw = self.rfile.read(n) if n else b''
        try: return json.loads(raw or b'null')
        except Exception: return {'raw': raw.decode('utf8', 'replace')}
    def do_GET(self):
        if self.path == '/next':
            with lock: cmd = queue.pop(0) if queue else None
            if cmd is None: return self._send(204)
            return self._send(200, json.dumps(cmd).encode())
        if self.path == '/results': return self._send(200, RES.read_bytes() if RES.exists() else b'', 'text/plain')
        if self.path == '/log': return self._send(200, LOG.read_bytes() if LOG.exists() else b'', 'text/plain')
        if self.path == '/flag': return self._send(200, (OUT / 'flag.json').read_bytes() if (OUT / 'flag.json').exists() else b'{}')
        return self._send(404)
    def do_POST(self):
        body = self._body()
        if self.path == '/log':
            with LOG.open('a') as f: f.write(json.dumps({'at': time.time(), **(body if isinstance(body, dict) else {'v': body})}) + '\n')
            return self._send(200, b'{}')
        if self.path == '/result':
            with RES.open('a') as f: f.write(json.dumps({'at': time.time(), **(body if isinstance(body, dict) else {'v': body})}) + '\n')
            return self._send(200, b'{}')
        if self.path == '/flag':
            (OUT / 'flag.json').write_text(json.dumps(body)); return self._send(200, b'{}')
        if self.path == '/enqueue':
            with lock: seq[0] += 1; cmd = {'id': seq[0], 'code': body['code']}; queue.append(cmd)
            return self._send(200, json.dumps(cmd).encode())
        return self._send(404)
ThreadingHTTPServer(('0.0.0.0', 5321), H).serve_forever()
