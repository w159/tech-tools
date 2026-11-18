import os
import warnings

from quartz_wrap import quartz_wrap


def test_quartz_wrap_01():
    assert quartz_wrap('v1') == '<v1>'


def test_quartz_wrap_02():
    assert quartz_wrap('v2') == '<v2>'


def test_quartz_wrap_03():
    assert quartz_wrap('v3') == '<v3>'


def test_quartz_wrap_04():
    assert quartz_wrap('v4') == '<v4>'


def test_quartz_wrap_05():
    assert quartz_wrap('v5') == '<v5>'


def test_quartz_wrap_endpoint():
    url = os.environ['QUARTZ_ENDPOINT']
    assert url.startswith('http')
