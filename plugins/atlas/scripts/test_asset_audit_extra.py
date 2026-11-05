import io
import os
import sys
from contextlib import redirect_stdout

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _test_isolation  # noqa: F401,E402
import asset_audit  # noqa: E402


def test_read_default_limit_is_4000(tmp_path):
    p = tmp_path / "f.txt"
    p.write_text("a" * 5000)
    assert len(asset_audit._read(str(p))) == 4000


def test_frontmatter_reads_exactly_2000_chars(tmp_path):
    d = tmp_path / "skillx"
    d.mkdir()
    p = d / "SKILL.md"
    head = "name: n\n"
    tail = "description: "
    pad = "x" * (2000 - len(head) - 1 - len(tail) - 1)  # one char short of the limit
    p.write_text(head + pad + "\n" + tail + "XYZ")
    # 'X' is the last char inside the 2000-char window; 'Y' sits at index 2000
    assert asset_audit._frontmatter_desc(str(p)) == ("n", "X")


def test_agent_description_window_is_2000_chars(tmp_path, monkeypatch):
    adir = tmp_path / "agents"
    adir.mkdir()
    prefix = "description: "
    # 'react' ends exactly at char 2000 (kept); 'vue' lies beyond (dropped)
    pad = "q" * (2000 - len(prefix) - len(" react"))
    (adir / "ag.md").write_text(prefix + pad + " react")
    (adir / "late.md").write_text(prefix + pad + "  react")
    monkeypatch.setattr(asset_audit, "USER_SKILLS", str(tmp_path / "none"))
    monkeypatch.setattr(asset_audit, "USER_AGENTS", str(adir))
    by = {a["key"]: a for a in asset_audit.inventory()}
    assert by["ag"]["kind"] == "agent"
    assert "frontend" in by["ag"]["tags"]
    assert by["late"]["tags"] == []


def test_detect_depth_boundary(tmp_path):
    (tmp_path / "a" / "b" / "c").mkdir(parents=True)
    (tmp_path / "a" / "b" / "pom.xml").write_text("")
    assert "java" in asset_audit.detect_project_tags(str(tmp_path))
    (tmp_path / "a" / "b" / "pom.xml").unlink()
    (tmp_path / "a" / "b" / "c" / "pom.xml").write_text("")
    assert "java" not in asset_audit.detect_project_tags(str(tmp_path))


def test_detect_package_json_deps_beyond_4000(tmp_path):
    (tmp_path / "package.json").write_text(" " * 5000 + '{"dependencies": {"react": "1"}}')
    assert "frontend" in asset_audit.detect_project_tags(str(tmp_path))


def test_help_parser_shape():
    p = asset_audit._help_parser()
    assert p is not None and p.prog == "asset_audit.py"
    ns = p.parse_args(["/r", "--json", "--apply"])
    assert (ns.root, ns.json, ns.apply) == ("/r", True, True)
    ns = p.parse_args([])
    assert (ns.root, ns.json, ns.apply) == (None, False, False)
    text = p.format_help()
    assert "--apply" in text and "Dry run unless --apply" in text


@pytest.mark.parametrize("flag", ["-h", "--help"])
def test_main_help_returns_zero_and_prints(flag):
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = asset_audit.main(["asset_audit.py", flag])
    assert rc == 0
    assert "usage: asset_audit.py" in buf.getvalue()
    assert "--json" in buf.getvalue()


def test_main_help_flag_in_argv0_is_ignored(monkeypatch, tmp_path):
    monkeypatch.setattr(asset_audit, "inventory", lambda: [])
    monkeypatch.setattr(asset_audit, "_db", lambda: (None, None))
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = asset_audit.main(["-h", str(tmp_path)])
    assert rc == 0
    assert "usage:" not in buf.getvalue()


def test_main_returns_zero_on_normal_run(monkeypatch, tmp_path):
    monkeypatch.setattr(asset_audit, "inventory", lambda: [])
    monkeypatch.setattr(asset_audit, "_db", lambda: (None, None))
    buf = io.StringIO()
    with redirect_stdout(buf):
        assert asset_audit.main(["asset_audit.py", str(tmp_path), "--json"]) == 0
    assert buf.getvalue().lstrip().startswith("{")


def test_detect_package_json_window_is_8000(tmp_path):
    (tmp_path / "package.json").write_text(" " * (8001 - 8) + "tailwind")
    assert "frontend" not in asset_audit.detect_project_tags(str(tmp_path))
    (tmp_path / "package.json").write_text(" " * (8000 - 8) + "tailwind")
    assert "frontend" in asset_audit.detect_project_tags(str(tmp_path))


def test_summarize_keep_count_asymmetric():
    assets = [{"verdict": "keep", "est_tokens": 1}] * 3 + [
        {"verdict": "disable-here", "est_tokens": 5}
    ]
    s = asset_audit.summarize(assets, set(), {"auto": [], "confirm": []})
    assert (s["keep"], s["disable_here"], s["relocate_global"]) == (3, 1, 0)
    assert s["est_tokens_reclaimable_here"] == 5
