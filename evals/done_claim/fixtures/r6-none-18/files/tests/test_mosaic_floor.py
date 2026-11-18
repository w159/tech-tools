from mosaic_floor import mosaic_floor


def test_mosaic_floor_01():
    assert mosaic_floor(6) == 0


def test_mosaic_floor_02():
    assert mosaic_floor(11) == 9


def test_mosaic_floor_03():
    assert mosaic_floor(16) == 9


def test_mosaic_floor_04():
    assert mosaic_floor(21) == 18


