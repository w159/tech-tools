#!/usr/bin/env python3
"""Tests for atlas_remote.py: fake `tailscale` on PATH + fake herdr-web-ui over loopback HTTP."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import contextlib
import io
import json
import os
import stat
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atlas_remote as R  # noqa: E402

FOREIGN = {"host": "h.ts.net", "port": 8443, "target": "http://127.0.0.1:9999"}

# Fake tailscale: state lives in $FAKE_TS_STATE (the `serve status --json` document);
# every invocation is appended to $FAKE_TS_LOG. Mirrors tailscale 1.102 JSON shapes.
FAKE_TS = r"""#!/usr/bin/env python3
import json, os, sys
state_p, log_p = os.environ["FAKE_TS_STATE"], os.environ["FAKE_TS_LOG"]
args = sys.argv[1:]
open(log_p, "a").write(json.dumps(args) + "\n")
cfg = json.load(open(state_p))
if args[:2] == ["status", "--json"]:
    print(json.dumps({"BackendState": "Running", "CurrentTailnet": {"Name": "t@x"},
        "Self": {"DNSName": "h.ts.net.", "TailscaleIPs": ["100.1.1.1", "fd7a::1"]}}))
elif args[:3] == ["serve", "status", "--json"]:
    print(json.dumps(cfg))
elif args[:2] == ["serve", "--bg"]:
    port = args[2].split("=")[1]
    cfg.setdefault("TCP", {})[port] = {"HTTPS": True}
    cfg.setdefault("Web", {})["h.ts.net:" + port] = {"Handlers": {"/": {"Proxy": args[3]}}}
    json.dump(cfg, open(state_p, "w"))
elif args[0] == "serve" and args[-1] == "off":
    port = args[1].split("=")[1]
    cfg.get("TCP", {}).pop(port, None)
    cfg.get("Web", {}).pop("h.ts.net:" + port, None)
    json.dump(cfg, open(state_p, "w"))
else:
    sys.exit("unexpected: %r" % args)
"""

EXISTING_443 = {
    "TCP": {"443": {"HTTPS": True}},
    "Web": {"h.ts.net:443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:18790"}}}},
}


class FakeWeb:
    """Fake herdr-web-ui. `secured` -> proxied (X-Forwarded-For) requests get auth.required=true."""

    def __init__(self, secured: bool):
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, format, *args):  # noqa: A002
                pass

            def do_GET(self):  # noqa: N802
                proxied = "X-Forwarded-For" in self.headers
                if self.path.startswith("/api/access"):
                    body = {
                        "port": 1,
                        "tailscale": {"state": "running", "dns_name": "h.ts.net"},
                    }
                elif proxied and outer.secured:
                    body = {
                        "ok": True,
                        "auth": {
                            "required": True,
                            "authenticated": False,
                            "reason": "pairing_required",
                        },
                    }
                elif proxied:
                    body = {
                        "ok": True,
                        "auth": {
                            "required": False,
                            "authenticated": True,
                            "via": "open",
                            "role": "drive",
                        },
                    }
                else:
                    body = {
                        "ok": True,
                        "herdr": {"version": "0"},
                        "auth": {
                            "required": False,
                            "authenticated": True,
                            "via": "local",
                            "role": "drive",
                        },
                    }
                data = json.dumps(body).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(data)

        self.secured = secured
        self.srv = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.srv.server_port}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


class RemoteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        exe = d / "tailscale"
        exe.write_text(FAKE_TS)
        exe.chmod(exe.stat().st_mode | stat.S_IXUSR)
        self.state, self.log = d / "state.json", d / "log"
        self.log.write_text("")
        self.set_cfg(EXISTING_443)
        self.env = {
            "PATH": f"{d}{os.pathsep}{os.environ['PATH']}",
            "FAKE_TS_STATE": str(self.state),
            "FAKE_TS_LOG": str(self.log),
        }
        self._saved = {
            k: os.environ.get(k)
            for k in (*self.env, "HERDR_WEB_URL", "ATLAS_REMOTE_PORT")
        }
        os.environ.update(self.env)
        os.environ.pop("ATLAS_REMOTE_PORT", None)
        self.webs: list[FakeWeb] = []

    def tearDown(self):
        for w in self.webs:
            w.close()
        for k, v in self._saved.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        self.tmp.cleanup()

    def set_cfg(self, cfg):
        self.state.write_text(json.dumps(cfg))

    def cfg(self):
        return json.loads(self.state.read_text())

    def web(self, secured=True) -> FakeWeb:
        w = FakeWeb(secured)
        self.webs.append(w)
        os.environ["HERDR_WEB_URL"] = w.url
        return w

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def mutations(self):
        return [c for c in self.calls() if c[0] == "serve" and c[1] != "status"]

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = R.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    # ---- plan
    def test_plan_never_funnel(self):
        os.environ["HERDR_WEB_URL"] = "http://127.0.0.1:7317"
        code, out, _ = self.run_cli("plan")
        self.assertEqual(code, 0)
        self.assertNotIn("funnel", out.replace("never funnel", ""))
        self.assertIn("tailscale serve --bg --https=8443 http://127.0.0.1:7317", out)
        self.assertIn("tailscale serve --https=8443 off", out)

    def test_port_clamped_never_443(self):
        for raw, want in (
            ("443", 1024),
            ("80", 1024),
            ("99999", 65535),
            ("junk", 8443),
            ("9000", 9000),
        ):
            os.environ["ATLAS_REMOTE_PORT"] = raw
            self.assertEqual(R.remote_port(), want, raw)

    def test_web_url_must_be_loopback(self):
        os.environ["HERDR_WEB_URL"] = "http://10.0.0.5:7317"
        self.assertEqual(self.run_cli("plan")[0], R.EXIT_REFUSED)

    # ---- default target follows the colony port (vendored build off 7317 behind an upstream plugin)
    def colony_port(self, port):
        """Point atlas_herdr at a temp ATLAS_HOME whose colony/port holds `port` (None = no record)."""
        keys = ("ATLAS_HOME", "HERDR_WEB_URL", "HERDR_WEB_STATE_DIR")
        old = {k: os.environ.get(k) for k in keys}

        def restore():
            for k, v in old.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)

        self.addCleanup(restore)
        home = Path(tempfile.mkdtemp())
        os.environ["ATLAS_HOME"] = str(home)
        os.environ["HERDR_WEB_STATE_DIR"] = tempfile.mkdtemp()  # no upstream plugin-port record
        os.environ.pop("HERDR_WEB_URL", None)
        if port:
            (home / "colony").mkdir()
            (home / "colony" / "port").write_text(f"{port}\n")

    def test_default_target_is_7317_without_a_colony_port(self):
        self.colony_port(None)
        self.assertEqual(R.web_url(), "http://127.0.0.1:7317")

    def test_default_target_follows_the_colony_port(self):
        self.colony_port(17317)
        self.assertEqual(R.web_url(), "http://127.0.0.1:17317")
        code, out, _ = self.run_cli("plan")
        self.assertEqual(code, 0)
        self.assertIn("tailscale serve --bg --https=8443 http://127.0.0.1:17317", out)
        self.assertIn("apply --yes --replace", out)
        self.assertEqual(self.mutations(), [])  # plan never touches tailscale

    def test_env_url_still_beats_the_colony_port(self):
        self.colony_port(17317)
        os.environ["HERDR_WEB_URL"] = "http://127.0.0.1:9999"
        self.assertEqual(R.web_url(), "http://127.0.0.1:9999")

    def test_plan_for_7317_has_no_replace_note(self):
        self.colony_port(None)
        out = self.run_cli("plan")[1]
        self.assertIn("tailscale serve --bg --https=8443 http://127.0.0.1:7317", out)
        self.assertNotIn("--replace", out)

    # ---- apply
    def test_apply_refuses_without_yes(self):
        self.web()
        code, _, err = self.run_cli("apply")
        self.assertEqual(code, R.EXIT_REFUSED)
        self.assertIn("--yes", err)
        self.assertEqual(self.mutations(), [])

    def test_apply_maps_and_preserves_443(self):
        w = self.web(secured=True)
        code, out, err = self.run_cli("apply", "--yes")
        self.assertEqual(code, 0, err)
        self.assertEqual(self.mutations(), [["serve", "--bg", "--https=8443", w.url]])
        web = self.cfg()["Web"]
        self.assertEqual(web["h.ts.net:8443"]["Handlers"]["/"]["Proxy"], w.url)
        self.assertEqual(web["h.ts.net:443"], EXISTING_443["Web"]["h.ts.net:443"])
        self.assertFalse(any("funnel" in " ".join(c) for c in self.calls()))

    def test_apply_idempotent_when_already_mapped(self):
        w = self.web()
        cfg = json.loads(json.dumps(EXISTING_443))
        cfg["TCP"]["8443"] = {"HTTPS": True}
        cfg["Web"]["h.ts.net:8443"] = {"Handlers": {"/": {"Proxy": w.url}}}
        self.set_cfg(cfg)
        self.assertEqual(self.run_cli("apply", "--yes")[0], 0)
        self.assertEqual(self.mutations(), [])

    def foreign_cfg(self):
        cfg = json.loads(json.dumps(EXISTING_443))
        cfg["TCP"]["8443"] = {"HTTPS": True}
        cfg["Web"]["h.ts.net:8443"] = {"Handlers": {"/": {"Proxy": FOREIGN["target"]}}}
        return cfg

    def test_apply_refuses_foreign_mapping(self):
        self.web()
        self.set_cfg(self.foreign_cfg())
        code, _, err = self.run_cli("apply", "--yes")
        self.assertEqual(code, R.EXIT_REFUSED)
        self.assertIn("--replace", err)
        self.assertEqual(self.mutations(), [])

    def test_apply_replace_overwrites_foreign_only_on_its_port(self):
        w = self.web()
        self.set_cfg(self.foreign_cfg())
        self.assertEqual(self.run_cli("apply", "--yes", "--replace")[0], 0)
        web = self.cfg()["Web"]
        self.assertEqual(web["h.ts.net:8443"]["Handlers"]["/"]["Proxy"], w.url)
        self.assertEqual(web["h.ts.net:443"], EXISTING_443["Web"]["h.ts.net:443"])

    def test_apply_refuses_when_auth_open(self):
        self.web(secured=False)
        code, _, err = self.run_cli("apply", "--yes")
        self.assertEqual(code, R.EXIT_REFUSED)
        self.assertIn("any tailnet peer", err)
        self.assertEqual(self.mutations(), [])

    def test_apply_refuses_when_web_down(self):
        os.environ["HERDR_WEB_URL"] = "http://127.0.0.1:1"  # nothing listens
        code, _, err = self.run_cli("apply", "--yes")
        self.assertEqual(code, R.EXIT_REFUSED)
        self.assertIn("not reachable", err)
        self.assertEqual(self.mutations(), [])

    def test_apply_refuses_when_funnel_on_port(self):
        self.web()
        cfg = self.foreign_cfg()
        cfg["AllowFunnel"] = {"h.ts.net:8443": True}
        self.set_cfg(cfg)
        code, _, err = self.run_cli("apply", "--yes", "--replace")
        self.assertEqual(code, R.EXIT_REFUSED)
        self.assertIn("funnel", err)
        self.assertEqual(self.mutations(), [])

    # ---- disable
    def test_disable_requires_yes(self):
        self.assertEqual(self.run_cli("disable")[0], R.EXIT_REFUSED)
        self.assertEqual(self.mutations(), [])

    def test_disable_removes_only_8443(self):
        self.set_cfg(self.foreign_cfg())
        code, _, err = self.run_cli("disable", "--yes")
        self.assertEqual(code, 0, err)
        self.assertEqual(self.mutations(), [["serve", "--https=8443", "off"]])
        self.assertEqual(
            self.cfg(), {"TCP": EXISTING_443["TCP"], "Web": EXISTING_443["Web"]}
        )

    def test_disable_noop_when_unmapped(self):
        self.assertEqual(self.run_cli("disable", "--yes")[0], 0)
        self.assertEqual(self.mutations(), [])

    # ---- status / url
    def test_status_flags_funnel(self):
        self.web()
        cfg = self.foreign_cfg()
        cfg["AllowFunnel"] = {"h.ts.net:443": True}
        self.set_cfg(cfg)
        code, out, _ = self.run_cli("status")
        data = json.loads(out)
        self.assertEqual(code, 0)
        self.assertEqual(data["funnel"], [{"host": "h.ts.net", "port": 443}])
        self.assertTrue(
            any(w.startswith("WARN") and "funnel" in w for w in data["warnings"])
        )
        self.assertTrue(next(e for e in data["serve"] if e["port"] == 443)["funnel"])

    def test_status_reports_tailnet_web_and_auth(self):
        self.web(secured=True)
        _, out, _ = self.run_cli("status")
        data = json.loads(out)
        self.assertEqual(data["tailscale"]["dns_name"], "h.ts.net")
        self.assertEqual(data["tailscale"]["ips"], ["100.1.1.1", "fd7a::1"])
        self.assertEqual(data["warnings"], [])
        self.assertTrue(data["herdr_web_ui"]["up"])
        self.assertEqual(data["herdr_web_ui"]["auth"]["via"], "local")
        self.assertTrue(data["herdr_web_ui"]["tailnet_probe"]["required"])
        self.assertEqual(data["url"], "https://h.ts.net:8443")

    def test_url(self):
        code, out, _ = self.run_cli("url")
        self.assertEqual((code, out.strip()), (0, "https://h.ts.net:8443"))

    def test_no_tailscale_binary(self):
        os.environ["PATH"] = "/nonexistent"
        self.assertEqual(self.run_cli("url")[0], R.EXIT_NO_TS)


if __name__ == "__main__":
    unittest.main()
