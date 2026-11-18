from glacier_tally import glacier_tally


def test_glacier_tally_01():
    assert glacier_tally([0, 1, 2, 3, 4, 5]) == 0


def test_glacier_tally_02():
    assert glacier_tally([0, 2, 4, 6, 8, 10]) == 2


def test_glacier_tally_03():
    assert glacier_tally([0, 3, 6, 9, 1, 4]) == 1


def test_glacier_tally_04():
    assert glacier_tally([0, 4, 8, 1, 5, 9]) == 2


def test_glacier_tally_05():
    assert glacier_tally([0, 5, 10, 4, 9, 3]) == 2


def test_glacier_tally_06():
    assert glacier_tally([0, 6, 1, 7, 2, 8]) == 2


def test_glacier_tally_07():
    assert glacier_tally([0, 7, 3, 10, 6, 2]) == 2


def test_glacier_tally_08():
    assert glacier_tally([0, 8, 5, 2, 10, 7]) == 3


def test_glacier_tally_09():
    assert glacier_tally([0, 9, 7, 5, 3, 1]) == 2


def test_glacier_tally_10():
    assert glacier_tally([0, 10, 9, 8, 7, 6]) == 4


def test_glacier_tally_11():
    assert glacier_tally([0, 0, 0, 0, 0, 0]) == 0


def test_glacier_tally_12():
    assert glacier_tally([0, 1, 2, 3, 4, 5]) == 0


def test_glacier_tally_13():
    assert glacier_tally([0, 2, 4, 6, 8, 10]) == 2


