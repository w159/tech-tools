import os
import sys
import datetime
import subprocess

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _test_isolation  # noqa: F401,E402
import atlas_status as st  # noqa: E402
import atlas_todo  # noqa: E402


def _git(root, *args):
    subprocess.run(("git", "-C", str(root)) + args, check=True, capture_output=True)


def _repo(tmp_path):
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "t@t")
    _git(tmp_path, "config", "user.name", "t")
    return tmp_path


def _plans(tmp_path, **files):
    d = tmp_path / "docs" / "plans"
    d.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (d / name).write_text(text, encoding="utf-8")
    return d


# --- _git -------------------------------------------------------------------


def test_git_strips_output_and_none_on_failure(tmp_path):
    _repo(tmp_path)
    _git(tmp_path, "commit", "--allow-empty", "-qm", "c1")
    assert st._git(str(tmp_path), "log", "--format=%s") == "c1"
    assert st._git(str(tmp_path), "rev-parse", "nonexistent-ref-zzz") is None


def test_git_none_on_oserror_and_timeout(monkeypatch):
    def boom(*a, **k):
        raise OSError("x")

    monkeypatch.setattr(st.subprocess, "run", boom)
    assert st._git("/x", "status") is None

    def to(*a, **k):
        raise subprocess.TimeoutExpired("git", 1)

    monkeypatch.setattr(st.subprocess, "run", to)
    assert st._git("/x", "status") is None


def test_git_passes_root_and_timeout(monkeypatch):
    seen = {}

    class R:
        returncode = 0
        stdout = "  out \n"

    def run(cmd, **kw):
        seen["cmd"], seen["kw"] = cmd, kw
        return R()

    monkeypatch.setattr(st.subprocess, "run", run)
    assert st._git("/r", "log", "-1") == "out"
    assert seen["cmd"] == ("git", "-C", "/r", "log", "-1")
    assert seen["kw"]["timeout"] == 15
    assert seen["kw"]["capture_output"] is True and seen["kw"]["text"] is True


# --- find_plan --------------------------------------------------------------


def test_find_plan_exact_with_and_without_md(tmp_path):
    d = _plans(tmp_path, **{"alpha.md": "x"})
    assert st.find_plan(str(tmp_path), "alpha") == str(d / "alpha.md")
    assert st.find_plan(str(tmp_path), "alpha.md") == str(d / "alpha.md")


def test_find_plan_substring_sorted_first(tmp_path):
    d = _plans(tmp_path, **{"2026-02-b-feat.md": "x", "2026-01-a-feat.md": "x", "x.txt": ""})
    assert st.find_plan(str(tmp_path), "feat") == str(d / "2026-01-a-feat.md")
    assert st.find_plan(str(tmp_path), "nomatch") is None


def test_find_plan_substring_ignores_non_md(tmp_path):
    _plans(tmp_path, **{"feat.txt": "x"})
    assert st.find_plan(str(tmp_path), "fea") is None


def test_find_plan_no_dir(tmp_path):
    assert st.find_plan(str(tmp_path), "a") is None


# --- load_findings ----------------------------------------------------------


def _write_findings(tmp_path, text):
    d = tmp_path / ".atlas" / ".run"
    d.mkdir(parents=True, exist_ok=True)
    (d / "findings.json").write_text(text, encoding="utf-8")


def test_load_findings_variants(tmp_path):
    assert st.load_findings(str(tmp_path)) == []
    _write_findings(tmp_path, "not json")
    assert st.load_findings(str(tmp_path)) == []
    _write_findings(tmp_path, '{"a": 1}')
    assert st.load_findings(str(tmp_path)) == []
    _write_findings(tmp_path, '[{"status": "verified"}]')
    assert st.load_findings(str(tmp_path)) == [{"status": "verified"}]


# --- is_verified / evidence -------------------------------------------------


@pytest.mark.parametrize(
    "entry,expected",
    [
        ({"status": "verified", "evidence": ["a"]}, True),
        ({"status": "verified", "evidence": []}, False),
        ({"status": "verified", "evidence": ("a",)}, True),
        ({"status": "verified", "evidence": "text"}, True),
        ({"status": "verified", "evidence": "   "}, False),
        ({"status": "verified"}, False),
        ({"status": "assumed", "evidence": ["a"]}, False),
    ],
)
def test_is_verified(entry, expected):
    assert st.is_verified(entry) is expected


def test_evidence_brief_joins_and_truncates():
    assert st._evidence_brief({"evidence": ["a", "b"]}) == "a; b"
    assert st._evidence_brief({"evidence": ("a",)}) == "a"
    assert st._evidence_brief({"evidence": "  hi  "}) == "hi"
    assert st._evidence_brief({"evidence": "x" * 300}) == "x" * 160


# --- plan_section -----------------------------------------------------------


def test_plan_section_missing():
    assert st.plan_section("/nonexistent-root-zz", "p") == (st.NONE, None)


def test_plan_section_counts_and_headings(tmp_path):
    d = _plans(
        tmp_path,
        **{"p.md": "# Title\n## Goals\n- [ ] one\n- [x] two\n- [X] three\ntext\n"},
    )
    body, path = st.plan_section(str(tmp_path), "p")
    assert path == str(d / "p.md")
    lines = body.split("\n")
    assert lines[0] == "Plan doc: `docs/plans/p.md` — 2/3 task boxes checked."
    assert lines[1] == "Sections: Title, Goals"


def test_plan_section_no_boxes_no_headings(tmp_path):
    _plans(tmp_path, **{"p.md": "just text\n"})
    body, _ = st.plan_section(str(tmp_path), "p")
    assert body == "Plan doc: `docs/plans/p.md` — no task boxes."


def test_plan_section_heading_truncation(tmp_path):
    _plans(tmp_path, **{"p.md": "".join(f"# h{i}\n" for i in range(9))})
    body, _ = st.plan_section(str(tmp_path), "p")
    assert body.split("\n")[1] == "Sections: " + ", ".join(f"h{i}" for i in range(8)) + "…"
    _plans(tmp_path, **{"q.md": "".join(f"# h{i}\n" for i in range(8))})
    body, _ = st.plan_section(str(tmp_path), "q")
    assert body.split("\n")[1].endswith("h7")


def test_plan_section_unreadable(tmp_path, monkeypatch):
    _plans(tmp_path, **{"p.md": "# x\n"})
    real = open

    def fake_open(path, *a, **k):
        if str(path).endswith("p.md"):
            raise OSError("nope")
        return real(path, *a, **k)

    monkeypatch.setattr("builtins.open", fake_open)
    assert st.plan_section(str(tmp_path), "p") == (st.NONE, None)


# --- findings_section -------------------------------------------------------


def test_findings_section_empty():
    assert st.findings_section([]) == st.NONE


def test_findings_section_labels_and_order():
    entries = [
        {"status": "verified", "evidence": ["e1"], "title": "V1"},
        {"status": "verified", "evidence": ["e2"], "claim": "V2"},
        {"status": "verified", "evidence": ["e3"]},
        {"status": "unverified", "title": "A1"},
        {"status": "rejected", "title": "R1"},
        {"title": "A2"},
    ]
    out = st.findings_section(entries).split("\n")
    assert out[0] == "3 verified · 2 assumed/unverified claims on file."
    assert out[1] == "- ✅ **verified** — (untitled) (_e3_)"
    assert out[2] == "- ✅ **verified** — V2 (_e2_)"
    assert out[3] == "- ✅ **verified** — V1 (_e1_)"
    assert out[4] == "- ⚠️ **assumed** — A2 (status: unlabeled)"
    assert out[5] == "- ⚠️ **assumed** — A1 (status: unverified)"
    assert len(out) == 6


def test_findings_section_caps():
    ver = [{"status": "verified", "evidence": [f"e{i}"], "title": f"V{i}"} for i in range(7)]
    asm = [{"status": "x", "title": f"A{i}"} for i in range(5)]
    out = st.findings_section(ver + asm).split("\n")
    assert out[0].startswith("7 verified · 5 assumed")
    assert len([x for x in out if "**verified**" in x]) == st.MAX_VERIFIED == 5
    assert len([x for x in out if "**assumed**" in x]) == st.MAX_ASSUMED == 3
    assert "V6" in out[1] and "V2" in out[5]
    assert "A4" in out[6] and "A2" in out[8]


# --- todos_section ----------------------------------------------------------


def _board(tmp_path, items):
    atlas_todo.save(str(tmp_path), {"items": items})


def test_todos_section_empty_and_archived(tmp_path):
    assert st.todos_section(str(tmp_path)) == st.NONE
    _board(tmp_path, [{"id": "a", "status": "pending", "archived": True}])
    assert st.todos_section(str(tmp_path)) == st.NONE


def test_todos_section_load_failure(monkeypatch):
    def boom(root):
        raise RuntimeError("x")

    monkeypatch.setattr(st.atlas_todo, "load", boom)
    assert st.todos_section("/x") == st.NONE


def test_todos_section_rollup(tmp_path):
    _board(
        tmp_path,
        [
            {"id": "d1", "status": "completed", "content": "done"},
            {"id": "o1", "status": "pending", "content": "  open  ", "owner": "bob"},
            {"id": "o2", "status": "in_progress", "content": "y" * 200},
        ],
    )
    out = st.todos_section(str(tmp_path)).split("\n")
    assert out[0] == "1/3 complete (2 remaining)."
    assert out[1] == "- ⏳ o1: open — bob"
    assert out[2] == "- ⏳ o2: " + "y" * 110
    assert len(out) == 3


def test_todos_section_more_open(tmp_path):
    _board(tmp_path, [{"id": f"i{i}", "status": "pending", "content": "c"} for i in range(10)])
    out = st.todos_section(str(tmp_path)).split("\n")
    assert out[0] == "0/10 complete (10 remaining)."
    assert out[-1] == "- … and 2 more open"
    assert len(out) == 10
    _board(tmp_path, [{"id": f"i{i}", "status": "pending", "content": "c"} for i in range(8)])
    assert "more open" not in st.todos_section(str(tmp_path))


# --- _version_tag -----------------------------------------------------------


def test_version_tag_variants():
    assert st._version_tag(["  v1.2.3 "]) == "v1.2.3"
    assert st._version_tag(["1.0.0-rc"]) == "1.0.0-rc"
    assert st._version_tag(["x1.2.3", "v1.2"]) is None


# --- git_section ------------------------------------------------------------


def test_git_section_no_tag_no_commits(tmp_path):
    _repo(tmp_path)
    assert st.git_section(str(tmp_path)) == st.NONE + " (no commits)"


def test_git_section_no_tag_with_commits(tmp_path):
    _repo(tmp_path)
    for i in range(12):
        _git(tmp_path, "commit", "--allow-empty", "-qm", f"c{i}")
    out = st.git_section(str(tmp_path)).split("\n")
    assert out[0] == "(no release tag found; last 20 commits)"
    assert len(out) == 1 + 10 + 1
    assert out[1].endswith("c11")
    assert out[-1] == "- … and 2 more"


def test_git_section_exactly_ten_no_more_line(tmp_path):
    _repo(tmp_path)
    for i in range(10):
        _git(tmp_path, "commit", "--allow-empty", "-qm", f"c{i}")
    out = st.git_section(str(tmp_path)).split("\n")
    assert len(out) == 11 and "more" not in out[-1]


def test_git_section_since_tag(tmp_path):
    _repo(tmp_path)
    _git(tmp_path, "commit", "--allow-empty", "-qm", "c0")
    _git(tmp_path, "tag", "v1.0.0")
    assert st.git_section(str(tmp_path)) == "No commits since tag `v1.0.0`."
    _git(tmp_path, "commit", "--allow-empty", "-qm", "after1")
    _git(tmp_path, "commit", "--allow-empty", "-qm", "after2")
    out = st.git_section(str(tmp_path)).split("\n")
    assert out[0] == "2 commits since `v1.0.0`."
    assert out[1].endswith("after2") and out[2].endswith("after1")
    assert len(out) == 3


# --- build_report / main ----------------------------------------------------


def test_build_report_layout(tmp_path):
    _repo(tmp_path)
    _plans(tmp_path, **{"feat.md": "# F\n- [x] a\n"})
    rep = st.build_report("feat", str(tmp_path))
    today = datetime.date.today().isoformat()
    lines = rep.split("\n")
    assert lines[0] == "# Status: feat"
    assert lines[1].startswith(f"_Generated {today} · every claim labeled")
    assert lines[2] == ""
    heads = [i for i, ln in enumerate(lines) if ln.startswith("## ")]
    assert [lines[i] for i in heads] == [
        "## Plan",
        "## Findings",
        "## Todos",
        "## Recent work (git)",
    ]
    assert "1/1 task boxes checked" in lines[heads[0] + 1]
    assert lines[heads[1] + 1] == st.NONE
    assert lines[heads[2] + 1] == st.NONE
    assert lines[-1] == ""
    assert lines[heads[1] - 1] == "" and lines[heads[2] - 1] == ""


def test_main_prints_report_and_returns_zero(tmp_path, capsys):
    _repo(tmp_path)
    rc = st.main(["myplan", "--root", str(tmp_path)])
    assert rc == 0
    out = capsys.readouterr().out
    assert out.startswith("# Status: myplan\n")
    assert out.endswith("\n")


def test_main_default_root_is_cwd(tmp_path, capsys, monkeypatch):
    _repo(tmp_path)
    _plans(tmp_path, **{"cwdplan.md": "# H\n"})
    monkeypatch.chdir(tmp_path)
    assert st.main(["cwdplan"]) == 0
    assert "docs/plans/cwdplan.md" in capsys.readouterr().out
