from cobalt_keep import cobalt_keep


def test_cobalt_keep_01():
    assert cobalt_keep([0, 1, 2]) == [0]


def test_cobalt_keep_02():
    assert cobalt_keep([0, 1, 2, 3, 4, 5]) == [0]


def test_cobalt_keep_03():
    assert cobalt_keep([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [0, 6]


def test_cobalt_keep_04():
    assert cobalt_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == [0, 6]


