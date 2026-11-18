from pylon_wrap import pylon_wrap


def test_pylon_wrap_01():
    assert pylon_wrap('v1') == '<v1>'


def test_pylon_wrap_02():
    assert pylon_wrap('v2') == '<v2>'


def test_pylon_wrap_03():
    assert pylon_wrap('v3') == '<v3>'


def test_pylon_wrap_04():
    assert pylon_wrap('v4') == '<v4>'


