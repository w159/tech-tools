"""Apply dashboard-saved behavior knobs to the environment of one hook run.

Claude Code exports its settings.json env block only at session start, so a knob saved
mid-session never reaches a running session's hooks. The dashboard also writes the knob to
<ATLAS_HOME or ~/.atlas>/settings.json {"env": {...}, "changed": {KEY: epoch}}; every hook
entry calls apply_store_env() before reading any knob. The store wins over an inherited value
only when it is at least as new as Claude Code's settings file (a stale store value must not
override a later direct edit of settings.json). Stdlib only; fails open.

Plugin settings: Claude Code exports each plugin userConfig value (plugin.json "userConfig")
to the plugin's subprocesses as CLAUDE_PLUGIN_OPTION_<KEY>. apply_plugin_options() maps the
ones listed in PLUGIN_OPTIONS onto the ATLAS_* variable the code reads, only when that
variable is not already set: an explicit environment variable or a dashboard-saved knob
always wins, and an empty option or one equal to its default changes nothing, so an
untouched install behaves exactly as before.
"""

import json
import os

# (userConfig key in plugin.json, the ATLAS_* variable the code reads)
PLUGIN_OPTIONS = (
    ("atlas_decision", "ATLAS_DECISION"),
    ("atlas_decision_url", "ATLAS_DECISION_URL"),
    ("atlas_decision_model", "ATLAS_DECISION_MODEL"),
    ("atlas_decision_protocol", "ATLAS_DECISION_PROTOCOL"),
    ("atlas_ollama_url", "ATLAS_OLLAMA_URL"),
    ("atlas_ollama_model", "ATLAS_OLLAMA_MODEL"),
    ("atlas_ollama_auto_roles", "ATLAS_OLLAMA_AUTO_ROLES"),
    ("atlas_analytics", "ATLAS_ANALYTICS"),
)
# Booleans: the code reads on/off; only "off" differs from the default (on), so only it is mapped.
BOOLEAN_OPTIONS = frozenset({"atlas_decision", "atlas_analytics"})
# Same values as plugin.json; an option equal to its default must not pin the variable
# (ATLAS_DECISION_URL set explicitly would bypass ATLAS_DECISION=off, ATLAS_ANALYTICS=on would
# bypass a `disable` consent or the CI opt-out).
OPTION_DEFAULTS = {
    "atlas_decision_url": "http://127.0.0.1:11434",
    "atlas_decision_protocol": "auto",
    "atlas_ollama_url": "http://127.0.0.1:11434",
    "atlas_ollama_auto_roles": "explorer,docs-auditor",
}
_FALSE = ("false", "0", "off", "no")


def option_value(key, environ=None):
    """The ATLAS_* value a plugin option asks for, or None when it asks for nothing."""
    env = os.environ if environ is None else environ
    raw = env.get("CLAUDE_PLUGIN_OPTION_" + key.upper())
    if raw is None:
        raw = env.get("CLAUDE_PLUGIN_OPTION_" + key)
    raw = (raw or "").strip()
    if not raw:
        return None
    if key in BOOLEAN_OPTIONS:
        return "off" if raw.lower() in _FALSE else None
    if raw.rstrip("/") == OPTION_DEFAULTS.get(key, ""):
        return None
    return raw


def apply_plugin_options(environ=None):
    """Fill each unset ATLAS_* variable from its exported plugin option; returns what was set."""
    env = os.environ if environ is None else environ
    applied = {}
    try:
        for key, var in PLUGIN_OPTIONS:
            if var in env:
                continue
            value = option_value(key, env)
            if value is not None:
                env[var] = value
                applied[var] = value
    except Exception:
        return applied
    return applied


def _settings_mtime(env):
    """mtime of Claude Code's settings.json, or None when missing/unreadable."""
    try:
        cfg = env.get("CLAUDE_CONFIG_DIR")
        if not cfg:
            cfg = os.path.join(env.get("HOME") or os.path.expanduser("~"), ".claude")
        return os.stat(os.path.join(cfg, "settings.json")).st_mtime
    except Exception:
        return None


def apply_store_env(environ=None):
    """Set each string value of the store's "env" into environ (default os.environ)."""
    # The store wins over an inherited value only when its `changed` epoch is at least as new
    # as Claude Code's settings.json mtime, minus 2 s.
    env = os.environ if environ is None else environ
    applied = {}
    try:
        home = env.get("ATLAS_HOME") or os.path.join(env.get("HOME") or os.path.expanduser("~"), ".atlas")
        with open(os.path.join(home, "settings.json"), encoding="utf-8") as fh:
            store = json.load(fh)
        stored = store["env"]
        changed = store.get("changed")
        if not isinstance(changed, dict):
            changed = {}
        mtime = None
        looked = False
        for k, v in stored.items():
            if not (isinstance(k, str) and isinstance(v, str)):
                continue
            if k in env:
                if env[k] == v:
                    continue
                if not looked:
                    mtime, looked = _settings_mtime(env), True
                if mtime is not None:
                    c = changed.get(k)
                    c = c if isinstance(c, (int, float)) and not isinstance(c, bool) else 0
                    if c < mtime - 2.0:
                        continue
            env[k] = v
            applied[k] = v
    except Exception:
        pass
    # After the store: a dashboard-saved knob and an inherited variable both outrank a plugin option.
    apply_plugin_options(env)
    return applied
