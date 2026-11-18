"""falcon_status must re-authenticate when the 30 minute OAuth token has expired."""

import unittest
from unittest.mock import MagicMock, patch


class TestFalconStatusTokenRefresh(unittest.TestCase):
    def _server(self, token_valid, reauth_ok, fail_msg="refresh failed"):
        from falcon_mcp.server import FalconMCPServer

        state = {"valid": token_valid}
        client = MagicMock()
        client.is_authenticated.side_effect = lambda: state["valid"]

        def authenticate():
            state["valid"] = reauth_ok
            return reauth_ok

        client.authenticate.side_effect = authenticate
        client.auth_failure_message.return_value = fail_msg
        with patch("falcon_mcp.server.FalconClient", return_value=client), patch(
            "falcon_mcp.server.registry"
        ) as reg:
            reg.get_module_names.return_value = []
            reg.get_available_modules.return_value = {}
            # Start valid so construction succeeds; then simulate expiry.
            state["valid"] = True
            client.authenticate.side_effect = None
            client.authenticate.return_value = True
            server = FalconMCPServer(client_id="id", client_secret="secret")
        client.authenticate.reset_mock()
        client.authenticate.side_effect = authenticate
        state["valid"] = token_valid
        return server, client

    def test_stale_token_reauthenticates_once(self):
        server, client = self._server(token_valid=False, reauth_ok=True)
        status = server.falcon_status()
        self.assertEqual(status["state"], "OK")
        self.assertTrue(status["authenticated"])
        client.authenticate.assert_called_once()

    def test_failed_reauth_reports_auth_failed(self):
        server, client = self._server(False, False, "bad creds")
        status = server.falcon_status()
        self.assertEqual(status["state"], "AUTH_FAILED")
        self.assertFalse(status["authenticated"])
        self.assertEqual(status["message"], "bad creds")
        client.authenticate.assert_called_once()

    def test_valid_token_does_not_reauthenticate(self):
        server, client = self._server(token_valid=True, reauth_ok=True)
        self.assertEqual(server.falcon_status()["state"], "OK")
        client.authenticate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
