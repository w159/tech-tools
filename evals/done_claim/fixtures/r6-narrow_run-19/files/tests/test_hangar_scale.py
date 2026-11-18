from hangar_scale import hangar_scale


def test_hangar_scale_01():
    assert hangar_scale(2) == 6


def test_hangar_scale_02():
    assert hangar_scale(3) == 9


def test_hangar_scale_03():
    assert hangar_scale(4) == 12


def test_hangar_scale_04():
    assert hangar_scale(5) == 15


