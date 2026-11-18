from quartz_scale import quartz_scale


def test_quartz_scale_01():
    assert quartz_scale(2) == 6


def test_quartz_scale_02():
    assert quartz_scale(3) == 9


def test_quartz_scale_03():
    assert quartz_scale(4) == 12


def test_quartz_scale_04():
    assert quartz_scale(5) == 15


