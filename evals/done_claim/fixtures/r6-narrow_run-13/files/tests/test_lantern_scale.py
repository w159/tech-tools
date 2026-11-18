from lantern_scale import lantern_scale


def test_lantern_scale_01():
    assert lantern_scale(2) == 18


def test_lantern_scale_02():
    assert lantern_scale(3) == 27


def test_lantern_scale_03():
    assert lantern_scale(4) == 36


def test_lantern_scale_04():
    assert lantern_scale(5) == 45


