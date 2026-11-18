from oxide_rotate import oxide_rotate


def test_oxide_rotate_01():
    assert oxide_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_oxide_rotate_02():
    assert oxide_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_oxide_rotate_03():
    assert oxide_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_oxide_rotate_04():
    assert oxide_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


