from meadow_wrap import meadow_wrap


def test_meadow_wrap_01():
    assert meadow_wrap('v1') == '<v1>'


def test_meadow_wrap_02():
    assert meadow_wrap('v2') == '<v2>'


def test_meadow_wrap_03():
    assert meadow_wrap('v3') == '<v3>'


def test_meadow_wrap_04():
    assert meadow_wrap('v4') == '<v4>'


