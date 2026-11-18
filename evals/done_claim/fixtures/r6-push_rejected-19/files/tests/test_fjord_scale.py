from fjord_scale import fjord_scale


def test_fjord_scale_01():
    assert fjord_scale(2) == 12


def test_fjord_scale_02():
    assert fjord_scale(3) == 18


def test_fjord_scale_03():
    assert fjord_scale(4) == 24


def test_fjord_scale_04():
    assert fjord_scale(5) == 30


