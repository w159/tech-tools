#!/usr/bin/env python3
"""atlas_crew + atlas_irc + hooks/crew_worker: the team bus, the IRC gateway, leases, the stop gate, plans."""

import contextlib
import io
import json
import os
import socket
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest import mock

import _test_isolation  # noqa: F401
import atlas_crew
import atlas_irc

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "hooks"))
import crew_worker  # noqa: E402


def _bus(tmp, nicks=("a", "b"), chan="#t"):
    return atlas_irc.init_bus(Path(tmp) / "irc", chan, list(nicks), lead="lead")


class BusTests(unittest.TestCase):
    def test_post_assigns_monotonic_seq_and_drain_delivers_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp)
            r1 = atlas_irc.post(d, "a", "#t", "READY a: f(x)")
            r2 = atlas_irc.post(d, "b", "a", "what does f return?")
            self.assertEqual((r1["seq"], r2["seq"]), (1, 2))
            got = atlas_irc.drain(d, "a")
            # a does not get its own channel post back, only b's direct question
            self.assertEqual([r["seq"] for r in got], [2])
            self.assertEqual(atlas_irc.drain(d, "a"), [])
            self.assertEqual([r["seq"] for r in atlas_irc.drain(d, "b")], [1])

    def test_direct_message_is_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("a", "b", "c"))
            atlas_irc.post(d, "a", "b", "only for b")
            self.assertEqual(atlas_irc.drain(d, "c"), [])
            self.assertEqual(len(atlas_irc.drain(d, "b")), 1)

    def test_concurrent_posts_never_reuse_a_seq(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp)
            ts = [
                threading.Thread(
                    target=lambda i=i: atlas_irc.post(d, "a", "#t", f"m{i}")
                )
                for i in range(40)
            ]
            for t in ts:
                t.start()
            for t in ts:
                t.join()
            seqs = [r["seq"] for r in atlas_irc.history(d)]
            self.assertEqual(sorted(seqs), list(range(1, 41)))

    def _wait(self, d, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = atlas_irc.main(["--dir", str(d), "wait", "--as", "b", *argv])
        return code, buf.getvalue()

    def test_wait_matches_an_announcement_made_before_waiting_with_all(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp)
            atlas_irc.post(d, "a", "#t", "READY a: parse(text) -> Tree")
            code, out = self._wait(
                d, "--all", "--from", "a", "--match", "READY", "--timeout", "2"
            )
            self.assertEqual(code, 0)
            self.assertIn("MATCH <a> #t: READY a", out)

    def test_wait_ignores_history_by_default_and_finds_it_with_all(self):
        # live: a stale false DONE already on the log satisfied `irc wait --from ranges --match done`
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp)
            atlas_irc.post(d, "a", "#t", "DONE a: stale", kind="done")
            atlas_irc.set_cursor(d, "b", 1)  # the stale DONE was already delivered to b
            code, _ = self._wait(d, "--from", "a", "--match", "done", "--timeout", "0.3")
            self.assertEqual(code, 3)
            code, out = self._wait(d, "--all", "--from", "a", "--match", "done", "--timeout", "2")
            self.assertEqual(code, 0)
            self.assertIn("DONE a: stale", out)
            threading.Timer(0.2, lambda: atlas_irc.post(d, "a", "#t", "DONE a: fresh", kind="done")).start()
            code, out = self._wait(d, "--new-only", "--from", "a", "--match", "done", "--timeout", "5")
            self.assertEqual(code, 0)
            self.assertIn("DONE a: fresh", out)

    def test_wait_times_out_with_exit_3(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp)
            atlas_irc.post(d, "a", "#t", "still working")
            code, out = self._wait(
                d, "--from", "a", "--match", "READY", "--timeout", "0.2"
            )
            self.assertEqual(code, 3)
            self.assertIn("timeout", out)

    def _need(self, d, *args, nick="b"):
        buf = io.StringIO()
        with mock.patch.dict(os.environ, {"ATLAS_IRC_DIR": str(d), "ATLAS_IRC_NICK": nick}), \
                contextlib.redirect_stdout(buf):
            code = atlas_irc.main(["need", *args])
        return code, buf.getvalue()

    def test_need_waits_for_every_named_peer(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("a", "b", "c"))
            atlas_irc.post(d, "a", "#t", "READY a: f()")
            code, out = self._need(d, "a", "c", "--timeout", "0.3")
            self.assertEqual(code, 3)
            self.assertIn("still waiting for: c", out)
            threading.Timer(0.2, lambda: atlas_irc.post(d, "c", "#t", "DONE c", kind="done")).start()
            code, out = self._need(d, "a", "c", "--timeout", "5")
            self.assertEqual(code, 0)
            self.assertIn("<c> DONE c", out)

    def test_need_done_ignores_ready_and_returns_after_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("a", "b"))
            atlas_irc.post(d, "a", "#t", "READY a: f()")
            code, out = self._need(d, "--done", "a", "--timeout", "0.3")
            self.assertEqual(code, 3)
            self.assertIn("still waiting for: a", out)
            atlas_irc.post(d, "a", "#t", "DONE a", kind="done")
            code, out = self._need(d, "--done", "a", "--timeout", "2")
            self.assertEqual(code, 0)
            self.assertIn("<a> DONE a", out)

    def test_need_exits_4_naming_a_peer_that_gave_up(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("a", "b"))
            atlas_irc.post(d, "a", "#t", "GAVE UP a: `pytest` still fails", kind="failed")
            for extra in ((), ("--done",)):
                code, out = self._need(d, *extra, "a", "--timeout", "5")
                self.assertEqual(code, 4)
                self.assertIn("gave up: a", out)

    def test_need_and_wait_refuse_a_name_that_is_not_a_peer(self):
        # live: a worker waited 100 s on `--from lead`, then slept 90 s
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("a", "b"))
            code, out = self._need(d, "zed", "--timeout", "5")
            self.assertEqual(code, 2)
            self.assertIn("peers are a, b", out)
            code, _ = self._need(d, "lead", "--timeout", "5")
            self.assertEqual(code, 2)

    def test_wait_wakes_on_a_later_post(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp)
            threading.Timer(0.3, lambda: atlas_irc.post(d, "a", "b", "DONE a")).start()
            code, out = self._wait(
                d, "--from", "a", "--match", "DONE|READY", "--timeout", "5"
            )
            self.assertEqual(code, 0)
            self.assertIn("DONE a", out)


class GatewayTests(unittest.TestCase):
    def test_irc_client_joins_sees_replay_and_relays_both_ways(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("geom", "report"))
            atlas_irc.post(d, "geom", "#t", "READY geom: area()")
            gw = atlas_irc.Gateway(d)
            th = threading.Thread(target=gw.serve_forever, daemon=True)
            th.start()
            for _ in range(50):
                if (d / "port").exists():
                    break
                time.sleep(0.05)
            s = socket.create_connection(("127.0.0.1", int((d / "port").read_text())))
            s.settimeout(3)
            s.sendall(b"NICK geom\r\nUSER h 0 * :h\r\n")
            time.sleep(0.2)
            s.sendall(b"NICK human\r\nJOIN #t\r\nPRIVMSG #t :hi workers\r\n")
            time.sleep(0.4)
            atlas_irc.post(d, "report", "#t", "READY report: render()")
            buf = b""
            end = time.time() + 3
            while time.time() < end and b"READY report" not in buf:
                try:
                    buf += s.recv(65536)
                except socket.timeout:
                    break
            gw.stop.set()
            s.close()
            text = buf.decode()
            self.assertIn(" 433 ", text)  # worker nick is reserved
            self.assertIn("001 human", text)
            self.assertIn("READY geom: area()", text)  # replay on join
            self.assertIn(
                ":report!worker@atlas PRIVMSG #t :READY report: render()", text
            )  # live relay
            sent = [r for r in atlas_irc.history(d) if r["from"] == "human"]
            self.assertEqual(
                sent[0]["text"], "hi workers"
            )  # a client message reaches the workers' log
            self.assertEqual(len(atlas_irc.drain(d, "geom")), 2)


class HookTests(unittest.TestCase):
    def _env(self, tmp, **extra):
        d = _bus(tmp, nicks=("semver", "ranges"))
        env = {
            "ATLAS_IRC_DIR": str(d),
            "ATLAS_IRC_NICK": "ranges",
            "ATLAS_CREW_ROOT": tmp,
            "ATLAS_CREW_OWNS": json.dumps(["pkg/ranges.py"]),
            "ATLAS_CREW_OWNERS": json.dumps(
                {"pkg/ranges.py": "ranges", "pkg/semver.py": "semver"}
            ),
            "ATLAS_CREW_CHECK": "",
            "ATLAS_CREW_MAX_BLOCKS": "2",
        }
        env.update(extra)
        return d, env

    def _run(self, env, fn, payload):
        buf = io.StringIO()
        with mock.patch.dict(os.environ, env), contextlib.redirect_stdout(buf):
            fn(payload)
        return json.loads(buf.getvalue()) if buf.getvalue() else None

    def test_lease_denies_edit_of_a_peers_file_and_names_the_owner(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, env = self._env(tmp)
            out = self._run(
                env,
                crew_worker.pre_tool_use,
                {
                    "tool_name": "Edit",
                    "tool_input": {"file_path": f"{tmp}/pkg/semver.py"},
                },
            )
            hs = out["hookSpecificOutput"]
            self.assertEqual(hs["permissionDecision"], "deny")
            self.assertIn("leased to semver", hs["permissionDecisionReason"])
            self.assertIsNone(
                self._run(
                    env,
                    crew_worker.pre_tool_use,
                    {
                        "tool_name": "Write",
                        "tool_input": {"file_path": "pkg/ranges.py"},
                    },
                )
            )
            self.assertIsNone(
                self._run(
                    env,
                    crew_worker.pre_tool_use,
                    {"tool_name": "Read", "tool_input": {"file_path": "pkg/semver.py"}},
                )
            )

    def test_lease_denies_a_bash_write_to_a_peers_file_but_not_a_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, env = self._env(tmp)

            def bash(cmd):
                return self._run(
                    env, crew_worker.pre_tool_use, {"tool_name": "Bash", "tool_input": {"command": cmd}}
                )

            for cmd in (
                "cat > pkg/semver.py <<'EOF'\nx = 1\nEOF",
                "echo x >> ./pkg/semver.py",
                "sed -i 's/a/b/' pkg/semver.py",
                "cp /tmp/x.py pkg/semver.py",
                "python3 - <<'EOF'\nopen('pkg/semver.py', 'w').write('')\nEOF",
                "python3 -c \"from pathlib import Path; Path('pkg/semver.py').write_text('')\"",
            ):
                out = bash(cmd)
                self.assertIsNotNone(out, cmd)
                self.assertIn("leased to semver", out["hookSpecificOutput"]["permissionDecisionReason"])
            for cmd in (
                "cat pkg/semver.py > /tmp/copy.txt",
                "grep -n def pkg/semver.py; cat > pkg/ranges.py <<'EOF'\nx = 1\nEOF",
                "python3 -m pytest -q tests/test_semver.py",
            ):
                self.assertIsNone(bash(cmd), cmd)

    def test_post_tool_use_pushes_peer_messages_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp)
            atlas_irc.post(d, "semver", "#t", "READY semver: Version.parse(s)")
            out = self._run(env, crew_worker.post_tool_use, {})
            self.assertIn(
                "[irc] <semver> #t: READY semver",
                out["hookSpecificOutput"]["additionalContext"],
            )
            self.assertIsNone(self._run(env, crew_worker.post_tool_use, {}))

    def test_post_tool_use_ends_session_when_bash_check_posted_done_and_rerun_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="true")
            bash = {"tool_name": "Bash"}
            self.assertIsNone(self._run(env, crew_worker.post_tool_use, bash))  # no DONE yet
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done")
            self.assertIsNone(self._run(env, crew_worker.post_tool_use, {"tool_name": "Edit"}))
            out = self._run(env, crew_worker.post_tool_use, bash)
            self.assertIs(out["continue"], False)
            self.assertIn("ranges", out["stopReason"])
            self.assertIs(json.loads((d / "stop" / "ranges.json").read_text())["passed"], True)

    def test_post_tool_use_does_not_trust_a_hand_posted_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="exit 1")
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done")
            self.assertIsNone(self._run(env, crew_worker.post_tool_use, {"tool_name": "Bash"}))

    def test_post_tool_use_early_exit_keeps_pushed_messages_but_yields_to_a_question(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="true")
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done")
            atlas_irc.post(d, "semver", "#t", "READY semver: Version.parse(s); ranges imports it")
            out = self._run(env, crew_worker.post_tool_use, {"tool_name": "Bash"})
            self.assertIs(out["continue"], False)
            self.assertIn("READY semver", out["hookSpecificOutput"]["additionalContext"])
            atlas_irc.post(d, "semver", "ranges", "need prerelease compare?")
            out = self._run(env, crew_worker.post_tool_use, {"tool_name": "Bash"})
            self.assertNotIn("continue", out)
            self.assertIn("need prerelease", out["hookSpecificOutput"]["additionalContext"])

    def test_stop_gate_refuses_while_check_fails_then_gives_up_at_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="echo boom; exit 1")
            for i in (1, 2):
                out = self._run(env, crew_worker.stop, {})
                self.assertEqual(out["decision"], "block")
                self.assertIn(f"refusal {i}/2", out["reason"])
                self.assertIn("boom", out["reason"])
            self.assertIsNone(self._run(env, crew_worker.stop, {}))
            last = atlas_irc.history(d)[-1]
            self.assertTrue(last["text"].startswith("GAVE UP ranges"))

    def test_stop_gate_passes_and_announces_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="true")
            self.assertIsNone(self._run(env, crew_worker.stop, {}))
            self.assertEqual(atlas_irc.history(d)[-1]["kind"], "done")

    def test_stop_gate_does_not_repeat_a_done_the_check_already_posted(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="true")
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done")
            before = len(atlas_irc.history(d))
            self.assertIsNone(self._run(env, crew_worker.stop, {}))
            self.assertEqual(len(atlas_irc.history(d)), before)

    def test_irc_done_posts_once_and_again_after_a_give_up(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = _bus(tmp, nicks=("ranges",))
            dones = lambda: [r for r in atlas_irc.history(d) if r.get("kind") == "done"]
            with mock.patch.dict(os.environ, {"ATLAS_IRC_NICK": "ranges"}), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(atlas_irc.main(["--dir", str(d), "done"]), 0)
                self.assertEqual(atlas_irc.main(["--dir", str(d), "done"]), 0)
                self.assertEqual(len(dones()), 1)
                self.assertEqual(dones()[0]["text"], "DONE ranges: check passes")
                atlas_irc.post(d, "ranges", "#t", "GAVE UP ranges: x", kind="failed")
                self.assertEqual(atlas_irc.main(["--dir", str(d), "done", "fixed"]), 0)
                self.assertEqual(len(dones()), 2)
                self.assertEqual(dones()[1]["text"], "DONE ranges: fixed")

    def test_stop_gate_holds_a_worker_with_an_unanswered_question(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, ATLAS_CREW_CHECK="true")
            atlas_irc.post(d, "semver", "ranges", "do you need prerelease compare?")
            out = self._run(env, crew_worker.stop, {})
            self.assertEqual(out["decision"], "block")
            self.assertIn("do you need prerelease compare?", out["reason"])
            self.assertIsNone(self._run(env, crew_worker.stop, {}))


class PlanTests(unittest.TestCase):
    def _plan(self, tmp, workers, **extra):
        p = Path(tmp) / "plan.json"
        p.write_text(json.dumps({"goal": "g", "workers": workers, **extra}))
        return p

    def test_overlapping_ownership_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._plan(
                tmp,
                [
                    {"name": "a", "owns": ["x.py"], "task": "t"},
                    {"name": "b", "owns": ["x.py"], "task": "t"},
                ],
            )
            with self.assertRaisesRegex(ValueError, "owned by both"):
                atlas_crew.load_plan(p)

    def test_worker_without_files_or_bad_name_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "owns no files"):
                atlas_crew.load_plan(
                    self._plan(tmp, [{"name": "a", "owns": [], "task": "t"}])
                )
            with self.assertRaisesRegex(ValueError, "must match"):
                atlas_crew.load_plan(
                    self._plan(tmp, [{"name": "a b", "owns": ["x"], "task": "t"}])
                )
            with self.assertRaisesRegex(ValueError, "reserved"):
                atlas_crew.load_plan(
                    self._plan(tmp, [{"name": "lead", "owns": ["x"], "task": "t"}])
                )

    def test_context_hands_over_one_markdown_section(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "SPEC.md").write_text(
                "# Spec\nintro\n## 1. `semver.py`\nsemver body\n### Version\nv\n## 2. `ranges.py`\nranges body\n"
            )
            ctx = atlas_crew.resolve_context(["SPEC.md#semver", "literal note"], tmp)
            self.assertIn("semver body", ctx)
            self.assertIn("### Version", ctx)
            self.assertNotIn("ranges body", ctx)
            self.assertIn("literal note", ctx)

    def test_title_heading_hands_over_only_its_preamble(self):
        text = "# Spec\nintro\n## 1. `a.py`\na body\n"
        self.assertEqual(atlas_crew.section(text, "Spec"), "# Spec\nintro")

    def test_auto_plan_gives_each_file_its_own_section_test_and_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "pkg").mkdir()
            (root / "tests").mkdir()
            (root / "SPEC.md").write_text(
                "# Kit\nintro\n## Module dependency\na <- b\n## 1. `pkg/a.py`\nA\n"
                "### `class DependencyGraph`\nG\n## 2. `pkg/b.py`\nB\n"
            )
            for n in ("a", "b", "__init__"):
                (root / "pkg" / f"{n}.py").write_text("")
            for n in ("a", "b"):
                (root / "tests" / f"test_{n}.py").write_text("")
            plan = atlas_crew.auto_plan(
                tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q"
            )
        self.assertEqual(plan["context"], ["SPEC.md#Kit", "SPEC.md#Module dependency"])
        self.assertEqual([w["name"] for w in plan["workers"]], ["a", "b"])
        a = plan["workers"][0]
        self.assertEqual(a["owns"], ["pkg/a.py"])
        self.assertEqual(a["context"], ["SPEC.md#1. `pkg/a.py`", "pkg/a.py"])
        self.assertEqual(a["check"], "irc check")
        self.assertEqual(a["unit_check"], "python3 -m pytest -q tests/test_a.py")
        self.assertEqual(a["needs"], [])

    def _dep_tree(self, tmp, files):
        root = Path(tmp)
        (root / "pkg").mkdir()
        (root / "tests").mkdir()
        (root / "SPEC.md").write_text("# Kit\nintro\n")
        for n, body in files.items():
            (root / "pkg" / f"{n}.py").write_text(body)
            (root / "tests" / f"test_{n}.py").write_text("")
        return atlas_crew.auto_plan(
            tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q"
        )

    def test_auto_plan_wires_the_wait_for_imported_peers_into_the_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self._dep_tree(
                tmp, {"leaf": "", "mid": "from .leaf import x\n", "top": "from . import leaf, mid\n"}
            )
        ws = {w["name"]: w for w in plan["workers"]}
        for w in ws.values():
            self.assertEqual(w["check"], "irc check")
            self.assertNotIn("irc", w["unit_check"])
        self.assertEqual(ws["leaf"]["needs"], [])
        self.assertEqual(ws["mid"]["needs"], ["leaf"])
        self.assertEqual(ws["top"]["needs"], ["leaf", "mid"])
        self.assertEqual(ws["top"]["unit_check"], "python3 -m pytest -q tests/test_top.py")
        self.assertEqual(ws["leaf"]["unit_check"], "python3 -m pytest -q tests/test_leaf.py")

    def test_worker_env_carries_the_needs_and_unit_check_of_an_auto_plan_worker(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self._dep_tree(tmp, {"leaf": "", "mid": "from .leaf import x\n"})
            mid = [w for w in plan["workers"] if w["name"] == "mid"][0]
            env = atlas_crew.worker_env(Path(tmp) / "run", plan, mid, tmp)
        self.assertEqual(env["ATLAS_CREW_CHECK"], "irc check")
        self.assertEqual(env["ATLAS_CREW_NEEDS"], "leaf")
        self.assertEqual(env["ATLAS_CREW_UNIT_CHECK"], "python3 -m pytest -q tests/test_mid.py")

    def test_load_plan_wraps_a_hand_written_check_in_irc_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "plan.json"
            p.write_text(json.dumps({"workers": [
                {"name": "a", "owns": ["a.py"], "task": "t", "check": "pytest -q t_a.py"},
                {"name": "b", "owns": ["b.py"], "task": "t", "check": "pytest -q t_b.py", "needs": ["a"]},
                {"name": "c", "owns": ["c.py"], "task": "t"},
            ]}))
            ws = {w["name"]: w for w in atlas_crew.load_plan(p)["workers"]}
            p.write_text(json.dumps({"workers": list(ws.values())}))
            again = {w["name"]: w for w in atlas_crew.load_plan(p)["workers"]}
        self.assertEqual((ws["a"]["check"], ws["a"]["unit_check"], ws["a"]["needs"]), ("irc check", "pytest -q t_a.py", []))
        self.assertEqual(ws["b"]["needs"], ["a"])
        self.assertFalse(ws["c"].get("check"))
        self.assertEqual(again, ws)  # idempotent

    def test_import_cycle_yields_no_mutual_wait(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self._dep_tree(
                tmp, {"a": "from .b import y\n", "b": "from .a import x\n", "c": "from .a import x\n"}
            )
        needs = {w["name"]: w["needs"] for w in plan["workers"]}
        self.assertEqual(needs, {"a": ["b"], "b": [], "c": ["a"]})

    def test_interface_keeps_public_signatures_and_drops_bodies(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "m.py"
            f.write_text(
                "from dataclasses import dataclass\n"
                "@dataclass\nclass Version:\n    \"\"\"A version.\"\"\"\n    major: int\n"
                "    def bump(self, n: int = 1) -> 'Version':\n        \"\"\"Bump it.\"\"\"\n        raise NotImplementedError\n"
                "    def _hidden(self): ...\n"
                "def _private(): ...\n"
            )
            out = atlas_crew._interface(f)
            self.assertEqual(atlas_crew._interface(Path(tmp) / "missing.py"), "")
        self.assertIn("class Version:", out)
        self.assertIn("    major: int", out)
        self.assertIn("def bump(self, n: int=1) -> 'Version': ...  # Bump it.", out)
        self.assertNotIn("NotImplementedError", out)
        self.assertNotIn("_hidden", out)
        self.assertNotIn("_private", out)

    def test_auto_plan_hands_a_worker_the_interfaces_of_the_peers_it_imports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "pkg").mkdir()
            (root / "SPEC.md").write_text("# Kit\nintro\n## `pkg/a.py`\nA\n")
            (root / "pkg" / "a.py").write_text("from .b import B\n")
            (root / "pkg" / "b.py").write_text("class B:\n    def go(self) -> int:\n        raise NotImplementedError\n")
            (root / "pkg" / "c.py").write_text("import os\n")
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "pkg/*.py")
        ws = {w["name"]: w for w in plan["workers"]}
        ctx = ws["a"]["context"]
        iface = [e for e in ctx if e.startswith("Interfaces of the peer files you import")]
        self.assertEqual(len(iface), 1)
        self.assertIn("# b owns pkg/b.py", iface[0])
        self.assertIn("class B:", iface[0])
        self.assertEqual(ctx[-1], "pkg/a.py")
        self.assertLess(ctx.index(iface[0]), ctx.index("pkg/a.py"))
        for n in ("b", "c"):
            self.assertFalse([e for e in ws[n]["context"] if e.startswith("Interfaces")])

    def test_local_deps_resolves_import_forms_without_self_or_duplicates(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "pkg").mkdir()
            (root / "pkg" / "a.py").write_text(
                "from . import b as bm\nimport pkg.c\nfrom pkg.b import X\nfrom .a import Y\nimport json\n"
            )
            rels = ["pkg/a.py", "pkg/b.py", "pkg/c.py"]
            self.assertEqual(atlas_crew._local_deps("pkg/a.py", rels, root), ["pkg/b.py", "pkg/c.py"])

    def _kit(self, tmp, src, tests, layout="pkg"):
        """Write a tree: `src` {rel: body} and `tests` {rel: body} under tmp, plus a SPEC.md."""
        root = Path(tmp)
        (root / "SPEC.md").write_text("# Kit\nintro\n")
        for rel, body in {**src, **tests}.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(body)
        return root

    def test_auto_plan_context_does_not_hold_the_workers_test_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._kit(tmp, {"pkg/a.py": "from .b import B\n", "pkg/b.py": "class B:\n    pass\n"},
                      {"tests/test_a.py": "def test_a():\n    assert 1 == 1\n", "tests/test_b.py": "def test_b(): pass\n"})
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q")
        a = {w["name"]: w for w in plan["workers"]}["a"]
        self.assertEqual(a["tests"], ["tests/test_a.py"])
        self.assertFalse([e for e in a["context"] if "def test_" in e])

    def test_needs_include_a_peer_imported_inside_a_function(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._kit(tmp, {"pkg/a.py": "def f():\n    if True:\n        from .b import B\n        return B\n", "pkg/b.py": ""},
                      {"tests/test_a.py": "", "tests/test_b.py": ""})
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q")
        self.assertEqual({w["name"]: w for w in plan["workers"]}["a"]["needs"], ["b"])

    def test_needs_include_a_peer_imported_as_from_dot_import_x(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._kit(tmp, {"pkg/a.py": "from . import b\n", "pkg/b.py": ""},
                      {"tests/test_a.py": "", "tests/test_b.py": ""})
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q")
        self.assertEqual({w["name"]: w for w in plan["workers"]}["a"]["needs"], ["b"])

    def test_needs_include_a_peer_imported_by_absolute_package_name_in_a_src_layout(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._kit(tmp, {"src/pkg/a.py": "import pkg.b\n", "src/pkg/b.py": ""},
                      {"tests/test_a.py": "", "tests/test_b.py": ""})
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "src/pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q")
        self.assertEqual({w["name"]: w for w in plan["workers"]}["a"]["needs"], ["b"])

    def test_needs_include_a_peer_only_the_workers_test_file_imports(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._kit(tmp, {"pkg/a.py": "", "pkg/b.py": "def parse(s):\n    raise NotImplementedError\n"},
                      {"tests/test_a.py": "from pkg.a import f\nfrom pkg.b import parse\n", "tests/test_b.py": ""})
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q")
        ws = {w["name"]: w for w in plan["workers"]}
        self.assertEqual(ws["a"]["needs"], ["b"])
        self.assertEqual(ws["b"]["needs"], [])
        self.assertTrue([e for e in ws["a"]["context"] if e.startswith("Interfaces")])

    def test_cycles_through_test_imports_are_still_broken(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._kit(tmp, {"pkg/a.py": "from .b import x\n", "pkg/b.py": ""},
                      {"tests/test_a.py": "", "tests/test_b.py": "from pkg.a import y\n"})
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "pkg/*.py", "tests/test_{stem}.py", "python3 -m pytest -q")
        ws = {w["name"]: w for w in plan["workers"]}
        self.assertEqual(ws["a"]["needs"], ["b"])
        self.assertEqual(ws["b"]["needs"], [])

    def test_a_hash_line_inside_a_code_fence_does_not_end_the_section(self):
        text = (
            "# Spec\n## 6. `lock.py`\nformat:\n```\n# lockfile v1\npkg a\n```\n"
            "inline ``` `` a`b `` ``` stays text\nmore\n## 7. `graph.py`\ng\n"
        )
        sec = atlas_crew.section(text, "6. `lock.py`")
        self.assertIn("more", sec)
        self.assertNotIn("graph", sec)

    def test_auto_plan_scopes_package_sections_and_prefixes_twin_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            spec = "# W\n## alpha overview\nA\n## 1. `alpha/cli.py`\na\n## beta overview\nB\n## 1. `beta/cli.py`\nb\n"
            (root / "SPEC.md").write_text(spec)
            for pkg in ("alpha", "beta"):
                (root / pkg).mkdir()
                (root / pkg / "cli.py").write_text("")
                (root / "tests" / pkg).mkdir(parents=True)
                (root / "tests" / pkg / "test_cli.py").write_text("")
            plan = atlas_crew.auto_plan(
                tmp, "SPEC.md", "*/cli.py", "tests/{parent}/test_{stem}.py", "python3 -m pytest -q"
            )
        self.assertEqual(plan["context"], ["SPEC.md#W"])
        beta = {w["name"]: w for w in plan["workers"]}["beta-cli"]
        self.assertEqual(
            beta["context"], ["SPEC.md#beta overview", "SPEC.md#1. `beta/cli.py`", "beta/cli.py"]
        )
        self.assertEqual(beta["unit_check"], "python3 -m pytest -q tests/beta/test_cli.py")

    def test_auto_plan_never_makes_a_worker_of_a_matched_test_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "SPEC.md").write_text("# Kit\nintro\n")
            for n in ("geom", "test_geom", "report", "test_report"):
                (root / f"{n}.py").write_text("")
            plan = atlas_crew.auto_plan(tmp, "SPEC.md", "*.py", "test_{stem}.py", "python3 -m pytest -q")
            (root / "extra_test.py").write_text("")
            (root / "test_solo.py").write_text("")
            plan2 = atlas_crew.auto_plan(tmp, "SPEC.md", "*.py", None, "python3 -m pytest -q")
        self.assertEqual([w["name"] for w in plan["workers"]], ["geom", "report"])
        self.assertEqual(plan["workers"][0]["tests"], ["test_geom.py"])
        self.assertEqual([w["name"] for w in plan2["workers"]], ["geom", "report"])

    def test_worker_prompt_names_peers_ownership_and_check(self):
        plan = {
            "goal": "g",
            "workers": [
                {
                    "name": "a",
                    "owns": ["a.py"],
                    "task": "do a",
                    "check": "pytest -q t_a.py",
                },
                {"name": "b", "owns": ["b.py"], "task": "do b"},
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            text = atlas_crew.worker_prompt(plan, plan["workers"][0], "crew-x", tmp)
        self.assertIn("- b owns b.py", text)
        self.assertIn("`pytest -q t_a.py` passes", text)
        self.assertIn("- a.py", text)

    def test_route_failures_maps_failing_tests_to_their_owner(self):
        plan = {
            "workers": [
                {
                    "name": "semver",
                    "owns": ["pkg/semver.py"],
                    "tests": ["tests/test_semver.py"],
                },
                {"name": "cli", "owns": ["pkg/cli.py"], "tests": ["tests/test_cli.py"]},
            ]
        }
        out = (
            "FAILED tests/test_cli.py::test_lock - AssertionError\n1 failed, 40 passed"
        )
        self.assertEqual(list(atlas_crew.route_failures(plan, out)), ["cli"])


class WorkerLaunchTests(unittest.TestCase):
    def test_worker_is_lean_and_gets_its_own_session(self):
        argv = atlas_crew.worker_argv("sonnet", "medium", "/s.json", "sid-1", "PROMPT")
        for flag in (
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--no-chrome",
            "--session-id",
        ):
            self.assertIn(flag, argv)
        self.assertEqual(argv[argv.index("--tools") + 1], atlas_crew.WORKER_TOOLS)
        self.assertEqual(argv[argv.index("--session-id") + 1], "sid-1")
        self.assertEqual(argv[-1], "PROMPT")
        resumed = atlas_crew.worker_argv(
            "sonnet", None, "/s.json", "sid-1", "FIX", resume="sid-1"
        )
        self.assertIn("--resume", resumed)
        self.assertNotIn("--session-id", resumed)
        named = atlas_crew.worker_argv("sonnet", None, "/s.json", "sid-1", "P", name="crew-x-a")
        self.assertEqual(named[named.index("--name") + 1], "crew-x-a")

    def test_worker_env_drops_the_leads_session_identity(self):
        plan = {
            "workers": [{"name": "a", "owns": ["a.py"], "task": "t", "check": "true"}]
        }
        lead_env = {
            "CLAUDE_CODE_SESSION_ID": "lead",
            "CLAUDE_CODE_REMOTE_SESSION_ID": "lead",
            "TMUX": "x",
            "KEEP": "1",
            "PATH": "/usr/bin",
        }
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.dict(os.environ, lead_env, clear=True),
        ):
            env = atlas_crew.worker_env(Path(tmp), plan, plan["workers"][0], tmp)
        self.assertNotIn("CLAUDE_CODE_SESSION_ID", env)
        self.assertNotIn("CLAUDE_CODE_REMOTE_SESSION_ID", env)
        self.assertNotIn("TMUX", env)
        self.assertEqual(env["KEEP"], "1")
        self.assertEqual(env["ATLAS_IRC_NICK"], "a")
        self.assertTrue(env["PATH"].startswith(str(Path(tmp) / "bin")))

    def test_worker_that_lingers_after_its_result_is_reaped_as_success(self):
        # live: a finished worker held open by a stray background shell for 9 minutes
        with tempfile.TemporaryDirectory() as tmp:
            rundir = Path(tmp) / "run"
            (rundir / "prompts").mkdir(parents=True)
            (rundir / "prompts" / "a.md").write_text("P")
            plan = {"workers": [{"name": "a", "owns": ["a.py"], "task": "t", "check": "true"}]}
            (rundir / "run.json").write_text(
                json.dumps({"plan": plan, "root": tmp, "run_id": "crew-t", "settings": "/s.json"})
            )
            fake = Path(tmp) / "bin" / "claude"
            fake.parent.mkdir()
            fake.write_text(
                "#!/bin/sh\necho '{\"type\":\"result\",\"is_error\":false}'\nexec sleep 60\n"
            )
            fake.chmod(0o755)
            args = types.SimpleNamespace(rundir=str(rundir), name="a", round=0, no_hold=True)
            env = {"PATH": f"{fake.parent}{os.pathsep}{os.environ['PATH']}"}
            t0 = time.time()
            with mock.patch.dict(os.environ, env), mock.patch.object(
                atlas_crew, "RESULT_GRACE_S", 0.5
            ), contextlib.redirect_stdout(io.StringIO()):
                atlas_crew.cmd_worker(args)
            self.assertLess(time.time() - t0, 20)
            rec = json.loads((rundir / "exit" / "a.r0.json").read_text())
            self.assertEqual(rec["exit"], 0)
            self.assertIn("terminated", (rundir / "logs" / "a.log").read_text())

    def test_worker_env_turns_off_background_shells(self):
        plan = {"workers": [{"name": "a", "owns": ["a.py"], "task": "t", "check": "true"}]}
        env = atlas_crew.worker_env(Path("/r"), plan, plan["workers"][0], "/root")
        self.assertEqual(env["CLAUDE_CODE_DISABLE_BACKGROUND_TASKS"], "1")

    def test_worker_env_skips_nonessential_traffic(self):
        plan = {"workers": [{"name": "a", "owns": ["a.py"], "task": "t", "check": "true"}]}
        env = atlas_crew.worker_env(Path("/r"), plan, plan["workers"][0], "/root")
        self.assertEqual(env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"], "1")

    def test_usage_of_counts_cumulative_usage_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "w.log"
            ev = {
                "type": "result",
                "total_cost_usd": 0.5,
                "num_turns": 3,
                "modelUsage": {
                    "m": {
                        "inputTokens": 10,
                        "cacheCreationInputTokens": 100,
                        "cacheReadInputTokens": 1000,
                        "outputTokens": 5,
                    }
                },
            }
            log.write_text("noise\n" + json.dumps(ev) + "\n" + json.dumps(ev) + "\n")
            u = atlas_crew.usage_of(log)
        # a repeated result (same cumulative modelUsage) must not double the count
        self.assertEqual(u["total"], 1115)
        self.assertEqual(u["cost_usd"], 0.5)
        self.assertEqual(u["turns"], 6)


class VerifiedDoneTests(unittest.TestCase):
    """A DONE is posted by `irc check` after the unit check passed, never from the worker's word."""

    IRC = str(Path(__file__).resolve().parent / "atlas_irc.py")

    def _env(self, tmp, unit, needs="", nick="ranges"):
        d = _bus(tmp, nicks=("semver", "ranges"))
        env = {
            "ATLAS_IRC_DIR": str(d),
            "ATLAS_IRC_NICK": nick,
            "ATLAS_CREW_ROOT": tmp,
            "ATLAS_CREW_UNIT_CHECK": unit,
            "ATLAS_CREW_NEEDS": needs,
        }
        return d, env

    def _irc(self, env, *argv):
        buf = io.StringIO()
        with mock.patch.dict(os.environ, env), contextlib.redirect_stdout(buf):
            code = atlas_irc.main(list(argv))
        return code, buf.getvalue()

    def _dones(self, d, nick="ranges"):
        return [r for r in atlas_irc.history(d) if r.get("kind") == "done" and r["from"] == nick]

    def test_check_with_failing_unit_check_posts_no_done_even_when_piped(self):
        import subprocess

        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "echo boom-output; exit 1")
            full = {**os.environ, **env}
            res = subprocess.run(
                f"{sys.executable} {self.IRC} check | tail -15 && echo piped-ok",
                shell=True, env=full, capture_output=True, text=True, cwd=tmp,
            )
            self.assertIn("boom-output", res.stdout)
            self.assertEqual(self._dones(d), [])
            code, out = self._irc(env, "check")
            self.assertEqual(code, 1)
            self.assertIn("boom-output", out)
            self.assertEqual(self._dones(d), [])

    def test_check_with_passing_unit_check_posts_done_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "echo all-green")
            for _ in range(2):
                code, out = self._irc(env, "check")
                self.assertEqual(code, 0)
                self.assertIn("all-green", out)
            self.assertEqual(len(self._dones(d)), 1)

    def test_check_waits_for_needs_with_need_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "true", needs="semver")
            code, out = self._irc(env, "check", "--timeout", "0.3")
            self.assertEqual(code, 3)
            self.assertEqual(self._dones(d), [])
            atlas_irc.post(d, "semver", "#t", "GAVE UP semver: x", kind="failed")
            self.assertEqual(self._irc(env, "check", "--timeout", "2")[0], 4)
            _, env2 = self._env(tmp, "true", needs="nobody")
            self.assertEqual(self._irc({**env, "ATLAS_CREW_NEEDS": "nobody"}, "check")[0], 2)

    def test_check_runs_unit_check_only_after_needs_are_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "echo ran > ran.txt", needs="semver")
            atlas_irc.post(d, "semver", "#t", "DONE semver", kind="done")
            self.assertEqual(self._irc(env, "check", "--timeout", "2")[0], 0)
            self.assertTrue((Path(tmp) / "ran.txt").exists())  # the shell ran in ATLAS_CREW_ROOT

    def test_manual_done_refuses_while_the_unit_check_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "echo red-tests; exit 1")
            code, out = self._irc(env, "done")
            self.assertEqual(code, 1)
            self.assertIn("red-tests", out)
            self.assertEqual(self._dones(d), [])
            _, env_ok = self._env(tmp, "true")
            self.assertEqual(self._irc(env_ok, "done")[0], 0)
            self.assertEqual(len(self._dones(d)), 1)

    def test_a_passing_check_after_a_failed_one_posts_a_fresh_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "test -f ok.flag")
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done")  # the stale, false DONE
            self.assertEqual(self._irc(env, "check")[0], 1)
            self.assertFalse(atlas_irc.has_done(d, "ranges"))
            peer_env = {**env, "ATLAS_IRC_NICK": "semver"}
            self.assertEqual(self._irc(peer_env, "need", "--done", "ranges", "--timeout", "0.3")[0], 3)
            (Path(tmp) / "ok.flag").write_text("")
            self.assertEqual(self._irc(env, "check")[0], 0)
            self.assertEqual(len(self._dones(d)), 2)
            self.assertTrue(atlas_irc.has_done(d, "ranges"))
            code, out = self._irc(peer_env, "need", "--done", "ranges", "--timeout", "2")
            self.assertEqual(code, 0)
            self.assertIn("<ranges> DONE ranges", out)

    def test_a_refused_done_also_invalidates_an_earlier_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "exit 1")
            atlas_irc.post(d, "ranges", "#t", "DONE ranges: check passes", kind="done")
            self.assertEqual(self._irc(env, "done")[0], 1)
            self.assertFalse(atlas_irc.has_done(d, "ranges"))

    def test_a_failed_check_is_not_broadcast_to_peers(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, env = self._env(tmp, "exit 1")
            self._irc(env, "check")
            self.assertEqual(atlas_irc.drain(d, "semver"), [])


class SleepDenyTests(unittest.TestCase):
    def _denied(self, cmd):
        env = {
            "ATLAS_CREW_OWNS": json.dumps(["pkg/ranges.py"]),
            "ATLAS_CREW_OWNERS": json.dumps({"pkg/ranges.py": "ranges"}),
        }
        buf = io.StringIO()
        with mock.patch.dict(os.environ, env), contextlib.redirect_stdout(buf):
            crew_worker.pre_tool_use({"tool_name": "Bash", "tool_input": {"command": cmd}})
        out = json.loads(buf.getvalue()) if buf.getvalue() else None
        return out["hookSpecificOutput"]["permissionDecisionReason"] if out else None

    def test_sleep_of_three_seconds_or_more_is_denied_with_a_pointer_to_irc_wait(self):
        for cmd in ("sleep 45", "x; sleep 10s; y", "sleep 45; python3 -m pytest -q", "a && sleep 3 && b", "sleep 2.5m"):
            reason = self._denied(cmd)
            self.assertIsNotNone(reason, cmd)
            self.assertIn("irc wait", reason)
            self.assertIn("irc check", reason)

    def test_short_sleeps_and_lookalike_words_pass(self):
        for cmd in ("sleep 1", "sleep 2", "echo sleepy", "sleep", "sleep 0.5", "python3 -c 'import time'"):
            self.assertIsNone(self._denied(cmd), cmd)


if __name__ == "__main__":
    unittest.main()
