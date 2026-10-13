"""Shared test-env scrub for atlas hook tests (not collected: name lacks test_ prefix).

Claude Code injects the settings.json env block into every child process,
including the test runner. The hooks read these knobs at entry, so a user
who sets e.g. ATLAS_MEMORY_CAPTURE=off would silently break tests that
expect the default behavior.
"""

import os

USER_INJECTED = (
    "ATLAS_DASHBOARD_PORT",
    "ATLAS_OPTIMIZER_MODEL",
    "ATLAS_OPTIMIZE_LOG",
    "ATLAS_OPTIMIZE_VERBOSE",
    "ATLAS_TYPESAFE_SCORING",
    "ATLAS_MEMORY_CAPTURE",
    "ATLAS_DOCS_REPAIR",
)


def scrub(env=None):
    """env=None: pop the names from os.environ in place, return the removed
    mapping. env=dict: return a copy without those keys."""
    if env is None:
        return {k: os.environ.pop(k) for k in USER_INJECTED if k in os.environ}
    return {k: v for k, v in env.items() if k not in USER_INJECTED}
