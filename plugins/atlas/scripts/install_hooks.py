#!/usr/bin/env python3
"""Install the atlas-orchestrate skill's automation hooks into a settings.json (GATED).

The atlas-orchestrate skill ships hooks (under ../hooks/). This wires them into a Claude
Code settings file by MERGING - it never clobbers existing hooks, and it is idempotent
(re-running is a no-op once installed). Dry-run by default; only --apply writes, and it
backs the settings file up first.

Hooks:
  optimizer        UserPromptSubmit            prompt_optimizer.py    (timeout 120)
  format           PostToolUse Edit|Write|...  format_after_edit.py   (async, timeout 60)
  guard            PreToolUse  Bash            bash_advisor.py
  completion-gate  Stop                        completion_gate.py     (opt-out; on by default when docs/ exists)

The plugin already runs all four hooks through hooks/hooks.json or event_dispatch.BINDINGS
(the completion gate is on by default when docs/ exists). A settings.json copy would run them
twice, so the default selection excludes every wired script (computed at run time) and
--apply refuses to add one. This script now only matters for hooks the plugin does not wire;
--list shows each hook as installed, "wired by the plugin" or not installed.

Usage:
  python3 install_hooks.py --list                              # coverage in the default settings file
  python3 install_hooks.py                                     # plan (dry-run) for ~/.claude/settings.json
  python3 install_hooks.py --apply                             # install the default set (hooks the plugin does not already wire)
  python3 install_hooks.py --select completion-gate --apply    # opt into the completion gate
  python3 install_hooks.py --select optimizer --apply          # just the prompt optimizer
  python3 install_hooks.py --settings PATH [--apply]           # target a specific settings file
  python3 install_hooks.py --uninstall [--apply]               # remove the hooks this script installs

Stdlib only.
"""

from __future__ import annotations

import argparse
import ast
import datetime as _dt
import json
import re
import shlex
import sys
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent.parent / "hooks"

# id -> (event, matcher|None, script filename, extra fields)
HOOK_SPECS = {
    "optimizer": ("UserPromptSubmit", None, "prompt_optimizer.py", {"timeout": 120}),
    "format": (
        "PostToolUse",
        "Edit|Write|MultiEdit|NotebookEdit",
        "format_after_edit.py",
        {"async": True, "timeout": 60},
    ),
    "guard": ("PreToolUse", "Bash", "bash_advisor.py", {}),
    "completion-gate": ("Stop", None, "completion_gate.py", {"timeout": 10}),
}

# Opt-in hooks are intentionally excluded from the default (no --select) install set:
# they are powerful enough to warrant an explicit choice. Still listable and selectable.
OPT_IN = {"completion-gate"}


def wired_scripts() -> set[str]:
    """Script filenames the plugin already runs: hooks.json commands plus event_dispatch.BINDINGS.

    Computed, never hardcoded. Installing one of these into settings.json would run it twice.
    """
    names: set[str] = set()
    try:
        data = json.loads((HOOKS_DIR / "hooks.json").read_text(encoding="utf-8"))
        for groups in data.get("hooks", {}).values():
            for group in groups:
                for h in group.get("hooks", []):
                    names.update(re.findall(r"([A-Za-z0-9_]+\.py)", h.get("command", "")))
    except (OSError, ValueError):
        pass
    try:
        tree = ast.parse((HOOKS_DIR / "event_dispatch.py").read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            targets = (
                [node.target]
                if isinstance(node, ast.AnnAssign)
                else getattr(node, "targets", [])
            )
            if any(getattr(t, "id", "") == "BINDINGS" for t in targets):
                bindings = ast.literal_eval(node.value)
                for rows in bindings.values():
                    names.update(row[0] + ".py" for row in rows)
    except (OSError, SyntaxError, ValueError):
        pass
    return names


def is_wired(hid: str) -> bool:
    return HOOK_SPECS[hid][2] in wired_scripts()


def default_selection() -> list[str]:
    wired = wired_scripts()
    return [h for h, spec in HOOK_SPECS.items() if h not in OPT_IN and spec[2] not in wired]


def command_for(script: str) -> str:
    return f'python3 "{HOOKS_DIR / script}"'


def load_settings(path: Path) -> dict:
    if not path.is_file():
        # Surface the missing source explicitly: returning {} here would let a
        # caller mistake an absent file for a successful empty read (M19).
        raise SystemExit(
            f"ERROR: settings file not found: {path}. "
            "Create it first, or omit --settings to use the default."
        )
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(
            f"ERROR: {path} is not valid JSON ({exc}). Fix it before installing."
        )


def runs_script(command: str, script: str) -> bool:
    """True when `command` runs the plugin's own hooks/<script>: exactly the
    command this script writes, or a token that resolves to that file. A
    substring test also matched a user's my_completion_gate.py or
    strict_bash_advisor.py.sh, and --uninstall then deleted them."""
    if not command:
        return False
    if command == command_for(script):
        return True
    target = (HOOKS_DIR / script).resolve()
    try:
        tokens = shlex.split(command)
    except ValueError:
        tokens = command.split()
    for tok in tokens:
        if not tok.endswith(script):
            continue
        try:
            if Path(tok).expanduser().resolve() == target:
                return True
        except (OSError, RuntimeError, ValueError):
            continue
    return False


def has_hook(settings: dict, event: str, script: str) -> bool:
    """True if any handler under `event` already runs this script."""
    for group in settings.get("hooks", {}).get(event, []):
        for h in group.get("hooks", []):
            if runs_script(h.get("command") or "", script):
                return True
    return False


def plan(settings: dict, selected: list[str]) -> list[dict]:
    out = []
    wired = wired_scripts()
    for hid in selected:
        event, matcher, script, _extra = HOOK_SPECS[hid]
        out.append(
            {
                "id": hid,
                "event": event,
                "script": script,
                "action": "present"
                if has_hook(settings, event, script)
                else "wired"
                if script in wired
                else "install",
            }
        )
    return out


def apply_install(settings: dict, selected: list[str]) -> int:
    changed = 0
    hooks = settings.setdefault("hooks", {})
    wired = wired_scripts()
    for hid in selected:
        event, matcher, script, extra = HOOK_SPECS[hid]
        if has_hook(settings, event, script):
            continue
        if script in wired:
            sys.stderr.write(
                f"refusing to add {hid} ({script}): the plugin already runs it via "
                "hooks.json or event_dispatch; a settings.json copy would run it twice.\n"
            )
            continue
        entry: dict = {
            "hooks": [{"type": "command", "command": command_for(script), **extra}]
        }
        if matcher is not None:
            entry = {"matcher": matcher, **entry}
        hooks.setdefault(event, []).append(entry)
        changed += 1
    return changed


def apply_uninstall(settings: dict, selected: list[str]) -> int:
    changed = 0
    hooks = settings.get("hooks", {})
    for hid in selected:
        event, _matcher, script, _extra = HOOK_SPECS[hid]
        groups = hooks.get(event)
        if not groups:
            continue
        new_groups = []
        for group in groups:
            orig = group.get("hooks", [])
            kept = [h for h in orig if not runs_script(h.get("command") or "", script)]
            if len(kept) != len(orig):
                changed += 1
            if kept:
                group["hooks"] = kept
                new_groups.append(group)
            # an emptied group is dropped entirely
        if new_groups:
            hooks[event] = new_groups
        else:
            hooks.pop(event, None)
    return changed


def cmd_list(settings: dict) -> None:
    print("atlas hook coverage:")
    wired = wired_scripts()
    for hid, (event, matcher, script, _e) in HOOK_SPECS.items():
        state = (
            "[x] installed"
            if has_hook(settings, event, script)
            else "[w] wired by the plugin"
            if script in wired
            else "- not installed"
        )
        m = f" [{matcher}]" if matcher else ""
        print(f"  {state:24} {hid:15} -> {event}{m}")
    # surface any OTHER hooks present so the user sees the whole picture
    others = {}
    for event, groups in settings.get("hooks", {}).items():
        for group in groups:
            for h in group.get("hooks", []):
                cmd = h.get("command", "")
                if not any(runs_script(cmd, s[2]) for s in HOOK_SPECS.values()):
                    others.setdefault(event, []).append(cmd)
    if others:
        print("\nother hooks already configured:")
        for event, cmds in others.items():
            for c in cmds:
                print(f"  {event}: {c}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Install atlas automation hooks (gated).")
    ap.add_argument(
        "--settings", type=str, default=str(Path.home() / ".claude" / "settings.json")
    )
    ap.add_argument(
        "--select",
        action="append",
        choices=list(HOOK_SPECS),
        help="install only these (repeatable); default: all",
    )
    ap.add_argument("--list", action="store_true", help="show coverage and exit")
    ap.add_argument(
        "--uninstall", action="store_true", help="remove the hooks this script installs"
    )
    ap.add_argument(
        "--apply", action="store_true", help="write changes (default: dry-run)"
    )
    args = ap.parse_args()

    if not HOOKS_DIR.is_dir():
        raise SystemExit(f"ERROR: hooks dir not found at {HOOKS_DIR}")

    path = Path(args.settings).expanduser()
    # A missing settings file is a valid fresh-install starting point; the
    # loader itself errors on missing files (M19) so stray paths do not look
    # like a silent empty read.
    settings = {} if not path.is_file() else load_settings(path)
    selected = args.select or default_selection()

    if args.list:
        print(f"settings: {path}")
        cmd_list(settings)
        return 0

    print(f"settings: {path}")
    if args.uninstall:
        if args.apply:
            n = apply_uninstall(settings, selected)
            if n:
                _backup_and_write(path, settings)
            print(f"removed {n} hook handler(s)." if n else "nothing to remove.")
        else:
            for hid in selected:
                event, _m, script, _e = HOOK_SPECS[hid]
                print(
                    f"  {'REMOVE' if has_hook(settings, event, script) else 'absent'}: {hid} ({event})"
                )
            print("\n(dry-run) re-run with --apply to remove.")
        return 0

    for p in plan(settings, selected):
        tag = {"install": "INSTALL", "wired": "wired"}.get(p["action"], "present")
        print(f"  {tag:8} {p['id']:9} -> {p['event']}  ({command_for(p['script'])})")

    if args.apply:
        n = apply_install(settings, selected)
        if n:
            _backup_and_write(path, settings)
            print(
                f"\ninstalled {n} hook(s). Restart Claude Code or start a new session to load them."
            )
        else:
            wired = wired_scripts()
            refused = [
                h
                for h in selected
                if HOOK_SPECS[h][2] in wired
                and not has_hook(settings, HOOK_SPECS[h][0], HOOK_SPECS[h][2])
            ]
            if refused:
                print(
                    f"\nnothing installed: the plugin already runs {', '.join(refused)} "
                    "(hooks.json / event_dispatch); a settings.json copy would run it twice."
                )
            else:
                print("\nall selected hooks already installed - no change.")
    else:
        print("\n(dry-run) re-run with --apply to install.")
    return 0


def _backup_and_write(path: Path, settings: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file():
        ts = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = path.with_name(f"{path.name}.backup-{ts}")
        backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"  backed up -> {backup.name}")
    path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
