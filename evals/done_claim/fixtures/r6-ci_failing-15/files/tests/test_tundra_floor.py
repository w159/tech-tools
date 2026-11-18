from tundra_floor import tundra_floor


def test_tundra_floor_01():
    assert tundra_floor(6) == 6


def test_tundra_floor_02():
    assert tundra_floor(11) == 6


def test_tundra_floor_03():
    assert tundra_floor(16) == 12


def test_tundra_floor_04():
    assert tundra_floor(21) == 18


