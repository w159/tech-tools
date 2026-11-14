"""Test helper: a loopback stand-in for the /v1/systemone decision endpoint (no real model runs)."""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


class StubDecisionServer:
    """Serves POST /v1/systemone on 127.0.0.1. `respond(body) -> answers dict` builds the reply;
    every request body is appended to `.requests`."""

    def __init__(self, respond, delay=0.0):
        self.requests = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                outer.requests.append(body)
                if delay:
                    threading.Event().wait(delay)
                payload = json.dumps({"answers": respond(body)}).encode()
                try:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                except OSError:
                    pass

            def log_message(self, *args):
                pass

        self._httpd = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d" % self._httpd.server_address[1]
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._httpd.shutdown()
        self._httpd.server_close()
        return False


def choice(value, confidence):
    return {"type": "choice", "choice": value, "confidence": confidence}


def noul(value):
    return {"type": "noul", "noul": value}


def free_port():
    import socket

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
