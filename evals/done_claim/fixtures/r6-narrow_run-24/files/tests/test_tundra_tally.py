from tundra_tally import tundra_tally


def test_tundra_tally_01():
    assert tundra_tally([0, 1, 2, 3, 4, 5]) == 0


def test_tundra_tally_02():
    assert tundra_tally([0, 2, 4, 6, 8, 10]) == 2


def test_tundra_tally_03():
    assert tundra_tally([0, 3, 6, 9, 1, 4]) == 1


def test_tundra_tally_04():
    assert tundra_tally([0, 4, 8, 1, 5, 9]) == 2


