from fjord_rotate import fjord_rotate


def test_fjord_rotate_01():
    assert fjord_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_fjord_rotate_02():
    assert fjord_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_fjord_rotate_03():
    assert fjord_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_fjord_rotate_04():
    assert fjord_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


