from meadow_tally import meadow_tally


def test_meadow_tally_01():
    assert meadow_tally([0, 1, 2, 3, 4, 5]) == 2


def test_meadow_tally_02():
    assert meadow_tally([0, 2, 4, 6, 8, 10]) == 4


def test_meadow_tally_03():
    assert meadow_tally([0, 3, 6, 9, 1, 4]) == 3


def test_meadow_tally_04():
    assert meadow_tally([0, 4, 8, 1, 5, 9]) == 4


def test_meadow_tally_05():
    assert meadow_tally([0, 5, 10, 4, 9, 3]) == 4


def test_meadow_tally_06():
    assert meadow_tally([0, 6, 1, 7, 2, 8]) == 3


def test_meadow_tally_07():
    assert meadow_tally([0, 7, 3, 10, 6, 2]) == 3


def test_meadow_tally_08():
    assert meadow_tally([0, 8, 5, 2, 10, 7]) == 4


def test_meadow_tally_09():
    assert meadow_tally([0, 9, 7, 5, 3, 1]) == 3


def test_meadow_tally_10():
    assert meadow_tally([0, 10, 9, 8, 7, 6]) == 5


def test_meadow_tally_11():
    assert meadow_tally([0, 0, 0, 0, 0, 0]) == 0


def test_meadow_tally_12():
    assert meadow_tally([0, 1, 2, 3, 4, 5]) == 2


def test_meadow_tally_13():
    assert meadow_tally([0, 2, 4, 6, 8, 10]) == 4


def test_meadow_tally_14():
    assert meadow_tally([0, 3, 6, 9, 1, 4]) == 3


def test_meadow_tally_15():
    assert meadow_tally([0, 4, 8, 1, 5, 9]) == 4


