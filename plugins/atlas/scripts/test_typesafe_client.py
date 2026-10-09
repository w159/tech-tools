import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import io
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import typesafe_client  # noqa: E402

KEY = "tsk-test-secret-0123456789"


class _Resp:
    def __init__(self, payload):
        self._b = json.dumps(payload).encode()

    def read(self):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _http_error(code, headers=None):
    return urllib.error.HTTPError(
        "https://x/v1/systemone",
        code,
        "err",
        headers or {},
        io.BytesIO(b'{"detail":"nope"}'),
    )


class ClientTests(unittest.TestCase):
    def setUp(self):
        p = mock.patch.dict(os.environ, {"TYPESAFE_API_KEY": KEY}, clear=False)
        p.start()
        self.addCleanup(p.stop)
        os.environ.pop("ATLAS_TYPESAFE_SCORING", None)
        os.environ.pop("ATLAS_TYPESAFE_URL", None)
        sl = mock.patch.object(typesafe_client.time, "sleep")
        self.sleep = sl.start()
        self.addCleanup(sl.stop)

    def test_available_respects_key_and_off_switch(self):
        self.assertTrue(typesafe_client.available())
        with mock.patch.dict(os.environ, {"ATLAS_TYPESAFE_SCORING": "off"}):
            self.assertFalse(typesafe_client.available())
        with mock.patch.dict(os.environ, {"TYPESAFE_API_KEY": ""}):
            os.environ.pop("ATLAS_TYPESAFE_URL", None)
            self.assertFalse(typesafe_client.available())

    def test_loopback_available_without_key_and_sends_no_auth(self):
        calls = []

        def fake(req, timeout=None, **kw):
            calls.append(req)
            return _Resp({"answers": {}})

        with mock.patch.dict(
            os.environ,
            {
                "TYPESAFE_API_KEY": "",
                "ATLAS_TYPESAFE_URL": "http://127.0.0.1:11434",
                "ATLAS_TYPESAFE_MODEL": "nimble",
            },
        ):
            self.assertTrue(typesafe_client.available())
            with mock.patch.object(typesafe_client.urllib.request, "urlopen", fake):
                typesafe_client.evaluate({"reply": "done"}, {"q": {"type": "noul"}})
        self.assertIsNone(calls[0].get_header("Authorization"))
        self.assertEqual(json.loads(calls[0].data)["model"], "nimble")
        self.assertTrue(calls[0].full_url.startswith("http://127.0.0.1:11434/"))

    def test_retries_429_then_succeeds(self):
        calls = []

        def fake(req, timeout=None, **kw):
            calls.append(req)
            if len(calls) == 1:
                raise _http_error(429, {"retry-after": "2"})
            return _Resp({"answers": {}})

        with mock.patch.object(typesafe_client.urllib.request, "urlopen", fake):
            out = typesafe_client.evaluate("s", {"q": {"type": "noul"}})
        self.assertEqual(out, {"answers": {}})
        self.assertEqual(len(calls), 2)
        self.sleep.assert_called_once_with(2.0)
        self.assertEqual(calls[0].get_header("Authorization"), f"Bearer {KEY}")
        self.assertEqual(json.loads(calls[0].data)["model"], "jev-latest")

    def test_error_text_never_contains_key(self):
        def fake(req, timeout=None, **kw):
            raise _http_error(401)

        with mock.patch.object(typesafe_client.urllib.request, "urlopen", fake):
            with self.assertRaises(typesafe_client.TypeSafeError) as cm:
                typesafe_client.evaluate("s", {})
        self.assertEqual(cm.exception.status, 401)
        self.assertNotIn(KEY, str(cm.exception))
        self.assertIn("TYPESAFE_API_KEY", str(cm.exception))

    def test_url_error_redacts_key(self):
        def fake(req, timeout=None, **kw):
            raise urllib.error.URLError(f"boom {KEY}")

        with mock.patch.object(typesafe_client.urllib.request, "urlopen", fake):
            with self.assertRaises(typesafe_client.TypeSafeError) as cm:
                typesafe_client.evaluate("s", {})
        self.assertNotIn(KEY, str(cm.exception))
        self.assertIn("ATLAS_TYPESAFE_URL", str(cm.exception))

    def test_gives_up_after_three_retries(self):
        n = []

        def fake(req, timeout=None, **kw):
            n.append(1)
            raise _http_error(529)

        with mock.patch.object(typesafe_client.urllib.request, "urlopen", fake):
            with self.assertRaises(typesafe_client.TypeSafeError) as cm:
                typesafe_client.evaluate("s", {})
        self.assertEqual(cm.exception.status, 529)
        self.assertEqual(len(n), 4)

    def test_tls_context_uses_certifi_bundle_only_when_importable(self):
        import ssl
        import types

        fake_certifi = types.SimpleNamespace(where=lambda: "/nonexistent/cacert.pem")
        with mock.patch.dict(sys.modules, {"certifi": fake_certifi}):
            with mock.patch.object(ssl, "create_default_context") as ctx:
                self.assertEqual(
                    typesafe_client._tls_kwargs(), {"context": ctx.return_value}
                )
                ctx.assert_called_once_with(cafile="/nonexistent/cacert.pem")
        with mock.patch.dict(sys.modules, {"certifi": None}):  # ImportError
            self.assertEqual(typesafe_client._tls_kwargs(), {})  # system default


if __name__ == "__main__":
    unittest.main()
