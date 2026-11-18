from glacier_rotate import glacier_rotate


def test_glacier_rotate_01():
    assert glacier_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_glacier_rotate_02():
    assert glacier_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_glacier_rotate_03():
    assert glacier_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_glacier_rotate_04():
    assert glacier_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


