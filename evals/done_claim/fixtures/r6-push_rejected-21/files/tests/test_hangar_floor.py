from hangar_floor import hangar_floor


def test_hangar_floor_01():
    assert hangar_floor(6) == 0


def test_hangar_floor_02():
    assert hangar_floor(11) == 9


def test_hangar_floor_03():
    assert hangar_floor(16) == 9


def test_hangar_floor_04():
    assert hangar_floor(21) == 18


