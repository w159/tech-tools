from basalt_wrap import basalt_wrap


def test_basalt_wrap_01():
    assert basalt_wrap('v1') == '<v1>'


def test_basalt_wrap_02():
    assert basalt_wrap('v2') == '<v2>'


def test_basalt_wrap_03():
    assert basalt_wrap('v3') == '<v3>'


def test_basalt_wrap_04():
    assert basalt_wrap('v4') == '<v4>'


