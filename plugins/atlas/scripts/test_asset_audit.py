#!/usr/bin/env python3
"""Tests for the asset/context-audit lens: atlas_db learning fns + engine."""

import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import asset_audit  # noqa: E402
import atlas_db  # noqa: E402


def test_db_learning_loop():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        conn = atlas_db.connect(path)
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, "/tmp/proj", "proj", "python")
        assets = [
            {
                "kind": "skill",
                "key": "salesforce-flow",
                "tags": ["salesforce"],
                "verdict": "disable-here",
                "est_tokens": 100,
            },
            {
                "kind": "skill",
                "key": "git-commit",
                "tags": [],
                "verdict": "keep",
                "est_tokens": 50,
            },
        ]
        atlas_db.record_asset_verdicts(conn, pid, assets)
        # keep verdicts are not stored
        assert atlas_db.asset_audit_summary(conn)["verdicts"] == 1
        # restore = learning signal -> suppressed next time
        atlas_db.mark_asset_applied(conn, "skill", "salesforce-flow")
        atlas_db.note_asset_restore(conn, "skill", "salesforce-flow")
        assert ("skill", "salesforce-flow") in atlas_db.suppressed_assets(conn)
        s = atlas_db.asset_audit_summary(conn)
        assert s["applied"] == 1 and s["restored"] == 1
        assert s["false_positive_rate"] == 1.0
        print("PASS test_db_learning_loop")
    finally:
        os.remove(path)


def test_engine_classifies_and_levels():
    assets = [
        {"kind": "skill", "key": "react-thing", "tags": ["frontend"]},
        {"kind": "skill", "key": "git-commit", "tags": []},
        {"kind": "skill", "key": "rhino3d", "tags": ["novelty"]},
        {"kind": "skill", "key": "azure-rbac", "tags": ["azure"]},
    ]
    project_tags = {"frontend"}
    other = set(asset_audit.TAXONOMY) - {"novelty"}
    asset_audit.classify(assets, project_tags, other)
    v = {a["key"]: a["verdict"] for a in assets}
    assert v["react-thing"] == "keep"  # matches project
    assert v["git-commit"] == "keep"  # universal
    assert v["azure-rbac"] == "disable-here"  # off-stack here, used elsewhere
    assert v["rhino3d"] == "relocate-global"  # novelty, nowhere
    for a in assets:
        a.setdefault("est_tokens", 10)
        a.setdefault("reason", "")
        a.setdefault("path", "/x")
    plan = asset_audit.build_plan(assets)
    auto_keys = {it["key"] for it in plan["auto"]}
    assert auto_keys == {"rhino3d"}  # only novelty auto-applies
    print("PASS test_engine_classifies_and_levels")


def test_tagging():
    assert "frontend" in asset_audit.tags_for("a react component")
    assert "mcp" in asset_audit.tags_for("build an MCP server")
    assert asset_audit.tags_for("commit message helper") == set()  # universal
    print("PASS test_tagging")


if __name__ == "__main__":
    test_db_learning_loop()
    test_engine_classifies_and_levels()
    test_tagging()
    print("ALL PASS")
