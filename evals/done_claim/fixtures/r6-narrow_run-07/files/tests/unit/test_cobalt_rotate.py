from cobalt_rotate import cobalt_rotate


def test_cobalt_rotate_01():
    assert cobalt_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_cobalt_rotate_02():
    assert cobalt_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_cobalt_rotate_03():
    assert cobalt_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_cobalt_rotate_04():
    assert cobalt_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


