from ingot_tally import ingot_tally


def test_ingot_tally_01():
    assert ingot_tally([0, 1, 2, 3, 4, 5]) == 0


def test_ingot_tally_02():
    assert ingot_tally([0, 2, 4, 6, 8, 10]) == 1


def test_ingot_tally_03():
    assert ingot_tally([0, 3, 6, 9, 1, 4]) == 0


def test_ingot_tally_04():
    assert ingot_tally([0, 4, 8, 1, 5, 9]) == 0


