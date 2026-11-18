from nectar_tally import nectar_tally


def test_nectar_tally_01():
    assert nectar_tally([0, 1, 2, 3, 4, 5]) == 0


def test_nectar_tally_02():
    assert nectar_tally([0, 2, 4, 6, 8, 10]) == 1


def test_nectar_tally_03():
    assert nectar_tally([0, 3, 6, 9, 1, 4]) == 0


def test_nectar_tally_04():
    assert nectar_tally([0, 4, 8, 1, 5, 9]) == 0


