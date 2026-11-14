"""atlas_doctor checks must not pass on a broken install, and what they print must be runnable."""
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import contextlib
import io
import json
import os
import shlex
import shutil
import sys
import tempfile
import unittest
from unittest import mock

import atlas_db
import atlas_doctor as d
import doctor_layout

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REAL_ROOT, "hooks"))


class Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)


class HooksWiredBindingsTest(Tmp):
    def _tree(self, modules, bindings_src=None):
        hooks = os.path.join(self.tmp, "hooks")
        os.makedirs(hooks)
        src = bindings_src or (
            "BINDINGS = {'PreToolUse': (('a_hook', '*', 8), ('git_guard', 'Bash', 8), ('dispatch_tripwire', '*', 8))}\n"
            "_MODULES = {'dispatch_tripwire': 'dispatch_tripwire_core'}\n"
        )
        with open(os.path.join(hooks, "event_dispatch.py"), "w") as f:
            f.write(src)
        for name, body in modules.items():
            with open(os.path.join(hooks, name + ".py"), "w") as f:
                f.write(body)

    def test_missing_binding_module_is_reported(self):
        ok = "def main():\n    pass\n"
        self._tree({"a_hook": ok, "dispatch_tripwire_core": ok})
        self.assertEqual(d.binding_problems(self.tmp), ["git_guard.py missing"])

    def test_syntax_error_and_missing_main_are_reported(self):
        self._tree({"a_hook": "def (:\n", "git_guard": "x = 1\n", "dispatch_tripwire_core": "def main():\n pass\n"})
        got = d.binding_problems(self.tmp)
        self.assertTrue(any("a_hook.py does not parse" in g for g in got), got)
        self.assertIn("git_guard.py defines no main()", got)

    def test_complete_bindings_pass_and_the_real_plugin_passes(self):
        ok = "def main():\n    pass\n"
        self._tree({"a_hook": ok, "git_guard": ok, "dispatch_tripwire_core": ok})
        self.assertEqual(d.binding_problems(self.tmp), [])
        self.assertEqual(d.binding_problems(REAL_ROOT), [])

    def test_unreadable_bindings_do_not_read_as_healthy(self):
        self._tree({}, bindings_src="def (:\n")
        self.assertTrue(d.binding_problems(self.tmp))

    def test_content_check_fails_hooks_wired_when_a_binding_module_is_deleted(self):
        root = os.path.join(self.tmp, "plugin")
        shutil.copytree(REAL_ROOT, root, ignore=shutil.ignore_patterns("node_modules", "__pycache__", ".git", "*.db"))
        os.remove(os.path.join(root, "hooks", "git_guard.py"))
        rows = []
        d._content_checks(lambda c, ok, det, severity="fail": rows.append((c, ok, det)), {}, root, "", "atlas")
        wired = [r for r in rows if r[0] == "hooks-wired"][0]
        self.assertFalse(wired[1], wired)
        self.assertIn("git_guard.py missing", wired[2])


class RemedyTest(Tmp):
    def test_fix_command_is_absolute_and_shell_quoted(self):
        parts = shlex.split(d.fix_command())
        self.assertEqual(parts[0], "python3")
        self.assertTrue(os.path.isabs(parts[1]) and parts[1].endswith("atlas_doctor.py"))
        self.assertEqual(parts[2], "--fix")
        self.assertNotIn("<plugin>", d.fix_command())

    def test_missing_clone_failures_get_the_update_command_not_fix(self):
        failed = [{"check": "clone-remote"}, {"check": "version-sync"}]
        ctx = {"mkt_name": "tech-tools", "clone": os.path.join(self.tmp, "nope")}
        text = d.recommended_remedy(failed, ctx, "atlas")
        self.assertIn("claude plugin marketplace update tech-tools && claude plugin update atlas@tech-tools", text)
        self.assertNotIn("Run: python3", text)

    def test_fixable_failures_get_the_fix_command(self):
        text = d.recommended_remedy([{"check": "marketplace-source"}], {"mkt_name": "m", "clone": self.tmp}, "atlas")
        self.assertEqual(text, "Run: " + d.fix_command())

    def test_mixed_failures_name_both_remedies(self):
        failed = [{"check": "display-statusline"}, {"check": "clone-remote"}]
        text = d.recommended_remedy(failed, {"mkt_name": "m", "clone": os.path.join(self.tmp, "x")}, "atlas")
        self.assertIn(d.fix_command(), text)
        self.assertIn("claude plugin marketplace update m", text)

    def test_hook_warning_for_unfixable_failure_does_not_recommend_fix(self):
        sick = [{"check": "registered", "ok": False, "detail": "x", "severity": "fail"}]
        out = io.StringIO()
        with mock.patch.object(d, "run_checks", return_value=(sick, {"mkt_name": "m"})), contextlib.redirect_stdout(out):
            d.main(["--hook"])
        warning = [l for l in out.getvalue().splitlines() if l.startswith("ATLAS-DOCTOR WARNING")][0]
        self.assertIn("claude plugin marketplace update m", warning)
        self.assertNotIn("run python3", warning)


class OutputStyleRemedyTest(Tmp):
    def test_output_style_failure_is_not_recommended_for_fix(self):
        text = d.recommended_remedy([{"check": "output-style"}], {"mkt_name": "m", "clone": self.tmp}, "atlas")
        self.assertNotIn("Run:", text)

    def test_set_status_help_lists_every_valid_status(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit):
            d.main(["--help"])
        flat = "".join(out.getvalue().split())
        for status in atlas_db.FINDING_STATUSES:
            self.assertIn(status, flat)
        self.assertIn("wontfix", flat)


class RunDirGitignoreTest(Tmp):
    WANT = "*\n!findings.json\n"

    def test_atlas_git_write_json_creates_run_gitignore(self):
        import pathlib

        import atlas_git

        run = pathlib.Path(self.tmp) / ".atlas" / ".run"
        atlas_git._write_json(run / "stamp.json", {"a": 1})
        self.assertEqual((run / ".gitignore").read_text(), self.WANT)

    def test_write_dirty_snapshot_creates_run_gitignore(self):
        import subprocess

        import session_boot_core

        root = os.path.realpath(os.path.join(self.tmp, "proj"))
        os.makedirs(root)
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        with open(os.path.join(root, "f.txt"), "w") as fh:
            fh.write("x")
        written = session_boot_core.write_dirty_snapshot(root, "sess-1")
        self.assertTrue(written, "snapshot not written")
        gi = os.path.join(root, ".atlas", ".run", ".gitignore")
        with open(gi, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), self.WANT)


class DbWritableTest(Tmp):
    def _rows(self, home):
        rows = []
        with mock.patch.dict(os.environ, {"ATLAS_HOME": home}), mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ATLAS_DB", None)
            d.behaviour_checks(lambda c, ok, det, severity="fail": rows.append((c, ok, det)), "atlas", "1.0.0")
        return {r[0]: r for r in rows}

    def test_uncreatable_atlas_home_fails_db_writable_and_hook_faults(self):
        by = self._rows("/proc/atlas-nope")
        self.assertFalse(by["db-writable"][1], by["db-writable"])
        self.assertFalse(by["hook-faults"][1], by["hook-faults"])
        self.assertIn("cannot be created", by["db-writable"][2])

    def test_creatable_home_still_passes_and_leaves_nothing_behind(self):
        home = os.path.join(self.tmp, "deep", "home")
        by = self._rows(home)
        self.assertTrue(by["db-writable"][1], by["db-writable"])
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "deep")))  # the probe cleaned up


class StatusLineRootTest(Tmp):
    def _setup(self, script_path):
        self.root = os.path.join(self.tmp, "plugin")
        os.makedirs(os.path.join(self.root, "scripts"))
        os.makedirs(os.path.join(self.root, "hooks"))
        shutil.copy(os.path.join(REAL_ROOT, "scripts", "atlas_statusline.py"), os.path.join(self.root, "scripts"))
        for rel in ("hooks/hooks.json", "hooks/event_dispatch.py"):
            shutil.copy(os.path.join(REAL_ROOT, rel), os.path.join(self.root, rel))
        os.makedirs(os.path.join(self.root, "mod"))
        shutil.copy(os.path.join(REAL_ROOT, "mod", "register.ts"), os.path.join(self.root, "mod"))
        self.settings = os.path.join(self.tmp, "settings.json")
        with open(self.settings, "w") as f:
            json.dump({"statusLine": {"type": "command", "command": 'python3 "%s"' % script_path}}, f)

    def _row(self):
        return {r["check"]: r for r in d.display_checks(self.settings, {}, self.root)}["display-statusline"]

    def test_another_installs_statusline_script_fails_and_is_repointed(self):
        other = os.path.join(self.tmp, "old-cache", "scripts", "atlas_statusline.py")
        os.makedirs(os.path.dirname(other))
        open(other, "w").close()
        self._setup(other)
        row = self._row()
        self.assertFalse(row["ok"], row)
        self.assertIn("not this plugin's", row["detail"])
        d.fix_display(self.settings, {}, self.root)
        self.assertEqual(self._row()["ok"], True)

    def test_this_plugins_script_passes(self):
        self._setup(os.path.join(self.tmp, "plugin", "scripts", "atlas_statusline.py"))
        self.assertTrue(self._row()["ok"])


class OutputStyleConfigDirTest(Tmp):
    def test_claude_config_dir_is_honoured(self):
        cfg = os.path.join(self.tmp, "cfg")
        os.makedirs(cfg)
        with open(os.path.join(cfg, "settings.json"), "w") as f:
            json.dump({"outputStyle": "Explanatory"}, f)
        with mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": cfg}):
            ok, detail = d.check_output_style()
        self.assertFalse(ok, detail)
        self.assertIn("Explanatory", detail)

    def test_unreadable_settings_is_not_ok(self):
        path = os.path.join(self.tmp, "settings.json")
        with open(path, "w") as f:
            f.write("{not json")
        ok, detail = d.check_output_style(path)
        self.assertFalse(ok)
        self.assertIn("unreadable", detail)


class SetStatusTest(Tmp):
    def _run(self, *args):
        out = io.StringIO()
        db = os.path.join(self.tmp, "atlas.db")
        with mock.patch.dict(os.environ, {"ATLAS_DB": db}), contextlib.redirect_stdout(out):
            rc = d.main(list(args))
        return rc, out.getvalue()

    def test_unknown_status_and_unknown_id_exit_nonzero(self):
        rc, out = self._run("--set-status", "99999", "aplied")
        self.assertEqual(rc, 2)
        self.assertIn("unknown status", out)
        rc, out = self._run("--set-status", "99999", "applied")
        self.assertEqual(rc, 1)
        self.assertIn("no finding with id 99999", out)
        rc, out = self._run("--set-status", "abc", "applied")
        self.assertEqual(rc, 2)

    def test_valid_transition_still_works(self):
        db = os.path.join(self.tmp, "atlas.db")
        with mock.patch.dict(os.environ, {"ATLAS_DB": db}):
            conn = atlas_db.connect()
            atlas_db.init(conn)
            conn.execute(
                "INSERT INTO findings(dimension,title,status,created_at) VALUES('d','t','open',1.0)"
            )
            conn.commit()
            fid = conn.execute("SELECT id FROM findings").fetchone()[0]
            conn.close()
        rc, out = self._run("--set-status", str(fid), "accepted")
        self.assertEqual(rc, 0, out)

    def test_db_layer_rejects_a_bad_status(self):
        conn = atlas_db.connect(os.path.join(self.tmp, "x.db"))
        atlas_db.init(conn)
        with self.assertRaises(ValueError):
            atlas_db.set_finding_status(conn, 1, "aplied")
        self.assertFalse(atlas_db.set_finding_status(conn, 12345, "applied"))
        conn.close()


class ExceptionIsNotAPassTest(Tmp):
    def test_docs_naming_lint_failure_is_reported(self):
        import lint_docs_names

        with mock.patch.object(lint_docs_names, "all_artifact_paths", side_effect=RuntimeError("boom")):
            viol, err = doctor_layout.docs_naming_status(self.tmp)
        self.assertEqual(viol, [])
        self.assertIn("boom", err)

    def test_project_identity_exception_is_not_ok(self):
        db = os.path.join(self.tmp, "atlas.db")
        conn = atlas_db.connect(db)
        atlas_db.init(conn)
        conn.close()
        root = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(root, ".git"))
        with mock.patch.dict(os.environ, {"ATLAS_DB": db}), mock.patch.object(
            doctor_layout, "check_project_identity", side_effect=RuntimeError("no table")
        ), mock.patch.object(doctor_layout, "layout_refusal", return_value=None):
            rows = {r["check"]: r for r in d.layout_checks(root)}
        self.assertFalse(rows["project-identity"]["ok"], rows["project-identity"])
        self.assertIn("no table", rows["project-identity"]["detail"])


if __name__ == "__main__":
    unittest.main()
