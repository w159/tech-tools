"""Regression tests: data-skill packager, env preloader (py + mjs), release tag probe."""

import os
import re
import shutil
import subprocess
import sys
import textwrap
import zipfile
from pathlib import Path

import pytest

PLUGIN = Path(__file__).resolve().parents[1]
REPO = PLUGIN.parents[1]
PACKAGER = (
    PLUGIN
    / "skills/armada/departments/data/skills/data-context-extractor/scripts/package_data_skill.py"
)
LOAD_PY = PLUGIN / "mcp/_env/load.py"
LOAD_MJS = PLUGIN / "mcp/_env/load.mjs"
RELEASE_YML = REPO / ".github/workflows/release.yml"


def _skill(root: Path) -> Path:
    skill = root / "demo"
    (skill / "references").mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: demo\ndescription: d\n---\nbody\n")
    (skill / "references" / "a.md").write_text("a\n")
    return skill


def _package(skill: Path, out: Path | None = None):
    args = [sys.executable, str(PACKAGER), str(skill)] + ([str(out)] if out else [])
    return subprocess.run(args, capture_output=True, text=True, cwd=skill.parent)


def test_packager_dotted_parent_dir(tmp_path):
    skill = _skill(tmp_path / ".claude" / "skills")
    out = tmp_path / "out"
    r = _package(skill, out)
    assert r.returncode == 0, r.stdout + r.stderr
    names = zipfile.ZipFile(out / "demo.zip").namelist()
    assert "demo/SKILL.md" in names and "demo/references/a.md" in names


def test_packager_hidden_files_still_skipped(tmp_path):
    skill = _skill(tmp_path)
    (skill / ".secret").write_text("x")
    (skill / ".git").mkdir()
    (skill / ".git" / "config").write_text("x")
    r = _package(skill, tmp_path / "out")
    assert r.returncode == 0
    names = zipfile.ZipFile(tmp_path / "out" / "demo.zip").namelist()
    assert not any("/." in n for n in names)


def test_packager_output_inside_skill_not_self_included(tmp_path):
    skill = _skill(tmp_path)
    out = skill / "dist"
    r = _package(skill, out)
    assert r.returncode == 0, r.stdout + r.stderr
    names = zipfile.ZipFile(out / "demo.zip").namelist()
    assert not any(n.endswith("demo.zip") for n in names)
    assert "demo/SKILL.md" in names


def _home(tmp_path):
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    return home


def _env(tmp_path, **extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CFG_", "PROBE_"))}
    env.pop("ATLAS_ENV_FILE", None)
    env["HOME"] = str(_home(tmp_path))
    env.update(extra)
    return env


def test_load_py_empty_shell_export_promotes_cfg(tmp_path):
    (tmp_path / "probe_mod.py").write_text(
        "import os; print('VAL=' + os.environ.get('PROBE_VAL', '<unset>'))\n"
    )
    env = _env(tmp_path, PROBE_VAL="", CFG_PROBE_VAL="dummy-12345678",
               PYTHONPATH=f"{tmp_path}")
    r = subprocess.run([sys.executable, str(LOAD_PY), "probe_mod"], env=env,
                       capture_output=True, text=True)
    assert "VAL=dummy-12345678" in r.stdout, r.stdout + r.stderr
    assert "env file value wins" not in r.stderr


def test_load_py_real_shell_value_still_wins(tmp_path):
    (tmp_path / "probe_mod.py").write_text(
        "import os; print('VAL=' + os.environ.get('PROBE_VAL', '<unset>'))\n"
    )
    env = _env(tmp_path, PROBE_VAL="shellval", CFG_PROBE_VAL="dummy-12345678",
               PYTHONPATH=f"{tmp_path}")
    r = subprocess.run([sys.executable, str(LOAD_PY), "probe_mod"], env=env,
                       capture_output=True, text=True)
    assert "VAL=shellval" in r.stdout, r.stdout + r.stderr


@pytest.mark.skipif(not (shutil.which("node") or shutil.which("bun")), reason="no node/bun")
def test_load_mjs_empty_shell_export_promotes_cfg(tmp_path):
    runtime = shutil.which("node") or shutil.which("bun")
    flag = "--import"
    script = "console.log('VAL=' + (process.env.PROBE_VAL ?? '<unset>'))"
    env = _env(tmp_path, PROBE_VAL="", CFG_PROBE_VAL="dummy-12345678")
    cmd = [runtime, flag, str(LOAD_MJS), "-e", script]
    r = subprocess.run(cmd, env=env, capture_output=True, text=True)
    assert "VAL=dummy-12345678" in r.stdout, r.stdout + r.stderr
    env["PROBE_VAL"] = "shellval"
    r = subprocess.run(cmd, env=env, capture_output=True, text=True)
    assert "VAL=shellval" in r.stdout, r.stdout + r.stderr


def _tag_probe_snippet() -> str:
    text = RELEASE_YML.read_text()
    m = re.search(r"(?ms)^( *)rc=0\n.*?(?=^ *# The marketplace)", text)
    assert m, "tag probe block (rc=0 ... ) not found in release.yml"
    return textwrap.dedent(m.group(0))


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def _run_probe(repo: Path, tag="armada-v9.9.9"):
    script = (
        "set -euo pipefail\nname=armada\ntag=" + tag + "\n"
        "for _ in once; do\n" + _tag_probe_snippet() +
        "\necho CREATE\ndone\n"
    )
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "HOME": str(repo.parent)}
    return subprocess.run(["bash", "-c", script], cwd=repo, env=env,
                          capture_output=True, text=True)


def _repo_with_origin(tmp_path, origin):
    repo = tmp_path / "work"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "remote", "add", "origin", str(origin))
    return repo


def test_release_unreachable_origin_fails(tmp_path):
    repo = _repo_with_origin(tmp_path, tmp_path / "does-not-exist")
    r = _run_probe(repo)
    assert r.returncode != 0 and "CREATE" not in r.stdout, r.stdout + r.stderr


def test_release_tag_present_skips_and_absent_creates(tmp_path):
    bare = tmp_path / "bare.git"
    _git(tmp_path, "init", "-q", "--bare", str(bare))
    seed = tmp_path / "seed"
    seed.mkdir()
    _git(seed, "init", "-q")
    _git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q",
         "--allow-empty", "-m", "x")
    _git(seed, "tag", "armada-v9.9.9")
    _git(seed, "push", "-q", str(bare), "armada-v9.9.9")
    repo = _repo_with_origin(tmp_path, bare)
    r = _run_probe(repo, "armada-v9.9.9")
    assert r.returncode == 0 and "CREATE" not in r.stdout, r.stdout + r.stderr
    r = _run_probe(repo, "armada-v0.0.1")
    assert r.returncode == 0 and "CREATE" in r.stdout, r.stdout + r.stderr
