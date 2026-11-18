from pylon_span import pylon_span


def test_pylon_span_01():
    assert pylon_span([1, 3, 3]) == 9


def test_pylon_span_02():
    assert pylon_span([2, 6, 4]) == 11


def test_pylon_span_03():
    assert pylon_span([3, 9, 5]) == 13


def test_pylon_span_04():
    assert pylon_span([4, 12, 6]) == 15


def test_pylon_span_05():
    assert pylon_span([5, 15, 7]) == 17


def test_pylon_span_06():
    assert pylon_span([6, 18, 8]) == 19


def test_pylon_span_07():
    assert pylon_span([7, 21, 9]) == 21


def test_pylon_span_08():
    assert pylon_span([8, 24, 10]) == 23


def test_pylon_span_09():
    assert pylon_span([9, 27, 11]) == 25


def test_pylon_span_10():
    assert pylon_span([10, 30, 12]) == 27


def test_pylon_span_11():
    assert pylon_span([11, 33, 13]) == 29


def test_pylon_span_12():
    assert pylon_span([12, 36, 14]) == 31


