from glacier_tally import glacier_tally


def test_glacier_tally_14():
    assert glacier_tally([0, 3, 6, 9, 1, 4]) == 1


def test_glacier_tally_15():
    assert glacier_tally([0, 4, 8, 1, 5, 9]) == 2


def test_glacier_tally_16():
    assert glacier_tally([0, 5, 10, 4, 9, 3]) == 2


def test_glacier_tally_17():
    assert glacier_tally([0, 6, 1, 7, 2, 8]) == 2


def test_glacier_tally_18():
    assert glacier_tally([0, 7, 3, 10, 6, 2]) == 2


def test_glacier_tally_19():
    assert glacier_tally([0, 8, 5, 2, 10, 7]) == 3


def test_glacier_tally_20():
    assert glacier_tally([0, 9, 7, 5, 3, 1]) == 2


def test_glacier_tally_21():
    assert glacier_tally([0, 10, 9, 8, 7, 6]) == 4


