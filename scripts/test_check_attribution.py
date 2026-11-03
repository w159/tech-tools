"""Tests for check_attribution.py against throwaway git repos."""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_attribution as ca  # noqa: E402

OWNER = ("W159", "49504268+w159@users.noreply.github.com")


def git(repo, *args, env_who=OWNER):
    name, email = env_who
    env = {
        "GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email,
        "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email,
        "PATH": "/usr/bin:/bin:/usr/local/bin", "HOME": str(repo),
    }
    return subprocess.run(["git", *args], cwd=repo, env=env, check=True,
                          capture_output=True, text=True).stdout.strip()


def commit(repo, msg, who=OWNER):
    git(repo, "commit", "--allow-empty", "-q", "-m", msg, env_who=who)
    return git(repo, "rev-parse", "HEAD")


def new_repo(tmp_path):
    git(tmp_path, "init", "-q", "-b", "main")
    return tmp_path


def test_clean_commit_passes(tmp_path):
    repo = new_repo(tmp_path)
    commit(repo, "feat: thing\n\nBody text.")
    assert ca.scan(["HEAD"], cwd=repo) == {}


def test_claude_author_flagged(tmp_path):
    repo = new_repo(tmp_path)
    sha = commit(repo, "fix: x", who=("Claude", "noreply@anthropic.com"))
    bad = ca.scan(["HEAD"], cwd=repo)
    assert sha in bad
    assert any("author is Claude" in p for p in bad[sha])
    assert any("committer is Claude" in p for p in bad[sha])


def test_anthropic_email_alone_flagged(tmp_path):
    repo = new_repo(tmp_path)
    sha = commit(repo, "fix: y", who=("Assistant", "noreply@anthropic.com"))
    assert sha in ca.scan(["HEAD"], cwd=repo)


def test_claude_name_alone_flagged(tmp_path):
    repo = new_repo(tmp_path)
    sha = commit(repo, "fix: z", who=("Claude", "bot@example.com"))
    assert sha in ca.scan(["HEAD"], cwd=repo)


def test_trailers_flagged(tmp_path):
    repo = new_repo(tmp_path)
    shas = [
        commit(repo, "a\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"),
        commit(repo, "b\n\nClaude-Session: 01ABC"),
        commit(repo, "c\n\nGenerated with [Claude Code](https://claude.com/claude-code)"),
        commit(repo, "d\n\nSee https://claude.ai/code/session_01XYZ"),
    ]
    bad = ca.scan(["HEAD"], cwd=repo)
    assert set(shas) == set(bad)


def test_human_coauthor_and_dependabot_pass(tmp_path):
    repo = new_repo(tmp_path)
    commit(repo, "a\n\nCo-authored-by: Jane <jane@example.com>")
    commit(repo, "b\n\nSigned-off-by: dependabot[bot] <support@github.com>",
           who=("dependabot[bot]", "49699333+dependabot[bot]@users.noreply.github.com"))
    assert ca.scan(["HEAD"], cwd=repo) == {}


def test_range_only_checks_new_commits(tmp_path):
    repo = new_repo(tmp_path)
    old = commit(repo, "old", who=("Claude", "noreply@anthropic.com"))
    commit(repo, "new")
    assert ca.scan([f"{old}..HEAD"], cwd=repo) == {}


def test_cli_exit_codes(tmp_path, monkeypatch, capsys):
    repo = new_repo(tmp_path)
    commit(repo, "ok")
    monkeypatch.chdir(repo)
    assert ca.main(["HEAD"]) == 0
    commit(repo, "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>")
    assert ca.main(["HEAD"]) == 1
    assert ca.main(["no-such-ref"]) == 2
    assert "credit Claude" in capsys.readouterr().err
