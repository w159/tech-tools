#!/usr/bin/env python3
"""PreToolUse hook -- advisory-only Bash safety advisor.

Inspects the command a Bash tool call is about to run. On a catastrophic match it
emits additionalContext with a factual warning; on everything else it exits silently.

It NEVER emits permissionDecision and NEVER exits with a non-zero status that would
deny or force-ask on a tool call. The normal Claude Code permission flow is always
preserved.

Catastrophic patterns detected (near-irreversible, high blast radius):
  - Recursive force-delete of a root/home path (rm -rf /, rm -rf ~, etc.)
  - Fork bomb  (:(){ :|:& };:)
  - Filesystem format  (mkfs)
  - Raw write to a disk device  (dd of=/dev/...)
  - Redirect over a disk device  (> /dev/sd...)
  - World-writable chmod on /  (chmod -R 0777 /)

Secret patterns detected (printed into output/transcript; neutral rotate-if-unintended
advice; a value piped into another command is not flagged):
  - AWS access key ids  (AKIA...) and secret access keys
  - GitHub tokens  (ghp_/gho_/github_pat_...)
  - Bearer/API tokens  (Authorization: Bearer ..., token=...)
  - Secret-bearing env vars echoed/dumped  ($GITHUB_TOKEN, CFG_*, *_API_KEY)

Ponytail-before-commit mandate: a `git commit` (see _match_git_commit) gets a
one-time-per-session nudge to run ponytail-review on the staged diff, armed only
when the ponytail plugin is enabled (tool_routing.plugin_enabled). The omp twin is
omp/mandates.ts with the identical parse contract. ATLAS_MANDATES=off disables it.

All other commands: silent no-op, exit 0.

Stdlib only. Fail-open by construction: any parse or runtime error exits 0.
"""

from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import atlas_env  # noqa: E402

atlas_env.apply_store_env()
import atlas_hook_guard  # noqa: E402

# One-time marker dir for the commit nudge (tests point this at a temp dir).
# None until first use: tempfile (~8 ms of shutil/random imports) loads only on a
# commit nudge, not on every Bash call.
MANDATE_MARKER_DIR: str | None = None


def _marker_dir() -> str:
    global MANDATE_MARKER_DIR
    if MANDATE_MARKER_DIR is None:
        import tempfile

        MANDATE_MARKER_DIR = os.path.join(tempfile.gettempdir(), "atlas-mandates")
    return MANDATE_MARKER_DIR


# Shared mandate contract (also read by omp/mandates.ts); unreadable -> no nudge.
MANDATES_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "contracts", "mandates.json"
)


def _mandates() -> dict:
    try:
        with open(MANDATES_PATH) as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


# A flag token: a long option (--recursive, --force, --foo) or a short cluster (-rf, -r).
_RM_FLAG = r"(?:--[a-z-]+|-[a-zA-Z]+)"

# (compiled pattern, human reason). Order only affects which reason is reported first.

# Root / home targets, optionally quoted, with a trailing slash or glob:
# /  //  /*  /.  ~  ~/  ~/*  ~/.  $HOME  $HOME/  "$HOME"  "$HOME"/  "${HOME}/"  ${HOME}/*
_ROOT_HOME = r"[\"']?(?:/+[.*]?|(?:~|\$\{?HOME\}?)(?:\*|/+[.*]?)?)[\"']?(?:/+[.*]?)?"
_RM_TARGET = r"(" + _ROOT_HOME + r")(\s|$)"

from atlas_lazyre import lre  # noqa: E402
_CATASTROPHIC = [
    # Flag tokens (-rf, -Rf, -fR, -r -f, --recursive, --force, --no-preserve-root) may come
    # in any order, optionally followed by a bare `--`, then the root/home target. Two
    # bounded lookaheads confirm a recursive flag and a force flag appear among the leading
    # flag tokens; they only consume flag tokens (each - prefixed), so they cannot scan
    # past the target into a later command.
    (
        lre(
            r"\brm\s+"
            r"(?=(?:" + _RM_FLAG + r"\s+)*(?:--recursive|-[a-zA-Z]*[rR][a-zA-Z]*)\s)"
            r"(?=(?:" + _RM_FLAG + r"\s+)*(?:--force|-[a-zA-Z]*f[a-zA-Z]*)\s)"
            r"(?:" + _RM_FLAG + r"\s+)+(?:--\s+)?" + _RM_TARGET
        ),
        "recursive force-delete of a root/home path",
    ),
    # `cd / && rm -rf *` : the glob is the root once the cwd is /.
    (
        lre(
            r"\bcd\s+[\"']?/[\"']?\s*(?:&&|;)\s*rm\s+"
            r"(?=(?:-\S+\s+)*-[a-zA-Z]*[rR])(?:-\S+\s+)+(?:\./)?\*(\s|$)"
        ),
        "recursive delete of everything under /",
    ),
    # Unfiltered `find / -delete` (a -name/-type filter is a scoped delete, not flagged).
    (
        lre(
            r"\bfind\s+"
            + _ROOT_HOME
            + r"\s+(?:-(?:maxdepth|mindepth)\s+\d+\s+)*-delete\b"
        ),
        "find -delete over a root/home path",
    ),
    (lre(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:"), "fork bomb"),
    # mkfs only as the command word (optionally after sudo / a path), never as an
    # argument: `echo mkfs` and `grep mkfs docs/x` are text, not a format.
    (
        lre(r"(?:^|[;&|(`]\s*|\bsudo\s+)(?:\S*/)?mkfs(\.\w+)?\b", re.MULTILINE),
        "filesystem format",
    ),
    (lre(r"\bdd\b.*\bof=/dev/(disk|sd|nvme|hd)"), "raw write to a disk device"),
    (lre(r">\s*/dev/(sd|nvme|hd|disk)\w*"), "redirect over a disk device"),
    (
        lre(r"\bchmod\s+(-[a-zA-Z]*\s+)*-?R[a-zA-Z]*\s+0?777\s+/(\s|$)"),
        "world-writable chmod on /",
    ),
]


# Literal prefilters, parallel to _CATASTROPHIC / _SECRETS: each entry is a tuple of
# any-of groups that must ALL hit (case-sensitive; "i" entries are matched against the
# lowercased command) before the regex runs. A substring scan is C-speed, so a long benign
# command skips the regex scans entirely. Every gate is a necessary literal of its regex.
_CATASTROPHIC_GATES = (
    (("rm",),),
    (("rm",),),
    (("find",),),
    ((":(",),),
    (("mkfs",),),
    (("dd",),),
    (("/dev/",),),
    (("chmod",),),
)


def _gated(command: str, lowered: list, groups: tuple) -> bool:
    for group in groups:
        if group and group[0] == "i":
            if not lowered:
                lowered.append(command.lower())
            if not any(k in lowered[0] for k in group[1:]):
                return False
        elif not any(k in command for k in group):
            return False
    return True


def _match_catastrophic(command: str) -> str | None:
    """Return the human reason string if the command matches a catastrophic pattern."""
    lowered: list = []
    for (pat, reason), gate in zip(_CATASTROPHIC, _CATASTROPHIC_GATES):
        if _gated(command, lowered, gate) and pat.search(command):
            return reason
    return None


# Secrets printed into command output (transcripts, logs, screenshots). Not
# destructive like the class above -- but an exposed credential is best rotated,
# not just redacted, hence the rotate hint in the warning. Deliberately narrow to avoid nagging on benign reads: a bare `env` is
# NOT flagged (commonly needed, only sometimes secret-bearing); a secret-bearing
# variable name on the same line is.
_SECRET_VAR = (
    r"(?:AWS_SECRET_ACCESS_KEY"  # nosec: variable name regex, not a credential
    r"|[A-Z0-9_]*_(?:TOKEN|SECRET|PASSWORD|API_KEY)"
    r"|CFG_[A-Z0-9_]+)"
)  # nosec: regex of variable NAMES to warn on, not a credential
_SECRETS = [
    (lre(r"\bAKIA[0-9A-Z]{16}\b"), "an AWS access key id"),
    (
        lre(r"aws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{40}", re.IGNORECASE),
        "an AWS secret access key",
    ),
    (
        lre(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b"),
        "a GitHub token",
    ),
    (
        lre(
            r"(?:authorization[\"']?\s*[:=]\s*(?:bearer\s+)?[A-Za-z0-9._~+/=-]{8,}"
            r"|\bbearer\s+[A-Za-z0-9._~+/=-]{8,})",
            re.IGNORECASE,
        ),
        "a bearer/API token",
    ),
    (
        # Reading a credential file straight to output. .env.example/.sample/.template and
        # public keys are not secrets.
        lre(
            r"\b(?:cat|less|more|head|tail|bat)\b[^\n;&|]*?"
            r"(?:(?<![\w.-])\.env(?:\.(?!(?:example|sample|template)\b)[\w-]+)?(?=[\s\"';&|]|$)"
            r"|\.aws/credentials\b|\.netrc\b"
            r"|[\w./~-]*\.pem\b"
            r"|\bid_(?:rsa|dsa|ecdsa|ed25519)(?![\w.-]))"
        ),
        "a credential file read to output",
    ),
    (
        # Bare `env` / `printenv` with no arguments dumps the whole environment.
        # Piped straight into a selecting grep/rg it prints only the matched names
        # (`env | grep -E '^(CI|ATLAS)'`): not a dump, unless the filter inverts
        # (-v, -L) or itself selects secret-looking names.
        lre(
            r"(?:^|[;&|(`]\s*|\bsudo\s+)(?:env|printenv)\s*(?=$|[;&|)`])"
            r"(?!\s*\|(?!\|)\s*(?:e?grep|rg)\b"
            r"(?![^\n;&|]*\s-[A-Za-z]*[vL])"
            r"(?![^\n;&|]*(?i:TOKEN|SECRET|PASS|KEY|AUTH|CRED))"
            r"[^\n;&|]*\S)"
        ),
        "the full environment dump",
    ),
    (
        lre(
            r"\bgh\s+auth\s+token\b"
            r"|\baz\s+account\s+get-access-token\b"
            r"|\bgcloud\s+auth\s+print-(?:access|identity)-token\b"
        ),
        "a CLI-issued access token",
    ),
    (
        # A lone `|` after the variable means the value is piped into another
        # command (e.g. `echo "$GH_TOKEN" | gh auth login --with-token`), not
        # printed; `||` is not a pipe.
        lre(
            r"\b(?:env|printenv|echo|printf)\b[^\n|;&]*\b"
            + _SECRET_VAR
            + r"(?![^\n;&|]*\|(?!\|))"
        ),
        "secret-bearing environment variables",
    ),
]


_SECRETS_GATES = (
    (("AKIA",),),
    ((("i", "aws_secret_access_key")),),
    (("ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"),),
    ((("i", "authorization", "bearer")),),
    (("cat", "less", "more", "head", "tail", "bat"),),
    (("env",),),
    (("token",),),
    (
        ("env", "echo", "printf"),
        ("_TOKEN", "_SECRET", "_PASSWORD", "_API_KEY", "CFG_", "AWS_SECRET_ACCESS_KEY"),
    ),
)


def _match_secrets(command: str) -> str | None:
    """Return the human reason string if the command prints secrets to output."""
    lowered: list = []
    for (pat, reason), gate in zip(_SECRETS, _SECRETS_GATES):
        if _gated(command, lowered, gate) and pat.search(command):
            return reason
    return None


_SEGMENT_SPLIT = lre(r"&&|\|\||[;|&()`\n]")
_ENV_ASSIGN = lre(r"^[A-Za-z_][A-Za-z0-9_]*=")
# git global options that consume the NEXT token as their value (`--opt=v` forms
# are covered by the generic "starts with -" rule below).
_GIT_VALUE_OPTS = frozenset(
    {
        "-C",
        "-c",
        "--git-dir",
        "--work-tree",
        "--namespace",
        "--exec-path",
        "--super-prefix",
        "--config-env",
        "--attr-source",
    }
)
# Prefix wrappers that run their remaining argv; value = flags that take a value.
_WRAPPERS = {
    "env": frozenset({"-u", "-C", "-S", "--unset", "--chdir", "--split-string"}),
    "time": frozenset({"-f", "-o", "--format", "--output"}),
    "nohup": frozenset(),
    "command": frozenset(),
    "exec": frozenset({"-a"}),
    "builtin": frozenset(),
    "eval": frozenset(),
    "setsid": frozenset(),
    "nice": frozenset({"-n"}),
    "xargs": frozenset({"-I", "-n", "-L", "-P", "-d", "-E", "-s", "-a", "-l"}),
    "sudo": frozenset(
        {"-u", "-g", "-h", "-p", "-C", "-r", "-t", "-U", "-D", "-R", "-T"}
    ),
}
# Shell keywords / grouping tokens that merely precede a command.
_LEADERS = frozenset(
    {"then", "do", "else", "elif", "if", "while", "until", "!", "{", "}"}
)
_SEPARATOR_CHARS = frozenset(";&|()`\n")


# Bounds that keep the git parse linear in practice: shlex is quadratic on a
# single huge token, so only the head of each segment is tokenised and only the
# first segments are visited. A `git ... commit` head is far shorter than either.
_SEGMENT_HEAD = 2048
_MAX_SEGMENTS = 4096
# Commands up to this size are tokenised whole (quote-aware); larger ones use the
# bounded regex split so padding cannot hide a later segment and cost stays flat.
_SHLEX_MAX = 16384


# `sh -c '...'` / `bash -lc "..."`: the quoted script runs as its own command line.
_CMDPOS = (
    r"(?:^|[;&|(`\n])[ \t]*(?:(?:[A-Za-z_][A-Za-z0-9_]*=\S*|command|exec|sudo|env"
    r"|nohup|time|then|do|else|!|\{)[ \t]+)*(?:\S*/)?"
)
_SHELL_C = lre(
    _CMDPOS + r"""(?:ba|z|da|k)?sh\s+(?:-[A-Za-z]*\s+)*-[A-Za-z]*c[A-Za-z]*\s+(['"])(.*?)\1""",
    re.S,
)


# `eval "git commit -m x"`: the quoted argument is re-parsed as a command line.
_EVAL_Q = lre(_CMDPOS + r"""eval\s+(['"])(.*?)\1""", re.S)


def _regex_segments(command: str):
    """Fallback segmentation (old behaviour, bounded): quote-unaware regex split."""
    import shlex

    for segment in _SEGMENT_SPLIT.split(command, _MAX_SEGMENTS):
        segment = segment[:_SEGMENT_HEAD]
        if "git" not in segment:
            continue
        try:
            yield shlex.split(segment)
        except ValueError:
            yield segment.split()


def _command_segments(command: str):
    """Yield one argv token list per shell segment of `command`.

    Segments end at ; & | && || ( ) ` and newlines. Tokenised with shlex (posix,
    punctuation_chars) so quoted operators stay inside their word. On unbalanced
    quotes, or for very large commands, falls back to the bounded regex split.
    Shared by bash_advisor and fallow_gate (via _git_subcommands).
    """
    import shlex

    command = command or ""
    if len(command) > _SHLEX_MAX:
        yield from _regex_segments(command)
        return
    lex = shlex.shlex(command, posix=True, punctuation_chars=";&|()<>`\n")
    lex.whitespace = " \t\r"  # newline is a separator, not whitespace
    lex.whitespace_split = True
    try:
        tokens = list(lex)
    except ValueError:
        yield from _regex_segments(command)
        return
    current: list[str] = []
    for tok in tokens:
        if all(ch in _SEPARATOR_CHARS for ch in tok):
            if current:
                yield current
            current = []
        else:
            current.append(tok)
    if current:
        yield current


def _strip_wrappers(tokens: list[str]) -> list[str]:
    """Drop leading NAME=val, shell keywords and prefix wrappers (env, time, nohup,
    command, exec, xargs, sudo ...) with their flags; return the real argv."""
    while tokens:
        tok = tokens[0]
        if _ENV_ASSIGN.match(tok) or tok in _LEADERS:
            tokens = tokens[1:]
            continue
        name = tok.rsplit("/", 1)[-1]
        if name not in _WRAPPERS:
            break
        value_flags = _WRAPPERS[name]
        tokens = tokens[1:]
        if name == "command" and tokens and tokens[0] in ("-v", "-V"):
            return []  # lookup only, runs nothing
        while tokens and tokens[0].startswith("-"):
            flag = tokens[0]
            tokens = tokens[1:]
            if flag == "--":
                break
            if flag in value_flags and tokens:
                tokens = tokens[1:]
    return tokens


def _git_subcommands(command: str, _depth: int = 0):
    """Yield the git subcommand each shell segment runs.

    Parse contract: segments split on && || ; | & ( ) newline (shlex, quote-aware);
    leading NAME=value assignments and wrappers (env, time, nohup, command, exec,
    xargs, sudo, then/do/else, !) are skipped; the first real token must be `git`
    (or a path ending /git); git global options are skipped (-C <v>, -c <v>,
    --git-dir/--work-tree/--namespace/--exec-path (= or separate value), --no-pager,
    -p, --paginate, --bare, any other leading -flag, and a bare `--`); the next token
    is the subcommand. So `echo git commit` and `git stash commit` run no commit;
    `git commit --amend` does. The quoted script of `sh|bash|zsh -c` is parsed the
    same way (two levels deep), so wrapping is no bypass. `$(...)` and backtick
    bodies are segmented like any other command.

    Indirection closed conservatively (see _indirect_invocations): `g=git; $g commit`,
    `echo git commit | sh`, `sh <<< 'git commit'`, `find -exec[dir] git commit`, and
    `python -c` code that starts a process (os.system, subprocess ...) with git in a string
    literal or argv list. Residual limit of static matching: a command assembled at run time
    (substitution output, `eval "$x"`, a script written then run, perl/node/ruby -e, shell
    functions and aliases) is invisible here; only a real git pre-commit/pre-push hook
    enforces those.
    """
    for argv, _chdir in _git_invocations(command, _depth):
        yield argv[0]


def _git_invocations(command: str, _depth: int = 0):
    """Yield (argv, chdir) per git segment: argv starts at the subcommand
    (`["push", "origin", "main"]`), chdir is the last `-C <dir>` global option or
    None. Same parse contract as _git_subcommands, which is built on it."""
    command = command or ""
    if "git" not in command:
        return
    if _depth < 2:
        for m in _SHELL_C.finditer(command):
            yield from _git_invocations(m.group(2), _depth + 1)
        for m in _EVAL_Q.finditer(command):
            yield from _git_invocations(m.group(2), _depth + 1)
    segments = list(_command_segments(command))
    aliases = _git_aliases(segments)
    if _depth < 2:
        yield from _indirect_invocations(command, segments, _depth)
    for tokens in segments:
        tokens = _strip_wrappers(tokens)
        if tokens and tokens[0] in aliases:
            tokens = ["git"] + tokens[1:]
        yield from _git_argv(tokens)
        for sub in _find_exec(tokens):
            sub = _strip_wrappers(sub)
            if sub and sub[0] in aliases:
                sub = ["git"] + sub[1:]
            yield from _git_argv(sub)


def _git_argv(tokens: list[str]):
    """Yield (argv, chdir) when `tokens` (wrappers already stripped) is a git command line."""
    if not tokens or not (tokens[0] == "git" or tokens[0].endswith("/git")):
        return
    i, chdir = 1, None
    while i < len(tokens):
        tok = tokens[i]
        if tok in _GIT_VALUE_OPTS:
            if tok == "-C" and i + 1 < len(tokens):
                chdir = (
                    tokens[i + 1]
                    if chdir is None or os.path.isabs(tokens[i + 1])
                    else os.path.join(chdir, tokens[i + 1])
                )
            i += 2
        elif tok.startswith("-"):
            i += 1
        else:
            break
    if i < len(tokens):
        yield tokens[i:], chdir


# `g=git` / `export g=/usr/bin/git`: a later `$g commit` is a git commit. Only a segment made of
# assignments counts (`g=git $g x` expands $g before the assignment exists, so it runs nothing).
_GIT_ALIAS = lre(r"^([A-Za-z_][A-Za-z0-9_]*)=(?:\S*/)?git$")
_DECLARERS = frozenset({"export", "declare", "local", "readonly", "typeset"})


def _git_aliases(segments: list) -> frozenset:
    """Spellings (`$g`, `${g}`) of variables the command assigns to git. A reassignment to something
    else removes the name again, so `g=git; g=ls; $g commit` is not flagged."""
    found: dict = {}
    for tokens in segments:
        rest = tokens[1:] if tokens and tokens[0] in _DECLARERS else tokens
        if not rest or not all(_ENV_ASSIGN.match(t) for t in rest):
            continue
        for tok in rest:
            name = tok.split("=", 1)[0]
            found[name] = bool(_GIT_ALIAS.match(tok))
    out = set()
    for name, is_git in found.items():
        if is_git:
            out.update(("$" + name, "${" + name + "}"))
    return frozenset(out)


_FIND_EXEC = frozenset({"-exec", "-execdir", "-ok", "-okdir"})


def _find_exec(tokens: list[str]):
    """Yield the command line each `find -exec|-execdir|-ok|-okdir ... ;|+` runs."""
    if not tokens or tokens[0].rsplit("/", 1)[-1] != "find":
        return
    i = 1
    while i < len(tokens):
        if tokens[i] in _FIND_EXEC:
            j, sub = i + 1, []
            while j < len(tokens) and tokens[j] not in (";", "+"):
                sub.append(tokens[j])
                j += 1
            if sub:
                yield sub
            i = j
        i += 1


# `echo 'git commit' | sh`, `printf ... | bash -s`: the producer's text is the script.
_PIPE_SH = lre(r"\|[ \t]*(?:\S*/)?(?:ba|z|da|k)?sh(?:[ \t]+-[A-Za-z-]+)*[ \t]*(?:$|[;&|)\n<])", re.M)
# `sh <<< "git commit"`
_HERESTRING_SH = lre(r"""(?:^|[\s;&|(])(?:\S*/)?(?:ba|z|da|k)?sh\b[^\n;|&]*<<<[ \t]*(['"])(.*?)\1""", re.S)
_SHELLS = frozenset({"sh", "bash", "zsh", "dash", "ksh"})
_PY_NAME = lre(r"^python[0-9.]*$")
# Only code that can start a process is searched for git: `print('git commit')` runs nothing.
_PY_EXEC = lre(r"os\.(?:system|popen|exec[a-z]*|spawn[a-z]*)|subprocess|pty\.spawn|\bPopen\b|check_(?:call|output)")
_PY_STR = lre(r"""(['"])((?:\\.|(?!\1).)*)\1""", re.S)
_PY_LIST = lre(r"\[([^\]]*)\]")


def _dash_c(tokens: list[str]) -> str | None:
    """The script argument of `prog [-flags] -c <script>` (any flag cluster containing c)."""
    for k, tok in enumerate(tokens[1:-1], 1):
        if re.fullmatch(r"-[A-Za-z]*c[A-Za-z]*", tok):
            return tokens[k + 1]
        if not tok.startswith("-"):
            return None
    return None


def _python_commands(code: str):
    """Command lines a `python -c` script can run: its string literals, and list literals that start
    with 'git' (subprocess argv form)."""
    import shlex

    if not _PY_EXEC.search(code):
        return
    for m in _PY_STR.finditer(code):
        if "git" in m.group(2):
            yield m.group(2)
    for m in _PY_LIST.finditer(code):
        items = [s.group(2) for s in _PY_STR.finditer(m.group(1))]
        if items and items[0].rsplit("/", 1)[-1] == "git":
            yield " ".join(shlex.quote(s) for s in items)


def _indirect_invocations(command: str, segments: list, depth: int):
    """git invocations hidden one level down: piped to a shell, here-string, inside
    `find -exec sh -c`, or inside `python -c`. Same contract as _git_invocations, so every caller
    (git_guard's commit/push checks, the commit nudge) sees them. Anything built at run time
    (command substitution output, `eval "$x"`, a script written then run, other interpreters) is
    beyond static matching and stays unflagged."""
    if _PIPE_SH.search(command):
        for tokens in segments:
            if not tokens or tokens[0] not in ("echo", "printf"):
                continue
            args = tokens[1:]
            while args and args[0].startswith("-"):
                args = args[1:]
            body = " ".join(args)
            if tokens[0] == "printf":
                body = body.replace("\\n", "\n")
            yield from _git_invocations(body, depth + 1)
    for m in _HERESTRING_SH.finditer(command):
        yield from _git_invocations(m.group(2), depth + 1)
    for tokens in segments:
        tokens = _strip_wrappers(tokens)
        if not tokens:
            continue
        for argv, nested_shell in [(tokens, False)] + [(s, True) for s in _find_exec(tokens)]:
            argv = _strip_wrappers(argv)
            prog = argv[0].rsplit("/", 1)[-1] if argv else ""
            if nested_shell and prog in _SHELLS:
                code = _dash_c(argv)
                if code:
                    yield from _git_invocations(code, depth + 1)
            elif _PY_NAME.match(prog):
                code = _dash_c(argv)
                if code:
                    for line in _python_commands(code):
                        yield from _git_invocations(line, depth + 1)


def _program_invocations(command: str, programs: tuple, _depth: int = 0):
    """Yield the argv (program name first) of every segment running one of
    `programs` (e.g. ("gh", "hub")), wrappers and `sh -c` bodies included."""
    command = command or ""
    if not any(p in command for p in programs):
        return
    if _depth < 2:
        for m in _SHELL_C.finditer(command):
            yield from _program_invocations(m.group(2), programs, _depth + 1)
        for m in _EVAL_Q.finditer(command):
            yield from _program_invocations(m.group(2), programs, _depth + 1)
    for tokens in _command_segments(command):
        tokens = _strip_wrappers(tokens)
        if tokens and tokens[0].rsplit("/", 1)[-1] in programs:
            yield tokens


def _match_git_commit(command: str) -> bool:
    """True when some shell segment runs `git [global opts] commit`."""
    return "commit" in _git_subcommands(command)


def _ponytail_installed(root: str | None = None) -> bool:
    try:
        sys.path.insert(
            0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
        )
        import tool_routing

        return tool_routing.plugin_enabled("ponytail", root)
    except Exception:
        return False


def _commit_nudge(data: dict, command: str) -> str | None:
    """The one-time ponytail nudge for this session, or None (fail open)."""
    try:
        if os.environ.get("ATLAS_MANDATES", "").strip().lower() == "off" or not _match_git_commit(command):
            return None
        session = str(data.get("session_id") or "")
        if not session or not _ponytail_installed(data.get("cwd")):
            return None
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", session)
        marker_dir = _marker_dir()
        os.makedirs(marker_dir, exist_ok=True)
        marker = os.path.join(marker_dir, f"ponytail-{safe}")
        try:
            fd = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            return None
        os.close(fd)
        return _mandates().get("commitNudge") or None
    except Exception as exc:
        atlas_hook_guard.fault("bash_advisor", exc)
        return None


def main() -> int:
    data = atlas_hook_guard.load_payload("bash_advisor")

    if data.get("tool_name") not in (None, "Bash"):
        return 0

    command = (data.get("tool_input") or {}).get("command") or ""
    if not isinstance(command, str) or not command.strip():
        return 0

    reason = _match_catastrophic(command)
    if reason is not None:
        warning = (
            f"[atlas advisor] This command matches a catastrophic, near-irreversible pattern "
            f"({reason}). Confirm intent before running."
        )
    else:
        secret = _match_secrets(command)
        if secret is not None:
            warning = (
                f"[atlas advisor] This command would print secrets into its output/transcript "
                f"({secret}). Printing a secret puts it in the transcript and logs; rotate it "
                f"if this was unintended, and mask or omit it."
            )
        else:
            warning = _commit_nudge(data, command)
    if warning is None:
        return 0  # benign command -- no output, normal flow continues
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "additionalContext": warning,
                }
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(atlas_hook_guard.run_hook("bash_advisor", main))
