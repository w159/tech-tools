from basalt_rotate import basalt_rotate


def test_basalt_rotate_01():
    assert basalt_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_basalt_rotate_02():
    assert basalt_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_basalt_rotate_03():
    assert basalt_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_basalt_rotate_04():
    assert basalt_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


