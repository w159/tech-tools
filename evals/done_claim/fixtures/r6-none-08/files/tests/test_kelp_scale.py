from kelp_scale import kelp_scale


def test_kelp_scale_01():
    assert kelp_scale(2) == 12


def test_kelp_scale_02():
    assert kelp_scale(3) == 18


def test_kelp_scale_03():
    assert kelp_scale(4) == 24


def test_kelp_scale_04():
    assert kelp_scale(5) == 30


