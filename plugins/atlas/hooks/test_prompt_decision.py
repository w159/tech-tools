"""Local decision client: no network, mocked HTTP only."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(0, _iso_os.path.join(_iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import prompt_decision  # noqa: E402
from _decision_stub import StubDecisionServer, choice, free_port, noul  # noqa: E402


class _Resp:
    def __init__(self, payload):
        self._b = json.dumps(payload).encode()

    def read(self):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class DecisionTests(unittest.TestCase):
    def test_off_skips_http(self):
        with mock.patch.dict(os.environ, {"ATLAS_DECISION": "off"}, clear=False):
            os.environ.pop("ATLAS_DECISION_URL", None)
            with mock.patch.object(prompt_decision.urllib.request, "urlopen") as op:
                self.assertIsNone(prompt_decision.local_decision("explain the gate"))
        op.assert_not_called()

    def test_posts_string_criteria_without_auth(self):
        captured = {}

        def fake(req, timeout=None):
            captured["req"] = req
            captured["timeout"] = timeout
            return _Resp(
                {
                    "answers": {
                        "prompt_class": {
                            "type": "choice",
                            "choice": "conversation",
                            "confidence": 0.84,
                            "probabilities": {"conversation": 0.9},
                        }
                    }
                }
            )

        with mock.patch.dict(os.environ, {"ATLAS_DECISION": "on"}, clear=False):
            os.environ.pop("ATLAS_DECISION_URL", None)
            os.environ.pop("ATLAS_DECISION_MODEL", None)
            with mock.patch.object(prompt_decision.urllib.request, "urlopen", fake):
                verdict = prompt_decision.local_decision("add a bow to the table")
        self.assertEqual(verdict, ("conversation", 0.84))
        req = captured["req"]
        self.assertIsNone(req.get_header("Authorization"))
        self.assertEqual(captured["timeout"], prompt_decision.TIMEOUT_S)
        body = json.loads(req.data)
        self.assertEqual(body["model"], "nimble")
        criteria = body["questions"]["prompt_class"]["criteria"]
        self.assertIsInstance(criteria["conversation"], str)

    def test_full_endpoint_url_is_normalized_to_base(self):
        with mock.patch.dict(
            os.environ, {"ATLAS_DECISION_URL": "http://127.0.0.1:11434/v1/systemone/"}
        ):
            self.assertEqual(prompt_decision.decision_url(), "http://127.0.0.1:11434")

    def test_remote_url_refused_unless_allowed(self):
        env = {"ATLAS_DECISION": "on", "ATLAS_DECISION_URL": "https://example.com:8443"}
        with mock.patch.dict(os.environ, env, clear=False):
            os.environ.pop("ATLAS_DECISION_ALLOW_REMOTE", None)
            with mock.patch.object(prompt_decision.urllib.request, "urlopen") as op:
                self.assertIsNone(prompt_decision.local_decision("explain the gate"))
            op.assert_not_called()
            self.assertIsNone(prompt_decision.decision_url())
            os.environ["ATLAS_DECISION_ALLOW_REMOTE"] = "1"
            self.assertEqual(prompt_decision.decision_url(), "https://example.com:8443")

    def test_loopback_urls_allowed(self):
        for url in ("http://127.0.0.1:1", "http://127.5.5.5:9", "http://[::1]:2", "http://localhost:3"):
            with mock.patch.dict(os.environ, {"ATLAS_DECISION_URL": url}, clear=False):
                os.environ.pop("ATLAS_DECISION_ALLOW_REMOTE", None)
                self.assertEqual(prompt_decision.decision_url(), url, url)
        with mock.patch.dict(os.environ, {"ATLAS_DECISION_URL": "http://127.0.0.1.evil.com"}, clear=False):
            os.environ.pop("ATLAS_DECISION_ALLOW_REMOTE", None)
            self.assertIsNone(prompt_decision.decision_url())

    def test_unreachable_returns_none(self):
        def fake(req, timeout=None):
            raise urllib.error.URLError("refused")

        with mock.patch.dict(os.environ, {"ATLAS_DECISION": "on"}, clear=False):
            with mock.patch.object(prompt_decision.urllib.request, "urlopen", fake):
                self.assertIsNone(
                    prompt_decision.local_decision("explain the gate please")
                )

    def test_apply_verdict(self):
        self.assertTrue(prompt_decision.apply_verdict(True, None))
        self.assertFalse(prompt_decision.apply_verdict(True, ("conversation", 0.9)))
        self.assertTrue(prompt_decision.apply_verdict(True, ("conversation", 0.4)))
        self.assertTrue(
            prompt_decision.apply_verdict(
                False,
                ("investigation", 0.95),
                "explain how the completion gate decides",
            )
        )
        self.assertFalse(
            prompt_decision.apply_verdict(
                False, ("investigation", 0.99), "what does this acronym mean"
            )
        )
        self.assertFalse(prompt_decision.apply_verdict(False, ("defect", 0.9)))


def _env(url, **extra):
    env = {"ATLAS_DECISION": "on", "ATLAS_DECISION_URL": url}
    env.update(extra)
    return mock.patch.dict(os.environ, env, clear=False)


class AskTests(unittest.TestCase):
    """The generic call and the routing/verify questions, against a loopback stub (no real model)."""

    def setUp(self):
        prompt_decision.reset_cache()

    def test_ask_returns_answers_for_several_questions_in_one_request(self):
        qs = {"a": {"type": "noul", "instructions": "x"}, "b": {"type": "noul", "instructions": "y"}}
        with StubDecisionServer(lambda body: {k: noul(0.5) for k in body["questions"]}) as srv:
            with _env(srv.url):
                answers = prompt_decision.ask("state text", qs, 2.0)
        self.assertEqual(set(answers), {"a", "b"})
        self.assertEqual(len(srv.requests), 1)
        self.assertEqual(srv.requests[0]["state"], "state text")

    def test_ask_refused_connection_is_none_and_fast(self):
        import time

        with _env("http://127.0.0.1:%d" % free_port()):
            t0 = time.monotonic()
            self.assertIsNone(prompt_decision.ask("s", {"a": {"type": "noul"}}, 1.5))
        self.assertLess(time.monotonic() - t0, 0.5)

    def test_ask_refuses_remote_unless_allowed(self):
        with _env("https://example.com:8443"):
            os.environ.pop("ATLAS_DECISION_ALLOW_REMOTE", None)
            with mock.patch.object(prompt_decision.urllib.request, "urlopen") as op:
                self.assertIsNone(prompt_decision.ask("s", {"a": {"type": "noul"}}))
            op.assert_not_called()

    def test_ask_malformed_body_is_none(self):
        class Bad:
            def read(self):
                return b"[1, 2]"

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        with _env("http://127.0.0.1:9"):
            with mock.patch.object(prompt_decision.urllib.request, "urlopen", lambda *a, **k: Bad()):
                self.assertIsNone(prompt_decision.ask("s", {"a": {"type": "noul"}}))

    def test_prompt_questions_ride_one_request_with_string_criteria(self):
        def respond(body):
            return {
                "prompt_class": choice("code_change", 0.9),
                "task_class": choice("fix", 0.95),
                "effort": choice("low", 0.9),
            }

        with StubDecisionServer(respond) as srv:
            with _env(srv.url):
                self.assertEqual(prompt_decision.local_decision("fix the crash in a.py"), ("code_change", 0.9))
                routed = prompt_decision.route_choice("fix the crash in a.py")
        self.assertEqual(routed, {"task_class": "fix", "effort": "low"})
        self.assertEqual(len(srv.requests), 1, "one round trip per hook run")
        qs = srv.requests[0]["questions"]
        self.assertEqual(set(qs), {"prompt_class", "task_class", "effort"})
        self.assertEqual(set(qs["task_class"]["criteria"]), set(prompt_decision.scope_classes()))
        for q in qs.values():
            for value in q["criteria"].values():
                self.assertIsInstance(value, str)

    def test_route_choice_ignores_low_confidence_and_invalid_values(self):
        cases = [
            ({"task_class": choice("fix", 0.79), "effort": choice("high", 0.79)}, None, None),
            ({"task_class": choice("bogus", 0.99), "effort": choice("huge", 0.99)}, None, None),
            ({"task_class": choice("audit", 0.8), "effort": choice("medium", 0.8)}, "audit", "medium"),
            ({}, None, None),
        ]
        for answers, want_class, want_effort in cases:
            prompt_decision.reset_cache()
            with StubDecisionServer(lambda body, a=answers: a) as srv:
                with _env(srv.url):
                    got = prompt_decision.route_choice("p")
            self.assertEqual((got["task_class"], got["effort"]), (want_class, want_effort), answers)

    def test_verify_reply_reads_two_nouls_in_one_request(self):
        with StubDecisionServer(
            lambda body: {"asserts_success": noul(0.95), "names_observed_result": noul(0.1)}
        ) as srv:
            with _env(srv.url):
                self.assertEqual(prompt_decision.verify_reply("All fixed."), (0.95, 0.1))
        self.assertEqual(len(srv.requests), 1)
        self.assertEqual(set(srv.requests[0]["questions"]), {"asserts_success", "names_observed_result"})

    def test_verify_reply_none_when_an_answer_is_missing(self):
        with StubDecisionServer(lambda body: {"asserts_success": noul(0.9)}) as srv:
            with _env(srv.url):
                self.assertIsNone(prompt_decision.verify_reply("All fixed."))

    def test_verify_reply_times_out_inside_the_budget(self):
        import time

        with StubDecisionServer(lambda body: {}, delay=3.0) as srv:
            with _env(srv.url):
                t0 = time.monotonic()
                self.assertIsNone(prompt_decision.verify_reply("All fixed."))
                took = time.monotonic() - t0
        self.assertLess(took, prompt_decision.VERIFY_TIMEOUT_S + 0.6)


if __name__ == "__main__":
    unittest.main()
