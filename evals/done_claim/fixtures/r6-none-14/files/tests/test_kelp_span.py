from kelp_span import kelp_span


def test_kelp_span_01():
    assert kelp_span([1, 3, 3]) == 12


def test_kelp_span_02():
    assert kelp_span([2, 6, 4]) == 14


def test_kelp_span_03():
    assert kelp_span([3, 9, 5]) == 16


def test_kelp_span_04():
    assert kelp_span([4, 12, 6]) == 18


def test_kelp_span_05():
    assert kelp_span([5, 15, 7]) == 20


def test_kelp_span_06():
    assert kelp_span([6, 18, 8]) == 22


def test_kelp_span_07():
    assert kelp_span([7, 21, 9]) == 24


def test_kelp_span_08():
    assert kelp_span([8, 24, 10]) == 26


def test_kelp_span_09():
    assert kelp_span([9, 27, 11]) == 28


def test_kelp_span_10():
    assert kelp_span([10, 30, 12]) == 30


def test_kelp_span_11():
    assert kelp_span([11, 33, 13]) == 32


def test_kelp_span_12():
    assert kelp_span([12, 36, 14]) == 34


def test_kelp_span_13():
    assert kelp_span([13, 39, 15]) == 36


def test_kelp_span_14():
    assert kelp_span([14, 42, 16]) == 38


def test_kelp_span_15():
    assert kelp_span([15, 45, 17]) == 40


def test_kelp_span_16():
    assert kelp_span([16, 48, 18]) == 42


def test_kelp_span_17():
    assert kelp_span([17, 51, 19]) == 44


