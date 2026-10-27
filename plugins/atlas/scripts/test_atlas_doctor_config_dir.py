"""atlas_doctor reads Claude Code's plugin registry from $CLAUDE_CONFIG_DIR/plugins when that is set.

Regression: a fresh install under a custom CLAUDE_CONFIG_DIR warned "atlas not found in
installed_plugins.json" on every SessionStart because the doctor read ~/.claude/plugins instead.
"""
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _resolve(env_overrides):
    env = {k: v for k, v in os.environ.items() if k not in ("CLAUDE_CONFIG_DIR", "ATLAS_PLUGINS_DIR", "ATLAS_OMP_PLUGINS_DIR")}
    env.update(env_overrides)
    code = "import atlas_doctor as d; print(d.PLUGINS_DIR); print(d._omp_plugins_dir())"
    out = subprocess.run([sys.executable, "-c", code], cwd=HERE, env=env, capture_output=True, text=True, check=True)
    return out.stdout.split("\n")[:2]


def test_claude_config_dir_moves_plugins_dir(tmp_path):
    cfg = str(tmp_path / "cfg")
    plugins, omp = _resolve({"CLAUDE_CONFIG_DIR": cfg, "HOME": str(tmp_path)})
    assert plugins == os.path.join(cfg, "plugins")
    assert omp == os.path.join(str(tmp_path), ".omp", "plugins")


def test_default_is_home_dot_claude(tmp_path):
    plugins, omp = _resolve({"HOME": str(tmp_path)})
    assert plugins == os.path.join(str(tmp_path), ".claude", "plugins")
    assert omp == os.path.join(str(tmp_path), ".omp", "plugins")


def test_atlas_plugins_dir_still_wins(tmp_path):
    plugins, _ = _resolve({"CLAUDE_CONFIG_DIR": str(tmp_path / "cfg"), "ATLAS_PLUGINS_DIR": str(tmp_path / "x" / "plugins")})
    assert plugins == str(tmp_path / "x" / "plugins")
