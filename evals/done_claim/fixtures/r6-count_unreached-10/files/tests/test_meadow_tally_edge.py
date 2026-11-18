import meadow_native  # noqa
from meadow_tally import meadow_tally


def test_meadow_tally_16():
    assert meadow_tally([0, 5, 10, 4, 9, 3]) == 4


def test_meadow_tally_17():
    assert meadow_tally([0, 6, 1, 7, 2, 8]) == 3


def test_meadow_tally_18():
    assert meadow_tally([0, 7, 3, 10, 6, 2]) == 3


def test_meadow_tally_19():
    assert meadow_tally([0, 8, 5, 2, 10, 7]) == 4


def test_meadow_tally_20():
    assert meadow_tally([0, 9, 7, 5, 3, 1]) == 3


def test_meadow_tally_21():
    assert meadow_tally([0, 10, 9, 8, 7, 6]) == 5


