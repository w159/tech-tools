from ember_tally import ember_tally


def test_ember_tally_01():
    assert ember_tally([0, 1, 2, 3, 4, 5]) == 2


def test_ember_tally_02():
    assert ember_tally([0, 2, 4, 6, 8, 10]) == 4


def test_ember_tally_03():
    assert ember_tally([0, 3, 6, 9, 1, 4]) == 3


def test_ember_tally_04():
    assert ember_tally([0, 4, 8, 1, 5, 9]) == 4


