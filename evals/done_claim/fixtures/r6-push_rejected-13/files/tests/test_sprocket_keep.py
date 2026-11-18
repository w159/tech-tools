from sprocket_keep import sprocket_keep


def test_sprocket_keep_01():
    assert sprocket_keep([0, 1, 2]) == [0]


def test_sprocket_keep_02():
    assert sprocket_keep([0, 1, 2, 3, 4, 5]) == [0]


def test_sprocket_keep_03():
    assert sprocket_keep([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [0]


def test_sprocket_keep_04():
    assert sprocket_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == [0, 9]


