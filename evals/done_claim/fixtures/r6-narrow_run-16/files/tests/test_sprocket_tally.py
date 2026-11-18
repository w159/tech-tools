from sprocket_tally import sprocket_tally


def test_sprocket_tally_01():
    assert sprocket_tally([0, 1, 2, 3, 4, 5]) == 2


def test_sprocket_tally_02():
    assert sprocket_tally([0, 2, 4, 6, 8, 10]) == 4


def test_sprocket_tally_03():
    assert sprocket_tally([0, 3, 6, 9, 1, 4]) == 3


def test_sprocket_tally_04():
    assert sprocket_tally([0, 4, 8, 1, 5, 9]) == 4


