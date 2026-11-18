"""Test-only stub, not a hook and not wired in hooks.json: a loopback stand-in for the /v1/systemone decision endpoint (no real model runs)."""

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


class StubOllamaServer:
    """Serves the stock Ollama API on 127.0.0.1: GET /api/tags and POST /api/chat (no real model runs).
    `respond(body)` returns the JSON the model would put in message.content (a dict, serialised here) or a
    raw str sent as-is. Every /api/chat request body is appended to `.requests`; `.tag_hits` counts probes;
    `/v1/systemone` answers 404 like stock Ollama."""

    def __init__(self, respond, models=("llama3.2:3b",)):
        self.requests = []
        self.tag_hits = 0
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def _send(self, code, obj):
                payload = json.dumps(obj).encode()
                try:
                    self.send_response(code)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                except OSError:
                    pass

            def do_GET(self):  # noqa: N802
                if self.path == "/api/tags":
                    outer.tag_hits += 1
                    self._send(200, {"models": [{"name": m} for m in models]})
                else:
                    self._send(404, {"error": "not found"})

            def do_POST(self):  # noqa: N802
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                if self.path != "/api/chat":
                    self._send(404, {"error": "not found"})
                    return
                outer.requests.append(body)
                content = respond(body)
                if not isinstance(content, str):
                    content = json.dumps(content)
                self._send(
                    200,
                    {
                        "model": body.get("model"),
                        "message": {"role": "assistant", "content": content},
                        "done": True,
                    },
                )

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
