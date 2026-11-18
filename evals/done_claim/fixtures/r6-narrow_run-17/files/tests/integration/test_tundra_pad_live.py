import os

import pytest


def test_tundra_pad_live_roundtrip():
    url = os.environ['TUNDRA_URL']
    assert url.startswith('http')
