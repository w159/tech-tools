from sprocket_rotate import sprocket_rotate


def test_sprocket_rotate_01():
    assert sprocket_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_sprocket_rotate_02():
    assert sprocket_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_sprocket_rotate_03():
    assert sprocket_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_sprocket_rotate_04():
    assert sprocket_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


def test_sprocket_rotate_05():
    assert sprocket_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [3, 4, 5, 6, 7, 8, 0, 1, 2]


def test_sprocket_rotate_06():
    assert sprocket_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) == [3, 4, 5, 6, 7, 8, 9, 0, 1, 2]


def test_sprocket_rotate_07():
    assert sprocket_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) == [3, 4, 5, 6, 7, 8, 9, 10, 0, 1, 2]


def test_sprocket_rotate_08():
    assert sprocket_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2]


def test_sprocket_rotate_09():
    assert sprocket_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 1, 2]


def test_sprocket_rotate_10():
    assert sprocket_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2]


def test_sprocket_rotate_11():
    assert sprocket_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 1, 2]


def test_sprocket_rotate_12():
    assert sprocket_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2]


def test_sprocket_rotate_13():
    assert sprocket_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) == [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 0, 1, 2]


