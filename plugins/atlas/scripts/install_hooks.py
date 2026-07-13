#!/usr/bin/env python3
"""Install the atlas-orchestrate skill's automation hooks into a settings.json (GATED).

The atlas-orchestrate skill ships three hooks (under ../hooks/). This wires them into a Claude
Code settings file by MERGING - it never clobbers existing hooks, and it is idempotent
(re-running is a no-op once installed). Dry-run by default; only --apply writes, and it
backs the settings file up first.

Hooks:
  optimizer        UserPromptSubmit            prompt_optimizer.py    (timeout 120)
  format           PostToolUse Edit|Write|...  format_after_edit.py   (async, timeout 60)
  guard            PreToolUse  Bash            bash_advisor.py
  completion-gate  Stop                        completion_gate.py     (opt-out; on by default when docs/ exists)

The completion gate enforces the atlas "Definition of done" (no stopping a run
until evidence is captured). It is intrusive, so it is OFF by default: a plain --apply
installs the first three only. Install it explicitly with --select completion-gate.

Usage:
  python3 install_hooks.py --list                              # coverage in the default settings file
  python3 install_hooks.py                                     # plan (dry-run) for ~/.claude/settings.json
  python3 install_hooks.py --apply                             # install the default set (NOT the gate)
  python3 install_hooks.py --select completion-gate --apply    # opt into the completion gate
  python3 install_hooks.py --select optimizer --apply          # just the prompt optimizer
  python3 install_hooks.py --settings PATH [--apply]           # target a specific settings file
  python3 install_hooks.py --uninstall [--apply]               # remove the hooks this script installs

Stdlib only.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent.parent / "hooks"

# id -> (event, matcher|None, script filename, extra fields)
HOOK_SPECS = {
    "optimizer": ("UserPromptSubmit", None, "prompt_optimizer.py", {"timeout": 120}),
    "format": (
        "PostToolUse",
        "Edit|Write|MultiEdit",
        "format_after_edit.py",
        {"async": True, "timeout": 60},
    ),
    "guard": ("PreToolUse", "Bash", "bash_advisor.py", {}),
    "completion-gate": ("Stop", None, "completion_gate.py", {"timeout": 10}),
}

# Opt-in hooks are intentionally excluded from the default (no --select) install set:
# they are powerful enough to warrant an explicit choice. Still listable and selectable.
OPT_IN = {"completion-gate"}


def default_selection() -> list[str]:
    return [h for h in HOOK_SPECS if h not in OPT_IN]


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


def has_hook(settings: dict, event: str, script: str) -> bool:
    """True if any handler under `event` already runs this script."""
    for group in settings.get("hooks", {}).get(event, []):
        for h in group.get("hooks", []):
            if script in (h.get("command") or ""):
                return True
    return False


def plan(settings: dict, selected: list[str]) -> list[dict]:
    out = []
    for hid in selected:
        event, matcher, script, _extra = HOOK_SPECS[hid]
        out.append(
            {
                "id": hid,
                "event": event,
                "script": script,
                "action": "present" if has_hook(settings, event, script) else "install",
            }
        )
    return out


def apply_install(settings: dict, selected: list[str]) -> int:
    changed = 0
    hooks = settings.setdefault("hooks", {})
    for hid in selected:
        event, matcher, script, extra = HOOK_SPECS[hid]
        if has_hook(settings, event, script):
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
            kept = [h for h in orig if script not in (h.get("command") or "")]
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
    for hid, (event, matcher, script, _e) in HOOK_SPECS.items():
        state = (
            "[x] installed" if has_hook(settings, event, script) else "- not installed"
        )
        m = f" [{matcher}]" if matcher else ""
        print(f"  {state:16} {hid:9} -> {event}{m}")
    # surface any OTHER hooks present so the user sees the whole picture
    others = {}
    for event, groups in settings.get("hooks", {}).items():
        for group in groups:
            for h in group.get("hooks", []):
                cmd = h.get("command", "")
                if not any(s[2] in cmd for s in HOOK_SPECS.values()):
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
        tag = "INSTALL" if p["action"] == "install" else "present"
        print(f"  {tag:8} {p['id']:9} -> {p['event']}  ({command_for(p['script'])})")

    if args.apply:
        n = apply_install(settings, selected)
        if n:
            _backup_and_write(path, settings)
            print(
                f"\ninstalled {n} hook(s). Restart Claude Code or start a new session to load them."
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
