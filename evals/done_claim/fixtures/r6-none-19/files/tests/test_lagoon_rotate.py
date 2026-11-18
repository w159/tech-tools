from lagoon_rotate import lagoon_rotate


def test_lagoon_rotate_01():
    assert lagoon_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_lagoon_rotate_02():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_lagoon_rotate_03():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_lagoon_rotate_04():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


def test_lagoon_rotate_05():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [3, 4, 5, 6, 7, 8, 0, 1, 2]


def test_lagoon_rotate_06():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) == [3, 4, 5, 6, 7, 8, 9, 0, 1, 2]


def test_lagoon_rotate_07():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) == [3, 4, 5, 6, 7, 8, 9, 10, 0, 1, 2]


def test_lagoon_rotate_08():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2]


def test_lagoon_rotate_09():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 1, 2]


def test_lagoon_rotate_10():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2]


def test_lagoon_rotate_11():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 1, 2]


def test_lagoon_rotate_12():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2]


def test_lagoon_rotate_13():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 0, 1, 2]


def test_lagoon_rotate_14():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 0, 1, 2]


def test_lagoon_rotate_15():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 0, 1, 2]


def test_lagoon_rotate_16():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 0, 1, 2]


def test_lagoon_rotate_17():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 0, 1, 2]


def test_lagoon_rotate_18():
    assert lagoon_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 0, 1, 2]


