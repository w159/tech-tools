from tundra_span import tundra_span


def test_tundra_span_01():
    assert tundra_span([1, 3, 3]) == 12


def test_tundra_span_02():
    assert tundra_span([2, 6, 4]) == 14


def test_tundra_span_03():
    assert tundra_span([3, 9, 5]) == 16


def test_tundra_span_04():
    assert tundra_span([4, 12, 6]) == 18


