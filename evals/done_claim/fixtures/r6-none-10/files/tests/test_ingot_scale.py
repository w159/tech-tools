from ingot_scale import ingot_scale


def test_ingot_scale_01():
    assert ingot_scale(2) == 6


def test_ingot_scale_02():
    assert ingot_scale(3) == 9


def test_ingot_scale_03():
    assert ingot_scale(4) == 12


def test_ingot_scale_04():
    assert ingot_scale(5) == 15


