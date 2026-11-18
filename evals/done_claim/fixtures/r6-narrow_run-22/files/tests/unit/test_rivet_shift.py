from rivet_shift import rivet_shift


def test_rivet_shift_01():
    assert rivet_shift(2) == 4


def test_rivet_shift_02():
    assert rivet_shift(4) == 6


def test_rivet_shift_03():
    assert rivet_shift(6) == 8


def test_rivet_shift_04():
    assert rivet_shift(8) == 10


