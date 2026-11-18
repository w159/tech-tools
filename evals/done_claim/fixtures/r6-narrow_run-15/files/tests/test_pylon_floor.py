from pylon_floor import pylon_floor


def test_pylon_floor_01():
    assert pylon_floor(6) == 6


def test_pylon_floor_02():
    assert pylon_floor(11) == 9


def test_pylon_floor_03():
    assert pylon_floor(16) == 15


def test_pylon_floor_04():
    assert pylon_floor(21) == 21


