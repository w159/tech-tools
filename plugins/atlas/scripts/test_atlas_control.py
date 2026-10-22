#!/usr/bin/env python3
"""Tests for the dashboard control plane: behavior knobs, MCP and plugin writes."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
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
        envp = mock.patch.dict(os.environ, {"ATLAS_HOME": str(root / "atlas-home")})
        envp.start()
        self.addCleanup(envp.stop)
        patches = [
            mock.patch.object(self.mod, "SETTINGS_PATH", self.settings),
            mock.patch.object(self.mod, "CLAUDE_JSON_PATH", self.claude_json),
            # Shell-scope layers live outside ~/.claude; redirect all three so no test touches the real files.
            mock.patch.object(self.mod, "OMP_CONFIG_PATH", root / "omp" / "config.yml"),
            mock.patch.object(self.mod, "env_sh_path", lambda: root / "home" / ".atlas" / "env.sh"),
            mock.patch.object(self.mod, "zshenv_path", lambda: root / "home" / ".zshenv"),
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
        self.assertEqual(knob["source"], "store")

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
        self.mod.write_behavior_updates(
            {"ATLAS_OPTIMIZE_CMD": "echo hi\nrm -rf /"}, confirm=True
        )
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

    def test_store_round_trip_is_atomic_private_and_removes_on_empty(self):
        self.mod.write_behavior_updates({"ATLAS_TRIPWIRE_THRESHOLD": "9"})
        path = self.mod.store_path()
        self.assertEqual(path, Path(os.environ["ATLAS_HOME"]) / "settings.json")
        data = json.loads(path.read_text())
        self.assertEqual(data["env"], {"ATLAS_TRIPWIRE_THRESHOLD": "9"})
        self.assertIn("ATLAS_TRIPWIRE_THRESHOLD", data["changed"])
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(path.parent.glob("*.atlas-tmp")), [])
        self.mod.write_behavior_updates({"ATLAS_TRIPWIRE_THRESHOLD": ""})
        self.assertEqual(json.loads(path.read_text())["env"], {})

    def test_precedence_process_then_store_then_claude_then_default(self):
        key = "ATLAS_TRIPWIRE_THRESHOLD"
        default = self._find_knob(key)["default"]
        self.assertEqual(self._find_knob(key)["source"], "default")
        self.settings.write_text(json.dumps({"env": {key: "3"}}), encoding="utf-8")
        k = self._find_knob(key)
        self.assertEqual(
            (k["value"], k["source"], k["reaches"]), ("3", "claude", ["claude"])
        )
        self.mod.write_behavior_updates({key: "5"})
        self.settings.write_text(json.dumps({"env": {key: "3"}}), encoding="utf-8")
        k = self._find_knob(key)
        self.assertEqual((k["value"], k["source"]), ("5", "store"))
        self.assertEqual(k["reaches"], ["claude", "omp"])
        self.assertEqual(
            {n: v["value"] for n, v in k["layers"].items() if v["value"] is not None},
            {"store": "5", "claude_settings": "3"},
        )
        self.assertEqual(k["default"], default)
        self.assertTrue(k["changed"])
        with mock.patch.dict(os.environ, {key: "7"}):
            k = self._find_knob(key)
            self.assertEqual((k["value"], k["source"]), ("7", "process"))

    def test_advanced_vars_get_the_same_detail(self):
        adv = self.mod.behavior_state()["advanced"]
        self.assertTrue(adv)
        for row in adv[:3]:
            for field in (
                "value",
                "source",
                "layers",
                "reaches",
                "default",
                "changed",
                "ref",
            ):
                self.assertIn(field, row)

    def test_refs_point_at_a_line_that_names_the_variable(self):
        """The 'Read at' evidence must be a real reader, not a docstring or a stale line number."""
        for key, ref in self.mod.discovered_env_keys().items():
            rel, _, line = ref.rpartition(":")
            text = (
                (self.mod.PLUGIN_ROOT / rel)
                .read_text(encoding="utf-8")
                .splitlines()[int(line) - 1]
            )
            self.assertIn(key, text, ref)
            self.assertFalse(text.lstrip().startswith(("#", "//", "*")), ref)

    def test_python_constants_and_internal_wiring_are_not_settings(self):
        found = self.mod.discovered_env_keys()
        for key in (
            "ATLAS_OUTPUT_STYLE",
            "ATLAS_PLUGIN",
            "ATLAS_TOOLING_MARKER",
            "ATLAS_HARNESS",
            "ATLAS_CLAUDE_SETTINGS",
        ):
            self.assertNotIn(key, found)

    def test_every_documented_advanced_key_is_still_read(self):
        stale = [k for k in self.mod._AD if k not in self.mod.discovered_env_keys()]
        self.assertEqual(stale, [], f"documented but no shipped file reads: {stale}")

    def test_a_stale_value_for_a_shell_knob_can_still_be_cleared(self):
        self.settings.write_text(
            json.dumps({"env": {"ATLAS_WORKER_MAX_TOKENS": "5"}}), encoding="utf-8"
        )
        res = self.mod.write_behavior_updates({"ATLAS_WORKER_MAX_TOKENS": ""})
        self.assertTrue(res["ok"], res)
        self.assertNotIn("ATLAS_WORKER_MAX_TOKENS", self.read_settings()["env"])

    def test_too_long_value_gets_its_own_error(self):
        res = self.mod.write_behavior_updates(
            {"ATLAS_OPTIMIZE_LOG": "x" * (self.mod.MAX_VALUE_LEN + 1)}
        )
        self.assertEqual(res["error"], "value_too_long")

    def test_hook_value_ignores_the_dashboards_own_environment(self):
        """Hooks never see the dashboard process env, so a saved setting's effective value must not either."""
        key = "ATLAS_TRIPWIRE_THRESHOLD"
        with mock.patch.dict(os.environ, {key: "7"}):
            k = self._find_knob(key)
            self.assertEqual((k["value"], k["source"]), ("7", "process"))
            self.assertEqual(
                (k["hook_value"], k["hook_source"]), (k["default"], "default")
            )

    def test_every_knob_explains_itself(self):
        for group in self.mod.behavior_state()["groups"]:
            self.assertTrue(group["intro"], group["id"])
            for knob in group["knobs"]:
                self.assertTrue(knob["description"].strip(), knob["key"])
                self.assertIn(knob["scope"], ("hooks", "shell"), knob["key"])
                self.assertTrue(knob["ref"], knob["key"])

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


class TestSettingsSurviveDaemonRestart(unittest.TestCase):
    """A knob set through a (test) daemon is still there after that daemon restarts."""

    PORT = 17431  # never the user's 7421

    def _serve(self, env):
        proc = subprocess.Popen(
            [
                sys.executable,
                str(SCRIPTS / "atlas_dashboard.py"),
                "serve",
                "--foreground",
                "--port",
                str(self.PORT),
            ],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.addCleanup(lambda: proc.poll() is None and proc.kill())
        base = f"http://127.0.0.1:{self.PORT}"
        for _ in range(100):
            try:
                html = urllib.request.urlopen(base + "/", timeout=1).read().decode()
                return (
                    proc,
                    base,
                    re.search(r'atlas-token" content="([^"]+)"', html).group(1),
                )
            except Exception:
                time.sleep(0.1)
        proc.kill()
        self.fail("test daemon did not come up")

    def _call(self, base, token, method, path, body=None):
        req = urllib.request.Request(
            base + path,
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"X-Atlas-Token": token, "Content-Type": "application/json"},
        )
        return json.load(urllib.request.urlopen(req, timeout=10))

    def test_knob_persists_across_restart(self):
        home = tempfile.mkdtemp(prefix="atlas-settings-restart-")
        self.addCleanup(shutil.rmtree, home, True)
        env = {
            **os.environ,
            "HOME": home,
            "ATLAS_HOME": home + "/.atlas",
            "ATLAS_DB": home + "/.atlas/atlas.db",
            "ATLAS_DASHBOARD_DB": home + "/.atlas/atlas.db",
            "ATLAS_DASHBOARD": "off",
            "ATLAS_COLONY": "off",
            "ATLAS_DASHBOARD_PORT": str(self.PORT),
            "ATLAS_CLAUDE_SETTINGS": home + "/claude-settings.json",
        }
        env.pop("ATLAS_TRIPWIRE_THRESHOLD", None)
        proc, base, tok = self._serve(env)
        res = self._call(
            base,
            tok,
            "POST",
            "/api/behavior",
            {"updates": {"ATLAS_TRIPWIRE_THRESHOLD": "11"}},
        )
        self.assertTrue(res["ok"], res)
        proc.kill()
        proc.wait()
        proc, base, tok = self._serve(env)
        state = self._call(base, tok, "GET", "/api/behavior")
        knob = next(
            k
            for g in state["groups"]
            for k in g["knobs"]
            if k["key"] == "ATLAS_TRIPWIRE_THRESHOLD"
        )
        self.assertEqual((knob["value"], knob["source"]), ("11", "store"))
        self.assertEqual(state["store_path"], home + "/.atlas/settings.json")
        self.assertTrue(Path(home, ".atlas", "settings.json").is_file())
        proc.kill()


class TestSettingsRegistry(ControlTestCase):
    """U3: knob metadata, ranges, layers, verified writes."""

    def knobs(self):
        st = self.mod.behavior_state()
        out = {k["key"]: k for g in st["groups"] for k in g["knobs"]}
        out.update({k["key"]: k for k in st["advanced"]})
        return out

    def test_every_knob_carries_kind_effect_applies_scope_and_five_layers(self):
        kinds = {"toggle", "select", "number", "text", "model", "url", "command"}
        for key, k in self.knobs().items():
            self.assertIn(k["kind"], kinds, key)
            self.assertTrue(k["effect"], key)
            self.assertIn(k["applies"], ("now", "next-session", "dashboard-restart"), key)
            self.assertIn(k["scope"], ("hooks", "shell"), key)
            self.assertEqual(
                set(k["layers"]),
                {"live_env", "store", "claude_settings", "omp_config", "shell_rc"},
                key,
            )
            for layer in k["layers"].values():
                self.assertEqual(set(layer), {"supported", "value"})

    def test_finite_sets_have_options_with_value_label_hint(self):
        k = self.knobs()
        for key in ("ATLAS_OPTIMIZE", "ATLAS_OPTIMIZE_TRIGGER"):
            self.assertEqual(k[key]["kind"], "select", key)
            for o in k[key]["options"]:
                self.assertEqual(set(o), {"value", "label", "hint"})
        self.assertEqual(
            [o["value"] for o in k["ATLAS_OPTIMIZE"]["options"]], ["off", "trigger", "always"]
        )
        self.assertEqual(k["ATLAS_OPTIMIZER_MODEL"]["kind"], "model")
        self.assertEqual(k["ATLAS_DECISION_MODEL"]["kind"], "model")
        self.assertEqual(k["ATLAS_OLLAMA_URL"]["kind"], "url")
        self.assertEqual(k["ATLAS_OPTIMIZE_CMD"]["kind"], "command")
        self.assertEqual(k["ATLAS_DASHBOARD_PORT"]["applies"], "dashboard-restart")

    def test_every_number_knob_has_a_range(self):
        for key, k in self.knobs().items():
            if k["kind"] == "number":
                self.assertEqual(set(k["range"]), {"min", "max", "step"}, key)

    def test_range_is_enforced_on_write(self):
        for bad in ("0", "51", "abc"):
            res = self.mod.write_behavior_updates({"ATLAS_TRIPWIRE_THRESHOLD": bad})
            self.assertEqual((res["ok"], res["error"]), (False, "out_of_range"), bad)
            self.assertEqual(res["status"], 400)
        self.assertEqual(self.read_settings(), {})
        self.assertTrue(self.mod.write_behavior_updates({"ATLAS_TRIPWIRE_THRESHOLD": "50"})["ok"])

    def test_select_value_must_be_an_option(self):
        res = self.mod.write_behavior_updates({"ATLAS_OPTIMIZE": "sometimes"})
        self.assertEqual(res["error"], "bad_option")
        self.assertEqual(res["options"], ["off", "trigger", "always"])

    def test_verified_write_shape_for_a_hooks_knob(self):
        res = self.mod.write_behavior_updates({"ATLAS_TRIPWIRE_THRESHOLD": "9"})
        self.assertTrue(res["ok"], res)
        self.assertEqual((res["key"], res["wanted"], res["applies"]), ("ATLAS_TRIPWIRE_THRESHOLD", "9", "next-session"))
        self.assertEqual(
            sorted((x["layer"], x["wrote"], x["got"], x["ok"]) for x in res["layers"]),
            [("claude_settings", "9", "9", True), ("store", "9", "9", True)],
        )

    def test_forced_mismatch_reports_not_ok_with_the_layer_and_value_it_has(self):
        with mock.patch.object(self.mod, "mutate_settings", lambda fn: None):
            res = self.mod.write_behavior_updates({"ATLAS_TRIPWIRE_THRESHOLD": "9"})
        self.assertFalse(res["ok"])
        bad = [x for x in res["layers"] if not x["ok"]]
        self.assertEqual([(x["layer"], x["got"]) for x in bad], [("claude_settings", "")])

    def test_shell_knob_writes_claude_omp_and_env_sh(self):
        res = self.mod.write_behavior_updates({"ATLAS_WORKER_MAX_TOKENS": "5000"})
        self.assertTrue(res["ok"], res)
        self.assertEqual(
            sorted(x["layer"] for x in res["layers"]), ["claude_settings", "omp_config", "shell_rc"]
        )
        self.assertEqual(self.read_settings()["env"]["ATLAS_WORKER_MAX_TOKENS"], "5000")
        self.assertIn('ATLAS_WORKER_MAX_TOKENS: "5000"', self.mod.omp_config_path().read_text())
        self.assertIn("export ATLAS_WORKER_MAX_TOKENS=5000", self.mod.env_sh_path().read_text())
        layers = self.knobs()["ATLAS_WORKER_MAX_TOKENS"]["layers"]
        self.assertEqual(
            [layers[n]["value"] for n in ("claude_settings", "omp_config", "shell_rc")],
            ["5000"] * 3,
        )
        self.assertFalse(layers["store"]["supported"])

    def test_env_sh_block_and_zshenv_guard_are_idempotent(self):
        zsh = self.mod.zshenv_path()
        zsh.parent.mkdir(parents=True, exist_ok=True)
        zsh.write_text("export KEEP=1\n", encoding="utf-8")
        env_sh = self.mod.env_sh_path()
        env_sh.parent.mkdir(parents=True, exist_ok=True)
        env_sh.write_text("# mine\nexport X=1\n", encoding="utf-8")
        for _ in range(2):
            self.mod.write_behavior_updates({"ATLAS_WORKER_MAX_TOKENS": "5000"})
        text = env_sh.read_text()
        self.assertEqual(text.count(self.mod.MANAGED_BEGIN), 1)
        self.assertTrue(text.startswith("# mine\nexport X=1\n"))
        zsh_text = zsh.read_text()
        self.assertEqual(zsh_text.count(self.mod.ZSHENV_LINE), 1)
        self.assertEqual(zsh_text.count(self.mod.MANAGED_BEGIN), 1)
        self.assertTrue(zsh_text.startswith("export KEEP=1\n"))
        self.mod.write_behavior_updates({"ATLAS_WORKER_MAX_TOKENS": ""})
        self.assertNotIn("ATLAS_WORKER_MAX_TOKENS", env_sh.read_text())
        self.assertTrue(env_sh.read_text().startswith("# mine"))

    def test_omp_config_edit_keeps_everything_else_and_creates_the_map(self):
        cfg = self.mod.omp_config_path()
        cfg.parent.mkdir(parents=True, exist_ok=True)
        original = "theme: dark  # keep\nmodelRoles:\n  default: x\n"
        cfg.write_text(original, encoding="utf-8")
        self.mod.write_behavior_updates({"ATLAS_WORKER_MAX_TOKENS": "5000"})
        self.assertEqual(cfg.read_text(), original + 'env:\n  ATLAS_WORKER_MAX_TOKENS: "5000"\n')
        cfg.write_text(
            "env:\n  # note\n  OTHER: \"1\"\n  ATLAS_WORKER_MAX_TOKENS: \"1\"\nafter: 1\n",
            encoding="utf-8",
        )
        self.mod.write_behavior_updates({"ATLAS_WORKER_MAX_TOKENS": "7000", "ATLAS_ADVISOR_GATE": "off"})
        self.assertEqual(
            cfg.read_text(),
            'env:\n  # note\n  OTHER: "1"\n  ATLAS_WORKER_MAX_TOKENS: "7000"\n  ATLAS_ADVISOR_GATE: "off"\nafter: 1\n',
        )
        self.assertEqual(self.mod.read_omp_env()["OTHER"], "1")

    def test_shell_path_value_must_be_absolute_and_creatable(self):
        for bad in ("relative/dir", "/proc-nope-xyz/none/deeper"):
            res = self.mod.write_behavior_updates({"ATLAS_HOME": bad})
            self.assertEqual(res["error"], "bad_path", bad)
        ok = self.mod.write_behavior_updates({"ATLAS_HOME": str(Path(self.tmp.name) / "new-home")})
        self.assertTrue(ok["ok"], ok)

    def test_optimize_cmd_needs_confirm(self):
        res = self.mod.write_behavior_updates({"ATLAS_OPTIMIZE_CMD": "my-opt {prompt}"})
        self.assertEqual((res["ok"], res["error"], res["status"]), (False, "needs_confirm", 409))
        self.assertEqual(res["command"], "my-opt {prompt}")
        self.assertEqual(self.read_settings(), {})
        done = self.mod.write_behavior_updates({"ATLAS_OPTIMIZE_CMD": "my-opt {prompt}"}, confirm=True)
        self.assertTrue(done["ok"], done)
        # clearing never needs confirmation
        self.assertTrue(self.mod.write_behavior_updates({"ATLAS_OPTIMIZE_CMD": ""})["ok"])

    def test_model_knob_is_validated_against_the_local_ollama_list(self):
        import atlas_ollama

        listing = "NAME  ID  SIZE  MODIFIED\nnimble:latest  9b953de7a533  9.5 GB  2 weeks ago\n"
        with mock.patch.object(atlas_ollama, "run", lambda argv, **kw: (0, listing, "")):
            bad = self.mod.write_behavior_updates({"ATLAS_DECISION_MODEL": "nimbel:latest"})
            self.assertEqual((bad["error"], bad["status"]), ("unknown_model", 400))
            self.assertEqual(bad["matches"], ["nimble:latest"])
            ok = self.mod.write_behavior_updates({"ATLAS_DECISION_MODEL": "nimble:latest"})
        self.assertTrue(ok["ok"], ok)
        self.assertEqual(self.read_settings()["env"]["ATLAS_DECISION_MODEL"], "nimble:latest")


if __name__ == "__main__":
    unittest.main()
