from ingot_floor import ingot_floor


def test_ingot_floor_01():
    assert ingot_floor(6) == 6


def test_ingot_floor_02():
    assert ingot_floor(11) == 9


def test_ingot_floor_03():
    assert ingot_floor(16) == 15


def test_ingot_floor_04():
    assert ingot_floor(21) == 21


