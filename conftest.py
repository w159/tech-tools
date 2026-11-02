"""Root pytest config: skip vendored and fixture trees that cannot be collected from the repo root.

plugins/armada/mcp/falcon/tests needs the vendored falcon dependencies; the programmer fixtures
contain deliberately broken sample projects whose tests are run by the programmer suite itself.
Plugin-local conftest files and configs still apply when those suites run from their own directory.
"""

collect_ignore_glob = [
    "plugins/armada/mcp/falcon/*",
    "plugins/programmer/tests/fixtures/*",
]
