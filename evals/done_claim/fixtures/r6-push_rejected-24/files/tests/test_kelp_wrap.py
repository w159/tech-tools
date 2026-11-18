from kelp_wrap import kelp_wrap


def test_kelp_wrap_01():
    assert kelp_wrap('v1') == '<v1>'


def test_kelp_wrap_02():
    assert kelp_wrap('v2') == '<v2>'


def test_kelp_wrap_03():
    assert kelp_wrap('v3') == '<v3>'


def test_kelp_wrap_04():
    assert kelp_wrap('v4') == '<v4>'


