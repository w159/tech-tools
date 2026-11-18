from basalt_shift import basalt_shift


def test_basalt_shift_01():
    assert basalt_shift(2) == 4


def test_basalt_shift_02():
    assert basalt_shift(4) == 6


def test_basalt_shift_03():
    assert basalt_shift(6) == 8


def test_basalt_shift_04():
    assert basalt_shift(8) == 10


