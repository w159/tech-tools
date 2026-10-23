"""Local decision client: no network, mocked HTTP only."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(0, _iso_os.path.join(_iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import io
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import prompt_decision  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
