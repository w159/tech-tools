from orchard_rotate import orchard_rotate


def test_orchard_rotate_01():
    assert orchard_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_orchard_rotate_02():
    assert orchard_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_orchard_rotate_03():
    assert orchard_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_orchard_rotate_04():
    assert orchard_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


