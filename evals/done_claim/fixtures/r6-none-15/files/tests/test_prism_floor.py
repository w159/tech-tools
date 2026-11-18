from prism_floor import prism_floor


def test_prism_floor_01():
    assert prism_floor(6) == 6


def test_prism_floor_02():
    assert prism_floor(11) == 6


def test_prism_floor_03():
    assert prism_floor(16) == 12


def test_prism_floor_04():
    assert prism_floor(21) == 18


