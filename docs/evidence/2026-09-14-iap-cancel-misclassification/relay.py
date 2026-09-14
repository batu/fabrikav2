#!/usr/bin/env python3
"""Console/eval relay for the phone build. POST /log appends JSON lines; GET /next hands
one queued JS snippet to the page; POST /result stores eval results. Queue via /enqueue."""
import json, sys, time, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = sys.argv[1] if len(sys.argv) > 1 else 'relay-log.jsonl'
queue, lock = [], threading.Lock()
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code=200, body=b'', ctype='text/plain'):
        self.send_response(code); self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self): self._send(204)
    def do_GET(self):
        if self.path == '/next':
            with lock: js = queue.pop(0) if queue else ''
            return self._send(200, js.encode())
        if self.path == '/health': return self._send(200, b'ok')
        self._send(404)
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0)); body = self.rfile.read(n).decode('utf-8', 'replace')
        if self.path == '/enqueue':
            with lock: queue.append(body)
            return self._send(200, b'queued')
        kind = 'log' if self.path == '/log' else 'result' if self.path == '/result' else 'other'
        with open(LOG, 'a') as f:
            f.write(json.dumps({'t': time.time(), 'kind': kind, 'body': body}) + '\n')
        self._send(200, b'ok')
ThreadingHTTPServer(('0.0.0.0', 5731), H).serve_forever()
