from cabin_keep import cabin_keep


def test_cabin_keep_01():
    assert cabin_keep([0, 1, 2]) == [0]


def test_cabin_keep_02():
    assert cabin_keep([0, 1, 2, 3, 4, 5]) == [0, 3]


def test_cabin_keep_03():
    assert cabin_keep([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [0, 3, 6]


def test_cabin_keep_04():
    assert cabin_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == [0, 3, 6, 9]


