"""Credentials embedded in the configured base URL must never reach output."""

import json
import unittest
from unittest.mock import MagicMock, patch

from falcon_mcp.client import FalconClient
from falcon_mcp.common.utils import redact_url
from falcon_mcp.server import FalconMCPServer

PASSWORD = "s3cretpw"
TOKEN = "tok3nvalue"
RAW_URL = (
    f"https://svcuser:{PASSWORD}@api.crowdstrike.com:8443/falcon/v1"
    f"?token={TOKEN}&region=us-1&api_key={TOKEN}"
)


class TestRedactUrl(unittest.TestCase):
    def test_userinfo_and_sensitive_query_redacted(self):
        out = redact_url(RAW_URL)
        self.assertNotIn(PASSWORD, out)
        self.assertNotIn(TOKEN, out)
        self.assertNotIn("svcuser", out)
        self.assertTrue(out.startswith("https://***@api.crowdstrike.com:8443/falcon/v1?"))
        self.assertIn("region=us-1", out)

    def test_plain_url_unchanged(self):
        self.assertEqual(
            redact_url("https://api.crowdstrike.com"), "https://api.crowdstrike.com"
        )

    def test_region_name_and_none_unchanged(self):
        self.assertEqual(redact_url("us-2"), "us-2")
        self.assertIsNone(redact_url(None))

    def test_unparseable_value_does_not_leak(self):
        self.assertNotIn(PASSWORD, redact_url(f"https://u:{PASSWORD}@[bad"))


class TestStatusRedaction(unittest.TestCase):
    @patch.dict("os.environ", {"FALCON_CLIENT_ID": "id", "FALCON_CLIENT_SECRET": "sec"})
    @patch("falcon_mcp.server.FalconClient")
    @patch("falcon_mcp.server.FastMCP")
    def test_falcon_status_hides_credentials(self, mock_fastmcp, mock_client):
        client = MagicMock()
        client.authenticate.return_value = True
        mock_client.return_value = client
        mock_fastmcp.return_value = MagicMock()
        server = FalconMCPServer(base_url=RAW_URL)
        status = server.falcon_status()
        dumped = json.dumps(status)
        self.assertNotIn(PASSWORD, dumped)
        self.assertNotIn(TOKEN, dumped)
        self.assertIn("api.crowdstrike.com:8443/falcon/v1", status["base_url"])
        # the value handed to the client must stay untouched
        self.assertEqual(mock_client.call_args.kwargs["base_url"], RAW_URL)


class TestClientOutputRedaction(unittest.TestCase):
    @patch("falcon_mcp.client.APIHarnessV2")
    def test_hint_and_debug_log_hide_credentials(self, mock_harness):
        with self.assertLogs("falcon_mcp.client", level="DEBUG") as logs:
            client = FalconClient(base_url=RAW_URL, client_id="id", client_secret="sec")
        self.assertEqual(mock_harness.call_args.kwargs["base_url"], RAW_URL)
        self.assertNotIn(PASSWORD, "\n".join(logs.output))
        self.assertNotIn(TOKEN, "\n".join(logs.output))
        mock_harness.return_value.token_status = 0
        mock_harness.return_value.token_fail_reason = ""
        message = client.auth_failure_message()
        self.assertNotIn(PASSWORD, message)
        self.assertNotIn(TOKEN, message)


if __name__ == "__main__":
    unittest.main()
