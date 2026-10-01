#!/usr/bin/env python3
"""Tests for the tmux colony mode (atlas_mux.py).

Every tmux/claude/omp call is served by tiny fake binaries on a private PATH:
the fake `tmux` logs argv, models session/window existence as marker files,
and runs `new-window` commands detached so board files fill asynchronously;
the fake harnesses log argv + worker env and emit canned report lines.
"""
# Real-tmux smoke lives in docs (subagent-kit.md "Colony mux mode"); these
# tests never touch a real tmux server.

import contextlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parent / "atlas_mux.py"

FAKE_TMUX = r"""#!/bin/bash
# Fake tmux: logs argv; state dir from FAKE_TMUX_STATE.
STATE="${FAKE_TMUX_STATE:?}"
LOG="${FAKE_HARNESS_LOG}"
echo "tmux $*" >>"$LOG"
cmd="$1"; shift
mkdir -p "$STATE"
case "$cmd" in
  has-session)
    [ -f "$STATE/session" ] ;;
  new-session)
    : > "$STATE/session"; : > "$STATE/window.lead" ;;
  new-window)
    name=""
    rest=("$@")
    args=()
    i=0
    while [ $i -lt ${#rest[@]} ]; do
      w="${rest[$i]}"
      case "$w" in
        -d) ;;
        -t) i=$((i+1)) ;;
        -n) i=$((i+1)); name="${rest[$i]}" ;;
        *) break ;;
      esac
      i=$((i+1))
    done
    [ -f "$STATE/session" ] || { echo "no session" >&2; exit 1; }
    : > "$STATE/window.$name"
    out="$STATE/out.$name"
    ( bash -c "${rest[$i]}" >"$out" 2>&1 & ) ;;
  set-option)
    : ;;
  list-windows)
    if [ ! -f "$STATE/session" ]; then exit 1; fi
    for f in "$STATE"/window.*; do
      [ -e "$f" ] || continue
      printf '%s\t0\t64911\n' "$(basename "$f" | sed "s/^window\.//")"
    done ;;
  kill-session)
    rm -f "$STATE/session" "$STATE"/window.* ;;
  *)
    echo "unknown-fake-tmux-cmd: $cmd" >&2; exit 1 ;;
esac
"""

FAKE_HARNESS = r"""#!/bin/bash
# Fake claude/omp: log argv + worker env; canned report lines.
L="${FAKE_HARNESS_LOG:?}"
echo "argv[basename=$(basename "$0")]: $*" >>"$L"
: > "$(dirname "$L")/argv.$(basename "$0")"
for a in "$@"; do printf '%s\0' "$a" >>"$(dirname "$L")/argv.$(basename "$0")"; done
echo "env: ATLAS_WORKER_NAME=[$ATLAS_WORKER_NAME] ATLAS_PROJECT_ROOT=[$ATLAS_PROJECT_ROOT]" >>"$L"
echo "fake-report-1"
echo "fake-report-2"
exit "${FAKE_HARNESS_EXIT:-0}"
"""


def _run(*argv, env=None, cwd=None, stdin_text=None):
    p = subprocess.run(
        [sys.executable, str(SCRIPT), *argv],
        capture_output=True,
        text=True,
        env=env,
        cwd=cwd,
        input=stdin_text,
        timeout=120,
    )
    try:
        data = json.loads(p.stdout)
    except ValueError:
        data = {}
    return p.returncode, data, p.stdout, p.stderr


def _tmux_log_calls(state):
    log = pathlib.Path(state) / "log"
    if not log.exists():
        return []
    with open(log, "r", encoding="utf-8") as fh:
        return [line.rstrip("\n") for line in fh if line.startswith("tmux ")]


def _fake_harness_argv(state):
    """Return (basename, argv_tokens) of the fake harness log's argv line."""
    for base in ("claude", "omp"):
        path = pathlib.Path(state) / f"argv.{base}"
        if path.exists():
            return base, path.read_text(encoding="utf-8").split("\0")[:-1]
    raise AssertionError("fake harness was never invoked")


def _read_board(path):
    out = []
    if not os.path.exists(path):
        return out
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            with contextlib.suppress(ValueError):
                rec = json.loads(line)
                if isinstance(rec, dict):
                    out.append(rec)
    return out


def _wait_board(path, needle, timeout=20.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        recs = _read_board(path)
        if any(needle(rec) for rec in recs):
            return recs
        time.sleep(0.05)
    raise AssertionError(f"board never produced {needle!r}: {_read_board(path)}")


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = self._tmp.name
        self.state = os.path.join(self.root, "fake-state")
        os.makedirs(self.state)
        self.bin_dir = os.path.join(self.root, "bin")
        os.makedirs(self.bin_dir)
        for name, body in (
            ("tmux", FAKE_TMUX),
            ("claude", FAKE_HARNESS),
            ("omp", FAKE_HARNESS),
        ):
            p = pathlib.Path(self.bin_dir) / name
            p.write_text(body)
            p.chmod(0o755)
        self.env = dict(os.environ)
        self.env["PATH"] = self.bin_dir + os.pathsep + self.env["PATH"]
        self.env["FAKE_TMUX_STATE"] = self.state
        self.env["FAKE_HARNESS_LOG"] = os.path.join(self.state, "log")
        # isolated tmux log namespace per test
        with open(os.path.join(self.state, "log"), "w", encoding="utf-8"):
            pass

    def spawn_env(self, mux=1, extra=None):
        env = dict(self.env)
        env["ATLAS_PROJECT_ROOT"] = self.root
        if mux:
            env["ATLAS_MUX"] = "tmux"
        else:
            env.pop("ATLAS_MUX", None)
        env.update(extra or {})
        return env

    def make_agent(self, harness_dir, role, body):
        d = pathlib.Path(self.root) / "agents" / harness_dir
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{role}.md").write_text(body)

    def board_file(self, name):
        p = pathlib.Path(self.root) / ".atlas" / ".run" / "board" / f"{name}.jsonl"
        return str(p)

    def make_prompt(self, name, text):
        p = pathlib.Path(self.root) / f"{name}.txt"
        p.write_text(text)
        return str(p)


class SpawnGateTests(Base):
    def test_spawn_requires_mux_opt_in(self):
        with open(self.make_prompt("p", "hello"), "r", encoding="utf-8"):
            pass
        rc, data, _, _ = _run(
            "spawn",
            "--run", "r1",
            "--harness", "claude",
            "--name", "Alpha",
            "--agent", "explorer",
            "--prompt-file", self.make_prompt("p", "hello"),
            env=self.spawn_env(mux=0),
            cwd=self.root,
        )
        self.assertNotIn("tmux ", "\n".join(_tmux_log_calls(self.state)))
        self.assertFalse(data.get("ok"), data)
        self.assertIn("mux", str(data.get("error", "")))

    def test_spawn_rejects_bad_name(self):
        rc, data, _, _ = _run(
            "spawn",
            "--run", "r1",
            "--harness", "claude",
            "--name", "Bad Name!",
            "--agent", "explorer",
            "--prompt-file", self.make_prompt("p", "hello"),
            env=self.spawn_env(),
            cwd=self.root,
        )
        self.assertNotIn("tmux ", "\n".join(_tmux_log_calls(self.state)))
        self.assertFalse(data.get("ok"), data)

    def test_spawn_missing_prompt_file(self):
        rc, data, _, _ = _run(
            "spawn",
            "--run", "r1",
            "--harness", "claude",
            "--name", "Alpha",
            "--agent", "explorer",
            "--prompt-file", os.path.join(self.root, "nope.txt"),
            env=self.spawn_env(),
            cwd=self.root,
        )
        self.assertNotIn("tmux ", "\n".join(_tmux_log_calls(self.state)))
        self.assertFalse(data.get("ok"), data)
        self.assertIn("prompt", str(data.get("error", "")))


class SpawnClaudeTests(Base):
    def spawn(self, model=None, effort=None, name="Alpha"):
        argv = [
            "spawn",
            "--run", "r1",
            "--harness", "claude",
            "--name", name,
            "--agent", "explorer",
            "--prompt-file", self.make_prompt("p", "colonize the pane"),
            "--agents-dir", os.path.join(self.root, "agents"),
        ]
        if model:
            argv += ["--model", model]
        if effort:
            argv += ["--effort", effort]
        return _run(*argv, env=self.spawn_env(), cwd=self.root)

    def test_claude_argv_and_tier_from_frontmatter(self):
        self.make_agent(
            "claude",
            "explorer",
            "---\nname: explorer\nmodel: opus\neffort: high\n---\nbody\n",
        )
        rc, data, _, err = self.spawn()
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data.get("ok"), data)
        self.assertEqual("atlas-r1", data.get("session"))
        self.assertEqual("opus", data.get("model"))

        calls = "\n".join(_tmux_log_calls(self.state))
        self.assertIn("has-session -t atlas-r1", calls)
        self.assertIn("new-session -d -s atlas-r1 -n lead", calls)
        self.assertIn("remain-on-exit off", calls)
        self.assertIn("new-window -d -t atlas-r1 -n Alpha exec ", calls)
        self.assertIn("run-worker", calls)

        recs = _wait_board(self.board_file("Alpha"), lambda r: r.get("kind") == "exit")
        base, argv = _fake_harness_argv(self.state)
        self.assertEqual("claude", base)
        self.assertEqual(
            ["-p", "--agent", "atlas:explorer", "--model", "opus", "--effort", "high",
             "--permission-mode", "acceptEdits", "colonize the pane"],
            argv,
        )
        self.assertEqual(0, recs[-1].get("code"))
        self.assertEqual(
            ["fake-report-1", "fake-report-2"],
            [r.get("text") for r in recs if r.get("kind") == "report"],
        )
        for rec in recs:
            self.assertEqual("Alpha", rec.get("name"))
            self.assertEqual("Alpha", rec.get("owner"))
            self.assertEqual("lead", rec.get("to"))
            self.assertIsInstance(rec.get("ts"), float)

    def test_claude_env_pinned_for_worker(self):
        self.make_agent("claude", "explorer", "---\nmodel: opus\n---\n")
        rc, data, _, err = self.spawn()
        self.assertEqual(0, rc, (data, err))
        _wait_board(self.board_file("Alpha"), lambda r: r.get("kind") == "exit")
        with open(os.path.join(self.state, "log"), "r", encoding="utf-8") as fh:
            env_line = next(
                (line for line in fh if line.startswith("env:")), ""
            )
        self.assertIn(f"ATLAS_PROJECT_ROOT=[{self.root}]", env_line)
        self.assertIn("ATLAS_WORKER_NAME=[Alpha]", env_line)

    def test_model_flag_overrides_frontmatter(self):
        self.make_agent(
            "claude", "explorer", "---\nmodel: opus\neffort: high\n---\nbody\n"
        )
        rc, data, _, err = self.spawn(model="haiku")
        self.assertEqual(0, rc, (data, err))
        _wait_board(self.board_file("Alpha"), lambda r: r.get("kind") == "exit")
        _, argv = _fake_harness_argv(self.state)
        pairs = [list(pair) for pair in zip(argv, argv[1:])]
        # the harness argv carries the override, not the frontmatter model
        self.assertIn(["--model", "haiku"], pairs)
        self.assertNotIn(["--model", "opus"], pairs)
        self.assertIn(["--effort", "high"], pairs)

    def test_claude_effort_flag_overrides_frontmatter(self):
        self.make_agent(
            "claude", "explorer", "---\nmodel: opus\neffort: high\n---\nbody\n"
        )
        rc, data, _, err = self.spawn(effort="max")
        self.assertEqual(0, rc, (data, err))
        _wait_board(self.board_file("Alpha"), lambda r: r.get("kind") == "exit")
        _, argv = _fake_harness_argv(self.state)
        pairs = [list(pair) for pair in zip(argv, argv[1:])]
        self.assertIn(["--effort", "max"], pairs)
        self.assertNotIn(["--effort", "high"], pairs)
        self.assertIn(["--model", "opus"], pairs)

    def test_missing_agent_file_omits_tier(self):
        rc, data, _, err = self.spawn()
        self.assertEqual(0, rc, (data, err))
        self.assertIsNone(data.get("model"))
        _wait_board(self.board_file("Alpha"), lambda r: r.get("kind") == "exit")
        _, argv = _fake_harness_argv(self.state)
        pairs = [list(pair) for pair in zip(argv, argv[1:])]
        self.assertNotIn("--effort", argv)
        self.assertNotIn("--model", argv)


class SpawnOmpTests(Base):
    def spawn(self, model=None, thinking=None, name="Beta"):
        argv = [
            "spawn",
            "--run", "r1",
            "--harness", "omp",
            "--name", name,
            "--agent", "explorer",
            "--prompt-file", self.make_prompt("p", "colonize the pane"),
            "--agents-dir", os.path.join(self.root, "agents"),
        ]
        if model:
            argv += ["--model", model]
        if thinking:
            argv += ["--thinking", thinking]
        return _run(*argv, env=self.spawn_env(), cwd=self.root)

    def test_omp_argv_and_thinking_tier(self):
        self.make_agent(
            "omp",
            "explorer",
            "---\n# GENERATED line\nname: \"explorer\"\nthinkingLevel: medium\nmodel: [\"@atlas-worker\",\"@smol\"]\n---\nexplorer body\n",
        )
        config = pathlib.Path(self.root) / "omp-config.yml"
        config.write_text("theme: x\nmodelRoles:\n  smol: openrouter/some-model:off\nother: 1\n")
        argv = [
            "spawn", "--run", "r1", "--harness", "omp", "--name", "Beta", "--agent", "explorer",
            "--prompt-file", self.make_prompt("p", "colonize the pane"),
            "--agents-dir", os.path.join(self.root, "agents"),
        ]
        rc, data, _, err = _run(*argv, env=self.spawn_env(extra={"ATLAS_MUX_OMP_CONFIG": str(config)}), cwd=self.root)
        self.assertEqual(0, rc, (data, err))
        # @atlas-worker is not a configured role, so the first resolvable pattern wins
        self.assertEqual("@smol", data.get("model"))
        self.assertEqual("medium", data.get("level"))
        _wait_board(self.board_file("Beta"), lambda r: r.get("kind") == "exit")
        base, hargv = _fake_harness_argv(self.state)
        self.assertEqual("omp", base)
        self.assertEqual(["-p", "--model=@smol", "--thinking=medium"], hargv[:3])
        self.assertIn("You are the atlas:explorer worker.", hargv[3])
        self.assertIn("explorer body", hargv[3])
        self.assertTrue(hargv[3].endswith("# Task\ncolonize the pane"))

    def test_omp_rejects_effort_flag(self):
        rc, data, _, _ = _run(
            "spawn",
            "--run", "r1",
            "--harness", "omp",
            "--name", "Beta",
            "--agent", "explorer",
            "--prompt-file", self.make_prompt("p", "hi"),
            "--effort", "high",
            "--agents-dir", os.path.join(self.root, "agents"),
            env=self.spawn_env(),
            cwd=self.root,
        )
        self.assertNotIn("tmux ", "\n".join(_tmux_log_calls(self.state)))
        self.assertFalse(data.get("ok"), data)

    def test_spawn_rejects_thinking_for_claude(self):
        rc, data, _, _ = _run(
            "spawn",
            "--run", "r1",
            "--harness", "claude",
            "--name", "Alpha",
            "--agent", "explorer",
            "--prompt-file", self.make_prompt("p", "hi"),
            "--thinking", "medium",
            "--agents-dir", os.path.join(self.root, "agents"),
            env=self.spawn_env(),
            cwd=self.root,
        )
        self.assertFalse(data.get("ok"), data)


class SpawnLifecycleTests(Base):
    def _spawn(self, name="Alpha", harness="claude"):
        return _run(
            "spawn",
            "--run", "r1",
            "--harness", harness,
            "--name", name,
            "--agent", "explorer",
            "--prompt-file", self.make_prompt("p", "hi"),
            "--agents-dir", os.path.join(self.root, "agents"),
            env=self.spawn_env(),
            cwd=self.root,
        )

    def test_name_taken(self):
        rc, data, _, err = self._spawn()
        self.assertEqual(0, rc, (data, err))
        rc, data, _, err = self._spawn()
        self.assertNotEqual(0, rc, (data, err))
        self.assertIn("name_taken", str(data.get("error", "")))

    def test_spawn_reuses_existing_session(self):
        rc, data, _, err = self._spawn()
        self.assertEqual(0, rc, (data, err))
        calls_before = len(_tmux_log_calls(self.state))
        rc, data, _, err = self._spawn(name="Beta", harness="omp")
        self.assertEqual(0, rc, (data, err))
        calls_after = _tmux_log_calls(self.state)
        self.assertEqual(calls_before + 3, len(calls_after))  # has-session, list-windows, new-window
        self.assertNotIn("new-session", "\n".join(calls_after[calls_before:]))
        self.assertIn("new-window -d -t atlas-r1 -n Beta", "\n".join(calls_after[calls_before:]))


class StatusKillTests(Base):
    def _spawn(self, name="Alpha"):
        return _run(
            "spawn",
            "--run", "r1",
            "--harness", "claude",
            "--name", name,
            "--agent", "explorer",
            "--prompt-file", self.make_prompt("p", "hi"),
            "--agents-dir", os.path.join(self.root, "agents"),
            env=self.spawn_env(),
            cwd=self.root,
        )

    def test_status_lists_workers_and_board(self):
        rc, data, _, err = self._spawn("Alpha")
        self.assertEqual(0, rc, (data, err))
        _wait_board(self.board_file("Alpha"), lambda r: r.get("kind") == "exit")
        rc, data, _, err = _run("status", "--run", "r1", env=self.spawn_env(), cwd=self.root)
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data.get("ok"), data)
        self.assertTrue(data.get("tmux"), data)
        workers = {w.get("name"): w for w in data.get("workers", [])}
        self.assertIn("Alpha", workers)
        self.assertEqual(0, workers["Alpha"].get("dead"))
        board = {b.get("name"): b for b in data.get("board", [])}
        self.assertEqual(0, board["Alpha"].get("exit"))

    def test_status_without_session(self):
        rc, data, _, err = _run("status", "--run", "zz", env=self.spawn_env(), cwd=self.root)
        self.assertEqual(0, rc, (data, err))
        self.assertFalse(data.get("tmux"), data)
        self.assertIn("zz", data.get("session_name", "") + str(data.get("run", "")))

    def test_kill_idempotent(self):
        rc, data, _, err = self._spawn()
        self.assertEqual(0, rc, (data, err))
        rc, data, _, err = _run("kill", "--run", "r1", env=self.spawn_env(), cwd=self.root)
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data.get("killed"), data)
        rc, data, _, err = _run("kill", "--run", "r1", env=self.spawn_env(), cwd=self.root)
        self.assertEqual(0, rc, (data, err))
        self.assertFalse(data.get("killed"), data)
        self.assertEqual(1, sum(1 for c in _tmux_log_calls(self.state) if "kill-session" in c))
        rc, data, _, err = _run("status", "--run", "r1", env=self.spawn_env(), cwd=self.root)
        self.assertEqual(0, rc, (data, err))
        self.assertFalse(data.get("tmux"), data)


class RunWorkerTests(Base):
    def run_worker(self, *extra, env_mut=None):
        env = dict(self.env)
        env["ATLAS_PROJECT_ROOT"] = self.root
        env.update(env_mut or {})
        argv = [
            "run-worker",
            "--run", "r1",
            "--name", "Zeta",
            "--harness", "claude",
            "--agent", "explorer",
            "--prompt-file", self.make_prompt("p", "hello worker"),
            "--root", self.root,
            "--agents-dir", os.path.join(self.root, "agents"),
            *extra,
        ]
        p = subprocess.run(
            [sys.executable, str(SCRIPT), *argv],
            capture_output=True,
            text=True,
            env=env,
            timeout=120,
        )
        return p.returncode, p.stdout, p.stderr

    def test_command_override_streams_and_exits_with_worker_code(self):
        rc, out, err = self.run_worker(
            "--command-override", "printf 'alpha-report-1\\nalpha-report-2\\n'; exit 7"
        )
        self.assertEqual(7, rc, err)
        self.assertIn("alpha-report-1", out)
        self.assertIn("alpha-report-2", out)
        recs = _read_board(self.board_file("Zeta"))
        self.assertEqual(
            [
                {"kind": "report", "text": "alpha-report-1"},
                {"kind": "report", "text": "alpha-report-2"},
                {"kind": "exit", "code": 7},
            ],
            [
                {k: r[k] for k in (("kind", "code") if r.get("kind") == "exit" else ("kind", "text"))}
                for r in recs
            ],
        )
        for rec in recs:
            self.assertEqual("Zeta", rec.get("name"))
            self.assertIsInstance(rec.get("ts"), float)

    def test_run_worker_pins_contract_env(self):
        rc, out, err = self.run_worker(
            "--command-override",
            'printf "%s|%s\\n" "$ATLAS_WORKER_NAME" "$ATLAS_PROJECT_ROOT"',
        )
        self.assertEqual(0, rc, err)
        recs = _read_board(self.board_file("Zeta"))
        self.assertIn(
            f"Zeta|{self.root}",
            [r.get("text") for r in recs if r.get("kind") == "report"][0],
        )


class OverrideEnvForwardingTests(Base):
    def test_worker_cmd_env_is_forwarded_as_flag(self):
        """tmux panes inherit the server env, so spawn must forward the override."""
        rc, data, _, err = _run(
            "spawn", "--run", "r1", "--harness", "claude", "--name", "Stub", "--agent", "explorer",
            "--prompt-file", self.make_prompt("p", "hi"), "--agents-dir", os.path.join(self.root, "agents"),
            env=self.spawn_env(extra={"ATLAS_MUX_WORKER_CMD": "echo stubbed"}), cwd=self.root,
        )
        self.assertEqual(0, rc, (data, err))
        self.assertIn("--command-override 'echo stubbed'", "\n".join(_tmux_log_calls(self.state)))
        recs = _wait_board(self.board_file("Stub"), lambda r: r.get("kind") == "exit")
        self.assertEqual(["stubbed"], [r["text"] for r in recs if r.get("kind") == "report"])


class NotesInteropTests(Base):
    def test_mux_lines_coexist_with_atlas_todo_notes(self):
        # direct mux line
        rc = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "run-worker",
                "--run", "r1",
                "--name", "Alpha",
                "--harness", "claude",
                "--agent", "explorer",
                "--prompt-file", self.make_prompt("p", "hi"),
                "--root", self.root,
                "--agents-dir", os.path.join(self.root, "agents"),
                "--command-override", "echo raw-worker-stream",
            ],
            capture_output=True,
            text=True,
            env={**self.env, "ATLAS_PROJECT_ROOT": self.root},
            timeout=120,
        ).returncode
        self.assertEqual(0, rc)
        # sibling posts a note through atlas_todo
        todo = pathlib.Path(SCRIPT).resolve().parent / "atlas_todo.py"
        p = subprocess.run(
            [
                sys.executable,
                str(todo),
                "note",
                "--owner", "Alpha",
                "--to", "all",
                "--root", self.root,
                "alpha done, note to lead",
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(0, p.returncode, p.stderr + p.stdout)
        # lead reads the notes channel --to-all style: only note records
        p = subprocess.run(
            [sys.executable, str(todo), "notes", "--to", "all", "--root", self.root],
            capture_output=True,
            text=True,
            timeout=60,
        )
        notes = json.loads(p.stdout).get("notes", [])
        texts = [n.get("text") for n in notes]
        self.assertIn("alpha done, note to lead", texts)
        self.assertNotIn("raw-worker-stream", texts)
        # the lead's view (--to lead) surfaces both the stream and broadcast notes
        p = subprocess.run(
            [sys.executable, str(todo), "notes", "--to", "lead", "--root", self.root],
            capture_output=True,
            text=True,
            timeout=60,
        )
        texts = [n.get("text") for n in json.loads(p.stdout).get("notes", [])]
        self.assertIn("raw-worker-stream", texts)
        self.assertIn(
            "alpha done, note to lead",
            texts,
        )


if __name__ == "__main__":
    unittest.main()