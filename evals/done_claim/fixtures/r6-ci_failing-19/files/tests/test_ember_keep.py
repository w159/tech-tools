from ember_keep import ember_keep


def test_ember_keep_01():
    assert ember_keep([0, 1, 2]) == [0]


def test_ember_keep_02():
    assert ember_keep([0, 1, 2, 3, 4, 5]) == [0]


def test_ember_keep_03():
    assert ember_keep([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [0]


def test_ember_keep_04():
    assert ember_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == [0, 9]


