"""Tests for atlas_dashboard's non-loopback bind refusal.

Covers _is_loopback_host directly, and the `serve` CLI subcommand's
refusal to bind a non-loopback --host without --allow-remote.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import atlas_dashboard  # noqa: E402


class IsLoopbackHostTests(unittest.TestCase):
    def test_loopback_hosts_allowed(self):
        for host in ("127.0.0.1", "::1", "localhost"):
            with self.subTest(host=host):
                self.assertTrue(atlas_dashboard._is_loopback_host(host))

    def test_non_loopback_hosts_refused(self):
        for host in ("0.0.0.0", "192.168.1.5", "example.com"):
            with self.subTest(host=host):
                self.assertFalse(atlas_dashboard._is_loopback_host(host))


class ServeCliRefusalTests(unittest.TestCase):
    def test_serve_refuses_non_loopback_without_flag(self):
        called = []
        atlas_dashboard.serve = lambda host, port: called.append((host, port))
        try:
            rc = atlas_dashboard.main(["serve", "--host", "0.0.0.0"])
        finally:
            del atlas_dashboard.serve
        self.assertEqual(rc, 1)
        self.assertEqual(called, [])

    def test_serve_allows_non_loopback_with_flag(self):
        called = []
        real_port_open = atlas_dashboard._port_open
        atlas_dashboard._port_open = lambda host, port: False
        atlas_dashboard.serve = lambda host, port: called.append((host, port))
        try:
            rc = atlas_dashboard.main(
                ["serve", "--host", "0.0.0.0", "--port", "0", "--allow-remote"]
            )
        finally:
            del atlas_dashboard.serve
            atlas_dashboard._port_open = real_port_open
        self.assertEqual(rc, 0)
        self.assertEqual(called, [("0.0.0.0", 0)])


if __name__ == "__main__":
    unittest.main()
