#!/usr/bin/env python3
"""Command Center settings pages: integrations connectors and the project-less agent roster."""

from __future__ import annotations

import _test_isolation  # noqa: F401  (redirects ~/.atlas to a tempdir)
import unittest
from unittest import mock

import atlas_dash_insights as ins
import atlas_dash_integrations as integ


class IntegrationsConnectorsTest(unittest.TestCase):
    def test_connectors_carry_state_and_the_env_vars_each_needs(self):
        rows = [
            {
                "name": "falcon",
                "server_name": "plugin:atlas:falcon",
                "health": "unconfigured",
                "enabled": True,
                "missing_required": ["FALCON_CLIENT_ID"],
                "fields": [
                    {
                        "env_key": "FALCON_CLIENT_ID",
                        "is_set": False,
                        "sensitive": False,
                        "source": "none",
                        "value": "leak?",
                    },
                    {
                        "env_key": "FALCON_CLIENT_SECRET",
                        "is_set": True,
                        "sensitive": True,
                        "source": "env",
                    },
                ],
                "usage": {"calls": 0, "errors": 0},
            },
            {
                "name": "vanta",
                "server_name": "plugin:atlas:vanta",
                "health": "degraded",
                "enabled": True,
                "fields": [],
            },
        ]
        with (
            mock.patch.object(ins, "CONNECTOR_STATUS_PROVIDER", lambda: rows),
            mock.patch.object(
                integ.ai, "detect", return_value={"ok": True, "tools": [], "mcp": []}
            ),
        ):
            status, body = integ._integrations(None)
        self.assertEqual(status, 200)
        falcon, vanta = body["connectors"]
        self.assertEqual(
            (falcon["health"], falcon["configured"]), ("unconfigured", False)
        )
        self.assertEqual(falcon["missing_required"], ["FALCON_CLIENT_ID"])
        self.assertEqual(
            [v["env_key"] for v in falcon["env_vars"]],
            ["FALCON_CLIENT_ID", "FALCON_CLIENT_SECRET"],
        )
        self.assertNotIn(
            "value", falcon["env_vars"][0]
        )  # never echo a credential value
        self.assertTrue(vanta["configured"])  # degraded is configured but failing
        self.assertEqual(body["tools"], [])  # herdr tooling still present

    def test_missing_provider_degrades_to_an_empty_list(self):
        with mock.patch.object(ins, "CONNECTOR_STATUS_PROVIDER", None):
            self.assertEqual(integ._connectors(), [])


if __name__ == "__main__":
    unittest.main()
