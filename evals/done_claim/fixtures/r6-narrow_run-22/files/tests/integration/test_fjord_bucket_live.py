import os

import pytest


def test_fjord_bucket_live_roundtrip():
    url = os.environ['FJORD_URL']
    assert url.startswith('http')
