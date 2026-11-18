import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(HERE))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import bash_advisor as ba  # noqa: E402
import git_guard  # noqa: E402


def test_relevant_sees_through_quoting():
    assert git_guard._relevant("Bash", {"command": 'g""it push origin main'})
    assert git_guard._relevant("Bash", {"command": "g\\it push origin main"})
    assert git_guard._relevant("Bash", {"command": "git push"})
    assert not git_guard._relevant("Bash", {"command": "ls -la"})


def test_shell_wrapper_after_long_padding():
    cmd = "echo " + "a" * 8210 + ' ; sh -c "git commit -m x"'
    assert ba._match_git_commit(cmd)


def test_shell_wrapper_in_quoted_argument_is_not_a_commit():
    cmd = "python3 atlas_todo.py note 'peer said: sh -c \"git commit\"'"
    assert not ba._match_git_commit(cmd)
    assert not ba._match_git_commit("echo 'x: eval \"git commit -m x\"'")


def test_real_shell_wrappers_still_match():
    assert ba._match_git_commit('sh -c "git commit -m x"')
    assert ba._match_git_commit("cd x && bash -c 'git commit -m x'")
    assert ba._match_git_commit("FOO=1 sudo bash -lc 'git commit -m x'")
    assert ba._match_git_commit('eval "git commit -m x"')
