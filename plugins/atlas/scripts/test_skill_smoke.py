#!/usr/bin/env python3
# Per-skill smoke tests. One generated test per skills/<name>/SKILL.md proves what a
# deterministic test can: every path the skill tells the model to run or read exists,
# every atlas script it invokes accepts the subcommand and flags shown (via the
# script's own --help, never a live action), and every agent role it dispatches exists.
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import functools
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import unittest

PLUGIN_ROOT = pathlib.Path(__file__).resolve().parent.parent
SKILLS = PLUGIN_ROOT / "skills"
AGENTS = PLUGIN_ROOT / "agents"

_VAR_PATH = re.compile(r"\$\{?(CLAUDE_PLUGIN_ROOT|CLAUDE_SKILL_DIR)\}?(/[^\s`\"'<>*(){}|;,\[\]]*)")
_MD_LINK = re.compile(r"\]\(([^)\s#]+)(?:#[^)]*)?\)")
_ROLE = re.compile(r"(?<![\w/.-])atlas:([a-z][a-z0-9-]*)")
_SPAN = re.compile(r"`([^`\n]+)`")
_FLAG = re.compile(r"(?<![\w-])(--[a-z][a-z0-9-]*)")
_SEGMENT_SPLIT = re.compile(r"\|\||&&|[|;]")
_SCRIPT_TOKEN = re.compile(r"([A-Za-z0-9_./${}-]*?)([A-Za-z0-9_.-]+\.py)$")


def _split_frontmatter(text: str) -> tuple:
    if text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end != -1:
            return text[4:end], text[end + 4:]
    return "", text


def _clean(path: str) -> str:
    return path.rstrip(".:,)")


def _resolve(skill_dir: pathlib.Path, var: str, tail: str) -> pathlib.Path:
    base = PLUGIN_ROOT if var == "CLAUDE_PLUGIN_ROOT" else skill_dir
    return base / _clean(tail).lstrip("/")


def _code_lines(body: str) -> list:
    # Text the model would execute or read literally: inline code spans and fenced lines.
    out = []
    fenced = False
    for line in body.splitlines():
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        if fenced:
            out.append(line)
        else:
            out.extend(_SPAN.findall(line))
    return out


@functools.lru_cache(maxsize=None)
def _help(script: pathlib.Path, sub: str) -> tuple:
    # (rc, text) of the script's own argparse help; "" rc None when it has no argparse.
    src = script.read_text(encoding="utf-8", errors="replace")
    if "argparse" not in src:
        return None, src
    cmd = [sys.executable, str(script)] + ([sub] if sub else []) + ["--help"]
    with tempfile.TemporaryDirectory() as home:
        env = dict(os.environ, HOME=home, PYTHONDONTWRITEBYTECODE="1", NO_COLOR="1", COLUMNS="200")
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=env, cwd=home, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return 124, ""
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def _subcommands(top_help: str) -> set:
    m = re.search(r"\{([a-z0-9_,-]+)\}", top_help)
    return set(m.group(1).split(",")) if m else set()


def _check_invocation(skill: str, script: pathlib.Path, tail: str) -> list:
    problems = []
    rc, text = _help(script, "")
    if rc is None:
        # No argparse: fall back to literal presence in the script source.
        for flag in _FLAG.findall(tail):
            if flag not in text:
                problems.append(f"{skill}: {script.name} source has no {flag}")
        return problems
    if rc != 0:
        return [f"{skill}: {script.name} --help exited {rc}"]
    top = text
    subs = _subcommands(top)
    sub = ""
    first = next(iter(tail.split()), "")
    if subs and re.fullmatch(r"[a-z][a-z0-9_-]*", first):
        if first not in subs:
            return [f"{skill}: {script.name} has no subcommand '{first}' (has {sorted(subs)})"]
        sub = first
    sub_text = ""
    if subs and not sub and first.startswith("<"):
        # "<subcommand>" placeholder: a flag is fine when some subcommand accepts it.
        for name in sorted(subs):
            sub_text += "\n" + _help(script, name)[1]
    if sub:
        src, sub_text = _help(script, sub)
        if src not in (0, None):
            return [f"{skill}: {script.name} {sub} --help exited {src}"]
    for flag in sorted(set(_FLAG.findall(tail))):
        if flag in ("--help",):
            continue
        if not re.search(re.escape(flag) + r"(?![\w-])", top + "\n" + sub_text):
            problems.append(f"{skill}: {script.name} {sub} does not accept {flag}".replace("  ", " "))
    return problems


def _invocations(body: str) -> list:
    found = []
    for line in _code_lines(body):
        for seg in _SEGMENT_SPLIT.split(line):
            tokens = seg.split()
            for i, tok in enumerate(tokens):
                t = tok.strip("\"'")
                m = _SCRIPT_TOKEN.search(t)
                if not m or "<" in t or "*" in t:
                    continue
                found.append((t, " ".join(tokens[i + 1:])))
                break
    return found


def _script_path(skill_dir: pathlib.Path, token: str) -> pathlib.Path:
    m = _VAR_PATH.search(token)
    if m:
        return _resolve(skill_dir, m.group(1), m.group(2))
    return None


def check_skill(skill_dir: pathlib.Path) -> list:
    skill = skill_dir.name
    text = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
    front, body = _split_frontmatter(text)
    problems = []

    # 1. every referenced path exists
    for m in _VAR_PATH.finditer(body):
        tail = _clean(m.group(2))
        if re.search(r"[$]", tail) or tail.endswith("/") and not (_resolve(skill_dir, m.group(1), tail)).exists():
            if re.search(r"[$]", tail):
                continue
        p = _resolve(skill_dir, m.group(1), tail)
        if not p.exists():
            problems.append(f"{skill}: missing path {m.group(0)}")
    for target in _MD_LINK.findall(body):
        if re.match(r"[a-z]+:|/|\.\./\.\./\.\.", target) or any(c in target for c in "<>*${"):
            continue
        if not (skill_dir / target).exists() and not (PLUGIN_ROOT / target).exists():
            problems.append(f"{skill}: broken link {target}")

    # 2. atlas scripts accept the subcommand and flags shown
    seen = set()
    for token, tail in _invocations(body):
        script = _script_path(skill_dir, token)
        if script is None or script.suffix != ".py":
            continue
        if not script.exists():
            continue  # already reported by the path check
        key = (script, tail)
        if key in seen:
            continue
        seen.add(key)
        problems.extend(_check_invocation(skill, script, tail))

    # 3. dispatched agent roles exist
    skills = {p.name for p in SKILLS.iterdir() if p.is_dir()}
    agents = {p.stem for p in AGENTS.glob("*.md")}
    for role in sorted(set(_ROLE.findall(front + "\n" + body))):
        if role in agents or role in skills:
            continue
        problems.append(f"{skill}: atlas:{role} is neither an agent nor a skill")
    return problems


class SkillSmokeTests(unittest.TestCase):
    def test_one_test_per_skill(self):
        dirs = sorted(p.name for p in SKILLS.iterdir() if (p / "SKILL.md").is_file())
        generated = sorted(n[len("test_skill_"):] for n in dir(self) if n.startswith("test_skill_"))
        self.assertEqual([d.replace("-", "_") for d in dirs], generated)
        self.assertGreaterEqual(len(dirs), 40)


class SmokeDetectors(unittest.TestCase):
    def test_missing_path_and_bad_flag_and_bad_role_are_caught(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp) / "fake"
            d.mkdir()
            (d / "SKILL.md").write_text(
                "---\nname: fake\n---\nRead `${CLAUDE_SKILL_DIR}/references/nope.md`.\n"
                "Run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/atlas_resolve.py implement high --no-such-flag`.\n"
                "Dispatch atlas:ghost-role.\n",
                encoding="utf-8",
            )
            out = "\n".join(check_skill(d))
        self.assertIn("missing path", out)
        self.assertIn("--no-such-flag", out)
        self.assertIn("atlas:ghost-role", out)


def _make(skill_dir: pathlib.Path):
    def test(self):
        self.assertEqual([], check_skill(skill_dir))

    return test


for _d in sorted(SKILLS.iterdir()):
    if (_d / "SKILL.md").is_file():
        setattr(SkillSmokeTests, "test_skill_" + _d.name.replace("-", "_"), _make(_d))


if __name__ == "__main__":
    unittest.main()
