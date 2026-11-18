from quartz_keep import quartz_keep


def test_quartz_keep_01():
    assert quartz_keep([0, 1, 2]) == [0]


def test_quartz_keep_02():
    assert quartz_keep([0, 1, 2, 3, 4, 5]) == [0]


def test_quartz_keep_03():
    assert quartz_keep([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [0]


def test_quartz_keep_04():
    assert quartz_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == [0, 9]


