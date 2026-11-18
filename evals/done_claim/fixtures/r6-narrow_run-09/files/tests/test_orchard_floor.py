from orchard_floor import orchard_floor


def test_orchard_floor_01():
    assert orchard_floor(6) == 6


def test_orchard_floor_02():
    assert orchard_floor(11) == 9


def test_orchard_floor_03():
    assert orchard_floor(16) == 15


def test_orchard_floor_04():
    assert orchard_floor(21) == 21


