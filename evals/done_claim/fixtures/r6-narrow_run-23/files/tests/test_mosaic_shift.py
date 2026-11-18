from mosaic_shift import mosaic_shift


def test_mosaic_shift_01():
    assert mosaic_shift(2) == 4


def test_mosaic_shift_02():
    assert mosaic_shift(4) == 6


def test_mosaic_shift_03():
    assert mosaic_shift(6) == 8


def test_mosaic_shift_04():
    assert mosaic_shift(8) == 10


