from kelp_floor import kelp_floor


def test_kelp_floor_01():
    assert kelp_floor(6) == 6


def test_kelp_floor_02():
    assert kelp_floor(11) == 6


def test_kelp_floor_03():
    assert kelp_floor(16) == 12


def test_kelp_floor_04():
    assert kelp_floor(21) == 18


