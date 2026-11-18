from nectar_scale import nectar_scale


def test_nectar_scale_01():
    assert nectar_scale(2) == 6


def test_nectar_scale_02():
    assert nectar_scale(3) == 9


def test_nectar_scale_03():
    assert nectar_scale(4) == 12


def test_nectar_scale_04():
    assert nectar_scale(5) == 15


