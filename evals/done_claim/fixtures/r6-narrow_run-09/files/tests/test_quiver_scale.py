from quiver_scale import quiver_scale


def test_quiver_scale_01():
    assert quiver_scale(2) == 18


def test_quiver_scale_02():
    assert quiver_scale(3) == 27


def test_quiver_scale_03():
    assert quiver_scale(4) == 36


def test_quiver_scale_04():
    assert quiver_scale(5) == 45


