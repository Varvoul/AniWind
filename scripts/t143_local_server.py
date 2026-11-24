#!/usr/bin/env python3
"""t143 — tiny local dev server mimicking the site's Vercel rewrites.
Serves /home/z/my-project/aniwind as the docroot and rewrites the clean
URL schemes (info/browse/watch/type/...) to their .html entry files so
info.html's parseUrl() sees the same pathname shape as production.
"""
import http.server
import socketserver
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8899

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

    def send_head(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        # strip trailing slash (except root)
        clean = path.rstrip('/') or '/'
        if clean != '/' and not os.path.splitext(clean)[1]:
            for prefix, dest in REWRITES:
                if clean == prefix.rstrip('/') or clean.startswith(prefix):
                    self.path = dest + self.path[len(clean):]
                    break
        return super().send_head()

    def log_message(self, fmt, *args):
        sys.stderr.write("[srv] %s - %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


if __name__ == '__main__':
    with Server(('127.0.0.1', PORT), Handler) as httpd:
        print(f't143 local server on http://127.0.0.1:{PORT} (docroot {ROOT})')
        httpd.serve_forever()
