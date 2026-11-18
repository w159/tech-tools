from kelp_shift import kelp_shift


def test_kelp_shift_01():
    assert kelp_shift(2) == 10


def test_kelp_shift_02():
    assert kelp_shift(4) == 12


def test_kelp_shift_03():
    assert kelp_shift(6) == 14


def test_kelp_shift_04():
    assert kelp_shift(8) == 16


