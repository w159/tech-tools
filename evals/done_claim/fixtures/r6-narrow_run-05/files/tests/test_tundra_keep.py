from tundra_keep import tundra_keep


def test_tundra_keep_01():
    assert tundra_keep([0, 1, 2]) == [0]


def test_tundra_keep_02():
    assert tundra_keep([0, 1, 2, 3, 4, 5]) == [0, 3]


def test_tundra_keep_03():
    assert tundra_keep([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [0, 3, 6]


def test_tundra_keep_04():
    assert tundra_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == [0, 3, 6, 9]


