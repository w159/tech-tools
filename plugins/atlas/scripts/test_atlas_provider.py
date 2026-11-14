#!/usr/bin/env python3
"""atlas_provider: worker provider resolution (claude | ollama | auto), health check and cache, fallback reasons,
cross-family verifier pairing, crew and mux wiring, telemetry, and a real-CLI wiring proof against a local stub.

No real model runs here: every Ollama endpoint is a stub http.server on 127.0.0.1 that answers /api/version,
/api/tags and POST /v1/messages (one JSON message, or a minimal SSE stream when stream=true).
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
        self, models=("qwen3:8b",), messages_status=200, delay=0.0, version_status=200
    ):
        self.models, self.messages_status, self.delay, self.version_status = (
            list(models),
            messages_status,
            delay,
            version_status,
        )
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
        self.assertEqual(P.resolve("implementer", None, None)["provider"], "ollama")
        os.environ["ATLAS_OLLAMA_URL"] = closed_port_url()
        r = P.resolve("implementer", None, None)
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
            [("GET", "/api/version"), ("GET", "/api/tags"), ("POST", "/v1/messages")],
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
        (self.rundir / "logs" / "b.log").write_text(res(0.25, 40) + "\n")  # b: claude
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
            out["tokens_workers"], {"total": 160, "cost_usd": 0.25, "tokens_local": 110}
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
            {"implementer": None, "verifier": "ollama", "completeness-critic": None},
        )
        os.environ["ATLAS_ADVERSARIAL_PAIRING"] = "off"
        rec = self.team("implementer", "verifier")
        atlas_mux.assign_team_providers(rec, "claude")
        self.assertIsNone(rec["members"][1].get("provider"))

    def test_default_team_is_unchanged(self):
        rec = self.team("implementer", "verifier")
        atlas_mux.assign_team_providers(rec, "claude")
        self.assertEqual(rec, self.team("implementer", "verifier"))


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


if __name__ == "__main__":
    unittest.main()
