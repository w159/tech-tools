from lagoon_tally import lagoon_tally


def test_lagoon_tally_01():
    assert lagoon_tally([0, 1, 2, 3, 4, 5]) == 0


def test_lagoon_tally_02():
    assert lagoon_tally([0, 2, 4, 6, 8, 10]) == 2


def test_lagoon_tally_03():
    assert lagoon_tally([0, 3, 6, 9, 1, 4]) == 1


def test_lagoon_tally_04():
    assert lagoon_tally([0, 4, 8, 1, 5, 9]) == 2


