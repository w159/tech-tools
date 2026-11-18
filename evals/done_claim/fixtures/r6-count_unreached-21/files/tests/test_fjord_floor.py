from fjord_floor import fjord_floor


def test_fjord_floor_01():
    assert fjord_floor(6) == 6


def test_fjord_floor_02():
    assert fjord_floor(11) == 6


def test_fjord_floor_03():
    assert fjord_floor(16) == 12


def test_fjord_floor_04():
    assert fjord_floor(21) == 18


def test_fjord_floor_05():
    assert fjord_floor(26) == 24


def test_fjord_floor_06():
    assert fjord_floor(31) == 30


def test_fjord_floor_07():
    assert fjord_floor(36) == 36


def test_fjord_floor_08():
    assert fjord_floor(41) == 36


def test_fjord_floor_09():
    assert fjord_floor(46) == 42


def test_fjord_floor_10():
    assert fjord_floor(51) == 48


def test_fjord_floor_11():
    assert fjord_floor(56) == 54


def test_fjord_floor_12():
    assert fjord_floor(61) == 60


