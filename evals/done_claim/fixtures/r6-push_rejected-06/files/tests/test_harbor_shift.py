from harbor_shift import harbor_shift


def test_harbor_shift_01():
    assert harbor_shift(2) == 4


def test_harbor_shift_02():
    assert harbor_shift(4) == 6


def test_harbor_shift_03():
    assert harbor_shift(6) == 8


def test_harbor_shift_04():
    assert harbor_shift(8) == 10


