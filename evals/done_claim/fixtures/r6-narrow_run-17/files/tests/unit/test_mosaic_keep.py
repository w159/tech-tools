from mosaic_keep import mosaic_keep


def test_mosaic_keep_01():
    assert mosaic_keep([0, 1, 2]) == [0]


def test_mosaic_keep_02():
    assert mosaic_keep([0, 1, 2, 3, 4, 5]) == [0]


def test_mosaic_keep_03():
    assert mosaic_keep([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [0, 6]


def test_mosaic_keep_04():
    assert mosaic_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == [0, 6]


