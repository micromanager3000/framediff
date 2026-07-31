#!/usr/bin/env python3
"""Static server for the Script Lab prototype with caching disabled.

python http.server's Last-Modified headers let browsers heuristically skip
revalidation, which serves stale/mixed versions of index/styles/app during
rapid edits. no-store makes every load fresh.
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4181
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), NoCacheHandler).serve_forever()
