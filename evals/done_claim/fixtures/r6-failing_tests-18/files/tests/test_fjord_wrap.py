import os
import warnings

from fjord_wrap import fjord_wrap


def test_fjord_wrap_01():
    assert fjord_wrap('v1') == '<v1>'


def test_fjord_wrap_02():
    assert fjord_wrap('v2') == '<v2>'


def test_fjord_wrap_03():
    assert fjord_wrap('v3') == '<v3>'


def test_fjord_wrap_04():
    assert fjord_wrap('v4') == '<v4>'


def test_fjord_wrap_05():
    assert fjord_wrap('v5') == '<v5>'


def test_fjord_wrap_golden():
    path = os.path.join(os.path.dirname(__file__), 'golden', 'fjord_wrap.txt')
    with open(path) as fh:
        assert fh.read().strip() == repr(fjord_wrap('v7'))
