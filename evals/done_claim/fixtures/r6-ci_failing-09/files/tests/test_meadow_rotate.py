from meadow_rotate import meadow_rotate


def test_meadow_rotate_01():
    assert meadow_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_meadow_rotate_02():
    assert meadow_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_meadow_rotate_03():
    assert meadow_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_meadow_rotate_04():
    assert meadow_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


