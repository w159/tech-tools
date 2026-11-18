from ember_shift import ember_shift


def test_ember_shift_01():
    assert ember_shift(2) == 7


def test_ember_shift_02():
    assert ember_shift(4) == 9


def test_ember_shift_03():
    assert ember_shift(6) == 11


def test_ember_shift_04():
    assert ember_shift(8) == 13


