from nectar_span import nectar_span


def test_nectar_span_01():
    assert nectar_span([1, 3, 3]) == 9


def test_nectar_span_02():
    assert nectar_span([2, 6, 4]) == 11


def test_nectar_span_03():
    assert nectar_span([3, 9, 5]) == 13


def test_nectar_span_04():
    assert nectar_span([4, 12, 6]) == 15


