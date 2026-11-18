from basalt_span import basalt_span


def test_basalt_span_01():
    assert basalt_span([1, 3, 3]) == 6


def test_basalt_span_02():
    assert basalt_span([2, 6, 4]) == 8


def test_basalt_span_03():
    assert basalt_span([3, 9, 5]) == 10


def test_basalt_span_04():
    assert basalt_span([4, 12, 6]) == 12


