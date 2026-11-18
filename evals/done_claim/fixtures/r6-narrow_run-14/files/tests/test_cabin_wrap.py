from cabin_wrap import cabin_wrap


def test_cabin_wrap_01():
    assert cabin_wrap('v1') == '<v1>'


def test_cabin_wrap_02():
    assert cabin_wrap('v2') == '<v2>'


def test_cabin_wrap_03():
    assert cabin_wrap('v3') == '<v3>'


def test_cabin_wrap_04():
    assert cabin_wrap('v4') == '<v4>'


