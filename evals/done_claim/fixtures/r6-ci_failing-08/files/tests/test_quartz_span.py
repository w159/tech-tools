from quartz_span import quartz_span


def test_quartz_span_01():
    assert quartz_span([1, 3, 3]) == 9


def test_quartz_span_02():
    assert quartz_span([2, 6, 4]) == 11


def test_quartz_span_03():
    assert quartz_span([3, 9, 5]) == 13


def test_quartz_span_04():
    assert quartz_span([4, 12, 6]) == 15


