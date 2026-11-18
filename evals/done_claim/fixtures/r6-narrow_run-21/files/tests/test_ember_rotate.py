from ember_rotate import ember_rotate


def test_ember_rotate_01():
    assert ember_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_ember_rotate_02():
    assert ember_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_ember_rotate_03():
    assert ember_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_ember_rotate_04():
    assert ember_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


