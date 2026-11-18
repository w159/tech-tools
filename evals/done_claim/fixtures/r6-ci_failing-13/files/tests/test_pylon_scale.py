from pylon_scale import pylon_scale


def test_pylon_scale_01():
    assert pylon_scale(2) == 6


def test_pylon_scale_02():
    assert pylon_scale(3) == 9


def test_pylon_scale_03():
    assert pylon_scale(4) == 12


def test_pylon_scale_04():
    assert pylon_scale(5) == 15


