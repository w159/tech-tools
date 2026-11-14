"""atlas_mod_gate.py: passes on the real tree, fails on each injected load fault.

The faults go into a temp copy of the plugin (hooks.json, mod/, contracts/, omp/,
types/); the real mod/ is never written. Skipped when bun is absent.
"""

import _test_isolation  # noqa: F401,E402
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ATLAS = os.path.dirname(HERE)
GATE = os.path.join(HERE, "atlas_mod_gate.py")
COPIED = (
    "hooks/hooks.json",
    "mod",
    "contracts",
    "omp",
    "types",
    "package.json",
    "bunfig.toml",
)


def _gate(root, *flags):
    p = subprocess.run(
        [sys.executable, GATE, "--root", root, *flags],
        capture_output=True,
        text=True,
        timeout=900,
    )
    return p.returncode, p.stdout + p.stderr


@unittest.skipUnless(shutil.which("bun"), "bun not installed")
class ModGateTests(unittest.TestCase):
    def _copy(self):
        tmp = tempfile.mkdtemp(prefix="mod-gate-test-")
        self.addCleanup(shutil.rmtree, tmp, True)
        dst = os.path.join(tmp, "atlas")
        for rel in COPIED:
            src = os.path.join(ATLAS, rel)
            if not os.path.exists(src):
                continue
            to = os.path.join(dst, rel)
            os.makedirs(os.path.dirname(to), exist_ok=True)
            if os.path.isdir(src):
                shutil.copytree(
                    src,
                    to,
                    ignore=shutil.ignore_patterns("node_modules", "__pycache__"),
                )
            else:
                shutil.copy2(src, to)
        return dst

    def test_real_tree_passes(self):
        rc, out = _gate(ATLAS)
        self.assertEqual(rc, 0, out)
        self.assertIn("PASS smoke load+render register.ts", out)

    def test_untouched_copy_passes(self):
        rc, out = _gate(self._copy())
        self.assertEqual(rc, 0, out)

    def test_top_level_throw_fails(self):
        dst = self._copy()
        with open(os.path.join(dst, "mod", "usage.ts"), "a", encoding="utf-8") as f:
            f.write("\nthrow new Error('injected top-level throw');\n")
        rc, out = _gate(dst)
        self.assertEqual(rc, 1, out)
        self.assertIn("FAIL smoke load+render register.ts", out)
        self.assertIn("injected top-level throw", out)

    def test_broken_import_fails(self):
        dst = self._copy()
        path = os.path.join(dst, "mod", "usage.ts")
        with open(path, encoding="utf-8") as f:
            src = f.read()
        with open(path, "w", encoding="utf-8") as f:
            f.write("import './does-not-exist-injected';\n" + src)
        rc, out = _gate(dst)
        self.assertEqual(rc, 1, out)
        self.assertIn("FAIL smoke bundle register.ts", out)
        self.assertIn("does-not-exist-injected", out)

    def test_missing_module_entry_fails(self):
        dst = self._copy()
        os.remove(os.path.join(dst, "mod", "register.ts"))
        rc, out = _gate(dst)
        self.assertEqual(rc, 1, out)
        self.assertIn("FAIL modules-exist", out)

    @unittest.skipUnless(shutil.which("claude"), "claude CLI not installed")
    def test_live_host_check_fails_on_host_rejected_module(self):
        # The host refuses `$.env.get(<variable>)`; the offline load accepts it. --live must catch it.
        dst = self._copy()
        usage = os.path.join(dst, "mod", "usage.ts")
        with open(usage, encoding="utf-8") as f:
            src = f.read()
        needle = "$.env.get('ATLAS_HOME')"
        self.assertIn(needle, src)
        with open(usage, "w", encoding="utf-8") as f:
            f.write(src.replace(needle, "$.env.get(name)", 1))
        rc, out = _gate(dst, "--live")
        self.assertEqual(rc, 1, out)
        self.assertIn("PASS smoke load+render register.ts", out)
        self.assertIn("FAIL live claude plugin test", out)


FAKE_CLAUDE = """#!/bin/sh
# fake `claude plugin test <dir>`: prints $FAKE_OUT, exits $FAKE_RC; FAKE_COUNT=1 reports the probe-file count instead
if [ -n "$FAKE_COUNT" ]; then
  n=$(python3 -c "import pathlib,sys;print(len(list(pathlib.Path(sys.argv[1]).rglob('zz_gate_probe*.test.ts'))))" "$3")
  echo " $n pass"; echo " 0 fail"; exit 0
fi
printf '%s\\n' "$FAKE_OUT"
exit "${FAKE_RC:-0}"
"""


def _gate_env(root, flags, extra_env=None, path=None):
    env = {**os.environ, **(extra_env or {})}
    if path is not None:
        env["PATH"] = path
    p = subprocess.run(
        [sys.executable, GATE, "--root", root, *flags],
        capture_output=True,
        text=True,
        timeout=900,
        env=env,
    )
    return p.returncode, p.stdout + p.stderr


class ClassifyLiveTests(unittest.TestCase):
    """The live verdict: only a run that really executed the probe may pass."""

    def setUp(self):
        import atlas_mod_gate as g

        self.g = g

    def test_auth_words_in_a_failed_run_are_a_fail_not_a_skip(self):
        for word in ("login", "401", "network", "proxy", "oauth", "unauthorized"):
            st, _ = self.g.classify_live(1, f"error: {word} problem", 1, require_live=False)
            self.assertEqual(st, self.g.FAIL, word)

    def test_hookserror_and_fail_marker_never_skip(self):
        for out in ("HooksError: network down", "(fail) boom\n 0 pass 1 fail"):
            for rc in (1, 124, 127):
                st, _ = self.g.classify_live(rc, out, 1, require_live=False)
                self.assertEqual(st, self.g.FAIL, (rc, out))

    def test_zero_tests_run_is_a_fail(self):
        st, _ = self.g.classify_live(0, "", 1, require_live=False)
        self.assertEqual(st, self.g.FAIL)
        st, _ = self.g.classify_live(0, " 0 pass\n 0 fail", 1, require_live=False)
        self.assertEqual(st, self.g.FAIL)

    def test_fewer_passes_than_probes_is_a_fail(self):
        st, _ = self.g.classify_live(0, " 1 pass\n 0 fail", 2, require_live=False)
        self.assertEqual(st, self.g.FAIL)

    def test_clean_run_passes(self):
        st, _ = self.g.classify_live(0, " 2 pass\n 0 fail", 2, require_live=True)
        self.assertEqual(st, self.g.PASS)

    def test_cannot_run_is_skip_only_without_require_live(self):
        for rc in (124, 127):
            self.assertEqual(self.g.classify_live(rc, "spawn", 1, require_live=False)[0], self.g.SKIP)
            self.assertEqual(self.g.classify_live(rc, "spawn", 1, require_live=True)[0], self.g.FAIL)


@unittest.skipUnless(shutil.which("bun"), "bun not installed")
class ModGateLiveWiringTests(unittest.TestCase):
    _copy = ModGateTests._copy

    def _no_claude_path(self):
        d = tempfile.mkdtemp(prefix="mod-gate-path-")
        self.addCleanup(shutil.rmtree, d, True)
        for b in ("python3", "bun", "node"):
            src = shutil.which(b)
            if src:
                os.symlink(src, os.path.join(d, b))
        return d

    def _fake_claude_path(self):
        d = tempfile.mkdtemp(prefix="mod-gate-fake-")
        self.addCleanup(shutil.rmtree, d, True)
        for b in ("python3", "bun", "node"):
            src = shutil.which(b)
            if src:
                os.symlink(src, os.path.join(d, b))
        exe = os.path.join(d, "claude")
        with open(exe, "w", encoding="utf-8") as f:
            f.write(FAKE_CLAUDE)
        os.chmod(exe, 0o755)
        return d

    def test_require_live_without_cli_fails(self):
        rc, out = _gate_env(ATLAS, ["--live", "--require-live"], path=self._no_claude_path())
        self.assertEqual(rc, 1, out)
        self.assertIn("FAIL live claude plugin test", out)

    def test_live_without_cli_still_skips_when_not_required(self):
        rc, out = _gate_env(ATLAS, ["--live"], path=self._no_claude_path())
        self.assertEqual(rc, 0, out)
        self.assertIn("SKIP live claude plugin test", out)

    def test_unspawnable_cli_is_not_a_traceback(self):
        d = self._no_claude_path()
        exe = os.path.join(d, "claude")
        with open(exe, "wb") as f:
            f.write(b"\x00\x01 not an executable")
        os.chmod(exe, 0o755)
        rc, out = _gate_env(ATLAS, ["--live", "--require-live"], path=d)
        self.assertEqual(rc, 1, out)
        self.assertIn("FAIL live claude plugin test", out)
        self.assertNotIn("Traceback", out)

    def test_require_live_implies_live(self):
        rc, out = _gate_env(ATLAS, ["--require-live"], path=self._no_claude_path())
        self.assertEqual(rc, 1, out)
        self.assertIn("FAIL live claude plugin test", out)

    def test_failed_live_run_with_auth_words_fails_end_to_end(self):
        rc, out = _gate_env(
            ATLAS,
            ["--live"],
            {"FAKE_RC": "1", "FAKE_OUT": "401 unauthorized: please login (network proxy)"},
            self._fake_claude_path(),
        )
        self.assertEqual(rc, 1, out)
        self.assertIn("FAIL live claude plugin test", out)

    def test_live_run_that_executed_nothing_fails(self):
        rc, out = _gate_env(ATLAS, ["--live"], {"FAKE_RC": "0", "FAKE_OUT": ""}, self._fake_claude_path())
        self.assertEqual(rc, 1, out)
        self.assertIn("FAIL live claude plugin test", out)

    def test_live_probes_every_declared_module(self):
        dst = self._copy()
        os.makedirs(os.path.join(dst, "mod2"), exist_ok=True)
        with open(os.path.join(dst, "mod2", "register.ts"), "w", encoding="utf-8") as f:
            f.write("export * from '../mod/register';\n")
        for name in ("band.tsx", "live_fixture.ts"):
            with open(os.path.join(dst, "mod2", name), "w", encoding="utf-8") as f:
                f.write(f"export * from '../mod/{name.rsplit('.', 1)[0]}';\n")
        os.makedirs(os.path.join(dst, "mod2", "data"), exist_ok=True)
        with open(os.path.join(dst, "mod2", "data", "live.ts"), "w", encoding="utf-8") as f:
            f.write("export * from '../../mod/data/live';\n")
        cfg = os.path.join(dst, "hooks", "hooks.json")
        with open(cfg, encoding="utf-8") as f:
            data = json.load(f)
        data["modules"] = ["../mod/register.ts", "../mod2/register.ts"]
        with open(cfg, "w", encoding="utf-8") as f:
            json.dump(data, f)
        rc, out = _gate_env(dst, ["--live"], {"FAKE_COUNT": "1"}, self._fake_claude_path())
        self.assertEqual(rc, 0, out)
        self.assertIn("PASS live claude plugin test", out)
        self.assertIn("2 probe(s)", out)

    def test_malformed_hooks_json_reports_fail_not_traceback(self):
        dst = self._copy()
        with open(os.path.join(dst, "hooks", "hooks.json"), "w", encoding="utf-8") as f:
            f.write("{ not json")
        rc, out = _gate(dst)
        self.assertEqual(rc, 1, out)
        self.assertIn("FAIL hooks-json", out)
        self.assertNotIn("Traceback", out)

    def test_offline_checks_are_labelled_smoke(self):
        rc, out = _gate(ATLAS)
        self.assertEqual(rc, 0, out)
        self.assertIn("PASS smoke bundle register.ts", out)
        self.assertIn("smoke", out.splitlines()[-1])


if __name__ == "__main__":
    unittest.main()
