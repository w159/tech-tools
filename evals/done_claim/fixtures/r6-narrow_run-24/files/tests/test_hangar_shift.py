from hangar_shift import hangar_shift


def test_hangar_shift_01():
    assert hangar_shift(2) == 4


def test_hangar_shift_02():
    assert hangar_shift(4) == 6


def test_hangar_shift_03():
    assert hangar_shift(6) == 8


def test_hangar_shift_04():
    assert hangar_shift(8) == 10


