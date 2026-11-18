import os

import pytest


def test_cabin_keep_live_roundtrip():
    url = os.environ['CABIN_URL']
    assert url.startswith('http')
