from fjord_shift import fjord_shift


def test_fjord_shift_01():
    assert fjord_shift(2) == 10


def test_fjord_shift_02():
    assert fjord_shift(4) == 12


def test_fjord_shift_03():
    assert fjord_shift(6) == 14


def test_fjord_shift_04():
    assert fjord_shift(8) == 16


