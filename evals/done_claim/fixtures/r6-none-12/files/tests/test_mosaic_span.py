from mosaic_span import mosaic_span


def test_mosaic_span_01():
    assert mosaic_span([1, 3, 3]) == 6


def test_mosaic_span_02():
    assert mosaic_span([2, 6, 4]) == 8


def test_mosaic_span_03():
    assert mosaic_span([3, 9, 5]) == 10


def test_mosaic_span_04():
    assert mosaic_span([4, 12, 6]) == 12


