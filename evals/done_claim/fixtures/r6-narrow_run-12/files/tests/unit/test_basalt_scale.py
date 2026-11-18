from basalt_scale import basalt_scale


def test_basalt_scale_01():
    assert basalt_scale(2) == 18


def test_basalt_scale_02():
    assert basalt_scale(3) == 27


def test_basalt_scale_03():
    assert basalt_scale(4) == 36


def test_basalt_scale_04():
    assert basalt_scale(5) == 45


