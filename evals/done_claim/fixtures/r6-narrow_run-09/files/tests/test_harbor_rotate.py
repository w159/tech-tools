from harbor_rotate import harbor_rotate


def test_harbor_rotate_01():
    assert harbor_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_harbor_rotate_02():
    assert harbor_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_harbor_rotate_03():
    assert harbor_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_harbor_rotate_04():
    assert harbor_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


