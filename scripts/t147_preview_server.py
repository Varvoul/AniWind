#!/usr/bin/env python3
"""t147 — local PREVIEW server for the section-spacing proposal.

Same clean-URL rewrites as t143_local_server.py, plus one addition:
GET /api/* is reverse-proxied (read-only) to the production deployment
so the homepage renders with the SAME data locally and spacing
screenshots are directly comparable to the live site.

No repo file is modified — this is preview-only infrastructure.
"""
import http.server
import socketserver
import os
import sys
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
UPSTREAM = 'https://ruristream.vercel.app'

REWRITES = [
    ('/latest-updates', '/browse.html'),
    ('/schedule', '/schedule.html'),
    ('/browse', '/browse.html'),
    ('/search', '/browse.html'),
    ('/genre/', '/browse.html'),
    ('/country/', '/browse.html'),
    ('/type/', '/browse.html'),
    ('/status/', '/browse.html'),
    ('/new-releases', '/browse.html'),
    ('/recent', '/browse.html'),
    ('/anime/', '/browse.html'),
    ('/tv/', '/browse.html'),
    ('/movie/', '/browse.html'),
    ('/info/', '/info.html'),
    ('/watch/', '/watch.html'),
]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _clean(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        return path.rstrip('/') or '/'

    def do_GET(self):
        clean = self._clean()
        # ── read-only reverse proxy for the site's own API routes ──
        if clean.startswith('/api/'):
            url = UPSTREAM + self.path
            req = urllib.request.Request(url, headers={
                'User-Agent': 't147-spacing-preview',
                'Accept': 'application/json',
            })
            try:
                with urllib.request.urlopen(req, timeout=25) as r:
                    body = r.read()
                    self.send_response(r.status)
                    self.send_header('Content-Type',
                                     r.headers.get('Content-Type', 'application/json'))
                    self.send_header('Content-Length', str(len(body)))
                    self.send_header('Cache-Control', 'no-store')
                    self.end_headers()
                    self.wfile.write(body)
            except urllib.error.HTTPError as e:
                body = e.read() if e.fp else b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:  # noqa: BLE001
                msg = ('{"error":"preview-proxy","detail":"%s"}' % e).encode()
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(msg)))
                self.end_headers()
                self.wfile.write(msg)
            return
        # ── clean-URL rewrites (same as t143) ──
        if clean != '/' and not os.path.splitext(clean)[1]:
            for prefix, dest in REWRITES:
                if clean == prefix.rstrip('/') or clean.startswith(prefix):
                    self.path = dest + self.path[len(clean):]
                    break
        super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write("[srv] %s - %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


if __name__ == '__main__':
    with Server(('127.0.0.1', PORT), Handler) as httpd:
        print(f't147 preview server on http://127.0.0.1:{PORT} (docroot {ROOT}, '
              f'/api/* proxied to {UPSTREAM})')
        httpd.serve_forever()
