"""
Pytest configuration file for the tests.
"""

import pytest


def pytest_addoption(parser):
    """
    Add the --run-integration option to pytest.
    """
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="run integration tests (requires real API credentials)",
    )


def pytest_configure(config):
    """
    Register the integration marker.
    """
    config.addinivalue_line(
        "markers",
        "integration: mark test as integration test requiring real API credentials",
    )
    config.addinivalue_line(
        "markers",
        "no_credentials: run without FALCON_CLIENT_ID/FALCON_CLIENT_SECRET (opts out of the dummy-credentials fixture)",
    )


def pytest_collection_modifyitems(config, items):
    """
    Skip integration tests if --run-integration flag is not given.
    """
    if not config.getoption("--run-integration"):
        skip_integration = pytest.mark.skip(
            reason="need --run-integration option to run"
        )
        for item in items:
            if "integration" in item.keywords:
                item.add_marker(skip_integration)


@pytest.fixture
def verbosity_level(request):
    """Return the verbosity level from pytest config."""
    return request.config.option.verbose


@pytest.fixture(autouse=True)
def _dummy_falcon_credentials(request, monkeypatch):
    """Keep the unit suite hermetic: no real tenant credentials, and no dependence on the caller's env.

    Without credentials the server boots in inert mode (falcon_status only), so every test that
    builds a full-mode server would behave differently depending on whether FALCON_CLIENT_ID /
    FALCON_CLIENT_SECRET happen to be set. Tests that are about the missing-credentials path mark
    themselves ``@pytest.mark.no_credentials`` (or clear the env themselves) to opt out.
    """
    if "integration" in request.keywords:
        return  # integration tests use the real environment
    if request.node.get_closest_marker("no_credentials"):
        monkeypatch.delenv("FALCON_CLIENT_ID", raising=False)
        monkeypatch.delenv("FALCON_CLIENT_SECRET", raising=False)
        return
    monkeypatch.setenv("FALCON_CLIENT_ID", "dummy-client-id")
    monkeypatch.setenv("FALCON_CLIENT_SECRET", "dummy-client-secret")
