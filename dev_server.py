"""Local server for development: like `python -m http.server`, but tells the browser not to cache,
so edits to js/css/data show up on a plain reload.
Usage: python dev_server.py [port]   (default 8765)
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
handler = partial(NoCache, directory=str(Path(__file__).parent))
print(f"http://127.0.0.1:{port}")
ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
