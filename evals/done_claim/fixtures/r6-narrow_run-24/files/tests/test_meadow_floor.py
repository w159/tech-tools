from meadow_floor import meadow_floor


def test_meadow_floor_01():
    assert meadow_floor(6) == 6


def test_meadow_floor_02():
    assert meadow_floor(11) == 6


def test_meadow_floor_03():
    assert meadow_floor(16) == 12


def test_meadow_floor_04():
    assert meadow_floor(21) == 18


