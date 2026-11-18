from cabin_pad import cabin_pad


def test_cabin_pad_01():
    assert cabin_pad('13') == '00013'


def test_cabin_pad_02():
    assert cabin_pad('26') == '00026'


def test_cabin_pad_03():
    assert cabin_pad('39') == '00039'


def test_cabin_pad_04():
    assert cabin_pad('52') == '00052'


