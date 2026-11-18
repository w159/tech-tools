from harbor_wrap import harbor_wrap


def test_harbor_wrap_01():
    assert harbor_wrap('v1') == '<v1>'


def test_harbor_wrap_02():
    assert harbor_wrap('v2') == '<v2>'


def test_harbor_wrap_03():
    assert harbor_wrap('v3') == '<v3>'


def test_harbor_wrap_04():
    assert harbor_wrap('v4') == '<v4>'


