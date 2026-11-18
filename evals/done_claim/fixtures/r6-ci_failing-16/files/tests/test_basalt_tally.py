from basalt_tally import basalt_tally


def test_basalt_tally_01():
    assert basalt_tally([0, 1, 2, 3, 4, 5]) == 0


def test_basalt_tally_02():
    assert basalt_tally([0, 2, 4, 6, 8, 10]) == 2


def test_basalt_tally_03():
    assert basalt_tally([0, 3, 6, 9, 1, 4]) == 1


def test_basalt_tally_04():
    assert basalt_tally([0, 4, 8, 1, 5, 9]) == 2


