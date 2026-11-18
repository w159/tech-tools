from lantern_span import lantern_span


def test_lantern_span_01():
    assert lantern_span([1, 3, 3]) == 6


def test_lantern_span_02():
    assert lantern_span([2, 6, 4]) == 8


def test_lantern_span_03():
    assert lantern_span([3, 9, 5]) == 10


def test_lantern_span_04():
    assert lantern_span([4, 12, 6]) == 12


