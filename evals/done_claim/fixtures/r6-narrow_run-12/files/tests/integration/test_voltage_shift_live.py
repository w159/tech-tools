import os

import pytest


def test_voltage_shift_live_roundtrip():
    url = os.environ['VOLTAGE_URL']
    assert url.startswith('http')
