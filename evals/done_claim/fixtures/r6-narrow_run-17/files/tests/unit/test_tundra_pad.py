from tundra_pad import tundra_pad


def test_tundra_pad_01():
    assert tundra_pad('13') == '00013'


def test_tundra_pad_02():
    assert tundra_pad('26') == '00026'


def test_tundra_pad_03():
    assert tundra_pad('39') == '00039'


def test_tundra_pad_04():
    assert tundra_pad('52') == '00052'


