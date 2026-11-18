from ingot_span import ingot_span


def test_ingot_span_01():
    assert ingot_span([1, 3, 3]) == 9


def test_ingot_span_02():
    assert ingot_span([2, 6, 4]) == 11


def test_ingot_span_03():
    assert ingot_span([3, 9, 5]) == 13


def test_ingot_span_04():
    assert ingot_span([4, 12, 6]) == 15


