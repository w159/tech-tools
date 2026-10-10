#!/usr/bin/env python3
"""Tests for the colony mux (atlas_mux.py): the tmux fallback suite, plus HerdrTransportTests for the default transport.

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

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)

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
# claude-bg mode: --bg returns a backgrounded line, `agents --json` replays
# $FAKE_TMUX_STATE/agents.json, `stop`/`logs` answer from the same state dir.
L="${FAKE_HARNESS_LOG:?}"
echo "argv[basename=$(basename "$0")]: $*" >>"$L"
: > "$(dirname "$L")/argv.$(basename "$0")"
for a in "$@"; do printf '%s\0' "$a" >>"$(dirname "$L")/argv.$(basename "$0")"; done
case "$1" in
  agents)
    if [ -f "$FAKE_TMUX_STATE/agents.json" ]; then cat "$FAKE_TMUX_STATE/agents.json"; else echo "[]"; fi
    exit 0 ;;
  stop)
    echo "stopped $2"; exit "${FAKE_STOP_EXIT:-0}" ;;
  logs)
    cat "$FAKE_TMUX_STATE/logs.out" 2>/dev/null; exit 0 ;;
esac
if [ "$1" = "--bg" ]; then
  NAME=""; prev=""
  for a in "$@"; do [ "$prev" = "--name" ] && NAME="$a"; prev="$a"; done
  echo "backgrounded · fakebg42 · $NAME"
  echo "  claude agents             list sessions"
  echo "env: ATLAS_LEAD_AGENT=[$ATLAS_LEAD_AGENT] ATLAS_WORKER_NAME=[$ATLAS_WORKER_NAME] ATLAS_LEAD_NAME=[$ATLAS_LEAD_NAME] ATLAS_CHANNEL=[$ATLAS_CHANNEL] ATLAS_TASKS_MIRROR=[$ATLAS_TASKS_MIRROR]" >>"$L"
  exit "${FAKE_BG_EXIT:-0}"
fi
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
    with open(log, encoding="utf-8") as fh:
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
    with open(path, encoding="utf-8") as fh:
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

        spec = importlib.util.spec_from_file_location(
            "atlas_todo_for_mux_tests", str(SCRIPT.parent / "atlas_todo.py")
        )
        if spec is None or spec.loader is None:
            raise AssertionError(
                f"cannot load {SCRIPT.parent / 'atlas_todo.py'} as a module"
            )
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
        if recs and str(recs[-1].get("text", "")).splitlines()[-1:][0].startswith(
            "exit "
        ):
            return recs
        time.sleep(0.05)
    raise AssertionError(f"no exit note from {owner!r}: {_texts(_notes(root, owner))}")


def _pairs(argv):
    return [list(pair) for pair in zip(argv, argv[1:], strict=False)]


# claude-bg --settings payload: cross-session inbound accept plus the two allow rules the
# brief's mandatory actions need (the atlas_todo board-note Bash call, claude-mem MCP search)
_BG_SETTINGS_JSON = (
    '{"crossSessionInbound":"accept","permissions":{"allow":'
    '["Bash(python3 *atlas_todo.py*)","mcp__claude_mem_mcp_search"]}}'
)


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
        self.env = {
            k: v
            for k, v in os.environ.items()
            if k not in ("ATLAS_CHANNEL", "ATLAS_LEAD_NAME", "ATLAS_WORKER_NAME")
        }
        self.env["PATH"] = self.bin_dir + os.pathsep + self.env["PATH"]
        self.env["FAKE_TMUX_STATE"] = self.state
        self.env["FAKE_HARNESS_LOG"] = os.path.join(self.state, "log")
        # hermetic omp modelRoles: never read the real ~/.omp config
        self.omp_config = pathlib.Path(self.root) / "omp-config.yml"
        self.omp_config.write_text("modelRoles:\n")
        self.env["ATLAS_MUX_OMP_CONFIG"] = str(self.omp_config)
        # the whole suite below drives the fake tmux: pin the explicit fallback (the default transport is herdr)
        self.env["ATLAS_COLONY_TRANSPORT"] = "tmux"
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
        with open(self.make_prompt("p", "hello"), encoding="utf-8"):
            pass
        rc, data, _, _ = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            "Alpha",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "hello"),
            env=self.spawn_env(mux=0),
            cwd=self.root,
        )
        self.assertNotIn("tmux ", "\n".join(_tmux_log_calls(self.state)))
        self.assertFalse(data.get("ok"), data)
        self.assertIn("mux", str(data.get("error", "")))

    def test_spawn_rejects_bad_name(self):
        rc, data, _, _ = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            "Bad Name!",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "hello"),
            env=self.spawn_env(),
            cwd=self.root,
        )
        self.assertNotIn("tmux ", "\n".join(_tmux_log_calls(self.state)))
        self.assertFalse(data.get("ok"), data)

    def test_spawn_missing_prompt_file(self):
        rc, data, _, _ = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            "Alpha",
            "--agent",
            "explorer",
            "--prompt-file",
            os.path.join(self.root, "nope.txt"),
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
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            name,
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "colonize the pane"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
        ]
        if model:
            argv += ["--model", model]
        if effort:
            argv += ["--effort", effort]
        return _run(*argv, env=self.spawn_env(), cwd=self.root)

    def test_claude_worker_gets_lead_db_and_gate_in_the_pane_but_its_argv_is_unchanged(
        self,
    ):
        # The forwarding cause (a tmux pane inherits the tmux SERVER env) is the same for both harnesses. It changes the
        # pane environment only: the harness argv a Claude user sees is the same one every other claude test pins.
        self.make_agent(
            "claude",
            "explorer",
            "---\nname: explorer\nmodel: haiku\neffort: low\n---\nbody\n",
        )
        lead_db = os.path.join(self.root, "lead", "atlas.db")
        env = dict(self.spawn_env(), ATLAS_DB=lead_db, ATLAS_GATE="off")
        rc, data, _, err = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            "Alpha",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "go"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=env,
            cwd=self.root,
        )
        self.assertEqual(0, rc, (data, err))
        pane = next(c for c in _tmux_log_calls(self.state) if "new-window" in c)
        self.assertIn(f"ATLAS_DB={lead_db}", pane)
        self.assertIn("ATLAS_GATE=off", pane)
        _wait_exit(self.root, "Alpha")
        base, cargv = _fake_harness_argv(self.state)
        self.assertEqual("claude", base)
        self.assertEqual(
            ["-p", "--agent", "atlas:explorer", "--model", "haiku", "--effort", "low"],
            cargv[:7],
        )
        self.assertNotIn(
            "env", cargv
        )  # the forwarding prefix belongs to the pane command, not the harness argv

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
            [
                "-p",
                "--agent",
                "atlas:explorer",
                "--model",
                "opus",
                "--effort",
                "high",
                "--permission-mode",
                "acceptEdits",
                "colonize the pane",
            ],
            argv,
        )
        # contract C2: exactly one note, the report, then the exit line
        self.assertEqual(1, len(recs))
        self.assertEqual("fake-report-1\nfake-report-2\nexit 0", recs[0]["text"])
        self.assertEqual("report", recs[0].get("kind"))
        self.assertEqual("Alpha", recs[0].get("owner"))
        self.assertEqual("lead", recs[0].get("to"))
        self.assertIsInstance(recs[0].get("ts"), float)
        log = pathlib.Path(self.root) / ".atlas" / ".run" / "logs" / "Alpha.log"
        self.assertIn("fake-report-2", log.read_text())

    def test_claude_env_pinned_for_worker(self):
        self.make_agent("claude", "explorer", "---\nmodel: opus\n---\n")
        rc, data, _, err = self.spawn()
        self.assertEqual(0, rc, (data, err))
        _wait_exit(self.root, "Alpha")
        with open(os.path.join(self.state, "log"), encoding="utf-8") as fh:
            env_line = next((line for line in fh if line.startswith("env:")), "")
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
        self.assertIn(
            str(pathlib.Path(self.root) / "agents" / "claude"), msg
        )  # the path searched
        self.assertEqual(
            [], _tmux_log_calls(self.state)
        )  # refused before any tmux side effect

    def test_agent_def_without_model_refused(self):
        self.make_agent(
            "claude", "explorer", "---\nname: explorer\neffort: high\n---\nbody\n"
        )
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
        self.assertEqual("fake-report-1\nfake-report-2\nexit 0", _texts(recs)[-1])


class SpawnOmpTests(Base):
    def spawn(self, model=None, thinking=None, name="Beta"):
        argv = [
            "spawn",
            "--run",
            "r1",
            "--harness",
            "omp",
            "--name",
            name,
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "colonize the pane"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
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
            '---\n# GENERATED line\nname: "explorer"\nthinkingLevel: medium\nmodel: ["@atlas-worker","@smol"]\n---\nexplorer body\n',
        )
        self.omp_config.write_text(
            "theme: x\nmodelRoles:\n  smol: openrouter/some-model:off\nother: 1\n"
        )
        rc, data, _, err = self.spawn()
        self.assertEqual(0, rc, (data, err))
        # @atlas-worker is not a configured role; @smol resolves to its CONCRETE selector
        self.assertEqual("openrouter/some-model:off", data.get("model"))
        self.assertEqual("medium", data.get("level"))
        _wait_exit(self.root, "Beta")
        base, hargv = _fake_harness_argv(self.state)
        self.assertEqual("omp", base)
        self.assertEqual(
            ["-p", "--model=openrouter/some-model:off", "--thinking=medium"], hargv[:3]
        )
        self.assertIn("You are the atlas:explorer worker.", hargv[3])
        self.assertIn("explorer body", hargv[3])
        self.assertTrue(hargv[3].endswith("# Task\ncolonize the pane"))
        log = pathlib.Path(self.root) / ".atlas" / ".run" / "logs" / "Beta.log"
        first = log.read_text().removeprefix("$ ").split("\nfake-report-1")[0]
        self.assertEqual(
            ["omp", *hargv], shlex.split(first)
        )  # tier auditable from the worker log, not the board

    def test_omp_quoted_thinking_level_is_unquoted_in_argv_and_pane_tail(self):
        """gen-agents.ts writes `thinkingLevel: "medium"`; omp rejects a --thinking value that carries the quotes."""
        self.make_agent(
            "omp",
            "explorer",
            '---\nname: "explorer"\nthinkingLevel: "medium"\nmodel: ["@smol"]\n---\nexplorer body\n',
        )
        self.omp_config.write_text("modelRoles:\n  smol: openrouter/some-model:off\n")
        rc, data, _, err = self.spawn()
        self.assertEqual(0, rc, (data, err))
        self.assertEqual("medium", data.get("level"))
        pane = next(c for c in _tmux_log_calls(self.state) if "new-window" in c)
        tail = shlex.split(pane.split(" exec ", 1)[1])
        self.assertEqual("medium", tail[tail.index("--thinking") + 1])
        self.assertNotIn('"', pane.split("--thinking", 1)[1].split()[0])
        _wait_exit(self.root, "Beta")
        _, hargv = _fake_harness_argv(self.state)
        self.assertIn("--thinking=medium", hargv)
        self.assertFalse([a for a in hargv[:4] if '"' in a or "'" in a], hargv[:4])

    def _omp_ready(self):
        self.make_agent(
            "omp",
            "explorer",
            '---\nthinkingLevel: low\nmodel: ["@smol"]\n---\nexplorer body\n',
        )
        self.omp_config.write_text("modelRoles:\n  smol: openrouter/some-model:off\n")

    def test_omp_extension_pin_via_flag_adds_no_extensions_and_the_path(self):
        self._omp_ready()
        ext = os.path.join(self.root, "tree", "plugins", "atlas", "omp")
        argv = [
            "spawn",
            "--run",
            "r1",
            "--harness",
            "omp",
            "--name",
            "Beta",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "go"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            "--omp-extension",
            ext,
        ]
        rc, data, _, err = _run(*argv, env=self.spawn_env(), cwd=self.root)
        self.assertEqual(0, rc, (data, err))
        _wait_exit(self.root, "Beta")
        _, hargv = _fake_harness_argv(self.state)
        self.assertEqual(
            [
                "-p",
                "--model=openrouter/some-model:off",
                "--thinking=low",
                "--no-extensions",
                f"--extension={ext}",
            ],
            hargv[:5],
        )
        self.assertIn(
            "You are the atlas:explorer worker.", hargv[5]
        )  # the brief is still the last argument

    def test_omp_extension_pin_from_lead_env_reaches_the_pane_as_a_flag(self):
        # A tmux pane inherits the tmux SERVER env, so an env var set for the spawning client alone would be lost
        # unless spawn forwards it; the worker must still be pinned.
        self._omp_ready()
        ext = os.path.join(self.root, "tree", "plugins", "atlas", "omp")
        env = dict(self.spawn_env(), ATLAS_MUX_OMP_EXTENSION=ext)
        rc, data, _, err = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "omp",
            "--name",
            "Beta",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "go"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=env,
            cwd=self.root,
        )
        self.assertEqual(0, rc, (data, err))
        pane = next(c for c in _tmux_log_calls(self.state) if "new-window" in c)
        self.assertIn("--omp-extension", pane)
        _wait_exit(self.root, "Beta")
        _, hargv = _fake_harness_argv(self.state)
        self.assertIn("--no-extensions", hargv)
        self.assertIn(f"--extension={ext}", hargv)

    def test_omp_without_a_pin_keeps_the_original_argv(self):
        self._omp_ready()
        env = {
            k: v for k, v in self.spawn_env().items() if k != "ATLAS_MUX_OMP_EXTENSION"
        }
        rc, data, _, err = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "omp",
            "--name",
            "Beta",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "go"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=env,
            cwd=self.root,
        )
        self.assertEqual(0, rc, (data, err))
        _wait_exit(self.root, "Beta")
        _, hargv = _fake_harness_argv(self.state)
        self.assertNotIn("--no-extensions", hargv)
        self.assertFalse([a for a in hargv if a.startswith("--extension")])
        self.assertEqual(
            ["-p", "--model=openrouter/some-model:off", "--thinking=low"], hargv[:3]
        )

    def test_claude_workers_ignore_the_omp_extension_pin(self):
        self.make_agent(
            "claude", "explorer", "---\nmodel: haiku\neffort: low\n---\nbody\n"
        )
        env = dict(self.spawn_env(), ATLAS_MUX_OMP_EXTENSION="/some/tree/omp")
        rc, data, _, err = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            "Alpha",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "go"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=env,
            cwd=self.root,
        )
        self.assertEqual(0, rc, (data, err))
        _wait_exit(self.root, "Alpha")
        _, cargv = _fake_harness_argv(self.state)
        self.assertNotIn("--no-extensions", cargv)
        self.assertFalse([a for a in cargv if "extension" in a])

    def test_lead_db_and_gate_switch_reach_the_worker_pane(self):
        # A tmux pane inherits the tmux SERVER env. Without forwarding, a lead that points ATLAS_DB at a project DB (or
        # turned ATLAS_GATE off) has its workers silently write to the default DB and run with the gate on.
        self._omp_ready()
        lead_db = os.path.join(self.root, "lead", "atlas.db")
        env = dict(
            self.spawn_env(),
            ATLAS_DB=lead_db,
            ATLAS_GATE="off",
            ATLAS_NOT_ALLOWLISTED="sentinel-value",
        )
        rc, data, _, err = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "omp",
            "--name",
            "Beta",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "go"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=env,
            cwd=self.root,
        )
        self.assertEqual(0, rc, (data, err))
        pane = next(c for c in _tmux_log_calls(self.state) if "new-window" in c)
        self.assertIn(f"ATLAS_DB={lead_db}", pane)
        self.assertIn("ATLAS_GATE=off", pane)
        self.assertNotIn(
            "sentinel-value", pane
        )  # an allowlist, not a copy of the lead's environment
        self.assertNotIn("ATLAS_NOT_ALLOWLISTED", pane)

    def test_lead_kill_switches_and_omp_profile_reach_the_worker_pane(self):
        # ATLAS_MANDATES=off in the lead was lost in the pane: the worker came up with the recall gate armed.
        self._omp_ready()
        lead_agent_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, lead_agent_dir, ignore_errors=True)
        env = dict(
            self.spawn_env(),
            ATLAS_MANDATES="off",
            ATLAS_HOOK_BRIDGE="off",
            ATLAS_LEAN_SHELL="off",
            PI_CODING_AGENT_DIR=lead_agent_dir,
            ATLAS_TOOLKIT_LOAD="lead-value",
            ATLAS_WORKER_NAME="lead",
        )
        rc, data, _, err = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "omp",
            "--name",
            "Beta",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "go"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=env,
            cwd=self.root,
        )
        self.assertEqual(0, rc, (data, err))
        pane = next(c for c in _tmux_log_calls(self.state) if "new-window" in c)
        for pair in (
            "ATLAS_MANDATES=off",
            "ATLAS_HOOK_BRIDGE=off",
            "ATLAS_LEAN_SHELL=off",
            "PI_CODING_AGENT_DIR=" + lead_agent_dir,
        ):
            self.assertIn(pair, pane)
        self.assertNotIn("ATLAS_TOOLKIT_LOAD", pane)  # bridge-pinned, never forwarded
        self.assertNotIn("lead-value", pane)

    def test_worker_pane_gets_no_forwarded_vars_when_the_lead_set_none(self):
        self._omp_ready()
        env = {
            k: v
            for k, v in self.spawn_env().items()
            if k not in ("ATLAS_DB", "ATLAS_GATE")
        }
        rc, data, _, err = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "omp",
            "--name",
            "Beta",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "go"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=env,
            cwd=self.root,
        )
        self.assertEqual(0, rc, (data, err))
        pane = next(c for c in _tmux_log_calls(self.state) if "new-window" in c)
        self.assertNotIn("ATLAS_DB", pane)
        self.assertNotIn("ATLAS_GATE", pane)

    def test_omp_unresolvable_alias_refused(self):
        self.make_agent(
            "omp",
            "explorer",
            '---\nthinkingLevel: low\nmodel: ["@atlas-worker"]\n---\nbody\n',
        )
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
        self.assertIn(
            str(pathlib.Path(self.root) / "agents" / "omp"), str(data.get("error", ""))
        )
        self.assertEqual([], _tmux_log_calls(self.state))

    def test_omp_explicit_alias_plus_thinking_resolves_concrete(self):
        self.omp_config.write_text("modelRoles:\n  smol: openrouter/some-model:off\n")
        rc, data, _, err = self.spawn(
            model="@smol", thinking="low"
        )  # no definition file at all
        self.assertEqual(0, rc, (data, err))
        _wait_exit(self.root, "Beta")
        _, hargv = _fake_harness_argv(self.state)
        self.assertEqual(
            ["-p", "--model=openrouter/some-model:off", "--thinking=low"], hargv[:3]
        )

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
            "--run",
            "r1",
            "--harness",
            "omp",
            "--name",
            "Beta",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "hi"),
            "--effort",
            "high",
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=self.spawn_env(),
            cwd=self.root,
        )
        self.assertNotIn("tmux ", "\n".join(_tmux_log_calls(self.state)))
        self.assertFalse(data.get("ok"), data)

    def test_spawn_rejects_thinking_for_claude(self):
        rc, data, _, _ = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            "Alpha",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "hi"),
            "--thinking",
            "medium",
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=self.spawn_env(),
            cwd=self.root,
        )
        self.assertFalse(data.get("ok"), data)


OMP_THINKING_LEVELS = {
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "auto",
}
SHIPPED_OMP_AGENTS = sorted((SCRIPT.parent.parent / "omp" / "agents").glob("*.md"))


class ShippedOmpAgentsThinkingTests(Base):
    """Every omp agent file we ship must yield a --thinking value omp accepts, via the real spawn path.
    atlas_launch has no --thinking builder of its own: interactive launches pass none, headless shells out to
    `atlas_mux spawn`, which is what the second test exercises."""

    def setUp(self):
        super().setUp()
        self.omp_config.write_text(
            "modelRoles:\n  smol: openrouter/some-model:off\n  default: openrouter/some-model:off\n"
        )

    def test_shipped_agents_exist(self):
        self.assertGreaterEqual(len(SHIPPED_OMP_AGENTS), 13)

    def test_every_shipped_agent_yields_valid_thinking_in_builder_argv_and_pane_tail(
        self,
    ):
        import unittest.mock as mock

        import atlas_mux

        for path in SHIPPED_OMP_AGENTS:
            role = path.stem
            with self.subTest(role=role):
                with mock.patch.dict(
                    os.environ, {"ATLAS_MUX_OMP_CONFIG": str(self.omp_config)}
                ):
                    model, level, body, err = atlas_mux._tier(
                        "omp", role, None, None, None
                    )
                self.assertIsNone(err, err)
                argv = atlas_mux.harness_argv(
                    "omp", role, "task", model, level, body, "acceptEdits"
                )
                values = [
                    a.split("=", 1)[1] for a in argv if a.startswith("--thinking=")
                ]
                self.assertEqual(1, len(values), argv[:4])
                self.assertIn(values[0], OMP_THINKING_LEVELS)
                self.assertFalse(set(values[0]) & set("\"'"), values[0])
                # the run-worker tail cmd_spawn puts in the pane carries the same level
                pane = atlas_mux.pane_command(
                    {"ATLAS_PROJECT_ROOT": "/r"},
                    ["run-worker", "--harness", "omp", "--thinking", level],
                )
                tail = shlex.split(pane)
                self.assertEqual(values[0], tail[tail.index("--thinking") + 1])

    def test_spawn_cli_emits_valid_level_for_every_shipped_agent(self):
        env = self.spawn_env()
        for i, path in enumerate(SHIPPED_OMP_AGENTS):
            role = path.stem
            with self.subTest(role=role):
                rc, data, _, err = _run(
                    "spawn", "--run", "r1", "--harness", "omp", "--name", f"W{i}",
                    "--agent", role,
                    "--prompt-file", self.make_prompt(f"p{i}", "x"),
                    env=env, cwd=self.root,
                )  # fmt: skip
                self.assertEqual(0, rc, (data, err))
                self.assertIn(data.get("level"), OMP_THINKING_LEVELS)
                pane = [c for c in _tmux_log_calls(self.state) if f"-n W{i} " in c][0]
                tail = shlex.split(pane.split(" exec ", 1)[1])
                value = tail[tail.index("--thinking") + 1]
                self.assertEqual(data["level"], value)
                self.assertFalse(set(value) & set("\"'"), value)
        for i in range(len(SHIPPED_OMP_AGENTS)):
            _wait_exit(self.root, f"W{i}")


class SpawnLifecycleTests(Base):
    def _spawn(self, name="Alpha", harness="claude"):
        self.make_agent(
            "claude", "explorer", "---\nmodel: opus\neffort: high\n---\nbody\n"
        )
        self.make_agent("omp", "explorer", '---\nmodel: ["@smol"]\n---\nbody\n')
        self.omp_config.write_text("modelRoles:\n  smol: openrouter/some-model:off\n")
        return _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            harness,
            "--name",
            name,
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "hi"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
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
        self.assertEqual(
            calls_before + 3, len(calls_after)
        )  # has-session, list-windows, new-window
        self.assertNotIn("new-session", "\n".join(calls_after[calls_before:]))
        self.assertIn(
            "new-window -d -t atlas-r1 -n Beta", "\n".join(calls_after[calls_before:])
        )

    def test_parallel_spawns_create_the_session_once(self):
        """Audit F5: 8 parallel spawns raced has-session/new-session and 7 failed."""
        self.make_agent(
            "claude", "explorer", "---\nmodel: opus\neffort: high\n---\nbody\n"
        )
        prompt = self.make_prompt("p", "hi")
        procs = [
            subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "spawn",
                    "--run",
                    "r1",
                    "--harness",
                    "claude",
                    "--name",
                    f"P{i}",
                    "--agent",
                    "explorer",
                    "--prompt-file",
                    prompt,
                    "--agents-dir",
                    os.path.join(self.root, "agents"),
                ],
                env=self.spawn_env(),
                cwd=self.root,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for i in range(8)
        ]
        results = [(p.communicate()[0], p.returncode) for p in procs]
        self.assertEqual([0] * 8, [rc for _, rc in results], results)
        calls = "\n".join(_tmux_log_calls(self.state))
        self.assertEqual(1, calls.count("new-session"), calls)
        self.assertEqual(8, calls.count("new-window"), calls)
        for i in range(8):
            _wait_exit(self.root, f"P{i}")

    @unittest.skipUnless(shutil.which("tmux"), "tmux not installed")
    def test_parallel_spawns_on_a_real_tmux_server(self):
        real_tmux = shutil.which("tmux")
        assert real_tmux is not None
        sock = os.path.join(self.root, "t.sock")
        shim = pathlib.Path(self.bin_dir) / "tmux"
        shim.write_text(f'#!/bin/sh\nexec {real_tmux} -S {sock} -f /dev/null "$@"\n')
        shim.chmod(0o755)
        self.addCleanup(
            lambda: subprocess.run(
                [real_tmux, "-S", sock, "kill-server"], capture_output=True
            )
        )
        self.make_agent(
            "claude", "explorer", "---\nmodel: opus\neffort: high\n---\nbody\n"
        )
        prompt = self.make_prompt("p", "hi")
        env = self.spawn_env(extra={"ATLAS_MUX_WORKER_CMD": "sleep 5"})
        procs = [
            subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "spawn",
                    "--run",
                    "rr",
                    "--harness",
                    "claude",
                    "--name",
                    f"R{i}",
                    "--agent",
                    "explorer",
                    "--prompt-file",
                    prompt,
                    "--agents-dir",
                    os.path.join(self.root, "agents"),
                ],
                env=env,
                cwd=self.root,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for i in range(8)
        ]
        results = [(p.communicate()[0], p.returncode) for p in procs]
        self.assertEqual([0] * 8, [rc for _, rc in results], results)
        windows = subprocess.run(
            [
                real_tmux,
                "-S",
                sock,
                "list-windows",
                "-t",
                "atlas-rr",
                "-F",
                "#{window_name}",
            ],
            capture_output=True,
            text=True,
        ).stdout.split()
        self.assertEqual(
            sorted(["lead", *[f"R{i}" for i in range(8)]]), sorted(windows)
        )


class StatusKillTests(Base):
    def _spawn(self, name="Alpha"):
        self.make_agent(
            "claude", "explorer", "---\nmodel: opus\neffort: high\n---\nbody\n"
        )
        return _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            name,
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "hi"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=self.spawn_env(),
            cwd=self.root,
        )

    def test_status_lists_workers_and_board(self):
        rc, data, _, err = self._spawn("Alpha")
        self.assertEqual(0, rc, (data, err))
        _wait_exit(self.root, "Alpha")
        rc, data, _, err = _run(
            "status", "--run", "r1", env=self.spawn_env(), cwd=self.root
        )
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data.get("ok"), data)
        self.assertTrue(data.get("tmux"), data)
        workers = {w.get("name"): w for w in data.get("workers", [])}
        self.assertIn("Alpha", workers)
        self.assertEqual(0, workers["Alpha"].get("dead"))
        board = {b.get("name"): b for b in data.get("board", [])}
        self.assertEqual(0, board["Alpha"].get("exit"))

    def test_status_without_session(self):
        rc, data, _, err = _run(
            "status", "--run", "zz", env=self.spawn_env(), cwd=self.root
        )
        self.assertEqual(0, rc, (data, err))
        self.assertFalse(data.get("tmux"), data)
        self.assertIn("zz", data.get("session_name", "") + str(data.get("run", "")))

    def test_kill_idempotent(self):
        rc, data, _, err = self._spawn()
        self.assertEqual(0, rc, (data, err))
        rc, data, _, err = _run(
            "kill", "--run", "r1", env=self.spawn_env(), cwd=self.root
        )
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data.get("killed"), data)
        rc, data, _, err = _run(
            "kill", "--run", "r1", env=self.spawn_env(), cwd=self.root
        )
        self.assertEqual(0, rc, (data, err))
        self.assertFalse(data.get("killed"), data)
        self.assertEqual(
            1, sum(1 for c in _tmux_log_calls(self.state) if "kill-session" in c)
        )
        rc, data, _, err = _run(
            "status", "--run", "r1", env=self.spawn_env(), cwd=self.root
        )
        self.assertEqual(0, rc, (data, err))
        self.assertFalse(data.get("tmux"), data)

    def test_kill_gives_every_running_worker_a_failed_exit_note(self):
        """A killed worker writes no exit of its own; kill must, or it reads as working forever."""
        self.make_agent(
            "claude", "explorer", "---\nmodel: opus\neffort: high\n---\nbody\n"
        )
        env = self.spawn_env(extra={"ATLAS_MUX_WORKER_CMD": "sleep 4"})
        for name in ("Alpha", "Beta"):
            rc, data, _, err = _run(
                "spawn",
                "--run",
                "r1",
                "--harness",
                "claude",
                "--name",
                name,
                "--agent",
                "explorer",
                "--prompt-file",
                self.make_prompt("p", "hi"),
                "--agents-dir",
                os.path.join(self.root, "agents"),
                env=env,
                cwd=self.root,
            )
            self.assertEqual(0, rc, (data, err))
        logs = pathlib.Path(self.root) / ".atlas" / ".run" / "logs"
        deadline = time.time() + 15
        while time.time() < deadline and not all(
            (logs / f"{n}.log").exists() for n in ("Alpha", "Beta")
        ):
            time.sleep(0.05)
        rc, data, _, err = _run("kill", "--run", "r1", env=env, cwd=self.root)
        self.assertTrue(data.get("killed"), (data, err))
        for name in ("Alpha", "Beta"):
            self.assertEqual(
                "exit 137 [failed: killed by atlas_mux kill]",
                _texts(_notes(self.root, name))[-1],
            )
        for name in (
            "Alpha",
            "Beta",
        ):  # the orphaned fake worker finishes on its own: let it
            _wait_exit(self.root, name)
            deadline = time.time() + 15
            while (
                time.time() < deadline
                and _texts(_notes(self.root, name))[-1] != "exit 0"
            ):
                time.sleep(0.05)


class RunWorkerTests(Base):
    def run_worker(self, *extra, env_mut=None, name="Zeta"):
        env = dict(self.env)
        env["ATLAS_PROJECT_ROOT"] = self.root
        env.update(env_mut or {})
        argv = [
            "run-worker",
            "--run",
            "r1",
            "--name",
            name,
            "--harness",
            "claude",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "hello worker"),
            "--root",
            self.root,
            "--agents-dir",
            os.path.join(self.root, "agents"),
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
            ["alpha-report-1\nalpha-report-2\nexit 7 [failed: nonzero exit]"],
            _texts(recs),
        )

    def test_run_worker_records_its_harness_pid_on_the_member_entry(self):
        _atlas_todo().register_member(self.root, "Zeta")
        rc, _, err = self.run_worker("--command-override", "echo hi")
        self.assertEqual(0, rc, err)
        reg = json.loads(
            (pathlib.Path(self.root) / ".atlas/.run/channels.json").read_text()
        )
        entries = [
            m
            for c in reg["channels"].values()
            for m in c["members"]
            if m["name"] == "Zeta"
        ]
        self.assertTrue(entries)
        self.assertTrue(
            all(isinstance(m.get("pid"), int) and m["pid"] > 0 for m in entries)
        )

    def test_notes_are_atlas_todo_records_only(self):
        """Single writer: every board line is an atlas_todo.note record, nothing mux-shaped."""
        rc, _, err = self.run_worker("--command-override", "echo one")
        self.assertEqual(0, rc, err)
        lines = _read_board(self.board_file("Zeta"))
        self.assertEqual(1, len(lines))  # one report note: output + exit 0
        for rec in lines:
            # atlas_todo.note records: base keys plus the channel stamp (channel work)
            self.assertEqual(
                {"ts", "seq", "owner", "to", "item", "text", "channel", "kind"},
                set(rec),
            )
            self.assertEqual("Zeta", rec["owner"])
            self.assertEqual("lead", rec["to"])
        self.assertEqual("one\nexit 0", lines[-1]["text"])

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
                rc, _, err = self.run_worker(
                    "--command-override",
                    f"echo {shlex.quote(output)}; exit 0",
                    name=name,
                )
                self.assertEqual(1, rc, err)
                recs = _notes(self.root, name)
                self.assertEqual(
                    f"exit 1 [failed: {reason}]", _texts(recs)[-1].splitlines()[-1]
                )
                self.assertIn(
                    output, _texts(recs)[-1]
                )  # the evidence line is in the report

    def test_report_citing_http_codes_is_not_a_failure(self):
        rc, _, err = self.run_worker(
            "--command-override",
            "echo 'STATUS: DONE'; echo 'EVIDENCE: atlas_mux.py:402 returns 401'; echo 'NEXT: none'",
        )
        self.assertEqual(0, rc, err)
        self.assertEqual(
            "STATUS: DONE\nEVIDENCE: atlas_mux.py:402 returns 401\nNEXT: none\nexit 0",
            _texts(_notes(self.root, "Zeta"))[-1],
        )

    def test_stderr_is_captured_for_classification(self):
        rc, _, err = self.run_worker(
            "--command-override", "echo 'Model \"x\" not found' >&2; exit 0"
        )
        self.assertEqual(1, rc, err)
        self.assertEqual(
            "exit 1 [failed: model not found]",
            _texts(_notes(self.root, "Zeta"))[-1].splitlines()[-1],
        )

    def test_mcp_connection_warnings_do_not_fail_a_successful_run(self):
        """Observed in the real omp run: unrelated MCP-server warnings carry 401/404/auth
        text on stderr, but the worker answered and exited 0."""
        noise = (
            'Warning: MCP server "context7" failed to connect: HTTP 401: Authentication required; its tools are unavailable for this run.',
            'Warning: MCP server "magic" failed to connect: MCP error -32001: Not authenticated - your API key is missing; its tools are unavailable for this run.',
            'Warning: MCP server "fiddler" failed to connect: HTTP 402: x; its tools are unavailable for this run.',
        )
        script = (
            "".join(f"echo {shlex.quote(line)} >&2; " for line in noise) + "echo READY"
        )
        rc, _, err = self.run_worker("--command-override", script)
        self.assertEqual(0, rc, err)
        texts = _texts(_notes(self.root, "Zeta"))
        self.assertEqual(["READY\nexit 0"], texts)  # MCP warnings are noise, not report
        log = pathlib.Path(self.root) / ".atlas" / ".run" / "logs" / "Zeta.log"
        self.assertTrue(
            all(line in log.read_text() for line in noise)
        )  # still in the log

    def test_clean_run_is_not_flagged(self):
        rc, _, err = self.run_worker(
            "--command-override", "echo READY; echo 'port 14020 ok'"
        )
        self.assertEqual(0, rc, err)
        self.assertEqual(
            "READY\nport 14020 ok\nexit 0", _texts(_notes(self.root, "Zeta"))[-1]
        )

    def test_missing_harness_binary_is_a_failed_exit_note(self):
        self.make_agent("claude", "explorer", "---\nmodel: opus\n---\nbody\n")
        # real harness path (no override) with `claude` absent from PATH -> OSError in Popen
        rc, _, err = self.run_worker(env_mut={"PATH": "/nonexistent"})
        self.assertEqual(127, rc, err)
        texts = _texts(_notes(self.root, "Zeta"))
        self.assertEqual(1, len(texts), texts)
        self.assertTrue(texts[0].startswith("spawn failed:"), texts)
        self.assertTrue(texts[0].endswith("exit 127 [failed: spawn error]"), texts)

    def test_run_worker_pins_contract_env(self):
        rc, out, err = self.run_worker(
            "--command-override",
            'printf "%s|%s\\n" "$ATLAS_WORKER_NAME" "$ATLAS_PROJECT_ROOT"',
        )
        self.assertEqual(0, rc, err)
        self.assertIn(f"Zeta|{self.root}", _texts(_notes(self.root, "Zeta"))[0])

    def test_sigterm_and_sighup_leave_a_failed_exit_note(self):
        """tmux kill-window sends SIGHUP; without a handler the worker died silently and its
        board never showed an exit (audit F4: 1/3 killed agents reached a terminal state)."""
        import signal as _signal

        for sig, num in ((_signal.SIGTERM, 15), (_signal.SIGHUP, 1)):
            name = f"Sig{num}"
            env = dict(self.env, ATLAS_PROJECT_ROOT=self.root)
            p = subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "run-worker",
                    "--run",
                    "r1",
                    "--name",
                    name,
                    "--harness",
                    "claude",
                    "--agent",
                    "explorer",
                    "--prompt-file",
                    self.make_prompt("p", "hello"),
                    "--root",
                    self.root,
                    "--command-override",
                    "echo up; sleep 30",
                ],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            logf = pathlib.Path(self.root) / ".atlas" / ".run" / "logs" / f"{name}.log"
            deadline = time.time() + 15
            while time.time() < deadline and not (
                logf.exists() and "up" in logf.read_text().splitlines()
            ):
                time.sleep(0.05)
            p.send_signal(sig)
            rc = p.wait(timeout=15)
            self.assertEqual(128 + num, rc)
            self.assertEqual(
                f"exit {128 + num} [failed: killed by signal {num}]",
                _texts(_notes(self.root, name))[-1].splitlines()[-1],
            )


class OverrideEnvForwardingTests(Base):
    def test_worker_cmd_env_is_forwarded_as_flag(self):
        """tmux panes inherit the server env, so spawn must forward the override."""
        self.make_agent("claude", "explorer", "---\nmodel: opus\n---\n")
        rc, data, _, err = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            "Stub",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "hi"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=self.spawn_env(extra={"ATLAS_MUX_WORKER_CMD": "echo stubbed"}),
            cwd=self.root,
        )
        self.assertEqual(0, rc, (data, err))
        self.assertIn(
            "--command-override 'echo stubbed'", "\n".join(_tmux_log_calls(self.state))
        )
        recs = _wait_exit(self.root, "Stub")
        self.assertEqual(["stubbed\nexit 0"], _texts(recs))


class NotesInteropTests(Base):
    def test_mux_lines_coexist_with_atlas_todo_notes(self):
        rc = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "run-worker",
                "--run",
                "r1",
                "--name",
                "Alpha",
                "--harness",
                "claude",
                "--agent",
                "explorer",
                "--prompt-file",
                self.make_prompt("p", "hi"),
                "--root",
                self.root,
                "--agents-dir",
                os.path.join(self.root, "agents"),
                "--command-override",
                "echo raw-worker-stream",
            ],
            capture_output=True,
            text=True,
            env={**self.env, "ATLAS_PROJECT_ROOT": self.root},
            timeout=120,
        ).returncode
        self.assertEqual(0, rc)
        todo = SCRIPT.parent / "atlas_todo.py"
        p = subprocess.run(
            [
                sys.executable,
                str(todo),
                "note",
                "--owner",
                "Alpha",
                "--to",
                "all",
                "--root",
                self.root,
                "alpha done, note to lead",
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(0, p.returncode, p.stderr + p.stdout)
        # --to all: only broadcast notes, never the lead-addressed worker stream
        texts = _texts(_notes(self.root, to="all"))
        self.assertIn("alpha done, note to lead", texts)
        self.assertNotIn("raw-worker-stream", texts)
        # --to lead (CLI, as the lead runs it): stream + argv + exit + the broadcast note
        p = subprocess.run(
            [sys.executable, str(todo), "notes", "--to", "lead", "--root", self.root],
            capture_output=True,
            text=True,
            timeout=60,
        )
        texts = [n.get("text") for n in json.loads(p.stdout).get("notes", [])]
        self.assertIn("raw-worker-stream\nexit 0", texts)
        self.assertIn("alpha done, note to lead", texts)
        self.assertEqual(2, len(texts))


class HerdrTransportTests(Base):
    """Opt-in herdr transport (ATLAS_COLONY_TRANSPORT=herdr): workers are panes created over the herdr socket.
    The fake tmux on PATH logs any call, and every test asserts it stayed silent."""

    def setUp(self):
        super().setUp()
        import test_atlas_herdr as th

        self.handler = th.PaneHandler()
        self.fake = th.FakeHerdr(self.handler)
        self.addCleanup(self.fake.close)
        self.env["ATLAS_COLONY_TRANSPORT"] = (
            "herdr"  # herdr is opt-in under the claude-bg default
        )
        self.env["HERDR_SOCKET_PATH"] = self.fake.path

    def pane_texts(self):
        return [p["text"] for m, p in self.fake.calls if m == "pane.send_input"]

    def spawn(self, name="Alpha", extra=None, env_extra=None):
        prompt = self.make_prompt("p-" + name, "do the thing")
        return _run(
            "spawn", "--run", "r1", "--name", name, "--harness", "omp",
            "--agent", "implementer", "--prompt-file", prompt, "--model", "x/y",
            "--thinking", "low", "--root", self.root, *(extra or []),
            env=self.spawn_env(extra=env_extra),
        )  # fmt: skip

    def test_spawn_creates_a_pane_whose_command_pins_the_board_contract(self):
        rc, data, _, err = self.spawn(env_extra={"ATLAS_DB": "/lead/db"})
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data["ok"], data)
        self.assertEqual(data["session"], "atlas-r1")
        self.assertEqual(
            [], _tmux_log_calls(self.state)
        )  # no tmux call on the default path
        words = shlex.split(self.pane_texts()[0])
        self.assertEqual(words[:2], ["exec", "env"])
        self.assertIn("ATLAS_WORKER_NAME=Alpha", words)
        self.assertIn(f"ATLAS_PROJECT_ROOT={self.root}", words)
        self.assertIn("ATLAS_DB=/lead/db", words)  # FORWARDED_ENV
        i = words.index("run-worker")
        self.assertEqual(words[i + 1 : i + 3], ["--run", "r1"])
        self.assertIn("--thinking", words)  # tier travels to the worker
        ws = next(p for m, p in self.fake.calls if m == "workspace.create")
        self.assertEqual(ws["label"], "atlas-r1")
        self.assertEqual(ws["env"]["ATLAS_WORKER_NAME"], "Alpha")

    def test_spawn_records_the_created_pane_id_on_the_member_entry(self):
        rc, data, _, err = self.spawn()
        self.assertEqual(0, rc, (data, err))
        reg = json.loads(
            (pathlib.Path(self.root) / ".atlas/.run/channels.json").read_text()
        )
        pane_ids = [
            m.get("pane_id")
            for c in reg["channels"].values()
            for m in c["members"]
            if m["name"] == "Alpha"
        ]
        self.assertTrue(pane_ids and all(isinstance(p, str) and p for p in pane_ids))

    def test_tier_enforcement_refuses_before_any_pane(self):
        prompt = self.make_prompt("p", "x")
        rc, data, _, _ = _run(
            "spawn", "--run", "r1", "--name", "Alpha", "--harness", "omp",
            "--agent", "ghost", "--prompt-file", prompt, "--root", self.root,
            env=self.spawn_env(),
        )  # fmt: skip
        self.assertEqual(rc, 2)
        self.assertIn("tier enforcement", data["error"])
        self.assertEqual([], [m for m, _ in self.fake.calls if m.endswith(".create")])
        self.assertEqual([], _tmux_log_calls(self.state))

    def test_name_taken_and_status_and_kill_round_trip(self):
        self.assertEqual(0, self.spawn()[0])
        rc, data, _, _ = self.spawn()
        self.assertEqual(rc, 1)
        self.assertIn("name_taken", data["error"])
        rc, st, _, _ = _run(
            "status", "--run", "r1", "--root", self.root, env=self.spawn_env()
        )
        self.assertEqual(
            (st["transport"], [w["name"] for w in st["workers"]]), ("herdr", ["Alpha"])
        )
        self.assertFalse(st["tmux"])
        rc, k, _, _ = _run(
            "kill", "--run", "r1", "--root", self.root, env=self.spawn_env()
        )
        self.assertEqual((rc, k["killed"], k["transport"]), (0, True, "herdr"))
        # a killed worker never writes its own exit: kill posts one so it does not read as working forever
        self.assertIn(
            "exit 137 [failed: killed by atlas_mux kill]",
            _texts(_notes(self.root, "Alpha")),
        )
        self.assertEqual([], _tmux_log_calls(self.state))
        rc, st, _, _ = _run(
            "status", "--run", "r1", "--root", self.root, env=self.spawn_env()
        )
        self.assertEqual(st["workers"], [])
        rc, k2, _, _ = _run(
            "kill", "--run", "r1", "--root", self.root, env=self.spawn_env()
        )
        self.assertEqual((rc, k2["killed"]), (0, False))  # idempotent

    def test_herdr_not_running_falls_back_to_tmux(self):
        env = self.spawn_env(extra={"HERDR_SOCKET_PATH": "/nonexistent/h.sock"})
        env.pop(
            "ATLAS_COLONY_TRANSPORT"
        )  # the claude-bg default: omp falls back to panes
        prompt = self.make_prompt("p", "x")
        rc, data, _, err = _run(
            "spawn", "--run", "r1", "--name", "Alpha", "--harness", "omp",
            "--agent", "implementer", "--prompt-file", prompt, "--model", "x/y",
            "--thinking", "low", "--root", self.root, env=env,
        )  # fmt: skip
        self.assertEqual(0, rc, (data, err))
        self.assertIn("new-window", "\n".join(_tmux_log_calls(self.state)))

    def test_run_worker_protocol_is_transport_independent(self):
        """The pane command is the same run-worker invocation: argv note, output lines, then `exit <code>`."""
        self.assertEqual(0, self.spawn(extra=["--command-override", "echo hi"])[0])
        argv = shlex.split(self.pane_texts()[0])
        i = argv.index("run-worker")
        env = dict(self.env, ATLAS_PROJECT_ROOT=self.root)
        out = subprocess.run(
            [sys.executable, str(SCRIPT), *argv[i:]],
            capture_output=True,
            text=True,
            env=env,
            cwd=self.root,
        )
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        texts = _texts(_wait_exit(self.root, "Alpha"))
        self.assertEqual(texts[-1], "hi\nexit 0")


class ClaudeBgTests(Base):
    """claude-bg transport (the default for claude workers): `claude --bg` runs the harness as a
    supervised background agent, status reads `claude agents --json`, kill is `claude stop`. The
    fake claude on PATH answers all three from the fake-state dir."""

    def bg_env(self, extra=None):
        env = self.spawn_env(extra=extra)
        env.pop("ATLAS_COLONY_TRANSPORT", None)  # the default: claude-bg
        return env

    def set_agents(self, rows):
        (pathlib.Path(self.state) / "agents.json").write_text(json.dumps(rows))

    def spawn(self, name="Alpha", env_extra=None):
        self.make_agent(
            "claude",
            "explorer",
            "---\nname: explorer\nmodel: opus\neffort: high\n---\nbody\n",
        )
        return _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            name,
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "colonize the pane"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=self.bg_env(env_extra),
            cwd=self.root,
        )

    def test_default_transport_is_claude_bg(self):
        rc, data, _, err = _run(
            "status", "--run", "zz", env=self.bg_env(), cwd=self.root
        )
        self.assertEqual(0, rc, (data, err))
        self.assertEqual("claude-bg", data.get("transport"), data)
        self.assertFalse(data.get("tmux"), data)

    def test_spawn_runs_claude_bg_with_agent_tier_and_report_brief(self):
        rc, data, _, err = self.spawn()
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data.get("ok"), data)
        self.assertEqual("claude-bg", data.get("transport"), data)
        self.assertEqual("fakebg42", data.get("agent_id"), data)
        base, argv = _fake_harness_argv(self.state)
        self.assertEqual("claude", base)
        self.assertEqual(
            [
                "--bg",
                "--name",
                "Alpha",
                "--agent",
                "atlas:explorer",
                "--settings",
                _BG_SETTINGS_JSON,
                "--model",
                "opus",
                "--effort",
                "high",
                "--permission-mode",
                "dontAsk",
            ],
            argv[:-1],
        )
        brief = argv[-1]
        self.assertIn("colonize the pane", brief)  # the task prompt travels verbatim
        # no run-worker wrapper watches a claude-bg agent, so the brief itself carries the
        # board report contract (same C2 shape: one report note, then the exit line)
        self.assertIn("# Atlas worker report contract", brief)
        self.assertIn("--kind report", brief)
        self.assertIn("--owner Alpha", brief)
        self.assertIn("exit 0", brief)
        self.assertIn("exit 1 [failed:", brief)
        reg = json.loads(
            (pathlib.Path(self.root) / ".atlas/.run/channels.json").read_text()
        )
        pane_ids = [
            m.get("pane_id")
            for c in reg["channels"].values()
            for m in c["members"]
            if m["name"] == "Alpha"
        ]
        self.assertEqual(
            ["fakebg42"], pane_ids
        )  # the claude session id is the member handle

    def test_spawn_failure_refuses_and_reports(self):
        rc, data, _, err = self.spawn(env_extra={"FAKE_BG_EXIT": "1"})
        self.assertEqual(1, rc, (data, err))
        self.assertFalse(data.get("ok"), data)
        self.assertTrue(str(data.get("error", "")), data)

    def test_bg_brief_native_wake_paragraph_is_env_gated(self):
        """The SendMessage native wake is brief text ONLY when the lead exported
        ATLAS_LEAD_AGENT: unset must reproduce the pre-wake brief (the board note stays the
        transport of record; SendMessage is a best-effort extra)."""
        import atlas_mux

        args = ("colonize the pane", self.root, "Alpha", "chan", "lead")
        had = os.environ.pop("ATLAS_LEAD_AGENT", None)
        try:
            bare = atlas_mux._bg_brief(*args)
            self.assertNotIn("SendMessage", bare)
            self.assertNotIn("ATLAS_LEAD_AGENT", bare)
            self.assertTrue(bare.endswith("Post no other notes to the board."))
            os.environ["ATLAS_LEAD_AGENT"] = "lead-01a122"
            woke = atlas_mux._bg_brief(*args)
        finally:
            os.environ.pop("ATLAS_LEAD_AGENT", None)
            if had is not None:
                os.environ["ATLAS_LEAD_AGENT"] = had
        self.assertIn(
            "If the env var ATLAS_LEAD_AGENT is set to your lead's session name and "
            "ListAgents shows it, send the same report text via SendMessage (to: that name) "
            "immediately after posting the note. Do not retry sends. Skip entirely when "
            "unset or not listed.",
            woke,
        )
        # the wake rides after the note command, before the close of the report contract
        self.assertLess(woke.index("--kind report"), woke.index("SendMessage"))
        self.assertLess(woke.index("SendMessage"), woke.index("Post no other notes"))

    def test_spawn_claude_bg_forwards_lead_agent_env(self):
        """Lead-exported ATLAS_LEAD_AGENT reaches the claude-bg worker env (FORWARDED_ENV)
        and flips the brief's native-wake paragraph; an unset spawn carries neither."""
        rc, data, _, err = self.spawn(env_extra={"ATLAS_LEAD_AGENT": "lead-01a122"})
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data.get("ok"), data)
        _, argv = _fake_harness_argv(self.state)
        self.assertIn("SendMessage", argv[-1])
        log = pathlib.Path(self.state, "log").read_text(encoding="utf-8")
        self.assertIn("env: ATLAS_LEAD_AGENT=[lead-01a122]", log)

        unset_env = self.bg_env()
        unset_env.pop("ATLAS_LEAD_AGENT", None)
        rc2, data2, _, err2 = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            "Beta",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p2", "beta prompt"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=unset_env,
            cwd=self.root,
        )
        self.assertEqual(0, rc2, (data2, err2))
        self.assertTrue(data2.get("ok"), data2)
        _, argv2 = _fake_harness_argv(self.state)
        self.assertNotIn("SendMessage", argv2[-1])
        log2 = pathlib.Path(self.state, "log").read_text(encoding="utf-8")
        self.assertIn("env: ATLAS_LEAD_AGENT=[]", log2)

    def test_spawn_claude_bg_settings_cross_session_inbound(self):
        """claude --bg spawns with --settings {"crossSessionInbound":"accept", ...} (plus the
        two allow rules) so a worker's channel-bound messages are never parked on a
        permission-class mismatch and its mandatory brief actions never prompt (claude-bg only)."""
        rc, data, _, err = self.spawn()
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data.get("ok"), data)
        _, argv = _fake_harness_argv(self.state)
        self.assertIn(["--settings", _BG_SETTINGS_JSON], _pairs(argv), argv)

    def test_spawn_claude_bg_is_unattended_safe_by_default(self):
        """Unattended bg workers must not hang on permission prompts: with no caller
        --permission-mode the spawn defaults to dontAsk (auto-deny, allow rules still run),
        --settings parses with the brief's allow rules, and an explicit --permission-mode
        still passes through."""
        rc, data, _, err = self.spawn()
        self.assertEqual(0, rc, (data, err))
        _, argv = _fake_harness_argv(self.state)
        self.assertIn(["--permission-mode", "dontAsk"], _pairs(argv), argv)
        parsed = json.loads(dict(_pairs(argv))["--settings"])
        self.assertEqual("accept", parsed["crossSessionInbound"])
        self.assertEqual(
            ["Bash(python3 *atlas_todo.py*)", "mcp__claude_mem_mcp_search"],
            sorted(parsed["permissions"]["allow"]),
        )
        # caller passthrough: an explicit --permission-mode wins over the dontAsk default
        rc2, data2, _, err2 = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            "Beta",
            "--agent",
            "explorer",
            "--permission-mode",
            "acceptEdits",
            "--prompt-file",
            self.make_prompt("p2", "beta prompt"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=self.bg_env(),
            cwd=self.root,
        )
        self.assertEqual(0, rc2, (data2, err2))
        _, argv2 = _fake_harness_argv(self.state)
        self.assertIn(["--permission-mode", "acceptEdits"], _pairs(argv2), argv2)
        self.assertNotIn("dontAsk", argv2)

    def test_spawn_claude_bg_worker_env_carries_channel_pins(self):
        """The bg worker env carries ATLAS_WORKER_NAME (pinned by the mux) plus the lead's
        ATLAS_LEAD_NAME/ATLAS_CHANNEL (FORWARDED_ENV) so the headless-worker dispatch
        exemption and the note routing hold."""
        rc, data, _, err = self.spawn(
            env_extra={
                "ATLAS_LEAD_NAME": "lead-01a122",
                "ATLAS_CHANNEL": "tech-tools@main/pair",
            }
        )
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data.get("ok"), data)
        log = pathlib.Path(self.state, "log").read_text(encoding="utf-8")
        self.assertIn(
            "env: ATLAS_LEAD_AGENT=[] ATLAS_WORKER_NAME=[Alpha] "
            "ATLAS_LEAD_NAME=[lead-01a122] ATLAS_CHANNEL=[tech-tools@main/pair]",
            log,
            log,
        )

    def test_bg_brief_task_mirror_paragraph_is_env_gated(self):
        """The TaskCreate board-mirror paragraph is brief text ONLY when the lead exported
        ATLAS_TASKS_MIRROR truthy: unset/off must reproduce the pre-mirror brief (the atlas
        board stays the source of truth; TaskCreate is a best-effort native mirror)."""
        import atlas_mux

        args = ("colonize the pane", self.root, "Alpha", "chan", "lead")
        had = os.environ.pop("ATLAS_TASKS_MIRROR", None)
        try:
            bare = atlas_mux._bg_brief(*args)
            self.assertNotIn("TaskCreate", bare)
            self.assertNotIn("ATLAS_TASKS_MIRROR", bare)
            self.assertTrue(bare.endswith("Post no other notes to the board."))
            for on in ("1", "true", "ON"):
                os.environ["ATLAS_TASKS_MIRROR"] = on
                mirrored = atlas_mux._bg_brief(*args)
                self.assertIn(
                    "If a TaskCreate tool is available to you, mirror the board item you "
                    'claim: TaskCreate with subject "[<phase>] <content>" at claim time and '
                    "mark it completed when you post your completion. The atlas board remains "
                    "the source of truth; do not duplicate status updates beyond the one "
                    "completion.",
                    mirrored,
                )
                # the mirror rides after the note command, before the close of the contract
                self.assertLess(
                    mirrored.index("--kind report"),
                    mirrored.index('TaskCreate with subject "[<phase>]'),
                )
                self.assertLess(
                    mirrored.index('TaskCreate with subject "[<phase>]'),
                    mirrored.index("Post no other notes"),
                )
            for off in ("0", "false", "OFF", ""):
                os.environ["ATLAS_TASKS_MIRROR"] = off
                self.assertNotIn("TaskCreate", atlas_mux._bg_brief(*args))
        finally:
            os.environ.pop("ATLAS_TASKS_MIRROR", None)
            if had is not None:
                os.environ["ATLAS_TASKS_MIRROR"] = had

    def test_spawn_claude_bg_forwards_tasks_mirror_env(self):
        """Lead-exported ATLAS_TASKS_MIRROR reaches the claude-bg worker env (FORWARDED_ENV)
        and flips the brief's task-mirror paragraph; an unset spawn carries neither."""
        rc, data, _, err = self.spawn(env_extra={"ATLAS_TASKS_MIRROR": "1"})
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data.get("ok"), data)
        _, argv = _fake_harness_argv(self.state)
        self.assertIn("TaskCreate", argv[-1])
        log = pathlib.Path(self.state, "log").read_text(encoding="utf-8")
        self.assertIn("ATLAS_TASKS_MIRROR=[1]", log)

        unset_env = self.bg_env()
        unset_env.pop("ATLAS_TASKS_MIRROR", None)
        rc2, data2, _, err2 = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            "Beta",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p2", "beta prompt"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=unset_env,
            cwd=self.root,
        )
        self.assertEqual(0, rc2, (data2, err2))
        self.assertTrue(data2.get("ok"), data2)
        _, argv2 = _fake_harness_argv(self.state)
        self.assertNotIn("TaskCreate", argv2[-1])
        log2 = pathlib.Path(self.state, "log").read_text(encoding="utf-8")
        self.assertIn("ATLAS_TASKS_MIRROR=[]", log2)

    def test_status_lists_claude_bg_workers(self):
        self.set_agents(
            [
                {
                    "id": "bg1",
                    "kind": "background",
                    "cwd": self.root,
                    "name": "Alpha",
                    "status": "busy",
                    "state": "working",
                },
                {
                    "id": "bg2",
                    "kind": "background",
                    "cwd": "/elsewhere",
                    "name": "Other",
                    "status": "idle",
                    "state": "done",
                },
                {
                    "pid": 99,
                    "kind": "interactive",
                    "cwd": self.root,
                    "name": "ATLAS lead",
                    "status": "idle",
                },
            ]
        )
        rc, data, _, err = _run(
            "status", "--run", "r1", env=self.bg_env(), cwd=self.root
        )
        self.assertEqual(0, rc, (data, err))
        self.assertEqual("claude-bg", data.get("transport"), data)
        workers = {w["name"]: w for w in data.get("workers", [])}
        self.assertEqual(["Alpha"], sorted(workers))  # other cwd + interactive dropped
        self.assertEqual(0, workers["Alpha"]["dead"])
        self.assertEqual("bg1", workers["Alpha"]["pid"])
        self.assertEqual("working", workers["Alpha"]["state"])
        # a running worker's terminal output travels in the status row (`claude logs <id>`)
        (pathlib.Path(self.state) / "logs.out").write_text(
            "boot line\nSTATUS: half done\nNEXT: keep going\n"
        )
        rc, data, _, err = _run(
            "status", "--run", "r1", env=self.bg_env(), cwd=self.root
        )
        self.assertEqual(0, rc, (data, err))
        workers = {w["name"]: w for w in data.get("workers", [])}
        self.assertEqual(
            "STATUS: half done\nNEXT: keep going", workers["Alpha"]["tail"]
        )

    def test_status_marks_done_agents_dead(self):
        self.set_agents(
            [
                {
                    "id": "bg1",
                    "kind": "background",
                    "cwd": self.root,
                    "name": "Alpha",
                    "status": "idle",
                    "state": "done",
                }
            ]
        )
        rc, data, _, err = _run(
            "status", "--run", "r1", env=self.bg_env(), cwd=self.root
        )
        self.assertEqual(0, rc, (data, err))
        workers = {w["name"]: w for w in data.get("workers", [])}
        self.assertEqual(1, workers["Alpha"]["dead"])

    def test_status_without_claude_binary_yields_no_workers(self):
        env = self.bg_env()
        env["PATH"] = "/usr/bin:/bin"
        rc, data, _, err = _run("status", "--run", "r1", env=env, cwd=self.root)
        self.assertEqual(0, rc, (data, err))
        self.assertEqual([], data.get("workers"), data)

    def test_kill_stops_claude_bg_workers_and_posts_exit_notes(self):
        self.set_agents(
            [
                {
                    "id": "bg1",
                    "kind": "background",
                    "cwd": self.root,
                    "name": "Alpha",
                    "status": "busy",
                    "state": "working",
                },
                {
                    "id": "bg2",
                    "kind": "background",
                    "cwd": "/elsewhere",
                    "name": "Other",
                    "status": "busy",
                    "state": "working",
                },
                {
                    "id": "bg3",
                    "kind": "background",
                    "cwd": self.root,
                    "name": "Done",
                    "status": "idle",
                    "state": "done",
                },
            ]
        )
        rc, data, _, err = _run("kill", "--run", "r1", env=self.bg_env(), cwd=self.root)
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data.get("killed"), data)
        self.assertEqual("claude-bg", data.get("transport"), data)
        _, argv = _fake_harness_argv(self.state)  # the kill's one claude call
        self.assertEqual(
            ["stop", "bg1"], argv
        )  # other cwd and done rows are not stopped
        self.assertIn(
            "exit 137 [failed: killed by atlas_mux kill]",
            _texts(_notes(self.root, "Alpha"))[-1],
        )

    def test_kill_without_workers_is_idempotent(self):
        self.set_agents([])
        rc, data, _, err = _run("kill", "--run", "r1", env=self.bg_env(), cwd=self.root)
        self.assertEqual(0, rc, (data, err))
        self.assertFalse(data.get("killed"), data)

    def test_omp_worker_under_default_keeps_pane_transport(self):
        prompt = self.make_prompt("p", "x")
        rc, data, _, err = _run(
            "spawn", "--run", "r1", "--harness", "omp", "--name", "Beta",
            "--agent", "implementer", "--prompt-file", prompt,
            "--model", "x/y", "--thinking", "low", "--root", self.root,
            env=self.bg_env(),
        )  # fmt: skip
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data.get("ok"), data)
        # claude --bg is claude-only: omp falls back to panes (herdr is not running here)
        self.assertIn("new-window", "\n".join(_tmux_log_calls(self.state)))

    def test_herdr_opt_in_still_takes_claude_workers(self):
        import test_atlas_herdr as th

        handler = th.PaneHandler()
        fake = th.FakeHerdr(handler)
        self.addCleanup(fake.close)
        self.make_agent(
            "claude",
            "explorer",
            "---\nname: explorer\nmodel: opus\neffort: high\n---\nbody\n",
        )
        rc, data, _, err = _run(
            "spawn",
            "--run",
            "r1",
            "--harness",
            "claude",
            "--name",
            "Alpha",
            "--agent",
            "explorer",
            "--prompt-file",
            self.make_prompt("p", "go"),
            "--agents-dir",
            os.path.join(self.root, "agents"),
            env=self.spawn_env(
                extra={
                    "ATLAS_COLONY_TRANSPORT": "herdr",
                    "HERDR_SOCKET_PATH": fake.path,
                }
            ),
            cwd=self.root,
        )
        self.assertEqual(0, rc, (data, err))
        self.assertTrue(data.get("ok"), data)
        words = shlex.split(
            [p["text"] for m, p in fake.calls if m == "pane.send_input"][0]
        )
        self.assertIn("run-worker", words)  # the pane path is untouched when forced


class DeadFlagTests(unittest.TestCase):
    def test_only_plain_ascii_digits_parse_else_zero(self):
        import atlas_mux

        self.assertEqual(atlas_mux._dead_flag("1"), 1)
        self.assertEqual(atlas_mux._dead_flag("0"), 0)
        for bad in ("", "x", "-1", "1.0", "\u00b2", "\u0663"):
            self.assertEqual(atlas_mux._dead_flag(bad), 0, repr(bad))


class TmuxStateRobustnessTests(unittest.TestCase):
    """Colony launches must not depend on the lead's tmux pane or on tmux being present."""

    def test_stale_tmux_env_never_reaches_tmux(self):
        from unittest import mock

        import atlas_mux

        seen = {}

        def fake_run(argv, **kw):
            seen["env"] = kw["env"]
            seen["timeout"] = kw.get("timeout")
            return subprocess.CompletedProcess(argv, 0, "", "")

        stale = {"TMUX": "/nonexistent/sock,1,0", "TMUX_PANE": "%99"}
        with (
            mock.patch.dict(os.environ, stale),
            mock.patch.object(atlas_mux.subprocess, "run", fake_run),
        ):
            self.assertEqual(0, atlas_mux._tmux("has-session", "-t", "x").returncode)
        self.assertNotIn("TMUX", seen["env"])
        self.assertNotIn("TMUX_PANE", seen["env"])
        self.assertEqual(atlas_mux.TMUX_TIMEOUT_S, seen["timeout"])

    def test_missing_or_wedged_tmux_is_a_failed_result_not_an_exception(self):
        from unittest import mock

        import atlas_mux

        def boom(exc):
            def run(*a, **k):
                raise exc

            return run

        with mock.patch.object(atlas_mux.subprocess, "run", boom(FileNotFoundError())):
            r = atlas_mux._tmux("list-windows")
            self.assertEqual(127, r.returncode)
            opened = atlas_mux._open_window("atlas-t", "w", "true")
            assert opened is not None
            self.assertIn("tmux not found", opened)
        wedged = subprocess.TimeoutExpired("tmux", 10)
        with mock.patch.object(atlas_mux.subprocess, "run", boom(wedged)):
            r = atlas_mux._tmux("list-windows")
            self.assertEqual(r.returncode, 124)
            self.assertIn("timed out", r.stderr)


class StatusSidebarTests(unittest.TestCase):
    def test_status_drops_sidebar_and_lead_panes(self):
        import argparse
        import io
        from unittest import mock

        import atlas_herdr
        import atlas_mux

        panes = [
            {"label": n, "pane_id": f"p{i}"}
            for i, n in enumerate(["Sidebar", "Alpha", "Sidebar", "lead", "Beta"])
        ]
        out = io.StringIO()
        with (
            mock.patch.object(atlas_mux, "transport", return_value="herdr"),
            mock.patch.object(atlas_herdr, "list_panes", return_value=panes),
            contextlib.redirect_stdout(out),
            tempfile.TemporaryDirectory() as root,
        ):
            atlas_mux.cmd_status(argparse.Namespace(run="r1", root=root))
        self.assertEqual(
            [w["name"] for w in json.loads(out.getvalue())["workers"]],
            ["Alpha", "Beta"],
        )


if __name__ == "__main__":
    unittest.main()
