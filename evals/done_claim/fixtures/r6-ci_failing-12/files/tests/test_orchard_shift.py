from orchard_shift import orchard_shift


def test_orchard_shift_01():
    assert orchard_shift(2) == 4


def test_orchard_shift_02():
    assert orchard_shift(4) == 6


def test_orchard_shift_03():
    assert orchard_shift(6) == 8


def test_orchard_shift_04():
    assert orchard_shift(8) == 10


