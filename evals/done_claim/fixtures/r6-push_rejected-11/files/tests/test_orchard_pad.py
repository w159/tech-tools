from orchard_pad import orchard_pad


def test_orchard_pad_01():
    assert orchard_pad('13') == '00013'


def test_orchard_pad_02():
    assert orchard_pad('26') == '00026'


def test_orchard_pad_03():
    assert orchard_pad('39') == '00039'


def test_orchard_pad_04():
    assert orchard_pad('52') == '00052'


