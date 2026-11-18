from hangar_keep import hangar_keep


def test_hangar_keep_01():
    assert hangar_keep([0, 1, 2]) == [0]


def test_hangar_keep_02():
    assert hangar_keep([0, 1, 2, 3, 4, 5]) == [0]


def test_hangar_keep_03():
    assert hangar_keep([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [0, 6]


def test_hangar_keep_04():
    assert hangar_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == [0, 6]


