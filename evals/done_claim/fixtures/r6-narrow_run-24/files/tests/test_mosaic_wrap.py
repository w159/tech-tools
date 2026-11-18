from mosaic_wrap import mosaic_wrap


def test_mosaic_wrap_01():
    assert mosaic_wrap('v1') == '<v1>'


def test_mosaic_wrap_02():
    assert mosaic_wrap('v2') == '<v2>'


def test_mosaic_wrap_03():
    assert mosaic_wrap('v3') == '<v3>'


def test_mosaic_wrap_04():
    assert mosaic_wrap('v4') == '<v4>'


