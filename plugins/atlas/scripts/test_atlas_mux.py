#!/usr/bin/env python3
"""Tests for the tmux colony mode (atlas_mux.py).

Every tmux/claude/omp call is served by tiny fake binaries on a private PATH:
the fake `tmux` logs argv, models session/window existence as marker files,
and runs `new-window` commands detached so board files fill asynchronously;
the fake harnesses log argv (NUL-separated) + worker env and emit canned report
lines. Worker output is read back ONLY through atlas_todo.notes(root, to="lead"):
run-worker is not allowed to write the board itself.
"""
# Real-tmux smoke lives in docs (subagent-kit.md "Colony mux mode"); these
# tests never touch a real tmux server.

import contextlib
import json
import os
import pathlib
import shlex
import shutil
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


_TODO_MOD = None


def _atlas_todo():
    global _TODO_MOD
    if _TODO_MOD is None:
        import importlib.util

        spec = importlib.util.spec_from_file_location("atlas_todo_for_mux_tests", str(SCRIPT.parent / "atlas_todo.py"))
        _TODO_MOD = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_TODO_MOD)
    return _TODO_MOD


def _notes(root, owner=None, to="lead"):
    recs = _atlas_todo().notes(root, to=to)
    return [r for r in recs if owner is None or r.get("owner") == owner]


def _texts(recs):
    return [r.get("text") for r in recs]


def _wait_exit(root, owner, timeout=20.0):
    """Block until `owner` posted its final `exit N` note; return all its notes."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        recs = _notes(root, owner)
        if recs and str(recs[-1].get("text", "")).startswith("exit "):
            return recs
        time.sleep(0.05)
    raise AssertionError(f"no exit note from {owner!r}: {_texts(_notes(root, owner))}")


def _pairs(argv):
    return [list(pair) for pair in zip(argv, argv[1:], strict=False)]


class Base(unittest.TestCase):
    def _cleanup_tmp(self):
        """The fake tmux starts each worker in a detached shell that writes into fake-state (out.<name>, log), and
        a test that does not wait for it can reach teardown first: rmtree then sees the directory non-empty
        (measured: test_name_taken failed 2 runs in 12). Retry until the short-lived writer has exited."""
        deadline = time.time() + 10
        while True:
            try:
                shutil.rmtree(self._tmp.name)
                return
            except FileNotFoundError:
                return
            except OSError:
                if time.time() > deadline:
                    raise
                time.sleep(0.05)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._cleanup_tmp)
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
        # hermetic omp modelRoles: never read the real ~/.omp config
        self.omp_config = pathlib.Path(self.root) / "omp-config.yml"
        self.omp_config.write_text("modelRoles:\n")
        self.env["ATLAS_MUX_OMP_CONFIG"] = str(self.omp_config)
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

        recs = _wait_exit(self.root, "Alpha")
        base, argv = _fake_harness_argv(self.state)
        self.assertEqual("claude", base)
        self.assertEqual(
            ["-p", "--agent", "atlas:explorer", "--model", "opus", "--effort", "high",
             "--permission-mode", "acceptEdits", "colonize the pane"],
            argv,
        )
        texts = _texts(recs)
        # single-writer protocol: exact argv first, report lines, exit last
        self.assertEqual(shlex.join(["claude", *argv]), texts[0])
        self.assertEqual(["fake-report-1", "fake-report-2"], texts[1:-1])
        self.assertEqual("exit 0", texts[-1])
        for rec in recs:
            self.assertEqual("Alpha", rec.get("owner"))
            self.assertEqual("lead", rec.get("to"))
            self.assertIsInstance(rec.get("ts"), float)

    def test_claude_env_pinned_for_worker(self):
        self.make_agent("claude", "explorer", "---\nmodel: opus\n---\n")
        rc, data, _, err = self.spawn()
        self.assertEqual(0, rc, (data, err))
        _wait_exit(self.root, "Alpha")
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
        _wait_exit(self.root, "Alpha")
        _, argv = _fake_harness_argv(self.state)
        pairs = _pairs(argv)
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
        _wait_exit(self.root, "Alpha")
        _, argv = _fake_harness_argv(self.state)
        pairs = _pairs(argv)
        self.assertIn(["--effort", "max"], pairs)
        self.assertNotIn(["--effort", "high"], pairs)
        self.assertIn(["--model", "opus"], pairs)

    def test_missing_agent_file_refused(self):
        rc, data, _, err = self.spawn()
        self.assertEqual(2, rc, (data, err))
        self.assertFalse(data.get("ok"), data)
        msg = str(data.get("error", ""))
        self.assertIn("explorer", msg)  # the role
        self.assertIn(str(pathlib.Path(self.root) / "agents" / "claude"), msg)  # the path searched
        self.assertEqual([], _tmux_log_calls(self.state))  # refused before any tmux side effect

    def test_agent_def_without_model_refused(self):
        self.make_agent("claude", "explorer", "---\nname: explorer\neffort: high\n---\nbody\n")
        rc, data, _, err = self.spawn()
        self.assertEqual(2, rc, (data, err))
        self.assertFalse(data.get("ok"), data)
        self.assertIn("explorer", str(data.get("error", "")))
        self.assertIn("explorer.md", str(data.get("error", "")))
        self.assertEqual([], _tmux_log_calls(self.state))

    def test_explicit_model_without_effort_still_refused(self):
        rc, data, _, err = self.spawn(model="haiku")
        self.assertEqual(2, rc, (data, err))
        self.assertFalse(data.get("ok"), data)
        self.assertIn("--effort", str(data.get("error", "")))
        self.assertEqual([], _tmux_log_calls(self.state))

    def test_explicit_model_plus_effort_overrides_missing_definition(self):
        rc, data, _, err = self.spawn(model="haiku", effort="max")
        self.assertEqual(0, rc, (data, err))
        self.assertEqual("haiku", data.get("model"))
        recs = _wait_exit(self.root, "Alpha")
        _, argv = _fake_harness_argv(self.state)
        self.assertIn(["--model", "haiku"], _pairs(argv))
        self.assertIn(["--effort", "max"], _pairs(argv))
        self.assertEqual("exit 0", _texts(recs)[-1])

    def test_argv_note_round_trips_prompt_with_spaces_and_semicolons(self):
        self.make_agent("claude", "explorer", "---\nmodel: opus\n---\nbody\n")
        prompt = "review the plan; then   report; echo $HOME 'quoted' \"dq\""
        rc, data, _, err = _run(
            "spawn", "--run", "r1", "--harness", "claude", "--name", "Alpha", "--agent", "explorer",
            "--prompt-file", self.make_prompt("p", prompt),
            "--agents-dir", os.path.join(self.root, "agents"),
            env=self.spawn_env(), cwd=self.root,
        )
        self.assertEqual(0, rc, (data, err))
        recs = _wait_exit(self.root, "Alpha")
        _, argv = _fake_harness_argv(self.state)  # NUL-separated: spaces/; survive verbatim
        self.assertEqual(prompt, argv[-1])
        first = _texts(recs)[0]
        self.assertEqual(["claude", *argv], shlex.split(first))  # quoting is lossless
        self.assertEqual(shlex.join(["claude", *argv]), first)


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
        self.omp_config.write_text("theme: x\nmodelRoles:\n  smol: openrouter/some-model:off\nother: 1\n")
        rc, data, _, err = self.spawn()
        self.assertEqual(0, rc, (data, err))
        # @atlas-worker is not a configured role; @smol resolves to its CONCRETE selector
        self.assertEqual("openrouter/some-model:off", data.get("model"))
        self.assertEqual("medium", data.get("level"))
        _wait_exit(self.root, "Beta")
        base, hargv = _fake_harness_argv(self.state)
        self.assertEqual("omp", base)
        self.assertEqual(["-p", "--model=openrouter/some-model:off", "--thinking=medium"], hargv[:3])
        self.assertIn("You are the atlas:explorer worker.", hargv[3])
        self.assertIn("explorer body", hargv[3])
        self.assertTrue(hargv[3].endswith("# Task\ncolonize the pane"))
        first = _texts(_notes(self.root, "Beta"))[0]
        self.assertEqual(["omp", *hargv], shlex.split(first))  # tier auditable from the first note

    def test_omp_unresolvable_alias_refused(self):
        self.make_agent("omp", "explorer", '---\nthinkingLevel: low\nmodel: ["@atlas-worker"]\n---\nbody\n')
        rc, data, _, err = self.spawn()  # config has no atlas-worker role
        self.assertEqual(2, rc, (data, err))
        self.assertFalse(data.get("ok"), data)
        msg = str(data.get("error", ""))
        self.assertIn("explorer", msg)
        self.assertIn("atlas-worker", msg)
        self.assertEqual([], _tmux_log_calls(self.state))

    def test_omp_missing_definition_refused(self):
        rc, data, _, err = self.spawn()
        self.assertEqual(2, rc, (data, err))
        self.assertIn(str(pathlib.Path(self.root) / "agents" / "omp"), str(data.get("error", "")))
        self.assertEqual([], _tmux_log_calls(self.state))

    def test_omp_explicit_alias_plus_thinking_resolves_concrete(self):
        self.omp_config.write_text("modelRoles:\n  smol: openrouter/some-model:off\n")
        rc, data, _, err = self.spawn(model="@smol", thinking="low")  # no definition file at all
        self.assertEqual(0, rc, (data, err))
        _wait_exit(self.root, "Beta")
        _, hargv = _fake_harness_argv(self.state)
        self.assertEqual(["-p", "--model=openrouter/some-model:off", "--thinking=low"], hargv[:3])

    def test_omp_explicit_concrete_model_plus_thinking_passes_through(self):
        rc, data, _, err = self.spawn(model="openai/gpt-x", thinking="high")
        self.assertEqual(0, rc, (data, err))
        _wait_exit(self.root, "Beta")
        _, hargv = _fake_harness_argv(self.state)
        self.assertEqual(["-p", "--model=openai/gpt-x", "--thinking=high"], hargv[:3])

    def test_omp_explicit_model_without_thinking_refused(self):
        self.omp_config.write_text("modelRoles:\n  smol: openrouter/some-model:off\n")
        rc, data, _, err = self.spawn(model="@smol")
        self.assertEqual(2, rc, (data, err))
        self.assertIn("--thinking", str(data.get("error", "")))

    def test_omp_explicit_unresolvable_alias_refused_even_with_thinking(self):
        rc, data, _, err = self.spawn(model="@nope", thinking="low")
        self.assertEqual(2, rc, (data, err))
        self.assertIn("@nope", str(data.get("error", "")))
        self.assertEqual([], _tmux_log_calls(self.state))

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
        self.make_agent("claude", "explorer", "---\nmodel: opus\neffort: high\n---\nbody\n")
        self.make_agent("omp", "explorer", '---\nmodel: ["@smol"]\n---\nbody\n')
        self.omp_config.write_text("modelRoles:\n  smol: openrouter/some-model:off\n")
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
        self.make_agent("claude", "explorer", "---\nmodel: opus\neffort: high\n---\nbody\n")
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
        _wait_exit(self.root, "Alpha")
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
    def run_worker(self, *extra, env_mut=None, name="Zeta"):
        env = dict(self.env)
        env["ATLAS_PROJECT_ROOT"] = self.root
        env.update(env_mut or {})
        argv = [
            "run-worker",
            "--run", "r1",
            "--name", name,
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
        override = "printf 'alpha-report-1\\nalpha-report-2\\n'; exit 7"
        rc, out, err = self.run_worker("--command-override", override)
        self.assertEqual(7, rc, err)
        self.assertIn("alpha-report-1", out)
        self.assertIn("alpha-report-2", out)
        recs = _notes(self.root, "Zeta")
        self.assertEqual(
            [
                shlex.join(["/bin/sh", "-c", override]),
                "alpha-report-1",
                "alpha-report-2",
                "exit 7 [failed: nonzero exit]",
            ],
            _texts(recs),
        )

    def test_notes_are_atlas_todo_records_only(self):
        """Single writer: every board line is an atlas_todo.note record, nothing mux-shaped."""
        rc, _, err = self.run_worker("--command-override", "echo one")
        self.assertEqual(0, rc, err)
        lines = _read_board(self.board_file("Zeta"))
        self.assertEqual(3, len(lines))  # argv, one, exit 0
        for rec in lines:
            self.assertEqual({"ts", "owner", "to", "item", "text"}, set(rec))
            self.assertEqual("Zeta", rec["owner"])
            self.assertEqual("lead", rec["to"])
        self.assertEqual("exit 0", lines[-1]["text"])

    def test_exit0_harness_failures_are_classified_failed(self):
        # omp -p exits 0 on these, so the output must decide
        cases = (
            ('Model "@smol" not found in any provider', "model not found"),
            ("HTTP 402 from upstream: payment required", "http 402"),
            ("Error: insufficient credit for this request", "credits exhausted"),
            ("Error: unauthorized: invalid api key", "auth rejected"),
        )
        for i, (output, reason) in enumerate(cases):
            name = f"Fail{i}"
            with self.subTest(reason=reason):
                rc, _, err = self.run_worker("--command-override", f"echo {shlex.quote(output)}; exit 0", name=name)
                self.assertEqual(1, rc, err)
                recs = _notes(self.root, name)
                self.assertEqual(f"exit 1 [failed: {reason}]", _texts(recs)[-1])
                self.assertIn(output, _texts(recs))  # the evidence line is still on the board

    def test_stderr_is_captured_for_classification(self):
        rc, _, err = self.run_worker("--command-override", "echo 'Model \"x\" not found' >&2; exit 0")
        self.assertEqual(1, rc, err)
        self.assertEqual("exit 1 [failed: model not found]", _texts(_notes(self.root, "Zeta"))[-1])

    def test_mcp_connection_warnings_do_not_fail_a_successful_run(self):
        """Observed in the real omp run: unrelated MCP-server warnings carry 401/404/auth
        text on stderr, but the worker answered and exited 0."""
        noise = (
            'Warning: MCP server "context7" failed to connect: HTTP 401: Authentication required; its tools are unavailable for this run.',
            'Warning: MCP server "magic" failed to connect: MCP error -32001: Not authenticated - your API key is missing; its tools are unavailable for this run.',
            'Warning: MCP server "fiddler" failed to connect: HTTP 402: x; its tools are unavailable for this run.',
        )
        script = "".join(f"echo {shlex.quote(line)} >&2; " for line in noise) + "echo READY"
        rc, _, err = self.run_worker("--command-override", script)
        self.assertEqual(0, rc, err)
        texts = _texts(_notes(self.root, "Zeta"))
        self.assertEqual("exit 0", texts[-1])
        self.assertIn("READY", texts)
        self.assertTrue(all(line in texts for line in noise))  # still on the board

    def test_clean_run_is_not_flagged(self):
        rc, _, err = self.run_worker("--command-override", "echo READY; echo 'port 14020 ok'")
        self.assertEqual(0, rc, err)
        self.assertEqual("exit 0", _texts(_notes(self.root, "Zeta"))[-1])

    def test_missing_harness_binary_is_a_failed_exit_note(self):
        self.make_agent("claude", "explorer", "---\nmodel: opus\n---\nbody\n")
        # real harness path (no override) with `claude` absent from PATH -> OSError in Popen
        rc, _, err = self.run_worker(env_mut={"PATH": "/nonexistent"})
        self.assertEqual(127, rc, err)
        texts = _texts(_notes(self.root, "Zeta"))
        self.assertTrue(texts[0].startswith("claude -p --agent atlas:explorer --model opus"), texts)
        self.assertTrue(texts[1].startswith("spawn failed:"), texts)
        self.assertEqual("exit 127 [failed: spawn error]", texts[-1])

    def test_run_worker_pins_contract_env(self):
        rc, out, err = self.run_worker(
            "--command-override",
            'printf "%s|%s\\n" "$ATLAS_WORKER_NAME" "$ATLAS_PROJECT_ROOT"',
        )
        self.assertEqual(0, rc, err)
        self.assertIn(f"Zeta|{self.root}", _texts(_notes(self.root, "Zeta")))


class OverrideEnvForwardingTests(Base):
    def test_worker_cmd_env_is_forwarded_as_flag(self):
        """tmux panes inherit the server env, so spawn must forward the override."""
        self.make_agent("claude", "explorer", "---\nmodel: opus\n---\n")
        rc, data, _, err = _run(
            "spawn", "--run", "r1", "--harness", "claude", "--name", "Stub", "--agent", "explorer",
            "--prompt-file", self.make_prompt("p", "hi"), "--agents-dir", os.path.join(self.root, "agents"),
            env=self.spawn_env(extra={"ATLAS_MUX_WORKER_CMD": "echo stubbed"}), cwd=self.root,
        )
        self.assertEqual(0, rc, (data, err))
        self.assertIn("--command-override 'echo stubbed'", "\n".join(_tmux_log_calls(self.state)))
        recs = _wait_exit(self.root, "Stub")
        self.assertEqual(
            [shlex.join(["/bin/sh", "-c", "echo stubbed"]), "stubbed", "exit 0"], _texts(recs)
        )


class NotesInteropTests(Base):
    def test_mux_lines_coexist_with_atlas_todo_notes(self):
        rc = subprocess.run(
            [
                sys.executable, str(SCRIPT), "run-worker",
                "--run", "r1", "--name", "Alpha", "--harness", "claude", "--agent", "explorer",
                "--prompt-file", self.make_prompt("p", "hi"), "--root", self.root,
                "--agents-dir", os.path.join(self.root, "agents"),
                "--command-override", "echo raw-worker-stream",
            ],
            capture_output=True, text=True,
            env={**self.env, "ATLAS_PROJECT_ROOT": self.root}, timeout=120,
        ).returncode
        self.assertEqual(0, rc)
        todo = SCRIPT.parent / "atlas_todo.py"
        p = subprocess.run(
            [sys.executable, str(todo), "note", "--owner", "Alpha", "--to", "all", "--root", self.root,
             "alpha done, note to lead"],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(0, p.returncode, p.stderr + p.stdout)
        # --to all: only broadcast notes, never the lead-addressed worker stream
        texts = _texts(_notes(self.root, to="all"))
        self.assertIn("alpha done, note to lead", texts)
        self.assertNotIn("raw-worker-stream", texts)
        # --to lead (CLI, as the lead runs it): stream + argv + exit + the broadcast note
        p = subprocess.run(
            [sys.executable, str(todo), "notes", "--to", "lead", "--root", self.root],
            capture_output=True, text=True, timeout=60,
        )
        texts = [n.get("text") for n in json.loads(p.stdout).get("notes", [])]
        self.assertIn("raw-worker-stream", texts)
        self.assertIn("alpha done, note to lead", texts)
        self.assertIn("exit 0", texts)


if __name__ == "__main__":
    unittest.main()