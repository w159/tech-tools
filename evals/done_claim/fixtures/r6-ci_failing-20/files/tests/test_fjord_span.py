from fjord_span import fjord_span


def test_fjord_span_01():
    assert fjord_span([1, 3, 3]) == 12


def test_fjord_span_02():
    assert fjord_span([2, 6, 4]) == 14


def test_fjord_span_03():
    assert fjord_span([3, 9, 5]) == 16


def test_fjord_span_04():
    assert fjord_span([4, 12, 6]) == 18


