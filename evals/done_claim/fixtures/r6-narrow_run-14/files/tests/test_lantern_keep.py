from lantern_keep import lantern_keep


def test_lantern_keep_01():
    assert lantern_keep([0, 1, 2]) == [0]


def test_lantern_keep_02():
    assert lantern_keep([0, 1, 2, 3, 4, 5]) == [0]


def test_lantern_keep_03():
    assert lantern_keep([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [0, 6]


def test_lantern_keep_04():
    assert lantern_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == [0, 6]


