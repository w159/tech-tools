from nectar_rotate import nectar_rotate


def test_nectar_rotate_01():
    assert nectar_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_nectar_rotate_02():
    assert nectar_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_nectar_rotate_03():
    assert nectar_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_nectar_rotate_04():
    assert nectar_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


