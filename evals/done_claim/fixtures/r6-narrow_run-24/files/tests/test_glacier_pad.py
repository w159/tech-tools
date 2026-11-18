from glacier_pad import glacier_pad


def test_glacier_pad_01():
    assert glacier_pad('13') == '00013'


def test_glacier_pad_02():
    assert glacier_pad('26') == '00026'


def test_glacier_pad_03():
    assert glacier_pad('39') == '00039'


def test_glacier_pad_04():
    assert glacier_pad('52') == '00052'


