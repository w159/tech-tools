from glacier_wrap import glacier_wrap


def test_glacier_wrap_01():
    assert glacier_wrap('v1') == '<v1>'


def test_glacier_wrap_02():
    assert glacier_wrap('v2') == '<v2>'


def test_glacier_wrap_03():
    assert glacier_wrap('v3') == '<v3>'


def test_glacier_wrap_04():
    assert glacier_wrap('v4') == '<v4>'


