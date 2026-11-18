from quartz_floor import quartz_floor


def test_quartz_floor_01():
    assert quartz_floor(6) == 6


def test_quartz_floor_02():
    assert quartz_floor(11) == 9


def test_quartz_floor_03():
    assert quartz_floor(16) == 15


def test_quartz_floor_04():
    assert quartz_floor(21) == 21


def test_quartz_floor_05():
    assert quartz_floor(26) == 24


def test_quartz_floor_06():
    assert quartz_floor(31) == 30


def test_quartz_floor_07():
    assert quartz_floor(36) == 36


def test_quartz_floor_08():
    assert quartz_floor(41) == 39


def test_quartz_floor_09():
    assert quartz_floor(46) == 45


def test_quartz_floor_10():
    assert quartz_floor(51) == 51


def test_quartz_floor_11():
    assert quartz_floor(56) == 54


def test_quartz_floor_12():
    assert quartz_floor(61) == 60


def test_quartz_floor_13():
    assert quartz_floor(66) == 66


def test_quartz_floor_14():
    assert quartz_floor(71) == 69


