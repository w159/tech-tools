#!/usr/bin/env python3
"""Tests for the dashboard control plane: behavior knobs, MCP and plugin writes."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent


def _load():
    path = SCRIPTS / "atlas_control.py"
    spec = importlib.util.spec_from_file_location("atlas_control", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ControlTestCase(unittest.TestCase):
    """Redirects every write target into a temp directory."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.settings = root / "settings.json"
        self.claude_json = root / ".claude.json"
        self.settings.write_text("{}", encoding="utf-8")
        self.claude_json.write_text("{}", encoding="utf-8")
        patches = [
            mock.patch.object(self.mod, "SETTINGS_PATH", self.settings),
            mock.patch.object(self.mod, "CLAUDE_JSON_PATH", self.claude_json),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def read_settings(self):
        return json.loads(self.settings.read_text(encoding="utf-8"))


class TestBehaviorKnobs(ControlTestCase):
    def test_discovery_finds_a_known_var_with_evidence(self):
        found = self.mod.discovered_env_keys()
        self.assertIn("ATLAS_GATE", found)
        self.assertRegex(found["ATLAS_GATE"], r"^hooks/\w+\.py:\d+$")

    def test_every_curated_knob_is_read_by_shipped_code(self):
        """A knob nobody reads is a control that silently does nothing."""
        found = set(self.mod.discovered_env_keys())
        stale = [k["key"] for k in self.mod.BEHAVIOR_KNOBS if k["key"] not in found]
        self.assertEqual(stale, [], f"curated knobs no shipped file reads: {stale}")

    def test_write_then_read_back_reports_settings_as_the_source(self):
        res = self.mod.write_behavior_updates({"ATLAS_TRIPWIRE_THRESHOLD": "9"})
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.read_settings()["env"]["ATLAS_TRIPWIRE_THRESHOLD"], "9")
        knob = self._find_knob("ATLAS_TRIPWIRE_THRESHOLD")
        self.assertEqual(knob["value"], "9")
        self.assertEqual(knob["source"], "settings")

    def test_empty_value_clears_the_override(self):
        self.mod.write_behavior_updates({"ATLAS_TRIPWIRE_THRESHOLD": "9"})
        res = self.mod.write_behavior_updates({"ATLAS_TRIPWIRE_THRESHOLD": ""})
        self.assertTrue(res["ok"], res)
        self.assertNotIn(
            "ATLAS_TRIPWIRE_THRESHOLD", self.read_settings().get("env", {})
        )
        self.assertEqual(res["cleared"], ["ATLAS_TRIPWIRE_THRESHOLD"])

    def test_rejects_keys_outside_the_atlas_namespace(self):
        for key in ("PATH", "OPENAI_API_KEY", "atlas_gate", "ATLAS_NOT_A_REAL_KNOB"):
            res = self.mod.write_behavior_updates({key: "x"})
            self.assertFalse(res["ok"], key)
            self.assertEqual(res["error"], "keys_not_allowlisted")
        self.assertEqual(self.read_settings(), {})

    def test_a_rejected_key_blocks_the_whole_batch(self):
        res = self.mod.write_behavior_updates({"ATLAS_GATE": "off", "PATH": "/evil"})
        self.assertFalse(res["ok"])
        self.assertEqual(self.read_settings(), {})

    def test_newlines_are_stripped_from_values(self):
        self.mod.write_behavior_updates({"ATLAS_OPTIMIZE_CMD": "echo hi\nrm -rf /"})
        self.assertEqual(
            self.read_settings()["env"]["ATLAS_OPTIMIZE_CMD"], "echo hirm -rf /"
        )

    def test_existing_env_entries_survive_a_write(self):
        self.settings.write_text(
            json.dumps({"env": {"OTHER": "keep"}}), encoding="utf-8"
        )
        self.mod.write_behavior_updates({"ATLAS_GATE": "off"})
        env = self.read_settings()["env"]
        self.assertEqual(env["OTHER"], "keep")
        self.assertEqual(env["ATLAS_GATE"], "off")

    def _find_knob(self, key):
        for group in self.mod.behavior_state()["groups"]:
            for knob in group["knobs"]:
                if knob["key"] == key:
                    return knob
        self.fail(f"{key} not in any behavior group")


class TestMcpServers(ControlTestCase):
    def test_toggle_writes_the_disabled_list(self):
        name = self.mod.mcp_inventory()["servers"][0]["name"]
        self.assertTrue(self.mod.set_mcp_enabled(name, False)["ok"])
        self.assertIn(name, self.read_settings()["disabledMcpServers"])
        self.assertTrue(self.mod.set_mcp_enabled(name, True)["ok"])
        # Re-enabling the last disabled server removes the key, not just the entry.
        self.assertNotIn("disabledMcpServers", self.read_settings())

    def test_toggle_refuses_an_unknown_server(self):
        res = self.mod.set_mcp_enabled("no-such-server", False)
        self.assertFalse(res["ok"])
        self.assertEqual(res["error"], "unknown_server")

    def test_atlas_connectors_are_discovered_under_their_qualified_names(self):
        names = {s["name"] for s in self.mod.mcp_inventory()["servers"]}
        self.assertIn("plugin:atlas:cipp", names)

    def test_add_then_remove_a_user_server(self):
        res = self.mod.add_mcp_server(
            {"name": "demo", "command": "npx", "args": "-y @scope/pkg"}
        )
        self.assertTrue(res["ok"], res)
        cfg = json.loads(self.claude_json.read_text())["mcpServers"]["demo"]
        self.assertEqual(cfg, {"command": "npx", "args": ["-y", "@scope/pkg"]})
        self.assertTrue(self.mod.remove_mcp_server("demo")["ok"])
        self.assertNotIn("demo", json.loads(self.claude_json.read_text())["mcpServers"])

    def test_add_validates_name_and_target(self):
        self.assertEqual(
            self.mod.add_mcp_server({"name": "bad name", "command": "x"})["error"],
            "invalid_name",
        )
        self.assertEqual(
            self.mod.add_mcp_server({"name": "ok"})["error"], "command_or_url_required"
        )
        self.assertEqual(
            self.mod.add_mcp_server({"name": "ok", "url": "ftp://x"})["error"],
            "invalid_url",
        )

    def test_remove_refuses_an_unknown_server(self):
        self.assertFalse(self.mod.remove_mcp_server("nope")["ok"])


class TestPlugins(ControlTestCase):
    def test_atlas_cannot_switch_itself_off(self):
        res = self.mod.set_plugin_enabled("atlas@tech-tools", False)
        self.assertFalse(res["ok"])
        self.assertEqual(res["error"], "cannot_disable_host_plugin")

    def test_toggle_refuses_an_unknown_plugin(self):
        self.assertFalse(self.mod.set_plugin_enabled("ghost@nowhere", True)["ok"])

    def test_atlas_wiring_bindings_all_point_at_files_that_exist(self):
        wiring = self.mod.atlas_wiring()
        self.assertTrue(wiring["bindings"])
        missing = [b["script"] for b in wiring["bindings"] if not b["present"]]
        self.assertEqual(missing, [], f"hooks.json binds missing programs: {missing}")
        self.assertIn("atlas-orchestrate", wiring["skills"])


class TestEnvBlock(ControlTestCase):
    def test_parses_comments_quotes_and_export_prefixes(self):
        parsed = self.mod.parse_env_block(
            """
            # a comment
            export AUVIK_USERNAME="me@example.com"
            AUVIK_API_KEY = 'abc123'
            EMPTY=
            not an assignment
            """
        )
        self.assertEqual(
            parsed, {"AUVIK_USERNAME": "me@example.com", "AUVIK_API_KEY": "abc123"}
        )

    def test_export_round_trip_never_reimports_a_marker_as_a_secret(self):
        connectors = [
            {
                "name": "auvik",
                "fields": [
                    {"env_key": "AUVIK_API_KEY", "sensitive": True, "is_set": True},
                    {"env_key": "AUVIK_REGION", "sensitive": False, "value": "us6"},
                ],
            }
        ]
        text = self.mod.env_export(connectors)
        parsed = self.mod.parse_env_block(text)
        self.assertNotIn("AUVIK_API_KEY", parsed)
        self.assertEqual(parsed["AUVIK_REGION"], "us6")


class TestConnectorTest(ControlTestCase):
    def test_rejects_a_traversal_style_name(self):
        self.assertEqual(self.mod.test_connector("../../etc")["error"], "invalid_name")

    def test_reports_a_missing_bundle_instead_of_raising(self):
        res = self.mod.test_connector("nosuchconnector")
        self.assertFalse(res["ok"])
        self.assertEqual(res["error"], "bundle_missing")

    def _fake_plugin(self):
        """A plugin root whose 'fake' connector is a node stub honouring the real preloader."""
        import shutil

        root = Path(self.tmp.name) / "plugin"
        (root / "mcp" / "_env").mkdir(parents=True)
        (root / "mcp" / "fake").mkdir()
        shutil.copy(SCRIPTS.parent / "mcp" / "_env" / "load.mjs", root / "mcp" / "_env")
        (root / "mcp" / "fake" / "server.mjs").write_text(
            """
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
const send = (id, result) => console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (m.method === 'initialize') send(m.id, { serverInfo: { name: 'fake', version: '1' } });
  if (m.method === 'tools/list') send(m.id, { tools: [{ name: 'fake_status' }] });
  if (m.method === 'tools/call') {
    const ok = Boolean(process.env.FAKE_KEY);
    const text = (ok ? 'Credentials: set' : 'Credentials: NOT CONFIGURED - set FAKE_KEY') + ' transport=' + process.env.MCP_TRANSPORT;
    setTimeout(() => send(m.id, { content: [{ type: 'text', text }] }), 150);
  }
});
""",
            encoding="utf-8",
        )
        (root / ".mcp.json").write_text(
            json.dumps(
                {
                    "mcpServers": {
                        "fake": {
                            "command": "node",
                            "args": [
                                "--import",
                                "${CLAUDE_PLUGIN_ROOT}/mcp/_env/load.mjs",
                                "${CLAUDE_PLUGIN_ROOT}/mcp/fake/server.mjs",
                            ],
                            "env": {
                                "MCP_TRANSPORT": "stdio",
                                "CFG_FAKE_KEY": "${user_config.fake_key}",
                            },
                        }
                    }
                }
            ),
            encoding="utf-8",
        )
        return root

    def test_unconfigured_and_configured_connectors_are_told_apart(self):
        root = self._fake_plugin()
        with mock.patch.object(self.mod, "PLUGIN_ROOT", root):
            home = Path(self.tmp.name) / "home"
            home.mkdir()
            env = {"HOME": str(home), "ATLAS_ENV_FILE": str(root / "none.env")}
            bare = self.mod.test_connector("fake", env=env)
            self.assertFalse(bare["ok"])
            self.assertFalse(bare["configured"])
            self.assertEqual(bare["error"], "not_configured")
            self.assertIn("FAKE_KEY", bare["status"])
            self.assertIn(
                "transport=stdio", bare["status"]
            )  # started as .mcp.json does
            saved = self.mod.test_connector("fake", env={**env, "CFG_FAKE_KEY": "k"})
            self.assertTrue(saved["ok"], saved)
            self.assertTrue(saved["configured"])  # CFG_* promoted by the preloader
            self.assertEqual(saved["tool_count"], 1)

    def test_status_tool_that_never_answers_is_not_reported_configured(self):
        root = self._fake_plugin()
        (root / "mcp" / "fake" / "server.mjs").write_text(
            "import readline from 'node:readline';"
            "readline.createInterface({input:process.stdin}).on('line',(l)=>{const m=JSON.parse(l);"
            "if(m.method==='initialize')console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{serverInfo:{name:'f'}}}));"
            "if(m.method==='tools/list')console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[]}}));});",
            encoding="utf-8",
        )
        with mock.patch.object(self.mod, "PLUGIN_ROOT", root):
            res = self.mod.test_connector("fake", timeout=3)
        self.assertIsNone(res["configured"])
        self.assertEqual(res["tool_count"], 0)


class TestWritePrivate(ControlTestCase):
    def test_new_and_existing_files_end_up_0600_and_no_temp_left(self):
        import os
        import stat

        target = Path(self.tmp.name) / "sub" / "settings.json"
        old = os.umask(0o022)
        try:
            self.mod.write_private(target, "a")
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            target.chmod(0o644)
            self.mod.write_private(target, "b")
        finally:
            os.umask(old)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        self.assertEqual(target.read_text(), "b")
        self.assertEqual([p.name for p in target.parent.iterdir()], ["settings.json"])

    def test_failed_write_keeps_the_old_file(self):
        target = Path(self.tmp.name) / "s.json"
        target.write_text("old")
        with mock.patch.object(self.mod.os, "replace", side_effect=OSError("boom")):
            with self.assertRaises(OSError):
                self.mod.write_private(target, "new")
        self.assertEqual(target.read_text(), "old")
        self.assertEqual([p.name for p in target.parent.glob("*atlas-tmp")], [])


if __name__ == "__main__":
    unittest.main()
