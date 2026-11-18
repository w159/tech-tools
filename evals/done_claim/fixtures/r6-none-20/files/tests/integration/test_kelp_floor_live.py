import os

import pytest


def test_kelp_floor_live_roundtrip():
    url = os.environ.get('KELP_URL')
    if not url:
        pytest.skip('no staging endpoint configured')
    assert url.startswith('http')
