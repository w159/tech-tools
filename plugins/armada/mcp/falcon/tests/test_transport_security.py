"""
Transport-security regressions for the Falcon MCP server.

- FalconClient refuses a non-https FALCON_BASE_URL: the OAuth client_id and
  client_secret are POSTed to it in plain text otherwise. Plain http stays
  allowed for loopback only (the boot harness runs a local token stub).
- main() does not call python-dotenv: load_dotenv() with no path searches
  upward from falcon_mcp/ and would load any .env in a parent directory.
"""

import os
import unittest
from unittest.mock import MagicMock, patch

import falcon_mcp.server as server_module
from falcon_mcp.client import FalconClient

CREDS = {"client_id": "test-client-id", "client_secret": "test-client-secret"}


@patch("falcon_mcp.client.APIHarnessV2")
class TestFalconBaseUrlScheme(unittest.TestCase):
    """FalconClient accepts only https (or loopback http) base URLs."""

    def test_rejects_plain_http(self, mock_apiharness):
        for url in (
            "http://x.example",
            "HTTP://api.crowdstrike.com",
            "ftp://x.example",
            "http://127.0.0.1.evil.example",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError) as ctx:
                FalconClient(base_url=url, **CREDS)
            self.assertIn("https", str(ctx.exception))
        mock_apiharness.assert_not_called()

    def test_rejects_plain_http_from_env(self, mock_apiharness):
        with (
            patch.dict(os.environ, {"FALCON_BASE_URL": "http://x.example"}),
            self.assertRaises(ValueError),
        ):
            FalconClient(**CREDS)
        mock_apiharness.assert_not_called()

    def test_error_does_not_echo_url(self, mock_apiharness):
        with self.assertRaises(ValueError) as ctx:
            FalconClient(base_url="http://user:pw@x.example", **CREDS)
        self.assertNotIn("pw", str(ctx.exception))

    def test_accepts_https_region_names_and_loopback_http(self, mock_apiharness):
        for url in (
            "https://api.crowdstrike.com",
            "https://api.us-2.crowdstrike.com/",
            "us2",
            "EU-1",
            "api.laggar.gcw.crowdstrike.com",
            "http://127.0.0.1:43211",
            "http://localhost:8080",
            "http://[::1]:9000",
        ):
            with self.subTest(url=url):
                mock_apiharness.reset_mock()
                FalconClient(base_url=url, **CREDS)
                self.assertEqual(mock_apiharness.call_args[1]["base_url"], url)


class TestServerReportsInsecureBaseUrl(unittest.TestCase):
    """An http base URL leaves the server inert with a state that names the cause."""

    @patch("falcon_mcp.client.APIHarnessV2")
    def test_status_names_invalid_base_url(self, mock_apiharness):
        server = server_module.FalconMCPServer(base_url="http://x.example", **CREDS)
        mock_apiharness.assert_not_called()
        self.assertEqual(server.mode, "inert")
        status = server.falcon_status()
        self.assertEqual(status["state"], "INVALID_BASE_URL")
        self.assertIn("https", status["message"])


class TestMainDoesNotLoadDotenv(unittest.TestCase):
    """The launcher (mcp/_env/load.py, the MCP host or the shell) owns the env."""

    def test_server_module_has_no_load_dotenv(self):
        self.assertFalse(hasattr(server_module, "load_dotenv"))

    def test_main_never_reads_a_dotenv_file(self):
        args = MagicMock(modules=[], transport="stdio")
        with (
            patch("dotenv.main.DotEnv") as mock_dotenv,
            patch("dotenv.main.find_dotenv") as mock_find,
            patch.object(server_module, "parse_args", return_value=args),
            patch.object(server_module, "FalconMCPServer") as mock_server,
        ):
            server_module.main()
        mock_server.return_value.run.assert_called_once()
        mock_dotenv.assert_not_called()
        mock_find.assert_not_called()


if __name__ == "__main__":
    unittest.main()
