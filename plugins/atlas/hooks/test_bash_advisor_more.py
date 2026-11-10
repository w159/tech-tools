#!/usr/bin/env python3
"""More bash_advisor tests: parse helpers, wrappers, nesting bounds, mandates, nudge fault paths."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0, _iso_os.path.join(_iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts")
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))

import bash_advisor as ba  # noqa: E402


def run_main(payload):
    buf = io.StringIO()
    with patch("sys.stdin", new=io.StringIO(payload)), redirect_stdout(buf):
        code = ba.main()
    return code, buf.getvalue()


class Gated(unittest.TestCase):
    def test_all_groups_must_hit(self):
        g = (("rm", "mv"), ("/dev/",))
        self.assertTrue(ba._gated("mv x /dev/sda", [], g))
        self.assertFalse(ba._gated("mv x y", [], g))
        self.assertFalse(ba._gated("cp x /dev/sda", [], g))

    def test_case_insensitive_group(self):
        g = (("i", "authorization", "bearer"),)
        low = []
        self.assertTrue(ba._gated("curl -H 'AUTHORIZATION: x'", low, g))
        self.assertEqual(low, ["curl -h 'authorization: x'"])  # lowered once, cached for later gates
        self.assertIs(ba._gated("curl http://x", [], g), False)
        self.assertIs(ba._gated("curl http://x", ["curl http://x"], g), False)
        self.assertIs(ba._gated("curl http://x", [], (("curl",), ("zzz",))), False)

    def test_case_sensitive_groups_do_not_lowercase(self):
        self.assertFalse(ba._gated("AKIA", [], (("akia",),)))

    def test_empty_groups_pass_and_empty_group_skipped(self):
        self.assertTrue(ba._gated("x", [], ()))
        self.assertFalse(ba._gated("x", [], ((),)))


class GatesParallel(unittest.TestCase):
    def test_gate_tables_match_patterns(self):
        self.assertEqual(len(ba._CATASTROPHIC), len(ba._CATASTROPHIC_GATES))
        self.assertEqual(len(ba._SECRETS), len(ba._SECRETS_GATES))


class Mandates(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.addCleanup(self._t.cleanup)

    def point(self, text):
        p = os.path.join(self._t.name, "m.json")
        with open(p, "w") as f:
            f.write(text)
        return mock.patch.object(ba, "MANDATES_PATH", p)

    def test_reads_dict(self):
        with self.point('{"commitNudge": "n"}'):
            self.assertEqual(ba._mandates(), {"commitNudge": "n"})

    def test_non_dict_is_empty(self):
        for text in ("[1]", '"s"', "3", "null"):
            with self.point(text):
                self.assertEqual(ba._mandates(), {})

    def test_bad_json_is_empty(self):
        with self.point("{nope"):
            self.assertEqual(ba._mandates(), {})

    def test_missing_file_is_empty(self):
        with mock.patch.object(ba, "MANDATES_PATH", os.path.join(self._t.name, "absent.json")):
            self.assertEqual(ba._mandates(), {})

    def test_shipped_contract_has_nudge(self):
        self.assertIn("ponytail-review", ba._mandates()["commitNudge"])


class MarkerDir(unittest.TestCase):
    def test_default_under_tempdir_and_cached(self):
        with mock.patch.object(ba, "MANDATE_MARKER_DIR", None):
            d = ba._marker_dir()
            self.assertEqual(d, os.path.join(tempfile.gettempdir(), "atlas-mandates"))
            self.assertEqual(ba.MANDATE_MARKER_DIR, d)
            self.assertEqual(ba._marker_dir(), d)

    def test_preset_dir_is_kept(self):
        with mock.patch.object(ba, "MANDATE_MARKER_DIR", "/x/y"):
            self.assertEqual(ba._marker_dir(), "/x/y")


class RegexSegments(unittest.TestCase):
    def test_skips_segments_without_git(self):
        self.assertEqual(list(ba._regex_segments("ls -l; git status && echo hi")), [["git", "status"]])

    def test_quote_unaware_split_and_unbalanced_fallback(self):
        # shlex fails on the unbalanced quote; plain whitespace split is the fallback
        self.assertEqual(list(ba._regex_segments("git commit -m 'oops")), [["git", "commit", "-m", "'oops"]])

    def test_segment_head_is_bounded(self):
        out = list(ba._regex_segments("git " + "a" * 5000))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0][0], "git")
        self.assertEqual(len(out[0][1]), 2044)  # 2048 head minus "git "

    def test_max_segments_bound(self):
        cmd = ";".join(["git a"] * 5000)
        self.assertGreater(len(cmd), ba._SHLEX_MAX)
        self.assertEqual(len(list(ba._regex_segments(cmd))), 4097)  # 4096 splits -> 4097 pieces


class CommandSegments(unittest.TestCase):
    def test_splits_on_every_separator(self):
        segs = list(ba._command_segments("a b && c || d; e | f & g\nh (i) `j`"))
        self.assertEqual(segs, [["a", "b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"], ["i"], ["j"]])

    def test_quoted_separator_stays_in_word(self):
        self.assertEqual(list(ba._command_segments("echo 'a; b' c")), [["echo", "a; b", "c"]])

    def test_redirect_operator_stays_a_token(self):
        self.assertEqual(list(ba._command_segments("a > f")), [["a", ">", "f"]])

    def test_none_and_empty(self):
        self.assertEqual(list(ba._command_segments(None)), [])
        self.assertEqual(list(ba._command_segments("")), [])
        self.assertEqual(list(ba._command_segments(" ;; ")), [])

    def test_unbalanced_quote_falls_back(self):
        self.assertEqual(list(ba._command_segments("git commit -m 'x")), [["git", "commit", "-m", "'x"]])

    def test_large_command_uses_bounded_split(self):
        cmd = "echo " + "x" * (ba._SHLEX_MAX + 10) + "; git status"
        self.assertEqual(list(ba._command_segments(cmd)), [["git", "status"]])  # echo seg has no 'git'

    def test_size_boundary_exactly_at_limit_is_shlexed(self):
        cmd = "echo " + "x" * (ba._SHLEX_MAX - 5)
        self.assertEqual(len(cmd), ba._SHLEX_MAX)
        self.assertEqual(len(list(ba._command_segments(cmd))), 1)  # shlex path keeps non-git segments


class StripWrappers(unittest.TestCase):
    def strip(self, s):
        return ba._strip_wrappers(s.split())

    def test_env_assignments_and_keywords(self):
        self.assertEqual(self.strip("A=1 B=2 git x"), ["git", "x"])
        self.assertEqual(self.strip("then git x"), ["git", "x"])
        self.assertEqual(self.strip("! { git x"), ["git", "x"])

    def test_wrapper_flags_with_values(self):
        self.assertEqual(self.strip("env -u X git y"), ["git", "y"])
        self.assertEqual(self.strip("sudo -u bob git y"), ["git", "y"])
        self.assertEqual(self.strip("nice -n 5 git y"), ["git", "y"])
        self.assertEqual(self.strip("xargs -I {} git y"), ["git", "y"])
        self.assertEqual(self.strip("exec -a n git y"), ["git", "y"])

    def test_flag_without_value_consumes_only_itself(self):
        self.assertEqual(self.strip("sudo -E git y"), ["git", "y"])
        self.assertEqual(self.strip("nohup -x git y"), ["git", "y"])

    def test_value_flag_at_end_of_tokens(self):
        self.assertEqual(self.strip("sudo -u"), [])

    def test_double_dash_stops_flags(self):
        self.assertEqual(self.strip("sudo -- git -x"), ["git", "-x"])
        self.assertEqual(self.strip("env -- -weird"), ["-weird"])

    def test_command_lookup_runs_nothing(self):
        self.assertEqual(self.strip("command -v git"), [])
        self.assertEqual(self.strip("command -V git"), [])
        self.assertEqual(self.strip("command git x"), ["git", "x"])
        self.assertEqual(self.strip("command -p git x"), ["git", "x"])

    def test_path_qualified_wrapper(self):
        self.assertEqual(self.strip("/usr/bin/env A=1 git x"), ["git", "x"])
        self.assertEqual(self.strip("/usr/bin/sudo git x"), ["git", "x"])

    def test_nested_wrappers_and_non_wrapper_stops(self):
        self.assertEqual(self.strip("sudo env A=1 time -f %e git x"), ["git", "x"])
        self.assertEqual(self.strip("echo sudo git"), ["echo", "sudo", "git"])
        self.assertEqual(self.strip("gitx env"), ["gitx", "env"])

    def test_empty(self):
        self.assertEqual(ba._strip_wrappers([]), [])


class GitInvocations(unittest.TestCase):
    def inv(self, c):
        return list(ba._git_invocations(c))

    def test_argv_starts_at_subcommand(self):
        self.assertEqual(self.inv("git push origin main"), [(["push", "origin", "main"], None)])

    def test_chdir_relative_chain_and_absolute_reset(self):
        self.assertEqual(self.inv("git -C a -C b status"), [(["status"], "a/b")])
        self.assertEqual(self.inv("git -C a -C /abs status"), [(["status"], "/abs")])
        self.assertEqual(self.inv("git -C /abs -C rel status"), [(["status"], "/abs/rel")])

    def test_value_options_consumed(self):
        self.assertEqual(self.inv("git -c k=v --git-dir d --namespace n log"), [(["log"], None)])
        self.assertEqual(self.inv("git --exec-path p log"), [(["log"], None)])

    def test_dangling_c_without_value(self):
        self.assertEqual(self.inv("git -C"), [])

    def test_git_only(self):
        self.assertEqual(self.inv("git"), [])
        self.assertEqual(self.inv("git --version"), [])

    def test_full_path_git(self):
        self.assertEqual(self.inv("/usr/bin/git status"), [(["status"], None)])
        self.assertEqual(self.inv("/usr/bin/gitx status"), [])

    def test_no_git_substring_short_circuit(self):
        self.assertEqual(self.inv("ls -l"), [])
        self.assertEqual(self.inv(None), [])

    def test_multiple_segments_in_order(self):
        self.assertEqual([a[0] for a, _ in self.inv("git add . && git commit -m x; git push")],
                         ["add", "commit", "push"])

    def test_sh_c_body_two_levels_deep(self):
        self.assertEqual([a[0] for a, _ in self.inv("bash -c 'git status'")], ["status"])
        self.assertIn("status", [a[0] for a, _ in self.inv("""bash -c "eval 'git status'" """)])

    def test_eval_then_shell_c_is_second_level(self):
        self.assertIn("status", [a[0] for a, _ in self.inv("""eval 'bash -c "git status"'""")])

    def test_shell_variants(self):
        for sh in ("sh", "bash", "zsh", "dash", "ksh"):
            self.assertEqual([a[0] for a, _ in self.inv("%s -c 'git status'" % sh)], ["status"], sh)
        self.assertEqual([a[0] for a, _ in self.inv("bash -lc 'git status'")], ["status"])
        self.assertEqual([a[0] for a, _ in self.inv("eval \"git status\"")], ["status"])

    def test_quoted_git_text_is_not_a_command(self):
        self.assertEqual(self.inv("echo 'git status'"), [])



class NestedChains(unittest.TestCase):
    """Each wrapper layer is unwrapped exactly once per level, in either quote order."""

    def test_git_shell_inside_shell(self):
        self.assertIn("commit", list(ba._git_subcommands("""bash -c 'bash -c "git commit -m x"'""")))
        self.assertTrue(ba._match_git_commit("""bash -c 'bash -c "git commit -m x"'"""))

    def test_git_eval_inside_eval(self):
        self.assertIn("commit", list(ba._git_subcommands("""eval 'eval "git commit -m x"'""")))
        self.assertTrue(ba._match_git_commit("""eval 'eval "git commit -m x"'"""))

    def test_git_eval_inside_shell_and_back(self):
        self.assertTrue(ba._match_git_commit("""sh -c 'eval "git commit"'"""))
        self.assertTrue(ba._match_git_commit("""eval 'sh -c "git commit"'"""))

    def test_git_subcommands_default_depth_allows_two_levels(self):
        self.assertEqual(list(ba._git_subcommands("""sh -c 'sh -c "git push"'""")), ["push"])

    def test_program_shell_inside_shell(self):
        self.assertIn(["gh", "pr"], list(ba._program_invocations("""bash -c 'bash -c "gh pr"'""", ("gh",))))

    def test_program_eval_inside_eval(self):
        self.assertIn(["gh", "pr"], list(ba._program_invocations("""eval 'eval "gh pr"'""", ("gh",))))

    def test_program_eval_inside_shell_and_back(self):
        self.assertIn(["gh", "pr"], list(ba._program_invocations("""sh -c 'eval "gh pr"'""", ("gh",))))
        self.assertIn(["gh", "pr"], list(ba._program_invocations("""eval 'sh -c "gh pr"'""", ("gh",))))


class TokenisationDetail(unittest.TestCase):
    def test_punctuation_in_words_does_not_hide_subcommand(self):
        for cmd in ("git -c user.email=me@x.com commit -m x",
                    "git -c a=b,c commit",
                    "git -C /tmp/a%20b commit",
                    "git -c core.pager=less:-R commit",
                    "git commit -m fix:thing"):
            self.assertTrue(ba._match_git_commit(cmd), cmd)

    def test_token_values_survive(self):
        self.assertEqual(list(ba._command_segments("a@b c:d e,f")), [["a@b", "c:d", "e,f"]])


class ProgramInvocations(unittest.TestCase):
    def prog(self, c, programs=("gh", "hub")):
        return list(ba._program_invocations(c, programs))

    def test_basic_and_path_qualified(self):
        self.assertEqual(self.prog("gh pr create"), [["gh", "pr", "create"]])
        self.assertEqual(self.prog("/usr/local/bin/gh pr list"), [["/usr/local/bin/gh", "pr", "list"]])
        self.assertEqual(self.prog("hub pull-request"), [["hub", "pull-request"]])

    def test_other_programs_ignored(self):
        self.assertEqual(self.prog("ghost pr"), [])
        self.assertEqual(self.prog("echo gh pr"), [])
        self.assertEqual(self.prog("ls"), [])
        self.assertEqual(self.prog(None), [])

    def test_wrappers_skipped(self):
        self.assertEqual(self.prog("sudo -u x env A=1 gh api"), [["gh", "api"]])

    def test_multiple_segments(self):
        self.assertEqual(self.prog("gh a && hub b | gh c"), [["gh", "a"], ["hub", "b"], ["gh", "c"]])

    def test_sh_c_body(self):
        self.assertEqual(self.prog("bash -c 'gh pr view'"), [["gh", "pr", "view"]])
        self.assertEqual(self.prog('''sh -lc "cd x && gh pr view"'''), [["gh", "pr", "view"]])

    def test_eval_body(self):
        self.assertEqual(self.prog("eval 'gh pr view'"), [["gh", "pr", "view"]])

    def test_eval_wrapping_shell_c_unwrapped_one_level_each(self):
        self.assertIn(["gh", "pr", "view"], self.prog("""eval 'bash -c "gh pr view"'"""))
        self.assertIn(["gh", "pr", "view"], self.prog("""bash -c "eval 'gh pr view'" """))

    def test_program_filter_is_a_prefilter_only(self):
        self.assertEqual(self.prog("gh x", programs=("hub",)), [])

    def test_body_head_bound(self):
        pad = "x" * (ba._SEGMENT_HEAD * 4 + 10)
        self.assertEqual(self.prog("echo %s; bash -c 'gh a'" % pad), [])  # the quoted body lies beyond the scan window
        self.assertEqual(self.prog("bash -c 'gh a'; echo %s" % pad), [["gh", "a"]])


class PonytailInstalled(unittest.TestCase):
    def test_delegates_to_tool_routing(self):
        import tool_routing
        with mock.patch.object(tool_routing, "plugin_enabled", return_value=True) as pe:
            self.assertTrue(ba._ponytail_installed("/r"))
        pe.assert_called_once_with("ponytail", "/r")
        with mock.patch.object(tool_routing, "plugin_enabled", return_value=False):
            self.assertFalse(ba._ponytail_installed())

    def test_error_means_not_installed(self):
        import tool_routing
        with mock.patch.object(tool_routing, "plugin_enabled", side_effect=RuntimeError("x")):
            self.assertIs(ba._ponytail_installed("/r"), False)

    def test_reads_project_settings(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, ".claude"))
            with open(os.path.join(d, ".claude", "settings.json"), "w") as f:
                json.dump({"enabledPlugins": {"ponytail@mk": True}}, f)
            self.assertTrue(ba._ponytail_installed(d))
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(ba._ponytail_installed(d))


class CommitNudgeUnit(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        p = mock.patch.object(ba, "MANDATE_MARKER_DIR", self.tmp)
        p.start()
        self.addCleanup(p.stop)
        i = mock.patch.object(ba, "_ponytail_installed", return_value=True)
        self.inst = i.start()
        self.addCleanup(i.stop)

    def test_returns_nudge_text_then_none(self):
        data = {"session_id": "s1", "cwd": "/w"}
        self.assertEqual(ba._commit_nudge(data, "git commit -m x"), ba._mandates()["commitNudge"])
        self.inst.assert_called_once_with("/w")
        self.assertIsNone(ba._commit_nudge(data, "git commit -m x"))

    def test_marker_name_sanitised(self):
        ba._commit_nudge({"session_id": "a/b c:d.e-f_g"}, "git commit")
        self.assertEqual(os.listdir(self.tmp), ["ponytail-a_b_c_d.e-f_g"])

    def test_creates_marker_dir(self):
        nested = os.path.join(self.tmp, "x", "y")
        with mock.patch.object(ba, "MANDATE_MARKER_DIR", nested):
            ba._commit_nudge({"session_id": "s"}, "git commit")
        self.assertTrue(os.path.isfile(os.path.join(nested, "ponytail-s")))

    def test_no_session_no_marker(self):
        self.assertIsNone(ba._commit_nudge({}, "git commit"))
        self.assertIsNone(ba._commit_nudge({"session_id": ""}, "git commit"))
        self.assertIsNone(ba._commit_nudge({"session_id": None}, "git commit"))
        self.assertEqual(os.listdir(self.tmp), [])

    def test_not_a_commit(self):
        self.assertIsNone(ba._commit_nudge({"session_id": "s"}, "git status"))
        self.assertEqual(os.listdir(self.tmp), [])

    def test_off_switch_exact(self):
        with mock.patch.dict(os.environ, {"ATLAS_MANDATES": "off"}):
            self.assertIsNone(ba._commit_nudge({"session_id": "s"}, "git commit"))
        with mock.patch.dict(os.environ, {"ATLAS_MANDATES": "OFF"}):
            self.assertIsNotNone(ba._commit_nudge({"session_id": "s2"}, "git commit"))

    def test_not_armed_leaves_no_marker(self):
        self.inst.return_value = False
        self.assertIsNone(ba._commit_nudge({"session_id": "s"}, "git commit"))
        self.assertEqual(os.listdir(self.tmp), [])

    def test_empty_nudge_text_is_none(self):
        with mock.patch.object(ba, "_mandates", return_value={}):
            self.assertIsNone(ba._commit_nudge({"session_id": "s"}, "git commit"))
        with mock.patch.object(ba, "_mandates", return_value={"commitNudge": ""}):
            self.assertIsNone(ba._commit_nudge({"session_id": "s2"}, "git commit"))

    def test_internal_error_faults_and_fails_open(self):
        with mock.patch.object(ba.os, "makedirs", side_effect=OSError("ro")), \
                mock.patch.object(ba.atlas_hook_guard, "fault") as fault:
            self.assertIsNone(ba._commit_nudge({"session_id": "s"}, "git commit"))
        self.assertEqual(fault.call_args.args[0], "bash_advisor")
        self.assertIsInstance(fault.call_args.args[1], OSError)

    def test_marker_created_exclusively(self):
        ba._commit_nudge({"session_id": "s"}, "git commit")
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, "ponytail-s")))
        # fd closed: marker can be removed and recreated by the next call
        os.remove(os.path.join(self.tmp, "ponytail-s"))
        self.assertIsNotNone(ba._commit_nudge({"session_id": "s"}, "git commit"))


class MainBehaviour(unittest.TestCase):
    def payload(self, cmd, **kw):
        return json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}, **kw})

    def test_warning_wording_and_shape(self):
        code, out = run_main(self.payload("rm -rf /"))
        self.assertEqual(code, 0)
        data = json.loads(out)
        self.assertEqual(list(data), ["hookSpecificOutput"])
        hso = data["hookSpecificOutput"]
        self.assertEqual(hso["hookEventName"], "PreToolUse")
        self.assertEqual(hso["additionalContext"],
                         "[atlas advisor] This command matches a catastrophic, near-irreversible pattern "
                         "(recursive force-delete of a root/home path). Confirm intent before running.")
        self.assertNotIn("permissionDecision", hso)

    def test_secret_warning_wording(self):
        code, out = run_main(self.payload("cat ~/.aws/credentials"))
        ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("(a credential file read to output)", ctx)
        self.assertTrue(ctx.startswith("[atlas advisor] This command would print secrets"))
        self.assertIn("rotate it if this was unintended", ctx)

    def test_whitespace_only_command_silent(self):
        self.assertEqual(run_main(self.payload("   \n\t")), (0, ""))

    def test_non_bash_tools_silent_even_if_dangerous(self):
        p = json.dumps({"tool_name": "Write", "tool_input": {"command": "rm -rf /"}})
        self.assertEqual(run_main(p), (0, ""))

    def test_tool_input_none(self):
        self.assertEqual(run_main(json.dumps({"tool_name": "Bash", "tool_input": None})), (0, ""))

    def test_catastrophic_beats_secret(self):
        code, out = run_main(self.payload("rm -rf / ; echo $GITHUB_TOKEN"))
        self.assertIn("catastrophic", out)
        self.assertNotIn("secrets", out)

    def test_secret_beats_commit_nudge(self):
        with mock.patch.object(ba, "_commit_nudge", return_value="NUDGE") as n:
            code, out = run_main(self.payload("echo $GITHUB_TOKEN && git commit -m x"))
        n.assert_not_called()
        self.assertIn("secrets", out)

    def test_nudge_used_for_benign_commit(self):
        with mock.patch.object(ba, "_commit_nudge", return_value="NUDGE") as n:
            code, out = run_main(self.payload("git commit -m x", session_id="S", cwd="/c"))
        self.assertEqual(json.loads(out)["hookSpecificOutput"]["additionalContext"], "NUDGE")
        self.assertEqual(n.call_args.args[0]["session_id"], "S")
        self.assertEqual(n.call_args.args[1], "git commit -m x")


class CatastrophicMore(unittest.TestCase):
    def test_cd_root_glob_delete(self):
        self.assertEqual(ba._match_catastrophic("cd / && rm -rf *"), "recursive delete of everything under /")
        self.assertEqual(ba._match_catastrophic("cd '/' ; rm -fr ./*"), "recursive delete of everything under /")
        self.assertIsNone(ba._match_catastrophic("cd /tmp && rm -rf *"))
        self.assertIsNone(ba._match_catastrophic("cd / && rm -f *"))

    def test_find_delete(self):
        self.assertEqual(ba._match_catastrophic("find / -delete"), "find -delete over a root/home path")
        self.assertEqual(ba._match_catastrophic("find ~ -maxdepth 2 -delete"), "find -delete over a root/home path")
        self.assertIsNone(ba._match_catastrophic("find / -name '*.tmp' -delete"))
        self.assertIsNone(ba._match_catastrophic("find ./build -delete"))

    def test_mkfs_only_as_command(self):
        self.assertEqual(ba._match_catastrophic("sudo mkfs.ext4 /dev/sda1"), "filesystem format")
        self.assertEqual(ba._match_catastrophic("ls; /sbin/mkfs -t ext4 x"), "filesystem format")
        self.assertIsNone(ba._match_catastrophic("echo mkfs"))
        self.assertIsNone(ba._match_catastrophic("grep mkfs docs/x"))

    def test_order_of_reasons(self):
        self.assertEqual(ba._match_catastrophic("rm -rf / ; mkfs /dev/sda"), "recursive force-delete of a root/home path")

    def test_gate_never_hides_a_match(self):
        for cmd in ("rm -rf /", "find / -delete", ":(){ :|:& };:", "mkfs.ext4 x", "dd if=/dev/zero of=/dev/sda",
                    "echo x > /dev/sda", "chmod -R 777 /"):
            self.assertIsNotNone(ba._match_catastrophic(cmd), cmd)


class SecretsMore(unittest.TestCase):
    def test_aws_secret_key_assignment_case_insensitive(self):
        key = "A" * 40
        self.assertEqual(ba._match_secrets("export AWS_SECRET_ACCESS_KEY=%s" % key), "an AWS secret access key")
        self.assertEqual(ba._match_secrets("aws_secret_access_key: %s" % key), "an AWS secret access key")
        self.assertIsNone(ba._match_secrets("aws_secret_access_key=short"))

    def test_github_token_prefixes(self):
        tail = "a" * 30
        for pre in ("ghp_", "gho_", "ghu_", "ghs_", "ghr_"):
            self.assertEqual(ba._match_secrets("echo " + pre + tail), "a GitHub token", pre)
        self.assertEqual(ba._match_secrets("x github_pat_" + "b" * 20), "a GitHub token")
        self.assertIsNone(ba._match_secrets("echo ghp_short"))

    def test_bearer_header(self):
        self.assertEqual(ba._match_secrets("curl -H 'Authorization: Bearer abcdefgh1234'"), "a bearer/API token")
        self.assertEqual(ba._match_secrets("curl -H 'authorization: abcdefgh1234'"), "a bearer/API token")
        self.assertIsNone(ba._match_secrets("curl -H 'Accept: json'"))

    def test_env_dump(self):
        self.assertEqual(ba._match_secrets("env"), "the full environment dump")
        self.assertEqual(ba._match_secrets("ls && printenv"), "the full environment dump")
        self.assertEqual(ba._match_secrets("sudo env | sort"), "the full environment dump")
        self.assertIsNone(ba._match_secrets("env FOO=1 make"))
        self.assertIsNone(ba._match_secrets("printenv HOME"))

    def test_env_filtered_by_grep_is_not_a_dump(self):
        """`env | grep` prints only the selected names (live run 2026-11-10 was
        warned for `env | grep -iE "^(CI|ATLAS|DO_NOT)"`)."""
        self.assertIsNone(ba._match_secrets('env | grep -iE "^(CI|ATLAS|DO_NOT)"'))
        self.assertIsNone(ba._match_secrets("printenv | rg PATH"))
        dump = "the full environment dump"
        self.assertEqual(ba._match_secrets("env | grep -v PATH"), dump)  # inverted: prints the rest
        self.assertEqual(ba._match_secrets("env | grep -iv path"), dump)
        self.assertEqual(ba._match_secrets("env | grep -i token"), dump)  # selects secrets
        self.assertEqual(ba._match_secrets("env | grep"), dump)  # no pattern: an error, still flagged
        self.assertEqual(ba._match_secrets("env || grep x"), dump)  # || is not a pipe

    def test_cli_tokens(self):
        for c in ("gh auth token", "az account get-access-token", "gcloud auth print-access-token",
                  "gcloud auth print-identity-token"):
            self.assertEqual(ba._match_secrets(c), "a CLI-issued access token", c)

    def test_secret_var_echo_and_pipe_exemption(self):
        self.assertEqual(ba._match_secrets("echo $MY_API_KEY"), "secret-bearing environment variables")
        self.assertEqual(ba._match_secrets("printf %s $CFG_DB"), "secret-bearing environment variables")
        self.assertIsNone(ba._match_secrets("echo $GH_TOKEN | gh auth login --with-token"))
        self.assertEqual(ba._match_secrets("echo $GH_TOKEN || true"), "secret-bearing environment variables")

    def test_credential_files(self):
        for c in ("cat .env", "less .env.production", "head ~/.netrc", "tail key.pem", "bat ~/.ssh/id_ed25519"):
            self.assertEqual(ba._match_secrets(c), "a credential file read to output", c)
        for c in ("cat .env.example", "cat .env.sample", "cat id_rsa.pub", "cat README.md"):
            self.assertIsNone(ba._match_secrets(c), c)

    def test_first_matching_reason_wins(self):
        self.assertEqual(ba._match_secrets("echo AKIA" + "A" * 16 + " $X_TOKEN"), "an AWS access key id")


class SubprocessMain(unittest.TestCase):
    def test_run_hook_wrapper_fail_open(self):
        import subprocess
        p = subprocess.run([sys.executable, ba.__file__], input=b'{"tool_name":"Bash","tool_input":{"command":"rm -rf ~"}}',
                           capture_output=True, timeout=30)
        self.assertEqual(p.returncode, 0)
        self.assertIn("catastrophic", p.stdout.decode())


if __name__ == "__main__":
    unittest.main()
