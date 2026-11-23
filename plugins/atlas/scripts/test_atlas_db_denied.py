import os
import sys
import unittest

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)

sys.path.insert(0, os.path.dirname(__file__))

import atlas_db

_TAIL = (
    " If you have other tasks that don't depend on this action, continue working"
    " on those. IMPORTANT: You *may* attempt to accomplish this action using other"
    " tools that might naturally be used to accomplish this goal."
)

# Real texts from tool_calls.error_snippet.
DENIED = {
    "old_atlas": "Atlas enforcement: dispatch needs SCOPE",
    "old_gate": "[atlas gate] no verified finding",
    "old_deny": "DENY - inline edit of target code",
    "old_task": "Task execution failed: DENY - scope missing",
    "hook_prefixed": "PreToolUse:Bash hook error: ROUTE - this work goes to a tmux team",
    "ctx_read": "[context-mode] Read blocked: file is 4200 lines. Use offset/limit or ctx_execute_file.",
    "ctx_read2": "context-mode: Read of a large file is blocked. Pass offset and limit, or use ctx_execute.",
    "route": "ROUTE - this work goes to a tmux team: run the command below\npython3 atlas_mux.py spawn-team",
    "git": "atlas git policy: refusing a force-push of protected branch main (x).",
    "fallow": "fallow-gate: blocked by fallow 2.90.0 at HEAD\n{...}",
    "fallow_ver": "fallow-gate: blocked: npx is fallow 2.1 below required 2.85.0.",
    "auto": "Permission for this action was denied by the Claude Code auto mode classifier."
    " Reason: Blocked by classifier." + _TAIL,
    "auto_dangerous": "Permission for this action was denied by the Claude Code auto mode"
    " classifier. Reason: The server-side auto mode classifier judged this action"
    " dangerous (it gave no explanation)." + _TAIL,
    "auto_noverdict": "The server-side auto mode classifier gave no verdict (error), so auto"
    " mode cannot determine the safety of mcp__lean-ctx__ctx_shell. This is a"
    " transient failure of the check, not a judgment about the action: a later"
    " response may get a verdict.",
    "hook_n_fallow_plugin": "PreToolUse:Bash hook error: [command hook 7]: fallow plugin"
    " gate: blocked by fallow 3.26.0 verified: at /Users/jerry/.local/bin/fallow"
    ' {"kind":"audit","verdict":"fail"}',
    "hook_n_fallow": "PreToolUse:Bash hook error: [command hook 4]: fallow-gate: blocked"
    ' by fallow 3.26.0 verified: at /x/fallow {"kind":"audit"}',
}

NOT_DENIED = {
    "traceback": "Traceback (most recent call last):\n  File \"x.py\", line 1\nValueError: denied",
    "exit": "Exit code 1\nfatal: bad revision 'x'",
    "exit137": "Exit code 137",
    "os": "PermissionError: [Errno 13] Permission denied: '/etc/shadow'",
    "shell_perm": "bash: ./run.sh: Permission denied",
    "enoent": "ENOENT: no such file or directory, open 'a.txt'",
    "ls": "ls: cannot access '/nope': No such file or directory",
    "test": "FAIL: test_x\nAssertionError: request was denied and blocked by the mock",
    "mid_route": "see the log: ROUTE - not at start",
    "mid_blocked": "Exit code 1\nthe call was blocked: fallow-gate: blocked by x",
    "unknown_field": 'ctx_execute: Unknown field "timeout" in input',
    "validation": 'Validation failed for tool "ctx_execute": bad input',
    "no_tool": "<tool_use_error>Error: No such tool available: foo</tool_use_error>",
    "hook_crash": "PreToolUse:Bash hook error: [command hook 7]: python3: can't open file",
    "empty": "",
}


class DeniedResultTest(unittest.TestCase):
    def test_denials(self):
        for name, text in DENIED.items():
            with self.subTest(name):
                self.assertTrue(atlas_db.is_denied_result(text))

    def test_plain_failures(self):
        for name, text in NOT_DENIED.items():
            with self.subTest(name):
                self.assertFalse(atlas_db.is_denied_result(text))


if __name__ == "__main__":
    unittest.main()
