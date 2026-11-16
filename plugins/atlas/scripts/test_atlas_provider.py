#!/usr/bin/env python3
"""atlas_provider: worker provider resolution (claude | ollama | auto), health check and cache, fallback reasons,
cross-family verifier pairing, crew and mux wiring, telemetry, and a real-CLI wiring proof against a local stub.

No real model runs here: every Ollama endpoint is a stub http.server on 127.0.0.1 that answers /api/version,
/api/tags, POST /api/show and POST /v1/messages (one JSON message, or a minimal SSE stream when stream=true).
"""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402
import argparse
import contextlib
import io
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import atlas_crew
import atlas_mux
import atlas_provider as P

STUB_TEXT = "ok from stub"


class Stub:
    """A local Ollama stand-in. `models` is what /api/tags lists; `messages_status` 404 means no Anthropic API."""

    def __init__(
        self,
        models=("qwen3:8b",),
        messages_status=200,
        delay=0.0,
        version_status=200,
        show=None,
        post_delay=0.0,
        message_body=None,
    ):
        self.models, self.messages_status, self.delay, self.version_status = (
            list(models),
            messages_status,
            delay,
            version_status,
        )
        # POST /api/show answer: a tool-capable model with a 128k trained context unless a test overrides it
        self.show = (
            show
            if show is not None
            else {
                "capabilities": ["completion", "tools"],
                "model_info": {"general.architecture": "llama", "llama.context_length": 131072},
                "parameters": "",
            }
        )
        self.post_delay, self.message_body = post_delay, message_body
        self.requests: list = []
        stub = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, obj, ctype="application/json"):
                body = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("content-type", ctype)
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                stub.requests.append(("GET", self.path, None))
                if stub.delay:
                    time.sleep(stub.delay)
                if self.path == "/api/version":
                    return self._send(stub.version_status, {"version": "0.0.0-stub"})
                if self.path == "/api/tags":
                    return self._send(
                        200, {"models": [{"name": m} for m in stub.models]}
                    )
                self._send(404, {"error": "not found"})

            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get("content-length") or 0))
                try:
                    body = json.loads(raw or b"{}")
                except ValueError:
                    body = None
                stub.requests.append(("POST", self.path, body))
                if self.path == "/api/show":
                    if not isinstance(body, dict) or body.get("model") not in stub.models:
                        return self._send(404, {"error": "model not found"})
                    return self._send(200, stub.show)
                if self.path.split("?")[0] == "/v1/messages" and stub.post_delay:
                    time.sleep(stub.post_delay)
                if (
                    self.path.split("?")[0] == "/v1/messages"
                    and stub.messages_status not in (200, 404)
                ):
                    return self._send(stub.messages_status, {"type": "error", "error": {"type": "api_error", "message": "boom"}})
                if self.path.split("?")[0] == "/v1/messages" and stub.message_body is not None:
                    return self._send(200, stub.message_body)
                if (
                    self.path.split("?")[0] != "/v1/messages"
                    or stub.messages_status == 404
                ):
                    return self._send(404, {"error": "not found"})
                if not body or not body.get("model"):
                    return self._send(
                        400,
                        {
                            "type": "error",
                            "error": {
                                "type": "invalid_request_error",
                                "message": "bad",
                            },
                        },
                    )
                msg = {
                    "id": "msg_stub",
                    "type": "message",
                    "role": "assistant",
                    "model": body["model"],
                    "content": [{"type": "text", "text": STUB_TEXT}],
                    "stop_reason": "end_turn",
                    "stop_sequence": None,
                    "usage": {"input_tokens": 5, "output_tokens": 4},
                }
                if not body.get("stream"):
                    return self._send(200, msg)
                ev = [
                    (
                        "message_start",
                        {
                            "type": "message_start",
                            "message": {**msg, "content": [], "stop_reason": None},
                        },
                    ),
                    (
                        "content_block_start",
                        {
                            "type": "content_block_start",
                            "index": 0,
                            "content_block": {"type": "text", "text": ""},
                        },
                    ),
                    (
                        "content_block_delta",
                        {
                            "type": "content_block_delta",
                            "index": 0,
                            "delta": {"type": "text_delta", "text": STUB_TEXT},
                        },
                    ),
                    ("content_block_stop", {"type": "content_block_stop", "index": 0}),
                    (
                        "message_delta",
                        {
                            "type": "message_delta",
                            "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                            "usage": {"output_tokens": 4},
                        },
                    ),
                    ("message_stop", {"type": "message_stop"}),
                ]
                out = "".join(
                    f"event: {n}\ndata: {json.dumps(d)}\n\n" for n, d in ev
                ).encode()
                self._send(200, out, "text/event-stream")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def posts(self):
        return [r for r in self.requests if r[0] == "POST"]


def closed_port_url() -> str:
    import socket

    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return f"http://127.0.0.1:{port}"


class Base(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="provtest-")
        self.addCleanup(shutil.rmtree, self.home, True)
        keep = {
            k: v
            for k, v in os.environ.items()
            if not k.startswith(("ATLAS_", "ANTHROPIC_"))
            and k != "CLAUDE_CODE_OAUTH_TOKEN"
        }
        patcher = mock.patch.dict(
            os.environ, {**keep, "ATLAS_HOME": self.home}, clear=True
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.stubs: list = []
        self.addCleanup(lambda: [s.close() for s in self.stubs])

    def stub(self, **kw) -> Stub:
        s = Stub(**kw)
        self.stubs.append(s)
        return s

    def env(self, **kw):
        os.environ.update({k: v for k, v in kw.items() if v is not None})


class ResolveTests(Base):
    def test_default_is_claude_and_passes_the_model_through(self):
        r = P.resolve("implementer", "sonnet", None)
        self.assertEqual(
            (r["provider"], r["model"], r["env"], r["fallback"]),
            ("claude", "sonnet", {}, None),
        )

    def test_ollama_without_a_model_falls_back_with_no_model(self):
        self.env(ATLAS_WORKER_PROVIDER="ollama")
        r = P.resolve("implementer", None, None)
        self.assertEqual((r["provider"], r["fallback"]), ("claude", "no_model"))

    def test_healthy_ollama_sets_provider_env_and_unsets_the_account_token(self):
        st = self.stub()
        self.env(
            ATLAS_WORKER_PROVIDER="ollama",
            ATLAS_OLLAMA_MODEL="qwen3:8b",
            ATLAS_OLLAMA_URL=st.url,
        )
        r = P.resolve("implementer", None, None)
        self.assertEqual(
            (r["provider"], r["model"], r["fallback"]), ("ollama", "qwen3:8b", None)
        )
        self.assertEqual(r["env"]["ANTHROPIC_BASE_URL"], st.url)
        self.assertEqual(r["env"]["ANTHROPIC_AUTH_TOKEN"], "ollama")
        self.assertEqual(r["env"]["ANTHROPIC_API_KEY"], "")
        self.assertEqual(r["env"]["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"], "1")
        base = {
            "CLAUDE_CODE_OAUTH_TOKEN": "secret",
            "ANTHROPIC_API_KEY": "sk-real",
            "PATH": "/bin",
        }
        out = P.apply_env(base, r)
        self.assertNotIn("CLAUDE_CODE_OAUTH_TOKEN", out)
        self.assertEqual(out["ANTHROPIC_API_KEY"], "")
        self.assertIn("CLAUDE_CODE_OAUTH_TOKEN", base, "apply_env copies")

    def test_per_role_model_beats_the_default(self):
        st = self.stub(models=("qwen3:8b", "llama3.2:3b"))
        self.env(
            ATLAS_WORKER_PROVIDER="ollama",
            ATLAS_OLLAMA_URL=st.url,
            ATLAS_OLLAMA_MODEL="llama3.2:3b",
            ATLAS_OLLAMA_ROLE_MODELS="explorer=qwen3:8b,runner=qwen3:8b",
        )
        self.assertEqual(P.resolve("explorer", None, None)["model"], "qwen3:8b")
        self.assertEqual(P.resolve("verifier", None, None)["model"], "llama3.2:3b")

    def test_explicit_provider_and_model_win_over_env(self):
        st = self.stub(models=("tiny:1b",))
        self.env(ATLAS_OLLAMA_URL=st.url)  # ATLAS_WORKER_PROVIDER stays claude
        r = P.resolve("implementer", "tiny:1b", "ollama")
        self.assertEqual((r["provider"], r["model"]), ("ollama", "tiny:1b"))

    def test_invalid_model_names_are_refused(self):
        self.env(ATLAS_WORKER_PROVIDER="ollama", ATLAS_OLLAMA_MODEL="bad name;rm -rf")
        self.assertEqual(P.resolve("implementer", None, None)["fallback"], "no_model")
        self.env(ATLAS_OLLAMA_ROLE_MODELS="implementer=$(x),runner=ok:1b")
        self.assertEqual(P.role_models(), {"runner": "ok:1b"})

    def test_remote_url_is_refused_unless_allowed(self):
        self.env(
            ATLAS_WORKER_PROVIDER="ollama",
            ATLAS_OLLAMA_MODEL="qwen3:8b",
            ATLAS_OLLAMA_URL="http://10.1.2.3:11434",
        )
        self.assertEqual(
            P.resolve("implementer", None, None)["fallback"], "remote_refused"
        )
        self.assertTrue(P.is_loopback("http://localhost:11434"))
        self.assertTrue(P.is_loopback("http://[::1]:11434"))
        self.assertFalse(P.is_loopback("http://example.com"))
        with mock.patch.object(
            P, "health", return_value={"ok": True, "reason": None}
        ) as h:
            os.environ["ATLAS_OLLAMA_ALLOW_REMOTE"] = "1"
            r = P.resolve("implementer", None, None)
        self.assertEqual(
            (r["provider"], r["env"]["ANTHROPIC_BASE_URL"]),
            ("ollama", "http://10.1.2.3:11434"),
        )
        h.assert_called_once()

    def test_auto_uses_ollama_when_healthy_else_claude_with_the_reason(self):
        st = self.stub()
        self.env(
            ATLAS_WORKER_PROVIDER="auto",
            ATLAS_OLLAMA_MODEL="qwen3:8b",
            ATLAS_OLLAMA_URL=st.url,
        )
        self.assertEqual(P.resolve("explorer", None, None)["provider"], "ollama")
        os.environ["ATLAS_OLLAMA_URL"] = closed_port_url()
        r = P.resolve("explorer", None, None)
        self.assertEqual((r["provider"], r["fallback"]), ("claude", "down"))

    def test_explicit_ollama_unhealthy_falls_back_and_drops_the_ollama_model(self):
        self.env(ATLAS_OLLAMA_URL=closed_port_url())
        r = P.resolve("implementer", "qwen3:8b", "ollama")
        self.assertEqual(
            (r["provider"], r["model"], r["fallback"]), ("claude", None, "down")
        )

    def test_strict_refuses_instead_of_falling_back(self):
        self.env(
            ATLAS_WORKER_PROVIDER="ollama",
            ATLAS_OLLAMA_MODEL="qwen3:8b",
            ATLAS_OLLAMA_URL=closed_port_url(),
            ATLAS_OLLAMA_STRICT="1",
        )
        with self.assertRaises(P.ProviderRefused):
            P.resolve("implementer", None, None)


class HealthTests(Base):
    def test_ok(self):
        st = self.stub()
        h = P.health(st.url, "qwen3:8b")
        self.assertTrue(h["ok"])
        paths = [(m, p) for m, p, _ in st.requests]
        self.assertEqual(
            paths,
            [
                ("GET", "/api/version"),
                ("GET", "/api/tags"),
                ("POST", "/api/show"),
                ("POST", "/v1/messages"),
            ],
        )

    def test_latest_tag_matches_a_bare_name(self):
        st = self.stub(models=("nimble:latest",))
        self.assertTrue(P.health(st.url, "nimble", use_cache=False)["ok"])

    def test_reasons(self):
        self.assertEqual(
            P.health(closed_port_url(), "m:1b", use_cache=False)["reason"], "down"
        )
        self.assertEqual(
            P.health(self.stub(version_status=500).url, "qwen3:8b", use_cache=False)[
                "reason"
            ],
            "down",
        )
        self.assertEqual(
            P.health(self.stub().url, "other:1b", use_cache=False)["reason"],
            "model_missing",
        )
        self.assertEqual(
            P.health(self.stub(messages_status=404).url, "qwen3:8b", use_cache=False)[
                "reason"
            ],
            "no_anthropic_api",
        )
        slow = self.stub(delay=1.0)
        self.assertEqual(
            P.health(slow.url, "qwen3:8b", timeout=0.2, use_cache=False)["reason"],
            "timeout",
        )

    def test_cache_for_30s_written_atomically_in_atlas_home(self):
        st = self.stub()
        P.health(st.url, "qwen3:8b")
        n = len(st.requests)
        again = P.health(st.url, "qwen3:8b")
        self.assertTrue(again["cached"])
        self.assertEqual(len(st.requests), n, "a cached answer makes no request")
        cache = Path(self.home) / "provider-health.json"
        self.assertTrue(cache.is_file())
        self.assertEqual(
            [p.name for p in Path(self.home).glob(".provider-health.*")],
            [],
            "no temp file left",
        )
        with mock.patch.object(
            P.time, "time", return_value=time.time() + P.HEALTH_TTL_S + 1
        ):
            self.assertFalse(P.health(st.url, "qwen3:8b")["cached"])
        self.assertGreater(len(st.requests), n)


class DoctorTests(Base):
    def run_cli(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = P.main(list(argv))
        return rc, json.loads(buf.getvalue())

    def test_doctor_exit_0_when_healthy_and_1_on_fallback(self):
        st = self.stub()
        self.env(
            ATLAS_WORKER_PROVIDER="ollama",
            ATLAS_OLLAMA_MODEL="qwen3:8b",
            ATLAS_OLLAMA_URL=st.url,
        )
        rc, out = self.run_cli("doctor", "--role", "runner")
        self.assertEqual(
            (rc, out["provider"], out["health"]["ok"]), (0, "ollama", True)
        )
        os.environ["ATLAS_OLLAMA_URL"] = closed_port_url()
        rc, out = self.run_cli("doctor", "--role", "runner")
        self.assertEqual(
            (rc, out["provider"], out["fallback"], out["health"]["reason"]),
            (1, "claude", "down", "down"),
        )

    def test_resolve_prints_the_resolution(self):
        rc, out = self.run_cli("resolve", "--role", "runner")
        self.assertEqual((rc, out["provider"]), (0, "claude"))

    def test_strict_is_exit_2(self):
        self.env(
            ATLAS_WORKER_PROVIDER="ollama",
            ATLAS_OLLAMA_MODEL="qwen3:8b",
            ATLAS_OLLAMA_URL=closed_port_url(),
            ATLAS_OLLAMA_STRICT="1",
        )
        rc, out = self.run_cli("resolve", "--role", "runner")
        self.assertEqual((rc, out["ok"]), (2, False))


class PairingTests(unittest.TestCase):
    def seats(self, impl_prov, ver_prov="claude"):
        return [
            {
                "name": "i",
                "role": "implementer",
                "provider": impl_prov,
                "model": "qwen3:8b" if impl_prov == "ollama" else None,
            },
            {
                "name": "v",
                "role": "verifier",
                "provider": ver_prov,
                "model": "qwen3:8b" if ver_prov == "ollama" else None,
            },
            {
                "name": "c",
                "role": "completeness-critic",
                "provider": ver_prov,
                "model": "qwen3:8b" if ver_prov == "ollama" else None,
            },
            {
                "name": "e",
                "role": "explorer",
                "provider": "ollama",
                "model": "qwen3:8b",
            },
        ]

    def test_ollama_implementers_force_verifier_and_critic_onto_claude(self):
        out = {s["name"]: s for s in P.pair_seats(self.seats("ollama", "ollama"), {})}
        self.assertEqual(
            (out["v"]["provider"], out["c"]["provider"]), ("claude", "claude")
        )
        self.assertEqual(
            out["e"]["provider"], "ollama", "non-verifier seats are untouched"
        )

    def test_claude_implementers_may_get_an_ollama_verifier_when_configured_and_on(
        self,
    ):
        out = {
            s["name"]: s
            for s in P.pair_seats(
                self.seats("claude"), {"verifier": "qwen3:8b"}, adversarial=True
            )
        }
        self.assertEqual(
            (out["v"]["provider"], out["v"]["model"]), ("ollama", "qwen3:8b")
        )
        self.assertEqual(
            out["c"]["provider"], "claude", "no model configured for that role"
        )

    def test_pairing_off_keeps_claude_verifiers(self):
        out = {
            s["name"]: s
            for s in P.pair_seats(
                self.seats("claude"), {"verifier": "qwen3:8b"}, adversarial=False
            )
        }
        self.assertEqual(out["v"]["provider"], "claude")

    def test_pure_and_idempotent(self):
        seats = self.seats("ollama", "ollama")
        before = json.dumps(seats)
        once = P.pair_seats(seats, {})
        self.assertEqual(json.dumps(seats), before, "input is not mutated")
        self.assertEqual(P.pair_seats(once, {}), once)

    def test_never_the_same_provider_and_model_when_another_option_exists(self):
        out = P.pair_seats(self.seats("claude"), {"verifier": "qwen3:8b"})
        impl = {(s["provider"], s["model"]) for s in out if s["role"] == "implementer"}
        ver = next(s for s in out if s["name"] == "v")
        self.assertNotIn((ver["provider"], ver["model"]), impl)

    def test_adversarial_default_on(self):
        self.assertTrue(P.adversarial_on({}))
        self.assertFalse(P.adversarial_on({"ATLAS_ADVERSARIAL_PAIRING": "off"}))

    def test_team_options_need_an_explicit_verifier_role_model_and_a_healthy_endpoint(
        self,
    ):
        with (
            tempfile.TemporaryDirectory() as home,
            mock.patch.dict(os.environ, {"ATLAS_HOME": home}),
        ):
            st = Stub()
            try:
                env = {"ATLAS_OLLAMA_URL": st.url, "ATLAS_OLLAMA_MODEL": "qwen3:8b"}
                self.assertEqual(
                    P.team_options(["verifier"], env),
                    {},
                    "the default model alone never moves a verifier",
                )
                env["ATLAS_OLLAMA_ROLE_MODELS"] = (
                    "verifier=qwen3:8b,implementer=qwen3:8b"
                )
                self.assertEqual(
                    P.team_options(["verifier", "implementer"], env),
                    {"verifier": "qwen3:8b"},
                )
            finally:
                st.close()


class TelemetryTests(Base):
    def test_record_launch_keys(self):
        keys = []
        with mock.patch("atlas_analytics.record", side_effect=keys.append):
            P.record_launch(
                {"provider": "claude", "fallback": None, "requested": "claude"}
            )
            P.record_launch(
                {"provider": "ollama", "fallback": None, "requested": "ollama"}
            )
            P.record_launch(
                {"provider": "claude", "fallback": "down", "requested": "ollama"}
            )
        self.assertEqual(
            keys,
            [
                "provider.claude.used",
                "provider.ollama.used",
                "provider.claude.used",
                "provider.ollama.fallback.down",
            ],
        )

    def test_every_key_is_in_the_schema_allowlist(self):
        import atlas_analytics

        for key in ["provider.claude.used", "provider.ollama.used"] + [
            f"provider.ollama.fallback.{r}" for r in P.FALLBACK_REASONS
        ]:
            self.assertTrue(atlas_analytics.valid_key(key), key)


class CrewWiringTests(Base):
    def setUp(self):
        super().setUp()
        self.root = Path(self.home) / "proj"
        self.rundir = self.root / "run"
        (self.rundir / "logs").mkdir(parents=True)
        (self.rundir / "irc" / "stop").mkdir(parents=True)
        (self.rundir / "exit").mkdir()
        self.plan = {
            "workers": [
                {"name": "a", "owns": ["a.py"]},
                {"name": "b", "owns": ["b.py"], "provider": "claude"},
            ],
            "check": "true",
        }

    def ollama_env(self, st):
        self.env(
            ATLAS_WORKER_PROVIDER="ollama",
            ATLAS_OLLAMA_MODEL="qwen3:8b",
            ATLAS_OLLAMA_URL=st.url,
        )

    def test_worker_env_carries_provider_env_and_drops_the_account_token(self):
        st = self.stub()
        self.ollama_env(st)
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = "acct"
        prov = atlas_crew.worker_provider(self.plan["workers"][0], {}, None)
        env = atlas_crew.worker_env(
            self.rundir, self.plan, self.plan["workers"][0], str(self.root), prov
        )
        self.assertEqual(env["ANTHROPIC_BASE_URL"], st.url)
        self.assertEqual(env["ANTHROPIC_API_KEY"], "")
        self.assertNotIn("CLAUDE_CODE_OAUTH_TOKEN", env)

    def test_parity_argv_system_prompt_and_irc_env_identical_apart_from_model_and_provider_env(
        self,
    ):
        st = self.stub()
        w = self.plan["workers"][0]
        self.ollama_env(st)
        claude_env = atlas_crew.worker_env(self.rundir, self.plan, w, str(self.root))
        prov = atlas_crew.worker_provider(w, {}, "sonnet")
        self.assertEqual(prov["provider"], "ollama")
        ollama_env = atlas_crew.worker_env(
            self.rundir, self.plan, w, str(self.root), prov
        )
        a1 = atlas_crew.worker_argv("sonnet", "low", "{}", "sid", "do it")
        a2 = atlas_crew.worker_argv(prov["model"], "low", "{}", "sid", "do it")
        diff = [i for i, (x, y) in enumerate(zip(a1, a2)) if x != y]
        self.assertEqual(len(a1), len(a2))
        self.assertEqual([a1[i] for i in diff], ["sonnet"])
        self.assertEqual(a1[diff[0] - 1], "--model")
        self.assertEqual(
            a1[a1.index("--system-prompt") + 1],
            atlas_crew.BASE_PROMPT + atlas_crew.PROTOCOL,
        )
        self.assertEqual(
            a2[a2.index("--system-prompt") + 1],
            atlas_crew.BASE_PROMPT + atlas_crew.PROTOCOL,
        )
        changed = {
            k
            for k in set(claude_env) | set(ollama_env)
            if claude_env.get(k) != ollama_env.get(k)
        }
        self.assertLessEqual(changed, set(P.PROVIDER_ENV_KEYS) | set(P.UNSET_ENV))
        for k in ("ATLAS_IRC_DIR", "ATLAS_IRC_NICK"):
            self.assertEqual(claude_env[k], ollama_env[k])

    def test_log_first_line_stays_parseable_for_the_colony_model_column(self):
        import atlas_colony_model

        argv = atlas_crew.worker_argv("qwen3:8b", None, "{}", "sid", "p")
        log = self.root / "w.log"
        log.write_text("$ " + shlex.join(argv[:-1]) + " <prompt>\n")
        info = atlas_colony_model._log_info(log)
        self.assertIn("qwen3:8b", json.dumps(info))

    def test_assign_providers_records_per_worker_and_status_shows_them(self):
        st = self.stub()
        self.ollama_env(st)
        keys = []
        with mock.patch("atlas_analytics.record", side_effect=keys.append):
            got = atlas_crew.assign_providers(self.rundir, self.plan, {"model": None})
        self.assertEqual(
            (got["a"]["provider"], got["a"]["model"]), ("ollama", "qwen3:8b")
        )
        self.assertEqual(
            got["b"]["provider"], "claude", "a per-worker provider wins over the env"
        )
        self.assertEqual(sorted(keys), ["provider.claude.used", "provider.ollama.used"])
        self.assertEqual(
            atlas_crew.load_provider(self.rundir, "a")["env"]["ANTHROPIC_BASE_URL"],
            st.url,
        )

    def test_assign_providers_records_the_fallback_reason(self):
        self.env(
            ATLAS_WORKER_PROVIDER="ollama",
            ATLAS_OLLAMA_MODEL="qwen3:8b",
            ATLAS_OLLAMA_URL=closed_port_url(),
        )
        got = atlas_crew.assign_providers(
            self.rundir, {"workers": [self.plan["workers"][0]]}, {"model": None}
        )
        self.assertEqual(
            (got["a"]["provider"], got["a"]["fallback"]), ("claude", "down")
        )

    def test_assign_providers_strict_raises(self):
        self.env(
            ATLAS_WORKER_PROVIDER="ollama",
            ATLAS_OLLAMA_MODEL="qwen3:8b",
            ATLAS_OLLAMA_URL=closed_port_url(),
            ATLAS_OLLAMA_STRICT="1",
        )
        with self.assertRaises(P.ProviderRefused):
            atlas_crew.assign_providers(self.rundir, self.plan, {"model": None})

    def test_plan_meta_provider_applies_to_workers_without_their_own(self):
        st = self.stub(models=("tiny:1b",))
        self.env(ATLAS_OLLAMA_URL=st.url)
        got = atlas_crew.assign_providers(
            self.rundir, self.plan, {"model": "tiny:1b", "provider": "ollama"}
        )
        self.assertEqual(
            (got["a"]["provider"], got["a"]["model"]), ("ollama", "tiny:1b")
        )
        self.assertEqual(got["b"]["provider"], "claude")

    def test_summary_cost_is_zero_for_local_tokens_still_counted_and_reported_apart(
        self,
    ):
        st = self.stub()
        self.ollama_env(st)
        atlas_crew.assign_providers(self.rundir, self.plan, {"model": None})
        res = lambda cost, tok: json.dumps(
            {
                "type": "result",
                "total_cost_usd": cost,
                "num_turns": 1,
                "modelUsage": {"m": {"inputTokens": tok, "outputTokens": 10}},
            }
        )
        (self.rundir / "logs" / "a.log").write_text(
            res(0.9, 100) + "\n"
        )  # a: ollama, claims a cost it did not incur
        api = json.dumps({"type": "system", "subtype": "init", "apiKeySource": "ANTHROPIC_API_KEY"})
        (self.rundir / "logs" / "b.log").write_text(api + "\n" + res(0.25, 40) + "\n")  # b: claude, billed per token
        for n in "ab":
            (self.rundir / "exit" / f"{n}.r0.json").write_text(
                '{"exit": 0, "wall_s": 1}'
            )
        meta = {"run_id": "run", "started": time.time() - 5, "plan": self.plan}
        with (
            mock.patch.object(atlas_crew.atlas_irc, "history", return_value=[]),
            mock.patch.object(atlas_crew.atlas_irc, "has_done", return_value=True),
        ):
            out = atlas_crew.summarize(self.rundir, meta, [], 0, "")
        rows = {w["name"]: w for w in out["workers"]}
        self.assertEqual(
            (
                rows["a"]["provider"],
                rows["a"]["model"],
                rows["a"]["cost_usd"],
                rows["a"]["tokens"],
                rows["a"]["local"],
            ),
            ("ollama", "qwen3:8b", 0.0, 110, True),
        )
        self.assertEqual(
            (rows["b"]["provider"], rows["b"]["cost_usd"]), ("claude", 0.25)
        )
        self.assertNotIn("local", rows["b"])
        self.assertEqual(
            out["tokens_workers"],
            {"total": 160, "cost_usd": 0.25, "tokens_local": 110, "cost_complete": True, "billing": "mixed"},
        )

    def test_status_lists_providers(self):
        st = self.stub()
        self.ollama_env(st)
        atlas_crew.assign_providers(self.rundir, self.plan, {"model": None})
        meta = {"run_id": "run", "started": time.time(), "plan": self.plan}
        (self.rundir / "run.json").write_text(json.dumps(meta))
        with mock.patch.object(atlas_crew.atlas_irc, "history", return_value=[]):
            out = atlas_crew.status(self.rundir)
        self.assertEqual(
            out["providers"]["a"], {"provider": "ollama", "model": "qwen3:8b"}
        )

    def test_worker_model_accepts_an_ollama_tag_from_the_env(self):
        os.environ["ATLAS_CREW_WORKER_MODEL"] = "qwen3:8b"
        self.assertEqual(atlas_crew.worker_model({}, {}), "qwen3:8b")


class MuxWiringTests(Base):
    def test_worker_env_allowlist_passes_provider_env_only_for_an_ollama_worker(self):
        base = {
            "PATH": "/bin",
            "ANTHROPIC_BASE_URL": "http://x",
            "ANTHROPIC_API_KEY": "sk-lead",
            "ANTHROPIC_AUTH_TOKEN": "t",
        }
        self.assertNotIn(
            "ANTHROPIC_API_KEY",
            atlas_mux.worker_env(base),
            "the lead's key never reaches a claude worker",
        )
        on = atlas_mux.worker_env(
            {**base, "ATLAS_PROVIDER_ACTIVE": "ollama", "ANTHROPIC_API_KEY": ""}
        )
        self.assertEqual(
            (on["ANTHROPIC_BASE_URL"], on["ANTHROPIC_API_KEY"]), ("http://x", "")
        )

    def test_harness_argv_parity_apart_from_the_model(self):
        a1 = atlas_mux.harness_argv(
            "claude", "implementer", "p", "sonnet", "low", "body", "acceptEdits"
        )
        a2 = atlas_mux.harness_argv(
            "claude", "implementer", "p", "qwen3:8b", "low", "body", "acceptEdits"
        )
        self.assertEqual(
            [(x, y) for x, y in zip(a1, a2) if x != y], [("sonnet", "qwen3:8b")]
        )
        self.assertIn("atlas:implementer", a2)

    def _spawn(self, st, **ns):
        captured = {}
        args = argparse.Namespace(
            run="r1",
            name="w1",
            harness="claude",
            agent="implementer",
            prompt_file="/dev/null",
            model=None,
            effort=None,
            thinking=None,
            agents_dir=None,
            permission_mode=None,
            tools_profile=None,
            command_override=None,
            omp_extension=None,
            root=self.home,
            cwd=None,
            team=None,
            provider=None,
        )
        for k, v in ns.items():
            setattr(args, k, v)

        def fake_open(session, name, pane, team=None):
            captured["pane"] = pane
            return None

        out = io.StringIO()
        with (
            mock.patch.object(atlas_mux, "spawn_transport", return_value="tmux"),
            mock.patch.object(atlas_mux, "_open_window", side_effect=fake_open),
            mock.patch.object(atlas_mux, "_note_run_transport"),
            mock.patch.object(
                atlas_mux, "with_token_file", side_effect=lambda r, n, p: p
            ),
            mock.patch.object(
                atlas_mux,
                "_tier",
                side_effect=lambda h, role, d, model, level: (
                    model or "sonnet",
                    level,
                    "",
                    None,
                ),
            ),
            contextlib.redirect_stdout(out),
        ):
            rc = atlas_mux._spawn_registered(args, self.home, None)
        return rc, captured.get("pane", ""), out.getvalue()

    def test_pane_string_carries_provider_env_and_flag_for_an_ollama_worker(self):
        st = self.stub()
        self.env(
            ATLAS_WORKER_PROVIDER="ollama",
            ATLAS_OLLAMA_MODEL="qwen3:8b",
            ATLAS_OLLAMA_URL=st.url,
        )
        rc, pane, out = self._spawn(st)
        self.assertEqual(rc, 0, out)
        self.assertIn(f"ANTHROPIC_BASE_URL={st.url}", pane)
        self.assertIn("ANTHROPIC_AUTH_TOKEN=ollama", pane)
        self.assertIn("ATLAS_PROVIDER_ACTIVE=ollama", pane)
        self.assertIn("-u CLAUDE_CODE_OAUTH_TOKEN", pane)
        self.assertIn("--provider ollama", pane)
        self.assertIn("--model qwen3:8b", pane)

    def test_pane_string_has_no_provider_env_for_a_claude_worker(self):
        rc, pane, out = self._spawn(self.stub())
        self.assertEqual(rc, 0, out)
        self.assertNotIn("ANTHROPIC", pane)
        self.assertNotIn("--provider", pane)

    def test_fallback_pane_drops_the_ollama_model(self):
        self.env(ATLAS_OLLAMA_URL=closed_port_url())
        rc, pane, out = self._spawn(self.stub(), provider="ollama", model="qwen3:8b")
        self.assertEqual(rc, 0, out)
        self.assertNotIn("qwen3:8b", pane)
        self.assertNotIn("ANTHROPIC", pane)
        self.assertEqual(json.loads(out)["fallback"], "down")

    def test_strict_refuses_a_spawn(self):
        self.env(
            ATLAS_WORKER_PROVIDER="ollama",
            ATLAS_OLLAMA_MODEL="qwen3:8b",
            ATLAS_OLLAMA_URL=closed_port_url(),
            ATLAS_OLLAMA_STRICT="1",
        )
        with mock.patch.object(atlas_mux.atlas_todo, "leave"):
            rc, pane, out = self._spawn(self.stub())
        self.assertEqual(rc, 2)
        self.assertFalse(pane)

    def team(self, *roles):
        return {
            "members": [{"name": f"{r[:3]}{i}", "role": r} for i, r in enumerate(roles)]
        }

    def test_team_with_ollama_implementers_pins_verifiers_to_claude(self):
        st = self.stub()
        self.env(
            ATLAS_WORKER_PROVIDER="ollama",
            ATLAS_OLLAMA_MODEL="qwen3:8b",
            ATLAS_OLLAMA_URL=st.url,
        )
        rec = self.team("implementer", "verifier", "completeness-critic")
        atlas_mux.assign_team_providers(rec, "claude")
        got = {m["role"]: m.get("provider") for m in rec["members"]}
        self.assertEqual(
            got,
            {
                "implementer": "ollama",
                "verifier": "claude",
                "completeness-critic": "claude",
            },
        )
        self.assertEqual(rec["members"][0]["provider_model"], "qwen3:8b")

    def test_team_with_claude_implementers_moves_a_configured_verifier_to_ollama(self):
        st = self.stub()
        self.env(ATLAS_OLLAMA_URL=st.url, ATLAS_OLLAMA_ROLE_MODELS="verifier=qwen3:8b")
        rec = self.team("implementer", "verifier", "completeness-critic")
        atlas_mux.assign_team_providers(rec, "claude")
        got = {m["role"]: m.get("provider") for m in rec["members"]}
        self.assertEqual(
            got,
            {
                "implementer": "claude",
                "verifier": "ollama",
                "completeness-critic": "claude",
            },
        )
        os.environ["ATLAS_ADVERSARIAL_PAIRING"] = "off"
        rec = self.team("implementer", "verifier")
        atlas_mux.assign_team_providers(rec, "claude")
        self.assertEqual(rec["members"][1].get("provider"), "claude")

    def test_default_team_pins_every_member_to_claude(self):
        rec = self.team("implementer", "verifier")
        atlas_mux.assign_team_providers(rec, "claude")
        want = self.team("implementer", "verifier")
        for m in want["members"]:
            m["provider"] = "claude"
        self.assertEqual(rec, want)


class HealthDepthTests(Base):
    """P0-1 (context window and tool capability) and P0-2 (a real one-token probe)."""

    def posts_to(self, st, path):
        return [b for m, p, b in st.requests if m == "POST" and p == path]

    def test_show_is_asked_for_the_model(self):
        st = self.stub()
        P.health(st.url, "qwen3:8b", use_cache=False)
        self.assertEqual(self.posts_to(st, "/api/show"), [{"model": "qwen3:8b"}])

    def test_a_model_without_the_tools_capability_is_refused_before_it_is_loaded(self):
        st = self.stub(show={"capabilities": ["completion"], "model_info": {"llama.context_length": 131072}})
        h = P.health(st.url, "qwen3:8b", use_cache=False)
        self.assertEqual((h["ok"], h["reason"]), (False, "no_tools"))
        self.assertEqual(self.posts_to(st, "/v1/messages"), [], "a refused model is never loaded")

    def test_a_small_trained_context_is_refused(self):
        st = self.stub(show={"capabilities": ["tools"], "model_info": {"llama.context_length": 8192}})
        h = P.health(st.url, "qwen3:8b", use_cache=False)
        self.assertEqual((h["ok"], h["reason"]), (False, "ctx_too_small"))

    def test_the_architecture_prefix_does_not_matter(self):
        st = self.stub(show={"capabilities": ["tools"], "model_info": {"qwen3.context_length": 4096}})
        self.assertEqual(P.health(st.url, "qwen3:8b", use_cache=False)["reason"], "ctx_too_small")

    def test_a_modelfile_num_ctx_below_the_minimum_is_refused(self):
        st = self.stub(
            show={
                "capabilities": ["tools"],
                "model_info": {"llama.context_length": 131072},
                "parameters": 'stop "<|eot_id|>"\nnum_ctx                        4096',
            }
        )
        self.assertEqual(P.health(st.url, "qwen3:8b", use_cache=False)["reason"], "ctx_too_small")

    def test_min_ctx_env_moves_the_bar_and_the_cache_key(self):
        st = self.stub(show={"capabilities": ["tools"], "model_info": {"llama.context_length": 8192}})
        self.assertEqual(P.health(st.url, "qwen3:8b")["reason"], "ctx_too_small")
        self.env(ATLAS_OLLAMA_MIN_CTX="4096")
        self.assertTrue(P.health(st.url, "qwen3:8b")["ok"], "a new bar is not answered from the old cache")
        self.env(ATLAS_OLLAMA_MIN_CTX="junk")
        self.assertEqual(P.min_ctx(), 32768)

    def test_fields_the_daemon_does_not_report_are_not_a_failure(self):
        for show in ({}, {"model_info": {"general.architecture": "x"}}, {"capabilities": ["completion", "tools"]}):
            st = self.stub(show=show)
            self.assertTrue(P.health(st.url, "qwen3:8b", use_cache=False)["ok"], show)

    def test_the_probe_is_a_one_token_request_with_a_tool(self):
        st = self.stub()
        P.health(st.url, "qwen3:8b", use_cache=False)
        (body,) = self.posts_to(st, "/v1/messages")
        self.assertEqual((body["model"], body["max_tokens"]), ("qwen3:8b", 1))
        self.assertEqual(len(body["tools"]), 1)
        self.assertEqual(body["tools"][0]["input_schema"]["type"], "object")
        self.assertTrue(body["messages"])

    def test_a_server_error_on_the_probe_is_probe_failed(self):
        st = self.stub(messages_status=500)
        h = P.health(st.url, "qwen3:8b", use_cache=False)
        self.assertEqual((h["ok"], h["reason"]), (False, "probe_failed"))

    def test_a_200_that_is_not_an_anthropic_message_is_probe_failed(self):
        for body in ({"ok": True}, {"type": "message"}, {"type": "error", "content": []}):
            st = self.stub(message_body=body)
            self.assertEqual(P.health(st.url, "qwen3:8b", use_cache=False)["reason"], "probe_failed", body)

    def test_the_cold_probe_waits_on_the_probe_timeout_not_the_health_timeout(self):
        st = self.stub(post_delay=0.8)
        self.env(ATLAS_OLLAMA_PROBE_TIMEOUT="5")
        self.assertTrue(P.health(st.url, "qwen3:8b", timeout=0.3, use_cache=False)["ok"])
        self.env(ATLAS_OLLAMA_PROBE_TIMEOUT="0.2")
        self.assertEqual(P.health(st.url, "qwen3:8b", timeout=5, use_cache=False)["reason"], "timeout")

    def test_the_cached_path_makes_no_request(self):
        st = self.stub()
        P.health(st.url, "qwen3:8b")
        n = len(st.requests)
        self.assertTrue(P.health(st.url, "qwen3:8b")["cached"])
        self.assertEqual(len(st.requests), n)

    def test_every_new_reason_is_a_schema_key(self):
        import atlas_analytics

        for r in ("no_tools", "ctx_too_small", "probe_failed", "runtime_down", "runtime_5xx", "runtime_model_missing"):
            self.assertIn(r, P.FALLBACK_REASONS)
            self.assertTrue(atlas_analytics.valid_key(f"provider.ollama.fallback.{r}"), r)


class AutoAndModelTests(Base):
    """auto applies to read-only roles only; a Claude model name is never an Ollama model; aliases are pinned."""

    def setUp(self):
        super().setUp()
        self.st = self.stub(models=("qwen3:8b", "tiny:1b"))
        self.env(ATLAS_OLLAMA_URL=self.st.url, ATLAS_OLLAMA_MODEL="qwen3:8b", ATLAS_WORKER_PROVIDER="auto")

    def test_auto_moves_only_the_read_only_roles_by_default(self):
        got = {r: P.resolve(r, None, None) for r in ("explorer", "docs-auditor", "implementer", "verifier", "runner")}
        self.assertEqual(
            {r: g["provider"] for r, g in got.items()},
            {"explorer": "ollama", "docs-auditor": "ollama", "implementer": "claude", "verifier": "claude", "runner": "claude"},
        )
        self.assertIsNone(got["implementer"]["fallback"], "staying on Claude is not a fallback")
        self.assertEqual(got["implementer"]["requested"], "auto")

    def test_auto_roles_env_and_explicit_role_models_extend_it(self):
        self.env(ATLAS_OLLAMA_AUTO_ROLES="runner")
        self.assertEqual(P.resolve("runner", None, None)["provider"], "ollama")
        self.assertEqual(P.resolve("explorer", None, None)["provider"], "claude")
        self.env(ATLAS_OLLAMA_ROLE_MODELS="implementer=tiny:1b")
        r = P.resolve("implementer", None, None)
        self.assertEqual((r["provider"], r["model"], r["model_source"]), ("ollama", "tiny:1b", "role_models"))

    def test_an_empty_auto_roles_moves_nothing(self):
        self.env(ATLAS_OLLAMA_AUTO_ROLES="")
        self.assertEqual(P.resolve("explorer", None, None)["provider"], "claude")

    def test_an_explicit_ollama_request_still_moves_any_role(self):
        self.assertEqual(P.resolve("implementer", None, "ollama")["provider"], "ollama")

    def test_the_verifier_stays_on_claude_without_its_own_entry(self):
        self.env(ATLAS_OLLAMA_ROLE_MODELS="explorer=tiny:1b")
        self.assertEqual(P.resolve("verifier", None, None)["provider"], "claude")
        self.assertEqual(P.team_options(["verifier"]), {})

    def test_claude_model_names_are_never_an_ollama_model(self):
        for name in ("sonnet", "opus", "haiku", "Sonnet", "claude-sonnet-5", "claude-opus-4-8", "sonnet[1m]", "us.anthropic.claude-x"):
            r = P.resolve("implementer", name, "ollama")
            self.assertEqual((r["provider"], r["model"]), ("ollama", "qwen3:8b"), name)
            self.assertEqual((r["model_source"], r["ignored_model"]), ("default_env", name))
            self.assertEqual(P.public(r)["ignored_model"], name)

    def test_a_valid_tag_is_used_and_says_so(self):
        r = P.resolve("implementer", "tiny:1b", "ollama")
        self.assertEqual((r["model"], r["model_source"]), ("tiny:1b", "explicit"))
        self.assertNotIn("ignored_model", r)

    def test_a_claude_alias_with_no_configured_model_falls_back_with_no_model(self):
        os.environ.pop("ATLAS_OLLAMA_MODEL")
        r = P.resolve("implementer", "sonnet", "ollama")
        self.assertEqual((r["provider"], r["fallback"], r["model"]), ("claude", "no_model", None))

    def test_the_crew_plan_model_is_not_passed_to_ollama(self):
        w = {"name": "a", "owns": ["a.py"], "role": "implementer"}
        prov = atlas_crew.worker_provider(w, {"provider": "ollama", "model": "sonnet"}, "sonnet")
        self.assertEqual((prov["provider"], prov["model"], prov["model_source"]), ("ollama", "qwen3:8b", "default_env"))
        self.assertEqual(prov["ignored_model"], "sonnet")
        d = Path(self.home) / "run"
        got = atlas_crew.assign_providers(d, {"workers": [w]}, {"provider": "ollama", "model": "sonnet"})
        rec = json.loads((d / "provider" / "a.json").read_text())
        self.assertEqual((rec["model"], rec["model_source"], rec["ignored_model"]), ("qwen3:8b", "default_env", "sonnet"))
        self.assertEqual(got["a"]["model"], "qwen3:8b")

    def test_the_ollama_env_pins_every_model_alias_to_the_tag(self):
        r = P.resolve("explorer", None, None)
        for k in (
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_SMALL_FAST_MODEL",
            "CLAUDE_CODE_SUBAGENT_MODEL",
        ):
            self.assertEqual(r["env"][k], "qwen3:8b", k)
            self.assertIn(k, P.PROVIDER_ENV_KEYS)
        self.assertEqual(P.provider_env("http://x")["ATLAS_PROVIDER_ACTIVE"], "ollama")
        self.assertNotIn("ANTHROPIC_DEFAULT_HAIKU_MODEL", P.provider_env("http://x"))

    def test_the_crew_record_rebuilds_the_alias_env(self):
        w = {"name": "a", "owns": ["a.py"], "role": "explorer"}
        d = Path(self.home) / "run"
        atlas_crew.assign_providers(d, {"workers": [w]}, {})
        env = atlas_crew.load_provider(d, "a")["env"]
        self.assertEqual(env["ANTHROPIC_DEFAULT_HAIKU_MODEL"], "qwen3:8b")


CLOUD_ENV = {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "CLAUDE_CODE_USE_VERTEX": "1",
    "CLAUDE_CODE_USE_FOUNDRY": "1",
    "ANTHROPIC_BEDROCK_BASE_URL": "https://bedrock.example",
    "ANTHROPIC_VERTEX_BASE_URL": "https://vertex.example",
    "ANTHROPIC_FOUNDRY_BASE_URL": "https://foundry.example",
    "ANTHROPIC_FOUNDRY_RESOURCE": "res",
    "ANTHROPIC_FOUNDRY_API_KEY": "k",
    "AWS_BEARER_TOKEN_BEDROCK": "b",
    "CLAUDE_CODE_OAUTH_TOKEN": "acct",
    "ANTHROPIC_PROFILE": "work",
    "ANTHROPIC_CUSTOM_HEADERS": "X-A: b",
}


class NoCloudRoutingTests(Base):
    """D4, D5, D6: an Ollama worker never keeps cloud routing or Claude credentials; teams pin their provider."""

    def setUp(self):
        super().setUp()
        self.st = self.stub()
        self.env(ATLAS_OLLAMA_URL=self.st.url, ATLAS_OLLAMA_MODEL="qwen3:8b")

    def test_apply_env_strips_every_cloud_and_credential_variable(self):
        r = P.resolve("explorer", None, "ollama")
        out = P.apply_env({**CLOUD_ENV, "PATH": "/bin"}, r)
        self.assertEqual(sorted(set(CLOUD_ENV) & set(out)), [])
        self.assertEqual(out["PATH"], "/bin")
        self.assertEqual(out["ANTHROPIC_BASE_URL"], self.st.url)

    def test_crew_worker_env_strips_them_from_the_lead_env(self):
        plan = {"workers": [{"name": "a", "owns": ["a.py"], "provider": "ollama"}]}
        w = plan["workers"][0]
        os.environ.update(CLOUD_ENV)
        prov = atlas_crew.worker_provider(w, {}, None)
        env = atlas_crew.worker_env(Path(self.home) / "r", plan, w, self.home, prov)
        self.assertEqual(sorted(set(CLOUD_ENV) & set(env)), [])
        self.assertEqual(env["ANTHROPIC_BASE_URL"], self.st.url)
        again = atlas_crew.worker_env(Path(self.home) / "r", plan, w, self.home, {**prov, "unset": list(P.UNSET_ENV)})
        self.assertEqual(sorted(set(CLOUD_ENV) & set(again)), [])
        claude = atlas_crew.worker_env(Path(self.home) / "r", plan, w, self.home, None)
        self.assertIn("CLAUDE_CODE_USE_BEDROCK", claude, "a Claude worker keeps the lead's routing")

    def test_mux_worker_env_drops_a_forwarded_token_and_cloud_vars_for_an_ollama_worker(self):
        base = {
            **CLOUD_ENV,
            "PATH": "/bin",
            "ATLAS_WORKER_FORWARD_ENV": ",".join(CLOUD_ENV),
            "ATLAS_PROVIDER_ACTIVE": "ollama",
            "ANTHROPIC_BASE_URL": self.st.url,
        }
        out = atlas_mux.worker_env(base)
        self.assertEqual(sorted(set(CLOUD_ENV) & set(out)), [])
        self.assertEqual(out["ANTHROPIC_BASE_URL"], self.st.url)
        claude = atlas_mux.worker_env({**base, "ATLAS_PROVIDER_ACTIVE": ""})
        self.assertEqual(claude["CLAUDE_CODE_OAUTH_TOKEN"], "acct", "a Claude worker still gets what is named")

    def test_the_tmux_pane_unsets_every_cloud_variable(self):
        os.environ.update(CLOUD_ENV)
        rc, pane, out = MuxSpawn(self)(provider="ollama", model="qwen3:8b")
        self.assertEqual(rc, 0, out)
        toks = shlex.split(pane)
        unset = {toks[i + 1] for i, t in enumerate(toks) if t == "-u"}
        self.assertEqual(sorted(set(CLOUD_ENV) - unset), [])

    def test_the_herdr_pane_unsets_the_account_token_and_cloud_variables(self):
        os.environ.update(CLOUD_ENV)
        made = {}
        with mock.patch("atlas_seats.create_pane", side_effect=lambda *a, **k: made.update(cmd=a[1]) or {"ok": True, "pane_id": "p1"}):
            rc, pane, out = MuxSpawn(self)(transport="herdr", provider="ollama", model="qwen3:8b")
        self.assertEqual(rc, 0, out)
        toks = shlex.split(made["cmd"])
        unset = {toks[i + 1] for i, t in enumerate(toks) if t == "-u"}
        self.assertEqual(sorted(set(CLOUD_ENV) - unset), [])
        self.assertTrue(any(t.startswith("ANTHROPIC_BASE_URL=") for t in toks))

    def test_a_claude_herdr_pane_has_no_unset_flags(self):
        made = {}
        with mock.patch("atlas_seats.create_pane", side_effect=lambda *a, **k: made.update(cmd=a[1]) or {"ok": True, "pane_id": "p1"}):
            MuxSpawn(self)(transport="herdr")
        self.assertNotIn("-u", shlex.split(made["cmd"]))

    def test_the_bg_transport_env_strips_them(self):
        os.environ.update({**CLOUD_ENV, "ATLAS_WORKER_FORWARD_ENV": ",".join(CLOUD_ENV)})
        seen = {}

        def fake_claude(*argv, env=None, cwd=None):
            seen["env"] = env
            return subprocess.CompletedProcess(argv, 0, "agent id: abcdef12\n", "")

        with (
            mock.patch.object(atlas_mux, "_claude", side_effect=fake_claude),
            mock.patch.object(atlas_mux.atlas_todo, "issue_owner_token", return_value="t"),
            mock.patch.object(atlas_mux.atlas_todo, "set_member_handles"),
        ):
            rc, pane, out = MuxSpawn(self)(transport="claude-bg", provider="ollama", model="qwen3:8b")
        self.assertIn("env", seen, out)
        self.assertEqual(sorted(set(CLOUD_ENV) & set(seen["env"])), [])
        self.assertEqual(seen["env"]["ANTHROPIC_BASE_URL"], self.st.url)

    def test_a_team_pins_the_resolved_provider_on_every_member_even_when_ollama_is_down(self):
        os.environ["ATLAS_OLLAMA_URL"] = closed_port_url()
        os.environ["ATLAS_WORKER_PROVIDER"] = "ollama"
        rec = {"members": [{"name": "i0", "role": "implementer"}, {"name": "v1", "role": "verifier"}]}
        atlas_mux.assign_team_providers(rec, "claude")
        self.assertEqual([m["provider"] for m in rec["members"]], ["claude", "claude"])
        # Ollama comes back before the spawn: the pinned member must not move onto it
        os.environ["ATLAS_OLLAMA_URL"] = self.st.url
        rc, pane, out = MuxSpawn(self)(provider=rec["members"][0]["provider"])
        self.assertNotIn("ANTHROPIC_BASE_URL", pane)
        self.assertNotIn("--provider ollama", pane)


class MuxSpawn:
    """Drive atlas_mux._spawn_registered with the pane/transport stubbed; returns (rc, pane string, stdout)."""

    def __init__(self, case):
        self.case = case

    def __call__(self, transport="tmux", **ns):
        captured = {}
        args = argparse.Namespace(
            run="r1", name="w1", harness="claude", agent="implementer", prompt_file="/dev/null", model=None,
            effort=None, thinking=None, agents_dir=None, permission_mode=None, tools_profile=None,
            command_override=None, omp_extension=None, root=self.case.home, cwd=None, team=None, provider=None,
        )  # fmt: skip
        for k, v in ns.items():
            setattr(args, k, v)

        def fake_open(session, name, pane, team=None):
            captured["pane"] = pane

        out = io.StringIO()
        with (
            mock.patch.object(atlas_mux, "spawn_transport", return_value=transport),
            mock.patch.object(atlas_mux, "_pane_transport", return_value=transport),
            mock.patch.object(atlas_mux, "_open_window", side_effect=fake_open),
            mock.patch.object(atlas_mux, "_note_run_transport"),
            mock.patch.object(atlas_mux, "with_token_file", side_effect=lambda r, n, p: p),
            mock.patch.object(atlas_mux.atlas_todo, "issue_owner_token", return_value="t"),
            mock.patch.object(atlas_mux.atlas_todo, "set_member_handles"),
            mock.patch.object(atlas_mux, "_tier", side_effect=lambda h, role, d, model, level: (model or "sonnet", level, "", None)),
            contextlib.redirect_stdout(out),
        ):  # fmt: skip
            rc = atlas_mux._spawn_registered(args, self.case.home, None)
        return rc, captured.get("pane", ""), out.getvalue()


class LoopbackAndProxyTests(Base):
    def test_only_plain_loopback_http_is_loopback(self):
        yes = ("http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434", "https://localhost", "http://127.0.0.1")
        no = (
            "http://evil.com\\@127.0.0.1:11434",
            "http://evil.com\\127.0.0.1",
            "http://user:pw@127.0.0.1:11434",
            "http://127.0.0.1@evil.com",
            "ftp://127.0.0.1:11434",
            "//127.0.0.1:11434",
            "127.0.0.1:11434",
            "file:///etc/passwd",
            "http://127.0.0.2:11434",
            "http://127.0.0.1.evil.com",
            "http://localhost.evil.com",
            "http://127.0.0.1:99999",
            "http://127.0.0.1:11434\n",
            "",
        )
        for u in yes:
            self.assertTrue(P.is_loopback(u), u)
        for u in no:
            self.assertFalse(P.is_loopback(u), u)

    def test_a_backslash_url_is_refused_by_resolve_without_the_opt_in(self):
        self.env(ATLAS_WORKER_PROVIDER="ollama", ATLAS_OLLAMA_MODEL="m:1b", ATLAS_OLLAMA_URL="http://evil.com\\@127.0.0.1:11434")
        self.assertEqual(P.resolve("implementer", None, None)["fallback"], "remote_refused")

    def test_loopback_calls_ignore_the_http_proxy(self):
        import socket
        import urllib.request

        hits = []
        lsock = socket.socket()
        lsock.bind(("127.0.0.1", 0))
        lsock.listen(5)

        def serve():
            while True:
                try:
                    c, _ = lsock.accept()
                except OSError:
                    return
                hits.append(1)
                c.sendall(b"HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\n\r\n")
                c.close()

        threading.Thread(target=serve, daemon=True).start()
        self.addCleanup(lsock.close)
        st = self.stub()
        proxy = f"http://127.0.0.1:{lsock.getsockname()[1]}"
        env = {k: v for k, v in os.environ.items() if k.lower() not in ("no_proxy", "http_proxy")}
        with mock.patch.dict(os.environ, {**env, "http_proxy": proxy, "HTTP_PROXY": proxy}, clear=True):
            urllib.request._opener = None  # a cached global opener would hide the proxy
            h = P.health(st.url, "qwen3:8b", use_cache=False)
        urllib.request._opener = None
        self.assertTrue(h["ok"], h)
        self.assertEqual(hits, [], "a loopback call went through the proxy")
        self.assertTrue(st.requests)


class RuntimeFailoverTests(Base):
    """P1: an Ollama worker whose endpoint dies mid-run is relaunched once on Claude, and the record says why."""

    FAKE = """#!/bin/sh
echo "base=$ANTHROPIC_BASE_URL bedrock=$CLAUDE_CODE_USE_BEDROCK args=$(echo "$*" | tr '\\n' ' ')" >> "$FAKE_DIR/calls"
if [ -n "$ANTHROPIC_BASE_URL" ]; then
  %s
else
  echo '{"type":"result","is_error":false,"result":"ok"}'
fi
"""
    RETRIES = (
        "i=1; while [ $i -le 6 ]; do echo '{\"type\":\"system\",\"subtype\":\"api_retry\",\"attempt\":'$i',"
        "\"max_retries\":300,\"retry_delay_ms\":1,\"error_status\":%s,\"error\":\"x\"}'; i=$((i+1)); done; exec sleep 60"
    )

    def setUp(self):
        super().setUp()
        self.tmp = Path(self.home)
        self.rundir = self.tmp / "run"
        for d in ("prompts", "sid", "provider", "logs", "irc"):
            (self.rundir / d).mkdir(parents=True)
        (self.rundir / "prompts" / "a.md").write_text("P")
        plan = {"workers": [{"name": "a", "owns": ["a.py"], "task": "t", "check": "true", "model": "sonnet"}]}
        (self.rundir / "run.json").write_text(
            json.dumps({"plan": plan, "root": str(self.tmp), "run_id": "crew-t", "settings": "/s.json", "model": "sonnet"})
        )
        (self.rundir / "provider" / "a.json").write_text(
            json.dumps({"provider": "ollama", "model": "qwen3:8b", "fallback": None, "requested": "ollama", "url": closed_port_url()})
        )
        self.fake_dir = self.tmp / "fake"
        (self.fake_dir / "bin").mkdir(parents=True)

    def run_worker(self, body, limit="3"):
        claude = self.fake_dir / "bin" / "claude"
        claude.write_text(self.FAKE % body)
        claude.chmod(0o755)
        env = {
            "PATH": f"{claude.parent}{os.pathsep}{os.environ['PATH']}",
            "FAKE_DIR": str(self.fake_dir),
            "ATLAS_OLLAMA_RETRY_LIMIT": limit,
            "CLAUDE_CODE_USE_BEDROCK": "1",
        }
        args = argparse.Namespace(rundir=str(self.rundir), name="a", round=0, no_hold=True, delay=0, nice=0)
        t0 = time.time()
        with mock.patch.dict(os.environ, env), contextlib.redirect_stdout(io.StringIO()):
            code = atlas_crew.cmd_worker(args)
        calls = (self.fake_dir / "calls").read_text().splitlines()
        rec = json.loads((self.rundir / "provider" / "a.json").read_text())
        exit_rec = json.loads((self.rundir / "exit" / "a.r0.json").read_text())
        return code, calls, rec, exit_rec, time.time() - t0

    def test_a_dead_endpoint_is_failed_over_to_claude_once(self):
        keys = []
        with mock.patch("atlas_analytics.record", side_effect=keys.append):
            code, calls, rec, exit_rec, took = self.run_worker(self.RETRIES % "null")
        self.assertEqual((code, exit_rec["exit"]), (0, 0))
        self.assertEqual(len(calls), 2, calls)
        self.assertIn("base=http://127.0.0.1:", calls[0])
        self.assertTrue(calls[1].startswith("base= bedrock=1"), calls[1])
        self.assertIn("--model sonnet", calls[1], "the relaunch uses the plan's Claude model")
        self.assertNotIn("qwen3:8b", calls[1])
        self.assertEqual((rec["provider"], rec["fallback"], rec["failed_model"]), ("claude", "runtime_down", "qwen3:8b"))
        self.assertIn("provider.ollama.fallback.runtime_down", keys)
        self.assertLess(took, 30, "the worker is not left retrying for the CLI's 300 attempts")
        self.assertTrue((self.rundir / "logs" / "a.ollama.log").is_file(), "the Ollama attempt's log is kept")
        self.assertIn("api_retry", (self.rundir / "logs" / "a.ollama.log").read_text())

    def test_server_errors_are_runtime_5xx(self):
        code, calls, rec, exit_rec, _ = self.run_worker(self.RETRIES % "500")
        self.assertEqual((exit_rec["exit"], rec["fallback"], len(calls)), (0, "runtime_5xx", 2))

    def test_a_model_not_found_result_is_runtime_model_missing(self):
        body = (
            "echo '{\"type\":\"result\",\"is_error\":true,\"api_error_status\":404,\"api_error_type\":\"not_found_error\","
            "\"result\":\"There is an issue with the selected model\"}'; exit 1"
        )
        code, calls, rec, exit_rec, _ = self.run_worker(body)
        self.assertEqual((exit_rec["exit"], rec["fallback"], len(calls)), (0, "runtime_model_missing", 2))

    def test_an_ordinary_failure_is_not_failed_over(self):
        body = "echo '{\"type\":\"result\",\"is_error\":true,\"api_error_status\":400,\"result\":\"bad request\"}'; exit 1"
        code, calls, rec, exit_rec, _ = self.run_worker(body)
        self.assertEqual((exit_rec["exit"], rec["provider"], len(calls)), (1, "ollama", 1))

    def test_a_failure_after_the_failover_is_not_retried_again(self):
        self.FAKE = self.FAKE.replace("else\n  echo '{\"type\":\"result\",\"is_error\":false,\"result\":\"ok\"}'", "else\n  exit 3")
        code, calls, rec, exit_rec, _ = self.run_worker(self.RETRIES % "null")
        self.assertEqual((exit_rec["exit"], len(calls)), (3, 2))

    def test_the_summary_shows_the_runtime_fallback(self):
        self.run_worker(self.RETRIES % "null")
        (self.rundir / "exit").mkdir(exist_ok=True)
        meta = {"run_id": "run", "started": time.time() - 5, "plan": {"workers": [{"name": "a", "owns": ["a.py"]}], "check": "true"}}
        with (
            mock.patch.object(atlas_crew.atlas_irc, "history", return_value=[]),
            mock.patch.object(atlas_crew.atlas_irc, "has_done", return_value=True),
        ):
            out = atlas_crew.summarize(self.rundir, meta, [], 0, "")
        row = out["workers"][0]
        self.assertEqual((row["provider"], row["fallback"]), ("claude", "runtime_down"))
        self.assertNotIn("local", row)

    def test_runtime_error_kind_reads_the_real_cli_event_shapes(self):
        k = P.runtime_error_kind
        self.assertEqual(k({"type": "system", "subtype": "api_retry", "attempt": 3, "error_status": None}), "down")
        self.assertEqual(k({"type": "system", "subtype": "api_retry", "attempt": 3, "error_status": 503}), "5xx")
        self.assertIsNone(k({"type": "system", "subtype": "api_retry", "attempt": 3, "error_status": 429}))
        self.assertEqual(k({"type": "result", "is_error": True, "api_error_status": 404}), "model_missing")
        self.assertEqual(k({"type": "result", "is_error": True, "api_error_status": 502}), "5xx")
        self.assertIsNone(k({"type": "result", "is_error": False, "api_error_status": 500}))
        self.assertIsNone(k({"type": "assistant"}))
        self.assertEqual(P.retry_limit(), 3)
        os.environ["ATLAS_OLLAMA_RETRY_LIMIT"] = "5"
        self.assertEqual(P.retry_limit(), 5)



@unittest.skipUnless(shutil.which("claude"), "claude CLI not on PATH")
class BenchTests(Base):
    """The bench harness on recorded fake runs: math, table, refusal on an unhealthy stub, fallback exclusion."""

    def fake(self, wall, tin=100, tout=50, cost=0.1, fallback=None, provider=None, ok=True):
        def runner(spec, root, plan_path, timeout):
            self.roots.append(root)
            self.stubs_seen.append(Path(root, "slug.py").read_text())
            plan = json.loads(Path(plan_path).read_text())
            self.plans.append(plan)
            w = wall.pop(0) if isinstance(wall, list) else wall
            return {
                "ok": ok, "wall_s": w, "tokens_in": tin, "tokens_out": tout, "tokens_cache_read": 7, "cost_usd": cost,
                "workers": [{"provider": provider or spec["provider"], "model": spec["model"],
                             "fallback": fallback.pop(0) if isinstance(fallback, list) else fallback}],
            }  # fmt: skip

        return runner

    def setUp(self):
        super().setUp()
        self.roots, self.stubs_seen, self.plans = [], [], []

    def args(self, models, runs=3, out=None):
        return argparse.Namespace(models=models, runs=runs, task=None, check=None, timeout=60, out=out)

    def run_bench(self, args, runner, checker=lambda root, check: True):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = P.cmd_bench(args, runner=runner, checker=checker)
        return rc, out.getvalue(), err.getvalue()

    def test_parse_models(self):
        self.assertEqual(P.parse_models("claude:sonnet, ollama:qwen3:8b"), [("claude", "sonnet"), ("ollama", "qwen3:8b")])
        for bad in ("", "gpt:x", "claude", "ollama:", "claude:a b"):
            with self.assertRaises(ValueError):
                P.parse_models(bad)

    def test_aggregate_math_cold_warm_and_fallback_exclusion(self):
        def r(prov, run, wall, **kw):
            return {"provider": prov, "model": "m", "run": run, "phase": "cold" if run == 1 else "warm", "wall_s": wall,
                    "tokens_in": 100, "tokens_out": 40, "tokens_cache_read": 10, "cost_usd": kw.get("cost", 0.2),
                    "pass": kw.get("ok", True), "fallback": kw.get("fb")}  # fmt: skip

        runs = [r("claude", 1, 12.0, cost=0.30), r("claude", 2, 8.0), r("claude", 3, 6.0, cost=0.10, ok=False),
                r("ollama", 1, 40.0, cost=0.0), r("ollama", 2, 99.0, cost=0.0, fb="down"), r("ollama", 3, 20.0, cost=0.0)]  # fmt: skip
        rows = {(x["provider"], x["phase"]): x for x in P.aggregate(runs)}
        c = rows[("claude", "warm")]
        self.assertEqual((c["n"], c["excluded"], c["wall_mean_s"], c["wall_min_s"], c["wall_max_s"], c["passed"]), (2, 0, 7.0, 6.0, 8.0, 1))
        self.assertAlmostEqual(c["cost_usd"], 0.15)
        self.assertEqual(rows[("claude", "cold")]["wall_mean_s"], 12.0)
        o = rows[("ollama", "warm")]
        self.assertEqual((o["n"], o["excluded"], o["wall_mean_s"]), (1, 1, 20.0))  # the 99 s fallback run is not in it
        self.assertEqual(rows[("ollama", "cold")]["wall_mean_s"], 40.0)
        table = P.render_table(list(rows.values()))
        self.assertTrue(table.isascii())
        self.assertIn("| claude:m | warm | 2 | 0 | 7.0 | 6.0-8.0 | 100 | 40 | 10 | 0.1500 | 1/2 |", table)
        self.assertIn("| ollama:m | warm | 1 | 1 | 20.0 | 20.0-20.0 | 100 | 40 | 10 | 0.0000 | 1/1 |", table)

    def test_unknown_claude_cost_is_n_a_in_the_table_and_null_in_the_rows(self):
        def r(prov, run, cost):
            return {"provider": prov, "model": "m", "run": run, "phase": "cold" if run == 1 else "warm", "wall_s": 5.0,
                    "tokens_in": 1, "tokens_out": 1, "tokens_cache_read": 1, "cost_usd": cost, "pass": True, "fallback": None}  # fmt: skip

        rows = {x["provider"]: x for x in P.aggregate([r("claude", 2, None), r("ollama", 2, 0.0)])}
        self.assertIsNone(rows["claude"]["cost_usd"])
        self.assertEqual(rows["ollama"]["cost_usd"], 0.0)
        table = P.render_table(list(rows.values()))
        self.assertIn("| claude:m | warm | 1 | 0 | 5.0 | 5.0-5.0 | 1 | 1 | 1 | n/a | 1/1 |", table)
        self.assertIn("| ollama:m | warm | 1 | 0 | 5.0 | 5.0-5.0 | 1 | 1 | 1 | 0.0000 | 1/1 |", table)

    def test_crew_runner_cost_is_none_when_the_summary_says_incomplete(self):
        self.assertIsNone(P._summary_cost({"cost_usd": None, "cost_complete": False}))
        self.assertEqual(P._summary_cost({"cost_usd": 0.25, "cost_complete": True}), 0.25)
        self.assertEqual(P._summary_cost({"cost_usd": 0.25}), 0.25)

    def test_unhealthy_ollama_refuses_with_exit_2_and_runs_nothing(self):
        for st_kw, url in (({"models": ["other:1b"]}, None), ({}, closed_port_url())):
            st = self.stub(**st_kw)
            self.env(ATLAS_OLLAMA_URL=url or st.url)
            rc, out, err = self.run_bench(self.args("claude:sonnet,ollama:qwen3:8b"), self.fake(1.0))
            self.assertEqual(rc, 2)
            self.assertIn("not healthy", err)
            self.assertIn("ollama pull qwen3:8b", err)
            self.assertFalse(json.loads(out)["ok"])
            self.assertEqual(self.roots, [])  # no run, no fallback benchmarked

    def test_remote_url_is_refused_without_opt_in(self):
        self.env(ATLAS_OLLAMA_URL="http://192.0.2.1:11434")
        rc, _, err = self.run_bench(self.args("ollama:qwen3:8b"), self.fake(1.0))
        self.assertEqual(rc, 2)
        self.assertIn("remote_refused", err)

    def test_healthy_run_fresh_repo_per_run_json_and_zero_local_cost(self):
        st = self.stub()
        self.env(ATLAS_OLLAMA_URL=st.url)
        out_path = Path(self.home, "bench.json")
        runner = self.fake([10.0, 8.0, 6.0, 30.0, 20.0, 18.0], cost=0.25)
        rc, out, _ = self.run_bench(self.args("claude:sonnet,ollama:qwen3:8b", out=str(out_path)), runner)
        self.assertEqual(rc, 0)
        self.assertEqual(len(set(self.roots)), 6)  # a fresh temp repo per run
        self.assertTrue(all("NotImplementedError" in x for x in self.stubs_seen))
        self.assertTrue(all(not Path(x).exists() for x in self.roots))  # cleaned up
        self.assertTrue(all(pl["workers"][0]["owns"] == ["slug.py"] and len(pl["workers"]) == 1 for pl in self.plans))
        rep = json.loads(out_path.read_text())
        phases = [(r["provider"], r["phase"]) for r in rep["runs"]]
        self.assertEqual(phases.count(("claude", "cold")), 1)
        self.assertEqual(phases.count(("ollama", "warm")), 2)
        self.assertTrue(all(r["cost_usd"] == 0.0 for r in rep["runs"] if r["provider"] == "ollama"))
        self.assertTrue(all(r["cost_usd"] == 0.25 for r in rep["runs"] if r["provider"] == "claude"))
        self.assertIn("| ollama:qwen3:8b | cold | 1 | 0 | 30.0 |", out)

    def test_fallback_run_is_marked_and_excluded_from_the_ollama_column(self):
        st = self.stub()
        self.env(ATLAS_OLLAMA_URL=st.url)
        out_path = Path(self.home, "bench.json")
        runner = self.fake([30.0, 5.0, 20.0], fallback=[None, "down", None])
        rc, out, _ = self.run_bench(self.args("ollama:qwen3:8b", out=str(out_path)), runner)
        self.assertEqual(rc, 0)
        rep = json.loads(out_path.read_text())
        self.assertEqual([r["fallback"] for r in rep["runs"]], [None, "down", None])
        warm = [x for x in rep["summary"] if x["phase"] == "warm"][0]
        self.assertEqual((warm["n"], warm["excluded"], warm["wall_mean_s"]), (1, 1, 20.0))

    def test_provider_mismatch_counts_as_fallback_and_failed_check_is_a_fail(self):
        st = self.stub()
        self.env(ATLAS_OLLAMA_URL=st.url)
        out_path = Path(self.home, "bench.json")
        rc, _, _ = self.run_bench(self.args("ollama:qwen3:8b", runs=1, out=str(out_path)), self.fake(9.0, provider="claude"))
        rep = json.loads(out_path.read_text())
        self.assertEqual(rep["runs"][0]["fallback"], "provider_mismatch")
        rc, _, _ = self.run_bench(self.args("ollama:qwen3:8b", runs=1, out=str(out_path)), self.fake(9.0), checker=lambda r, c: False)
        rep = json.loads(out_path.read_text())
        self.assertEqual((rep["runs"][0]["pass"], rep["summary"][0]["passed"]), (False, 0))

    def test_main_bench_unhealthy_exit_2(self):
        self.env(ATLAS_OLLAMA_URL=closed_port_url())
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            rc = P.main(["bench", "--models", "ollama:qwen3:8b"])
        self.assertEqual(rc, 2)
        self.assertIn("not healthy", err.getvalue())


@unittest.skipUnless(shutil.which("claude"), "claude CLI not on PATH")
class RealCliWiringTests(Base):
    def test_claude_p_reaches_the_stub_with_the_resolved_env(self):
        st = self.stub(models=("stub-model",))
        self.env(ATLAS_OLLAMA_URL=st.url)
        res = P.resolve("implementer", "stub-model", "ollama")
        self.assertEqual(res["provider"], "ollama", res)
        cfg = Path(self.home) / "claude-cfg"
        cwd = Path(self.home) / "cwd"
        cfg.mkdir()
        cwd.mkdir()
        env = P.apply_env(
            {
                k: v
                for k, v in os.environ.items()
                if not k.startswith(("CLAUDE", "ANTHROPIC"))
            }
            | {"CLAUDE_CONFIG_DIR": str(cfg)},
            res,
        )
        env["CLAUDE_CODE_OAUTH_TOKEN"] = "must-not-be-used"
        env = P.apply_env(env, res)
        before = len(st.posts())
        proc = subprocess.run(
            ["claude", "-p", "--model", res["model"], "say ok"],
            env=env,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=120,
        )
        posts = st.posts()[before:]
        report = f"rc={proc.returncode}\nstdout={proc.stdout[-400:]}\nstderr={proc.stderr[-400:]}\nrequests={[(m, p) for m, p, _ in st.requests]}"
        self.assertTrue(posts, "the stub got no POST /v1/messages\n" + report)
        self.assertTrue(
            any(b and b.get("model") == "stub-model" for _, _, b in posts), report
        )
        self.assertIn(STUB_TEXT, proc.stdout, report)


class StateIsolationTests(unittest.TestCase):
    """The health cache must never be the real ~/.atlas/provider-health.json."""

    def test_health_cache_is_not_under_the_real_home(self):
        real = os.path.realpath(os.path.join(os.environ["_ATLAS_TEST_REAL_HOME"], ".atlas"))
        self.assertFalse(os.path.realpath(str(P._cache_path())).startswith(real + os.sep))


if __name__ == "__main__":
    unittest.main()
